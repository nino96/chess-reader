"""Cheap development diagnostics for issue #40 TileNet candidates.

The report is aggregate-only: board identifiers and label sequences never leave
the validated local dataset. Orientation is not inferred by this tile model.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from typing import Any, Sequence

import numpy as np
import onnxruntime as ort
import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dataset import DatasetError, load_split, sha256_file

CLASS_ORDER = "1KQRBNPkqrbnp"
CLASS_COUNT = len(CLASS_ORDER)
INPUT_WIDTH = 1024
INPUT_NAME = "tiles"
OUTPUT_NAME = "probs"


class DiagnosticError(RuntimeError):
    """A candidate or development input cannot be evaluated safely."""


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def load_board_metadata(data_dir: Path, split: str = "dev") -> list[dict[str, Any]]:
    path = data_dir / f"{split}.labels.json"
    try:
        root = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DiagnosticError("development labels metadata is unavailable") from error
    boards = root.get("boards") if isinstance(root, dict) else None
    if not isinstance(boards, list) or not boards:
        raise DiagnosticError("development labels have no boards")
    result: list[dict[str, Any]] = []
    for value in boards:
        render = value.get("render") if isinstance(value, dict) else None
        family = value.get("family") if isinstance(value, dict) else None
        if (
            not isinstance(render, dict)
            or not isinstance(family, str)
            or not family
            or not isinstance(render.get("style"), str)
            or not isinstance(render.get("reduction"), (int, float))
            or isinstance(render.get("reduction"), bool)
            or not isinstance(render.get("speckles"), int)
            or isinstance(render.get("speckles"), bool)
            or render["speckles"] < 0
        ):
            raise DiagnosticError("development board metadata is incomplete")
        result.append({
            "family": family,
            "style": render["style"],
            "reduction": str(render["reduction"]),
            "speckles": "present" if render["speckles"] > 0 else "absent",
        })
    return result


def _metric_block(correct: np.ndarray, exact: np.ndarray, occupied: np.ndarray) -> dict[str, Any]:
    return {
        "boards": int(len(exact)),
        "exactBoards": int(exact.sum()),
        "exactBoardAccuracy": float(exact.mean()),
        "correctSquares": int(correct.sum()),
        "squares": int(correct.size),
        "squareAccuracy": float(correct.mean()),
        "correctOccupiedSquares": int((correct & occupied).sum()),
        "occupiedSquares": int(occupied.sum()),
        "occupiedSquareAccuracy": _ratio(int((correct & occupied).sum()), int(occupied.sum())),
    }


def evaluate_probabilities(
    probabilities: np.ndarray,
    labels: np.ndarray,
    metadata: list[dict[str, Any]],
    confidence_floor: float = 0.7,
    histogram_edges: Sequence[float] = (0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1),
) -> dict[str, Any]:
    if probabilities.shape != (*labels.shape, CLASS_COUNT) or labels.ndim != 2 or labels.shape[1] != 64:
        raise DiagnosticError("probabilities or labels have an incompatible shape")
    if len(metadata) != labels.shape[0] or not np.isfinite(probabilities).all():
        raise DiagnosticError("diagnostic inputs are incomplete or nonfinite")
    if labels.dtype.kind not in "iu" or np.any(labels < 0) or np.any(labels >= CLASS_COUNT):
        raise DiagnosticError("labels must be integer classes 0..12")
    if np.any(probabilities < 0) or np.any(probabilities > 1) or not np.allclose(probabilities.sum(axis=2), 1, atol=1e-5, rtol=1e-5):
        raise DiagnosticError("candidate outputs must be normalized probabilities")
    if not 0 < confidence_floor < 1:
        raise DiagnosticError("confidence floor must be between zero and one")
    predictions = probabilities.argmax(axis=2)
    confidence = probabilities.max(axis=2)
    correct = predictions == labels
    exact = correct.all(axis=1)
    occupied = labels != 0
    accepted = confidence >= confidence_floor
    board_accepted = accepted.all(axis=1)
    confusion = np.zeros((CLASS_COUNT, CLASS_COUNT), dtype=np.int64)
    np.add.at(confusion, (labels.ravel(), predictions.ravel()), 1)

    def aggregate(mask: np.ndarray) -> dict[str, Any]:
        chosen = np.flatnonzero(mask)
        block = _metric_block(correct[chosen], exact[chosen], occupied[chosen])
        chosen_accepted = accepted[chosen]
        chosen_board_accepted = board_accepted[chosen]
        block["confidenceQualified"] = {
            "acceptedSquares": int(chosen_accepted.sum()),
            "squareCoverage": float(chosen_accepted.mean()),
            "acceptedCorrectSquares": int((chosen_accepted & correct[chosen]).sum()),
            "acceptedWrongSquares": int((chosen_accepted & ~correct[chosen]).sum()),
            "acceptedBoards": int(chosen_board_accepted.sum()),
            "boardCoverage": float(chosen_board_accepted.mean()),
            "reliableExactBoards": int((exact[chosen] & chosen_board_accepted).sum()),
            "reliableWrongBoards": int((~exact[chosen] & chosen_board_accepted).sum()),
        }
        values = confidence[chosen]
        block["confidence"] = {"minimum": float(values.min()), "mean": float(values.mean())}
        return block

    dimensions: dict[str, dict[str, Any]] = {}
    for field in ("family", "style", "reduction", "speckles"):
        dimensions[field] = {
            value: aggregate(np.asarray([board[field] == value for board in metadata]))
            for value in sorted({board[field] for board in metadata})
        }
    pristine_mask = np.asarray([
        board["style"] == "flat" and board["reduction"] in ("1", "1.0") and board["speckles"] == "absent"
        for board in metadata
    ])
    degraded_mask = ~pristine_mask
    dimensions["condition"] = {
        "pristine": aggregate(pristine_mask),
        "degraded": aggregate(degraded_mask),
    }
    true_probs = probabilities.reshape(-1, CLASS_COUNT)[np.arange(labels.size), labels.ravel()]
    per_class = {}
    for index, symbol in enumerate(CLASS_ORDER):
        mask = labels == index
        total = int(mask.sum())
        per_class[symbol] = {
            "correct": int((correct & mask).sum()),
            "errors": int((~correct & mask).sum()),
            "total": total,
            "accuracy": _ratio(int((correct & mask).sum()), total),
            "meanConfidence": float(confidence[mask].mean()) if total else None,
            "minimumConfidence": float(confidence[mask].min()) if total else None,
            "meanCrossEntropy": float((-np.log(np.clip(true_probs[labels.ravel() == index], 1e-30, 1))).mean()) if total else None,
        }
    white = np.isin(labels, np.arange(1, 7))
    black = np.isin(labels, np.arange(7, 13))
    colors = {"empty": labels == 0, "white": white, "black": black, "occupied": occupied}
    histogram, edges = np.histogram(confidence, bins=np.asarray(histogram_edges, dtype=np.float64))
    raw = _metric_block(correct, exact, occupied)
    reliable_wrong = (~exact) & board_accepted
    qualified = {
        "confidenceFloor": confidence_floor,
        "acceptedSquares": int(accepted.sum()),
        "squareCoverage": float(accepted.mean()),
        "acceptedCorrectSquares": int((accepted & correct).sum()),
        "acceptedWrongSquares": int((accepted & ~correct).sum()),
        "confidenceQualifiedCorrectSquareAccuracy": float((accepted & correct).sum() / correct.size),
        "acceptedSquarePrecision": _ratio(int((accepted & correct).sum()), int(accepted.sum())),
        "acceptedBoards": int(board_accepted.sum()),
        "boardCoverage": float(board_accepted.mean()),
        "reliableExactBoards": int((exact & board_accepted).sum()),
        "reliableWrongBoards": int(reliable_wrong.sum()),
        "lowConfidenceBoards": int((~board_accepted).sum()),
    }
    failed_classes = [symbol for symbol, item in per_class.items() if item["total"] and item["correct"] == 0]
    failed_families = [name for name, item in dimensions["family"].items() if item["exactBoards"] == 0]
    return {
        "raw": raw,
        "confidenceQualified": qualified,
        "perClass": per_class,
        "color": {
            name: {"correct": int((correct & mask).sum()), "errors": int((~correct & mask).sum()), "total": int(mask.sum()), "accuracy": _ratio(int((correct & mask).sum()), int(mask.sum())), "meanConfidence": float(confidence[mask].mean()) if np.any(mask) else None, "minimumConfidence": float(confidence[mask].min()) if np.any(mask) else None}
            for name, mask in colors.items()
        },
        "crossColorErrors": {
            "whiteToBlack": int((white & np.isin(predictions, np.arange(7, 13))).sum()),
            "blackToWhite": int((black & np.isin(predictions, np.arange(1, 7))).sum()),
            "whiteToEmpty": int((white & (predictions == 0)).sum()),
            "blackToEmpty": int((black & (predictions == 0)).sum()),
            "emptyToWhite": int(((labels == 0) & np.isin(predictions, np.arange(1, 7))).sum()),
            "emptyToBlack": int(((labels == 0) & np.isin(predictions, np.arange(7, 13))).sum()),
        },
        "confusion": {
            "classOrder": CLASS_ORDER,
            "matrixActualRowsPredictedColumns": confusion.tolist(),
            "offDiagonal": [
                {"actual": CLASS_ORDER[a], "predicted": CLASS_ORDER[p], "count": int(confusion[a, p])}
                for a in range(CLASS_COUNT) for p in range(CLASS_COUNT)
                if a != p and confusion[a, p]
            ],
        },
        "confidence": {
            "minimum": float(confidence.min()), "mean": float(confidence.mean()),
            "quantiles": {str(q): float(np.quantile(confidence, q)) for q in (0, 0.01, 0.05, 0.5, 0.95, 0.99, 1)},
            "histogram": {"edges": list(map(float, edges)), "counts": histogram.tolist()},
        },
        "dimensions": dimensions,
        "orientation": {"input": "native", "assumption": "A1 orientation", "inferred": False, "accuracy": None},
        "stopGate": {
            "zeroExactFamilies": failed_families,
            "zeroCorrectClasses": failed_classes,
            "minimumReliableExactBoardAccuracy": 0.95,
            "minimumConfidenceQualifiedCorrectSquareAccuracy": 0.995,
            "maximumReliableWrongBoards": 0,
            "passed": not failed_families and not failed_classes and qualified["reliableWrongBoards"] == 0
                and qualified["reliableExactBoards"] / len(exact) >= 0.95
                and qualified["confidenceQualifiedCorrectSquareAccuracy"] >= 0.995,
        },
    }


def infer_onnx(model_path: Path, vectors: np.ndarray) -> np.ndarray:
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    if [item.name for item in session.get_inputs()] != [INPUT_NAME] or [item.name for item in session.get_outputs()] != [OUTPUT_NAME]:
        raise DiagnosticError("candidate ONNX interface differs from tiles/probs")
    flat = vectors.reshape(-1, INPUT_WIDTH)
    chunks = [session.run([OUTPUT_NAME], {INPUT_NAME: flat[offset : offset + 512]})[0] for offset in range(0, len(flat), 512)]
    return np.concatenate(chunks).reshape(vectors.shape[0], 64, CLASS_COUNT)


def run(model_path: Path, data_dir: Path, confidence_floor: float = 0.7) -> dict[str, Any]:
    if confidence_floor != 0.7:
        raise DiagnosticError("FENShot confidence floor is frozen at 0.7")
    started = time.perf_counter()
    dataset = load_split(data_dir, "dev")
    metadata = load_board_metadata(data_dir)
    metrics = evaluate_probabilities(infer_onnx(model_path, dataset.vectors), dataset.labels, metadata, confidence_floor)
    elapsed = time.perf_counter() - started
    if elapsed > 60:
        raise DiagnosticError("development diagnostic exceeded its 60-second CPU ceiling")
    return {
        "schemaVersion": 1, "status": "completed", "kind": "issue-40-cheap-development-diagnostic",
        "command": "python experiments/recognition-training/v3/diagnostic.py --model <candidate> --data-dir experiments/recognition-training/v3/data/full --output <report>",
        "commit": _command_output(("git", "rev-parse", "HEAD")),
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "onnxruntime": ort.__version__, "provider": "CPUExecutionProvider", "intraOpThreads": 1, "interOpThreads": 1},
        "scriptSha256": sha256_file(Path(__file__)),
        "candidate": {"sha256": sha256_file(model_path), "bytes": model_path.stat().st_size},
        "input": {"split": "dev", "boards": dataset.board_count, "squares": int(dataset.labels.size), "datasetManifestSha256": dataset.manifest_sha256, "vectorsSha256": dataset.vector_sha256, "labelsSha256": dataset.labels_sha256},
        **metrics, "elapsedSeconds": elapsed,
    }


def _command_output(command: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--confidence-floor", type=float, default=0.7)
    args = parser.parse_args(argv)
    try:
        result = run(args.model.resolve(), args.data_dir.resolve(), args.confidence_floor)
    except (DatasetError, DiagnosticError, OSError, RuntimeError, ValueError) as error:
        result = {"schemaVersion": 1, "status": "failed", "error": str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
