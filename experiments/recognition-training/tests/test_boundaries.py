from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from dataset import Dataset, DatasetError, load_split
from evaluate_onnx import CONFIDENCE_FLOOR, EvaluationError, _freeze_candidate, evaluate
from trainer import TrainingError, recipe_from_protocol, require_device


ROOT = Path(__file__).resolve().parents[1]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _dataset(vectors: np.ndarray) -> Dataset:
    return Dataset(
        split="dev",
        vectors=vectors,
        labels=np.zeros((len(vectors), 64), dtype=np.int64),
        vector_sha256="a" * 64,
        labels_sha256="b" * 64,
        manifest_sha256="c" * 64,
        generator_sha256="d" * 64,
        source_lock_sha256="e" * 64,
        families=frozenset(("synthetic-development",)),
        board_count=len(vectors),
    )


class TrainingBoundaryTest(unittest.TestCase):
    def test_cuda_request_fails_explicitly_when_cuda_is_unavailable(self) -> None:
        with patch("trainer.torch.cuda.is_available", return_value=False):
            with self.assertRaisesRegex(TrainingError, "CUDA was requested"):
                require_device("cuda")

    def test_protocol_rejects_unlisted_pilot_and_full_seeds(self) -> None:
        protocol = json.loads((ROOT / "protocol.json").read_text(encoding="utf-8"))
        for mode, seed in (("pilot", 39), ("full", 3803)):
            with self.subTest(mode=mode, seed=seed):
                with self.assertRaisesRegex(TrainingError, "seed or recipe"):
                    recipe_from_protocol(protocol, mode, seed)  # type: ignore[arg-type]


