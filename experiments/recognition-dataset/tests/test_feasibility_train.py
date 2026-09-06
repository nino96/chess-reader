import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch

import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
import feasibility_train as subject  # noqa: E402


def write_split(root: Path, split: str, boards: int = 2):
    tiles = np.zeros((boards, 64, 1024), dtype=np.float32)
    labels = np.zeros((boards, 64), dtype=np.int64)
    labels[:, 0] = 1
    np.savez(root / f"{split}.npz", tiles=tiles, labels=labels)
    metadata = {"boards": [{"id": f"{split}-{i}", "sourceId": f"source-{i}", "family": f"family-{i % 2}", "condition": "clean", "clean": True, "exposed": True} for i in range(boards)]}
    (root / f"{split}.metadata.json").write_text(json.dumps(metadata), encoding="utf-8")


class FeasibilityTrainTests(unittest.TestCase):
    def test_shapes_classes_and_hash_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train")
            write_split(root, "dev")
            lock = {"schema": 1, "splits": {s: {"tilesSha256": subject.sha256(root / f"{s}.npz"), "metadataSha256": subject.sha256(root / f"{s}.metadata.json")} for s in ("train", "dev")}}
            (root / "dataset-lock.json").write_text(json.dumps(lock), encoding="utf-8")
            subject.verify_lock(root)
            tiles, labels, metadata = subject.load_split(root, "train")
            self.assertEqual(tiles.shape, (2, 64, 1024))
            self.assertEqual(labels.dtype, np.int64)
            self.assertEqual(len(metadata), 2)
            with self.assertRaises(subject.FeasibilityError):
                subject.load_split(root, "qualification")

    def test_family_order_equalizes_families_deterministically(self):
        metadata = [
            {"family": "a"}, {"family": "a"},
            {"family": "b"},
            {"family": "c"}, {"family": "c"}, {"family": "c"},
        ]
        first = subject.family_order(metadata, 17)
        second = subject.family_order(metadata, 17)
        self.assertTrue(np.array_equal(first, second))
        families = [metadata[int(index)]["family"] for index in first]
        self.assertEqual(len(first), 9)
        self.assertEqual({family: families.count(family) for family in set(families)}, {"a": 3, "b": 3, "c": 3})
        for offset in range(0, len(first), 3):
            self.assertEqual(set(families[offset:offset + 3]), {"a", "b", "c"})

    def test_invalid_label_and_hash_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train")
            write_split(root, "dev")
            lock = {"schema": 1, "splits": {s: {"tilesSha256": subject.sha256(root / f"{s}.npz"), "metadataSha256": subject.sha256(root / f"{s}.metadata.json")} for s in ("train", "dev")}}
            (root / "dataset-lock.json").write_text(json.dumps(lock), encoding="utf-8")
            with np.load(root / "train.npz") as archive:
                bad = archive["labels"].copy()
                bad[0, 0] = 13
                np.savez(root / "train.npz", tiles=archive["tiles"], labels=bad)
            with self.assertRaises(subject.FeasibilityError):
                subject.load_split(root, "train")

    def test_budget_truncation_is_explicit_and_cpu_replay_is_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train", 4)
            write_split(root, "dev", 2)
            train, train_labels, train_meta = subject.load_split(root, "train")
            dev, dev_labels, dev_meta = subject.load_split(root, "dev")
            with patch.object(subject.time, "monotonic", side_effect=[0.0, 1.0]):
                result = subject.train_once(train, train_labels, train_meta, dev, dev_labels, dev_meta, subject.LogitTileNet(), 4100, epochs=2, max_seconds=0.5, minimum_updates=200, device="cpu")
            self.assertEqual(result["status"], "budget-truncated")
            self.assertLess(result["updates"], 200)

    def test_ledger_reserves_caps_and_blocks_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "budget-ledger.json"
            entry = subject.ledger_start(path, "pilot", 60)
            self.assertEqual(entry["status"], "reserved")
            with self.assertRaises(subject.FeasibilityError):
                subject.ledger_start(path, "pilot", 60)
            resumed = subject.ledger_start(path, "pilot", 60, resume=True)
            self.assertEqual(resumed["reservedSeconds"], 60)
            subject.ledger_finish(path, "pilot", "failed")
            with self.assertRaises(subject.FeasibilityError):
                subject.ledger_start(path, "pilot", 60, resume=True)

    def test_checkpoint_resume_matches_uninterrupted_cpu_trajectory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train", 4)
            write_split(root, "dev", 2)
            train, train_labels, train_meta = subject.load_split(root, "train")
            dev, dev_labels, dev_meta = subject.load_split(root, "dev")
            torch.manual_seed(99)
            first = subject.LogitTileNet()
            uninterrupted = subject.train_once(train, train_labels, train_meta, dev, dev_labels, dev_meta, first, 4100, epochs=2, max_seconds=100, minimum_updates=1, device="cpu")
            checkpoint = root / "checkpoint.pt"
            torch.manual_seed(99)
            interrupted = subject.train_once(train, train_labels, train_meta, dev, dev_labels, dev_meta, subject.LogitTileNet(), 4100, epochs=2, max_seconds=100, minimum_updates=1, device="cpu", checkpoint=checkpoint, stop_after_epoch=1)
            self.assertEqual(interrupted["status"], "interrupted")
            torch.manual_seed(99)
            resumed = subject.train_once(train, train_labels, train_meta, dev, dev_labels, dev_meta, subject.LogitTileNet(), 4100, epochs=2, max_seconds=100, minimum_updates=1, device="cpu", checkpoint=checkpoint, resume=True)
            for name, value in uninterrupted["model"].state_dict().items():
                self.assertTrue(torch.equal(value, resumed["model"].state_dict()[name]), name)

    def test_seeded_augmentation_views_and_resume_are_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train", 4)
            write_split(root, "dev", 2)
            train, train_labels, train_meta = subject.load_split(root, "train")
            dev, dev_labels, dev_meta = subject.load_split(root, "dev")
            bank = np.empty((4, 3, 64, 1024), dtype=np.float32)
            for parent in range(4):
                for variant, value in enumerate((0.1, 0.2, 0.3)):
                    bank[parent, variant] = value + parent / 100
            first = subject.epoch_views(train, bank, 4101)
            second = subject.epoch_views(train, bank, 4101)
            self.assertTrue(np.array_equal(first, second))
            checkpoint = root / "augmented.pt"
            uninterrupted = subject.train_once(
                train, train_labels, train_meta, dev, dev_labels, dev_meta,
                subject.LogitTileNet(), 4100, epochs=2, max_seconds=100,
                minimum_updates=1, device="cpu", augmentation_bank=bank,
            )
            interrupted = subject.train_once(
                train, train_labels, train_meta, dev, dev_labels, dev_meta,
                subject.LogitTileNet(), 4100, epochs=2, max_seconds=100,
                minimum_updates=1, device="cpu", checkpoint=checkpoint,
                stop_after_epoch=1, augmentation_bank=bank,
            )
            self.assertEqual(interrupted["status"], "interrupted")
            resumed = subject.train_once(
                train, train_labels, train_meta, dev, dev_labels, dev_meta,
                subject.LogitTileNet(), 4100, epochs=2, max_seconds=100,
                minimum_updates=1, device="cpu", checkpoint=checkpoint,
                resume=True, augmentation_bank=bank,
            )
            self.assertEqual(uninterrupted["curves"], resumed["curves"])
            for name, value in uninterrupted["model"].state_dict().items():
                self.assertTrue(torch.equal(value, resumed["model"].state_dict()[name]), name)

    def test_pilot_recovery_proof_is_computed_and_full_gate_accepts_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train", 2)
            write_split(root, "dev", 2)
            train, train_labels, train_meta = subject.load_split(root, "train")
            dev, dev_labels, dev_meta = subject.load_split(root, "dev")
            model, result, proof = subject.pilot_recovery(
                train, train_labels, train_meta, dev, dev_labels, dev_meta,
                subject.LogitTileNet(), 4100, epochs=1, max_seconds=30,
                minimum_updates=1, device="cpu", checkpoint=root / "pilot.pt",
            )
            self.assertIsNotNone(model)
            self.assertEqual(result["status"], "completed")
            self.assertTrue(proof["performed"])
            self.assertTrue(proof["equivalent"])
            self.assertTrue(all(proof["comparisons"].values()))
            report = {"status": "completed", "recoveryEquivalent": proof["equivalent"], "recovery": proof}
            subject.require_completed_pilot(report)
            report["recoveryEquivalent"] = False
            with self.assertRaises(subject.FeasibilityError):
                subject.require_completed_pilot(report)

    def test_completion_returns_selected_best_weights_not_last_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_split(root, "train", 2)
            write_split(root, "dev", 2)
            train, train_labels, train_meta = subject.load_split(root, "train")
            dev, dev_labels, dev_meta = subject.load_split(root, "dev")
            checkpoint = root / "best.pt"
            with patch.object(subject, "development_score", side_effect=[0.0, 1.0]):
                result = subject.train_once(
                    train, train_labels, train_meta, dev, dev_labels, dev_meta,
                    subject.LogitTileNet(), 4100, epochs=2, max_seconds=30,
                    minimum_updates=1, device="cpu", checkpoint=checkpoint,
                )
            saved = torch.load(checkpoint, map_location="cpu", weights_only=False)
            for name, value in result["model"].state_dict().items():
                self.assertTrue(torch.equal(value.cpu(), saved["bestModel"][name]), name)
            self.assertTrue(any(not torch.equal(value.cpu(), saved["model"][name]) for name, value in result["model"].state_dict().items()))


if __name__ == "__main__":
    unittest.main()
