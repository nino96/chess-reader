"""Bounded post-freeze diagnostic on the already-used development split.

This script performs aggregate CPU inference on Firi development vectors only.
It does not load the held-out test split and must not be used for selection,
threshold changes, or model promotion.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import subprocess
import time
from typing import Any, Sequence

EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
LEGACY_ROOT = EXPERIMENT_ROOT.parent

import sys

if str(LEGACY_ROOT) not in sys.path:
    sys.path.insert(0, str(LEGACY_ROOT))

import numpy as np
import onnxruntime as ort

from dataset import DatasetError, load_split, sha256_file
from tilenet_model import CLASS_COUNT, CLASS_ORDER, INPUT_NAME, INPUT_WIDTH, OUTPUT_NAME


class DiagnosticError(RuntimeError):
    """The diagnostic boundary or an input artifact is invalid."""


CONFIDENCE_FLOOR = 0.7
EXPECTED_MODELS = {"shipped", "tilenet-full-3811", "tilenet-full-3812"}


def _commit() -> str | None:
    try:
        completed = subprocess.run(
            ("git", "rev-parse", "HEAD"),
            capture_output=True,
            check=False,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return completed.stdout.strip() if completed.returncode == 0 else None


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DiagnosticError(f"unable to read {path.name}") from error
    if not isinstance(value, dict):
        raise DiagnosticError(f"{path.name} must contain an object")
    return value


def _load_models(freeze_path: Path) -> list[dict[str, Any]]:
    freeze = _read_object(freeze_path)
    candidates = freeze.get("candidates")
    if freeze.get("schemaVersion") != 1 or freeze.get("runKind") != "full":
        raise DiagnosticError("candidate freeze schema is invalid")
    if not isinstance(candidates, list) or len(candidates) != len(EXPECTED_MODELS):
        raise DiagnosticError("candidate freeze must contain the three frozen models")
    models: list[dict[str, Any]] = []
    found: set[str] = set()
    for raw in candidates:
        if not isinstance(raw, dict):
            raise DiagnosticError("candidate freeze entry is invalid")
        model_id = raw.get("id")
        relative_path = raw.get("modelPath")
        digest = raw.get("sha256")
        byte_length = raw.get("bytes")
        if (
            not isinstance(model_id, str)
            or model_id not in EXPECTED_MODELS
            or model_id in found
            or not isinstance(relative_path, str)
            or not isinstance(digest, str)
            or not isinstance(byte_length, int)
        ):
            raise DiagnosticError("candidate freeze entry is incomplete")
        model_path = (freeze_path.parent / relative_path).resolve()
        if sha256_file(model_path) != digest or model_path.stat().st_size != byte_length:
            raise DiagnosticError(f"frozen model identity changed for {model_id}")
        found.add(model_id)
        models.append(
            {
                "id": model_id,
                "seed": raw.get("seed"),
                "path": model_path,
                "sha256": digest,
                "bytes": byte_length,
            }
        )
    if found != EXPECTED_MODELS:
        raise DiagnosticError("candidate freeze model identities differ from the expected set")
    return models


def _selected_dev_losses() -> dict[str, float]:
    selected: dict[str, float] = {}
    for seed in (3811, 3812):
        report = _read_object(EXPERIMENT_ROOT / "reports" / f"full-{seed}.json")
        checkpoint = report.get("checkpoint")
        if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("selectedDevLoss"), (int, float)):
            raise DiagnosticError(f"full-{seed} report has no selected development loss")
        selected[f"tilenet-full-{seed}"] = float(checkpoint["selectedDevLoss"])
    return selected


def _safe_ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _evaluate_model(
    model: dict[str, Any], vectors: np.ndarray, labels: np.ndarray, selected_losses: dict[str, float]
) -> dict[str, Any]:
    started = time.perf_counter()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(model["path"]), sess_options=options, providers=["CPUExecutionProvider"]
    )
    if [value.name for value in session.get_inputs()] != [INPUT_NAME] or [
        value.name for value in session.get_outputs()
    ] != [OUTPUT_NAME]:
        raise DiagnosticError(f"unexpected ONNX interface for {model['id']}")
    flat = vectors.reshape(-1, INPUT_WIDTH)
    board_probabilities: list[np.ndarray] = []
    for board in range(labels.shape[0]):
        probabilities = session.run(
            [OUTPUT_NAME], {INPUT_NAME: flat[board * 64 : (board + 1) * 64]}
        )[0]
        if probabilities.shape != (64, CLASS_COUNT) or not np.isfinite(probabilities).all():
            raise DiagnosticError(f"invalid ONNX output for {model['id']}")
        board_probabilities.append(probabilities)
    probabilities = np.stack(board_probabilities)
    predictions = np.argmax(probabilities, axis=2)
    confidences = np.max(probabilities, axis=2)
    correct = predictions == labels
    exact = np.all(correct, axis=1)
    reliable = np.min(confidences, axis=1) >= CONFIDENCE_FLOOR
    confident_correct = correct & (confidences >= CONFIDENCE_FLOOR)
    confusion = np.zeros((CLASS_COUNT, CLASS_COUNT), dtype=np.int64)
    for actual in range(CLASS_COUNT):
        for predicted in range(CLASS_COUNT):
            confusion[actual, predicted] = int(
                np.sum((labels == actual) & (predictions == predicted))
            )
    flat_probabilities = probabilities.reshape(-1, CLASS_COUNT).astype(np.float64)
    flat_labels = labels.reshape(-1)
    true_probabilities = flat_probabilities[np.arange(len(flat_labels)), flat_labels]
    mean_cross_entropy = float(np.mean(-np.log(np.clip(true_probabilities, 1e-300, 1.0))))
    white = np.isin(labels, np.arange(1, 7))
    black = np.isin(labels, np.arange(7, 13))
    predicted_white = np.isin(predictions, np.arange(1, 7))
    predicted_black = np.isin(predictions, np.arange(7, 13))
    empty = labels == 0
    nonempty = ~empty
    black_errors = black & ~correct
    white_errors = white & ~correct
    same_piece_white = np.zeros_like(labels, dtype=bool)
    for black_class in range(7, 13):
        same_piece_white |= (labels == black_class) & (predictions == black_class - 6)
    selected_loss = selected_losses.get(str(model["id"]))
    all_squares = int(labels.size)
    result: dict[str, Any] = {
        "id": model["id"],
        "seed": model["seed"],
        "sha256": model["sha256"],
        "bytes": model["bytes"],
        "meanCrossEntropy": mean_cross_entropy,
        "recordedSelectedDevelopmentMeanCrossEntropy": selected_loss,
        "absoluteDifferenceFromRecorded": (
            abs(mean_cross_entropy - selected_loss) if selected_loss is not None else None
        ),
        "raw": {
            "correctSquares": int(correct.sum()),
            "squareAccuracy": float(correct.mean()),
            "exactBoards": int(exact.sum()),
            "exactBoardAccuracy": float(exact.mean()),
        },
        "confidenceQualified": {
            "confidentCorrectSquares": int(confident_correct.sum()),
            "confidentSquareAccuracy": float(confident_correct.sum() / all_squares),
            "reliableExactBoards": int((exact & reliable).sum()),
            "reliableWrongBoards": int((~exact & reliable).sum()),
            "lowConfidenceBoards": int((~reliable).sum()),
        },
        "colorAggregates": {
            "emptyCorrect": int((correct & empty).sum()),
            "emptyTotal": int(empty.sum()),
            "emptyAccuracy": _safe_ratio(int((correct & empty).sum()), int(empty.sum())),
            "nonemptyCorrect": int((correct & nonempty).sum()),
            "nonemptyTotal": int(nonempty.sum()),
            "nonemptyAccuracy": _safe_ratio(int((correct & nonempty).sum()), int(nonempty.sum())),
            "whiteCorrect": int((correct & white).sum()),
            "whiteTotal": int(white.sum()),
            "whiteAccuracy": _safe_ratio(int((correct & white).sum()), int(white.sum())),
            "blackCorrect": int((correct & black).sum()),
            "blackTotal": int(black.sum()),
            "blackAccuracy": _safe_ratio(int((correct & black).sum()), int(black.sum())),
            "blackToWhite": int((black_errors & predicted_white).sum()),
            "blackToWhiteShareOfBlackErrors": _safe_ratio(
                int((black_errors & predicted_white).sum()), int(black_errors.sum())
            ),
            "blackToSamePieceWhiteCounterpart": int(same_piece_white.sum()),
            "whiteToBlack": int((white_errors & predicted_black).sum()),
            "totalPredictedBlack": int(predicted_black.sum()),
        },
        "perClass": {
            CLASS_ORDER[index]: {
                "correct": int(confusion[index, index]),
                "total": int(confusion[index].sum()),
                "accuracy": _safe_ratio(int(confusion[index, index]), int(confusion[index].sum())),
            }
            for index in range(CLASS_COUNT)
        },
        "offDiagonalConfusions": sorted(
            [
                {
                    "actual": CLASS_ORDER[actual],
                    "predicted": CLASS_ORDER[predicted],
                    "count": int(confusion[actual, predicted]),
                }
                for actual in range(CLASS_COUNT)
                for predicted in range(CLASS_COUNT)
                if actual != predicted and confusion[actual, predicted] > 0
            ],
            key=lambda value: (-value["count"], value["actual"], value["predicted"]),
        ),
    }
    result["elapsedSeconds"] = time.perf_counter() - started
    return result


def run(data_dir: Path, freeze_path: Path) -> dict[str, Any]:
    started = time.perf_counter()
    canonical_manifest = EXPERIMENT_ROOT / "manifests" / "dataset-v2.json"
    if sha256_file(data_dir / "dataset-manifest.json") != sha256_file(canonical_manifest):
        raise DiagnosticError("development data does not match the canonical v2 dataset")
    dataset = load_split(data_dir, "dev")
    if dataset.board_count != 256 or dataset.families != frozenset(("firi",)):
        raise DiagnosticError("diagnostic requires the fixed 256-board Firi development split")
    models = _load_models(freeze_path)
    selected_losses = _selected_dev_losses()
    results = [
        _evaluate_model(model, dataset.vectors, dataset.labels, selected_losses)
        for model in models
    ]
    return {
        "schemaVersion": 1,
        "status": "completed",
        "kind": "post-freeze-development-color-diagnostic",
        "policy": "Aggregate CPU inference on the already-used development split only. No held-out inference, training, threshold change, candidate selection, or promotion use.",
        "command": "experiments/recognition-training/.venv/bin/python experiments/recognition-training/v2/analysis/dev_color_diagnostic.py",
        "commit": _commit(),
        "environment": {
            "python": platform.python_version(),
            "onnxruntime": ort.__version__,
            "provider": "CPUExecutionProvider",
            "intraOpThreads": 1,
            "interOpThreads": 1,
        },
        "scriptSha256": sha256_file(Path(__file__)),
        "candidateFreezeSha256": sha256_file(freeze_path),
        "input": {
            "split": "dev",
            "family": "firi",
            "boards": dataset.board_count,
            "squares": int(dataset.labels.size),
            "datasetManifestSha256": dataset.manifest_sha256,
            "vectorsSha256": dataset.vector_sha256,
            "labelsSha256": dataset.labels_sha256,
        },
        "confidenceFloor": CONFIDENCE_FLOOR,
        "models": results,
        "elapsedSeconds": time.perf_counter() - started,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=EXPERIMENT_ROOT / "data" / "full")
    parser.add_argument(
        "--freeze", type=Path, default=EXPERIMENT_ROOT / "runs" / "candidates.freeze.json"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=EXPERIMENT_ROOT / "reports" / "failure-diagnostic-dev.json",
    )
    arguments = parser.parse_args(argv)
    try:
        result = run(arguments.data_dir, arguments.freeze)
    except (DatasetError, DiagnosticError, OSError, RuntimeError, ValueError) as error:
        result = {"schemaVersion": 1, "status": "failed", "error": str(error)}
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
