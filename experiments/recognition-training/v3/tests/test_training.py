import copy
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

import numpy as np
import onnxruntime as ort
import torch

ROOT = Path(__file__).resolve().parents[2]
V3 = ROOT / "v3"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(V3))
if "trainer" in sys.modules and Path(sys.modules["trainer"].__file__).resolve().parent != V3:
    del sys.modules["trainer"]

from dataset import Dataset
from diagnostic import DiagnosticError, evaluate_probabilities
import trainer as trainer_module
from trainer import (
    LogitTileNet, Recipe, TrainingError, _ledger_finish, _ledger_start,
    ensure_elapsed_within_available, initialize_shipped,
    mean_available_class_cross_entropy, train,
)


SHIPPED = (
    ROOT.parents[1]
    / "node_modules/.pnpm/@scoriiu+fenshot@0.1.4_onnxruntime-web@1.29.0/"
    "node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx"
)


def synthetic_dataset(split: str, boards: int = 13) -> tuple[Dataset, list[dict[str, str]]]:
    rng = np.random.default_rng(91 if split == "train" else 92)
    vectors = rng.random((boards, 64, 1024), dtype=np.float32)
    labels = np.asarray([[offset % 13 for offset in range(index, index + 64)] for index in range(boards)], dtype=np.int64)
    dataset = Dataset(split, vectors, labels, "v" * 64, "l" * 64, "m" * 64, "g" * 64, "s" * 64, frozenset(("a", "b")), boards)
    metadata = [
        {"family": "a" if index % 2 == 0 else "b", "style": "flat" if index % 3 == 0 else "hatch", "reduction": "1" if index % 3 == 0 else "0.64", "speckles": "absent" if index % 3 == 0 else "present"}
        for index in range(boards)
    ]
    return dataset, metadata


def tiny_recipe() -> Recipe:
    return Recipe("synthetic", 3820, 13, 13, 2, 120, 512, 1e-4, 1e-6, 1e-4, 0.7, (0, 0.5, 0.7, 0.9, 1), 1e-5, 1e-5)