class DatasetBoundaryTest(unittest.TestCase):
    def test_corpus_v1_path_cannot_be_loaded_as_a_training_split(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            corpus = Path(temporary) / "corpus" / "v1"
            with self.assertRaisesRegex(DatasetError, "cannot be used for training"):
                load_split(corpus, "train")

    def test_test_labels_cannot_be_injected_as_development_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary)
            labels = {
                "schemaVersion": 1,
                "split": "test",
                "boards": [
                    {
                        "id": "opaque-test-board",
                        "family": "held-out-only",
                        "labels": [0] * 64,
                    }
                ],
            }
            labels_bytes = (json.dumps(labels) + "\n").encode()
            vectors = np.zeros((1, 64, 1024), dtype="<f4").tobytes()
            (data / "dev.labels.json").write_bytes(labels_bytes)
            (data / "dev.vectors.f32le").write_bytes(vectors)
            manifest = {
                "schemaVersion": 1,
                "sources": {},
                "generator": {"sha256": "a" * 64},
                "generatorLock": {"sha256": "b" * 64},
                "splits": {},
                "exclusions": ["packages/test-fixtures/corpus/v1"],
                "artifacts": {
                    "dev": {
                        "vectors": {
                            "path": "dev.vectors.f32le",
                            "sha256": hashlib.sha256(vectors).hexdigest(),
                            "byteLength": len(vectors),
                            "shape": [1, 64, 1024],
                        },
                        "labels": {
                            "path": "dev.labels.json",
                            "sha256": hashlib.sha256(labels_bytes).hexdigest(),
                            "byteLength": len(labels_bytes),
                        },
                    }
                },
            }
            (data / "dataset-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(DatasetError, "labels split"):
                load_split(data, "dev")


class EvaluationBoundaryTest(unittest.TestCase):
    def _frozen_input(self, root: Path, candidates: list[dict[str, object]]) -> tuple[Path, Path, Path]:
        data = root / "data"
        runs = root / "runs"
        data.mkdir()
        runs.mkdir()
        vectors = data / "test.vectors.f32le"
        vectors.write_bytes(b"vector-lock")
        boards = [
            {"id": f"opaque-{index}", "family": "held-out", "labels": [0] * 64}
            for index in range(256)
        ]
        (data / "test.labels.json").write_text(
            json.dumps({"schemaVersion": 1, "split": "test", "boards": boards}),
            encoding="utf-8",
        )
        wrapper = {
            "schemaVersion": 1,
            "id": "held-out-v1",
            "role": "held-out-test",
            "dtype": "float32-le",
            "shape": [256, 64, 1024],
            "byteLength": vectors.stat().st_size,
            "sha256": _sha256(vectors),
            "labels": [
                {"boardId": board["id"], "classes": board["labels"]} for board in boards
            ],
        }
        wrapper_path = data / "vectors.manifest.json"
        wrapper_path.write_text(json.dumps(wrapper), encoding="utf-8")
        freeze = {
            "schemaVersion": 1,
            "runKind": "full",
            "protocolSha256": "f" * 64,
            "testManifestSha256": _sha256(wrapper_path),
            "candidates": candidates,
        }
        freeze_path = runs / "candidates.freeze.json"
        freeze_path.write_text(json.dumps(freeze), encoding="utf-8")
        model = runs / "candidate.onnx"
        model.write_bytes(b"candidate")
        return freeze_path, model, data

    def test_freeze_rejects_missing_or_duplicate_candidate_identities(self) -> None:
        shipped = {"id": "shipped", "seed": None, "modelPath": "candidate.onnx"}
        seed_3801 = {"id": "tilenet-full-3801", "seed": 3801, "modelPath": "candidate.onnx"}
        seed_3802 = {"id": "tilenet-full-3802", "seed": 3802, "modelPath": "candidate.onnx"}
        malformed = ([shipped, seed_3801], [shipped, seed_3801, seed_3801])
        for index, candidates in enumerate(malformed):
            with self.subTest(case=index), tempfile.TemporaryDirectory() as temporary:
                freeze, model, data = self._frozen_input(Path(temporary), candidates)
                with self.assertRaisesRegex(EvaluationError, "exactly shipped"):
                    _freeze_candidate(freeze, model, "f" * 64, data)

    def test_fixed_confidence_floor_counts_low_confidence_correct_squares_as_failures(self) -> None:
        probabilities = np.zeros((64, 13), dtype=np.float32)
        probabilities[:, 0] = np.float32(CONFIDENCE_FLOOR - 0.01)
        probabilities[:, 1] = np.float32(1.0 - probabilities[0, 0])

        class FakeSession:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def run(self, *_args: object, **_kwargs: object) -> list[np.ndarray]:
                return [probabilities]

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "candidate.onnx"
            model.write_bytes(b"model")
            (root / "dataset-manifest.json").write_bytes(b"manifest")
            dataset = _dataset(np.zeros((1, 64, 1024), dtype=np.float32))
            with (
                patch("evaluate_onnx.load_split", return_value=dataset),
                patch("evaluate_onnx.ort.InferenceSession", FakeSession),
            ):
                report = evaluate(model, root, "dev")
        self.assertEqual(report["confidenceFloor"], 0.7)
        self.assertEqual(report["raw"]["exactBoards"], 1)
        self.assertEqual(report["confidenceQualified"]["reliableExactBoards"], 0)
        self.assertEqual(report["confidenceQualified"]["confidentCorrectSquares"], 0)
        self.assertEqual(report["confidenceQualified"]["lowConfidenceBoards"], 1)

    def test_malformed_model_output_is_rejected_before_metrics(self) -> None:
        class MalformedSession:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def run(self, *_args: object, **_kwargs: object) -> list[np.ndarray]:
                return [np.zeros((63, 13), dtype=np.float32)]

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "candidate.onnx"
            model.write_bytes(b"model")
            (root / "dataset-manifest.json").write_bytes(b"manifest")
            dataset = _dataset(np.zeros((1, 64, 1024), dtype=np.float32))
            with (
                patch("evaluate_onnx.load_split", return_value=dataset),
                patch("evaluate_onnx.ort.InferenceSession", MalformedSession),
            ):
                with self.assertRaisesRegex(EvaluationError, "invalid probabilities"):
                    evaluate(model, root, "dev")


if __name__ == "__main__":
    unittest.main()
