from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace

import numpy as np

V3 = Path(__file__).resolve().parents[1]
PARENT = V3.parent
sys.path.insert(0, str(PARENT))
sys.path.insert(0, str(V3))

import nakst_development as subject
from dataset import Dataset


class FakeSession:
    calls = 0

    def __init__(self, _path: Path) -> None:
        pass

    def infer(self, rgb: np.ndarray) -> list[dict]:
        self.__class__.calls += 1
        assert rgb.shape == (256, 256, 3)
        return []


def fake_dataset() -> Dataset:
    tile = np.zeros((1, 1, 1024), dtype=np.float32)
    vectors = np.broadcast_to(tile, (384, 64, 1024))
    label = np.zeros((1, 64), dtype=np.int64)
    labels = np.broadcast_to(label, (384, 64))
    return Dataset("dev", vectors, labels, "v" * 64, "l" * 64, "m" * 64, "g" * 64, "s" * 64, frozenset(("family",)), 384)


class NakstDevelopmentTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeSession.calls = 0

    def test_empty_cells_do_not_invent_confidence_or_raise(self) -> None:
        counts = subject.empty_counts()
        prediction = {"cellsA1First": [{"label": None, "confidence": None} for _ in range(64)], "board": SimpleNamespace(score=0.9), "abstained": False}
        subject._add_prediction(counts, np.zeros(64, dtype=np.int64), [prediction])
        self.assertEqual(counts["exactBoards"], 1)
        self.assertEqual(counts["detectedPieceConfidence"]["count"], 0)
        self.assertEqual(counts["pieceAndBoardConfidenceQualifiedAtOrAbove0.7"]["observedPredictedPieces"], 0)

    def test_impossibility_bounds_use_full_384_board_denominators(self) -> None:
        counts = subject.empty_counts()
        counts.update({"processedBoards": 20, "exactBoards": 0, "nonExactBoards": 20, "correctSquares": 1279, "wrongSquares": 1})
        decision = subject._decision(counts, None)
        self.assertEqual(decision["status"], "STOP")
        self.assertLess(decision["rawExactUpperBound"], 0.95)
        self.assertEqual(decision["thresholdTuning"], "unneeded: raw upper bound already fails")
        counts.update({"processedBoards": 2, "exactBoards": 2, "nonExactBoards": 0, "correctSquares": 5, "wrongSquares": 123})
        self.assertLess(subject._decision(counts, None)["rawSquareUpperBound"], 0.995)

    def test_fake_session_stops_early_and_retains_partial_aggregate_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "partial.json"
            with (
                mock.patch.object(subject, "load_split", return_value=fake_dataset()),
                mock.patch.object(subject, "verify_artifact"),
                mock.patch.object(subject, "verified_dev_rgb", return_value=[Path("unused")] * 384),
                mock.patch.object(subject, "load_rgb", return_value=np.zeros((256, 256, 3), dtype=np.uint8)),
                mock.patch.object(subject, "verify_reuse", return_value=None),
                mock.patch.object(subject, "sha256_file", return_value="a" * 64),
            ):
                result = subject.run(output, session_factory=FakeSession)
            self.assertEqual(result["status"], "stopped")
            self.assertEqual(result["input"]["denominatorBoards"], 384)
            self.assertEqual(result["input"]["actualBoardsProcessed"], 2)
            self.assertEqual(result["raw"]["wrongSquares"], 128)
            self.assertEqual(FakeSession.calls, 2)
            self.assertTrue(output.is_file())
            self.assertFalse(result["confidencePolicy"]["inventedEmptyConfidence"])

    def test_internal_deadline_writes_partial_without_inference(self) -> None:
        values = iter((0.0, 55.0, 55.0))
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "timeout.json"
            with (
                mock.patch.object(subject, "load_split", return_value=fake_dataset()),
                mock.patch.object(subject, "verify_artifact"),
                mock.patch.object(subject, "verified_dev_rgb", return_value=[Path("unused")] * 384),
                mock.patch.object(subject, "verify_reuse", return_value=None),
                mock.patch.object(subject, "sha256_file", return_value="a" * 64),
                mock.patch.object(subject.time, "monotonic", side_effect=lambda: next(values)),
            ):
                result = subject.run(output, session_factory=FakeSession, clock=subject.time.monotonic)
            self.assertEqual(result["status"], "stopped")
            self.assertEqual(result["input"]["actualBoardsProcessed"], 0)
            self.assertIn("55-second", result["decision"]["reason"])
            self.assertEqual(FakeSession.calls, 0)

    def test_reused_aggregate_preserves_unknown_empty_confidence(self) -> None:
        detector = {
            "boards": 12, "exactBoards": 5, "squares": 768, "correctSquares": 711,
            "occupiedTotal": 147, "occupiedCorrect": 100, "missedBoardSquares": 0,
            "perClass": {symbol: {"total": 0, "correct": 0} for symbol in subject.CANONICAL_CLASSES},
            "color": {"white": {"total": 72, "correct": 45}, "black": {"total": 75, "correct": 55}},
            "confusionActualRowsPredictedColumns": np.zeros((13, 14), dtype=np.int64).tolist(),
            "detectedPieceConfidence": {"count": 134, "minimum": 0.32, "mean": 0.86},
        }
        counts = subject.empty_counts()
        self.assertEqual(subject._merge_reused(counts, detector), 12)
        self.assertEqual(counts["reusedBoardsWithoutPerSquareConfidence"], 12)
        self.assertEqual(counts["pieceAndBoardConfidenceQualifiedAtOrAbove0.7"]["observedPredictedPieces"], 0)
        self.assertEqual(counts["wrongSquares"], 57)


if __name__ == "__main__":
    unittest.main()