class TrainingTests(unittest.TestCase):
    def test_minibatch_loss_is_the_mean_of_available_class_means(self) -> None:
        logits = torch.tensor([[3.0, 0.0], [0.0, 3.0], [0.0, 3.0]])
        labels = torch.tensor([0, 1, 1])
        per_item = torch.nn.functional.cross_entropy(logits, labels, reduction="none")
        expected = (per_item[0] + per_item[1:].mean()) / 2
        self.assertTrue(torch.equal(mean_available_class_cross_entropy(logits, labels), expected))

    def test_initializes_every_fused_weight_from_the_reviewed_shipped_model(self) -> None:
        model = initialize_shipped(SHIPPED)
        self.assertEqual(sum(value.numel() for value in model.parameters()), 321_485)
        self.assertFalse(any("bn" in name.lower() for name, _ in model.named_modules()))
        inputs = np.random.default_rng(17).random((16, 1024), dtype=np.float32)
        with torch.inference_mode():
            logits = model(torch.from_numpy(inputs))
        self.assertEqual(tuple(logits.shape), (16, 13))
        self.assertFalse(torch.allclose(logits.sum(1), torch.ones(16)))
        reconstructed = torch.softmax(logits, dim=1).numpy()
        shipped = ort.InferenceSession(str(SHIPPED), providers=["CPUExecutionProvider"]).run(["probs"], {"tiles": inputs})[0]
        np.testing.assert_allclose(reconstructed, shipped, atol=1e-5, rtol=1e-5)
        np.testing.assert_array_equal(reconstructed.argmax(1), shipped.argmax(1))

    def test_minibatch_checkpoint_recovers_deterministically_and_keeps_best_isolated(self) -> None:
        train_set, train_meta = synthetic_dataset("train")
        dev_set, dev_meta = synthetic_dataset("dev")
        recipe = tiny_recipe()
        torch.manual_seed(8)
        base = LogitTileNet()
        initial = copy.deepcopy(base.state_dict())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            uninterrupted = LogitTileNet(); uninterrupted.load_state_dict(initial)
            uninterrupted, direct = train(recipe, train_set, dev_set, train_meta, dev_meta, uninterrupted, torch.device("cpu"), root / "direct", time.monotonic() + 120)
            interrupted = LogitTileNet(); interrupted.load_state_dict(initial)
            _, partial = train(recipe, train_set, dev_set, train_meta, dev_meta, interrupted, torch.device("cpu"), root / "recovered", time.monotonic() + 120, interrupt_after_batches=1)
            self.assertTrue(partial["interrupted"])
            wrong_identity = {"datasetManifestSha256": "changed"}
            rejected = LogitTileNet(); rejected.load_state_dict(initial)
            with self.assertRaisesRegex(TrainingError, "identity differs"):
                train(recipe, train_set, dev_set, train_meta, dev_meta, rejected, torch.device("cpu"), root / "recovered", time.monotonic() + 120, wrong_identity, resume=True)
            resumed = LogitTileNet(); resumed.load_state_dict(initial)
            resumed, recovered = train(recipe, train_set, dev_set, train_meta, dev_meta, resumed, torch.device("cpu"), root / "recovered", time.monotonic() + 120, resume=True)
            self.assertEqual(direct["history"], recovered["history"])
            self.assertIn("trainMeanAvailableClassCrossEntropyPerMinibatch", recovered["history"][0])
            self.assertEqual(direct["bestEpoch"], recovered["bestEpoch"])
            self.assertGreater(recovered["firstGradientNorm"], 0)
            self.assertTrue(recovered["weightsChanged"])
            for name, value in uninterrupted.state_dict().items():
                self.assertTrue(torch.equal(value, resumed.state_dict()[name]), name)
            best = root / "recovered" / recovered["bestPath"]
            self.assertTrue(best.is_file())
            self.assertTrue(best.with_suffix(".pt.sha256").is_file())
            self.assertNotEqual(best, root / "recovered" / "checkpoint-last.pt")

    def test_diagnostic_reports_reliability_classes_colors_and_conditions(self) -> None:
        labels = np.tile(np.arange(64) % 13, (2, 1)).astype(np.int64)
        probabilities = np.full((2, 64, 13), 0.001, dtype=np.float32)
        probabilities[np.arange(2)[:, None], np.arange(64), labels] = 0.988
        metadata = [
            {"family": "a", "style": "flat", "reduction": "1", "speckles": "absent"},
            {"family": "b", "style": "hatch", "reduction": "0.64", "speckles": "present"},
        ]
        report = evaluate_probabilities(probabilities, labels, metadata)
        self.assertEqual(report["raw"]["exactBoards"], 2)
        self.assertEqual(report["confidenceQualified"]["reliableExactBoards"], 2)
        self.assertEqual(report["dimensions"]["condition"]["pristine"]["exactBoards"], 1)
        self.assertEqual(report["dimensions"]["condition"]["degraded"]["exactBoards"], 1)
        self.assertEqual(set(report["perClass"]), set("1KQRBNPkqrbnp"))
        self.assertIn("whiteToBlack", report["crossColorErrors"])
        self.assertFalse(report["orientation"]["inferred"])
        broken = probabilities.copy(); broken[0, 0, 0] = 2
        with self.assertRaisesRegex(DiagnosticError, "normalized probabilities"):
            evaluate_probabilities(broken, labels, metadata)

    def test_budget_ledger_charges_actual_time_and_rejects_pending_or_per_run_overage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            ledger = Path(temporary) / "ledger.json"
            index, available = _ledger_start(ledger, "pilot", 60)
            self.assertEqual(available, 60)
            with self.assertRaisesRegex(TrainingError, "pending attempt"):
                _ledger_start(ledger, "full-3821", 600)
            _ledger_finish(ledger, index, "failed", 12.5)
            _, remaining = _ledger_start(ledger, "pilot", 60)
            self.assertEqual(remaining, 47.5)

    def test_final_deadline_uses_ledger_reduced_allowance(self) -> None:
        ensure_elapsed_within_available(2.0, 2.0)
        with self.assertRaisesRegex(TrainingError, "final diagnostics"):
            ensure_elapsed_within_available(2.01, 2.0)

    def test_integrated_run_reaches_exported_onnx_diagnostic(self) -> None:
        train_set, train_meta = synthetic_dataset("train")
        dev_set, dev_meta = synthetic_dataset("dev")
        recipe = tiny_recipe()
        recipe = Recipe("pilot", recipe.seed, recipe.train_boards, recipe.dev_boards, 1, 60, recipe.batch_size, recipe.learning_rate, recipe.minimum_learning_rate, recipe.weight_decay, recipe.confidence_floor, recipe.histogram_edges, recipe.onnx_atol, recipe.onnx_rtol)
        probabilities = np.full((13, 64, 13), 0.001, dtype=np.float32)
        probabilities[np.arange(13)[:, None], np.arange(64), dev_set.labels] = 0.988
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = {name: root / name for name in ("datasetDir", "shippedModel", "dataQualityManifest", "pretrainingLock", "outputDir")}
            protocol = {"paths": {}}
            model = LogitTileNet()
            training = {"history": [], "bestEpoch": 1}
            recovery = {"performed": True, "equivalent": True}
            with (
                mock.patch.object(trainer_module, "load_protocol", return_value=(protocol, recipe, "p" * 64)),
                mock.patch.object(trainer_module, "resolve_paths", return_value=paths),
                mock.patch.object(trainer_module, "verify_pretraining_lock", return_value={"protocolSha256": "p" * 64}),
                mock.patch.object(trainer_module.torch.cuda, "is_available", return_value=True),
                mock.patch.object(trainer_module.torch.cuda, "get_device_name", return_value="synthetic-gpu"),
                mock.patch.object(trainer_module, "load_split", side_effect=[train_set, dev_set]),
                mock.patch.object(trainer_module, "load_board_metadata", side_effect=[train_meta, dev_meta]),
                mock.patch.object(trainer_module, "configure_determinism"),
                mock.patch.object(trainer_module, "verify_pilot_recovery", return_value=(model, training, recovery)),
                mock.patch.object(trainer_module, "export_and_validate", return_value={"sha256": "e" * 64}),
                mock.patch.object(trainer_module, "infer_onnx", return_value=probabilities) as inference,
                mock.patch.object(trainer_module, "_environment", return_value={"device": "cuda"}),
                mock.patch.object(trainer_module, "sha256_file", return_value="s" * 64),
            ):
                report = trainer_module.run(root / "protocol.json", "pilot", "cuda")
            self.assertEqual(report["status"], "completed")
            inference.assert_called_once()
            self.assertTrue((paths["outputDir"] / "pilot" / "run-report.json").is_file())


if __name__ == "__main__":
    unittest.main()
