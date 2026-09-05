"""Bounded full-development diagnostic for the native NAKST detector.

Only the 384-board development split is available here. The evaluator stops as
soon as either frozen promotion target is mathematically unreachable and always
retains aggregate-only partial evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from typing import Any, Callable, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parent
if str(PARENT) not in sys.path:
    sys.path.insert(0, str(PARENT))

from dataset import DatasetError, load_split, sha256_file
from alternatives import (
    CANONICAL_CLASSES, Image, NAKST_BYTES, NAKST_SHA256, NakstSession,
    verify_artifact,
)

BOARD_COUNT = 384
SQUARE_COUNT = BOARD_COUNT * 64
MAX_NONEXACT = 19
MAX_WRONG_SQUARES = 122
CONFIDENCE_FLOOR = 0.7
INTERNAL_SECONDS = 55
OUTPUT_CEILING_SECONDS = 60


class DevelopmentError(RuntimeError):
    """The bounded diagnostic cannot produce trustworthy evidence."""


def _read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DevelopmentError(f"{label} is unavailable or invalid") from error
    if not isinstance(value, dict):
        raise DevelopmentError(f"{label} must contain an object")
    return value


def _command_output(command: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def verified_dev_rgb(data: Path, dataset_manifest: Path, labels_path: Path) -> list[Path]:
    """Validate the reviewed native RGB inventory before any model forward."""
    canonical = ROOT / "manifests/dataset-generated.json"
    verification_path = ROOT / "manifests/dataset-verification.json"
    manifest = _read_object(dataset_manifest, "dataset manifest")
    if sha256_file(dataset_manifest) != sha256_file(canonical):
        raise DevelopmentError("generated dataset manifest differs from its canonical copy")
    verification_record = manifest.get("verification")
    if not isinstance(verification_record, dict) or verification_record.get("path") != "manifests/dataset-verification.json" or verification_record.get("sha256") != sha256_file(verification_path):
        raise DevelopmentError("dataset manifest does not bind RGB verification evidence")
    verification = _read_object(verification_path, "dataset verification")
    checks = verification.get("checks")
    hashes = verification.get("devRgbHashes")
    boolean_checks = ("splitIdsDisjoint", "everyClassPerFamilyCondition", "vectorLengths", "smokeTruthComplete", "serializedDevReplay", "fullCorpusReplay", "corpusV1Excluded")
    if verification.get("schemaVersion") != 1 or verification.get("status") != "passed" or not isinstance(checks, dict) or checks.get("devRgbCount") != BOARD_COUNT or any(checks.get(key) is not True for key in boolean_checks) or not isinstance(hashes, dict) or len(hashes) != BOARD_COUNT:
        raise DevelopmentError("native RGB verification evidence is incomplete")
    if verification.get("sourceLockFinalSha256") != sha256_file(ROOT / "source-lock.json"):
        raise DevelopmentError("RGB verification does not bind the current source lock")
    labels = _read_object(labels_path, "development labels").get("boards")
    if not isinstance(labels, list) or len(labels) != BOARD_COUNT:
        raise DevelopmentError("development labels do not define 384 RGB identities")
    paths: list[Path] = []
    for index, board in enumerate(labels):
        expected_name = f"synthetic-v3-dev-{index:05d}.png"
        if not isinstance(board, dict) or board.get("id") != expected_name.removesuffix(".png") or hashes.get(expected_name) is None:
            raise DevelopmentError("native RGB identity order differs from development labels")
        path = data / "dev-rgb" / expected_name
        if sha256_file(path) != hashes[expected_name]:
            raise DevelopmentError("native RGB image differs from reviewed verification evidence")
        paths.append(path)
    return paths


def load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        value = np.asarray(image.convert("RGB"))
    if value.dtype != np.uint8 or value.ndim != 3 or value.shape[2] != 3:
        raise DevelopmentError("native development image is not uint8 RGB")
    return value


def empty_counts() -> dict[str, Any]:
    return {
        "processedBoards": 0, "exactBoards": 0, "correctSquares": 0,
        "occupiedTotal": 0, "occupiedCorrect": 0, "nonExactBoards": 0,
        "wrongSquares": 0, "missedBoardSquares": 0,
        "perClass": {symbol: {"total": 0, "correct": 0} for symbol in CANONICAL_CLASSES},
        "color": {name: {"total": 0, "correct": 0} for name in ("empty", "white", "black", "occupied")},
        "confusionActualRowsPredictedColumns": np.zeros((13, 14), dtype=np.int64).tolist(),
        "detectedPieceConfidence": {"count": 0, "minimum": None, "sum": 0.0},
        "pieceAndBoardConfidenceQualifiedAtOrAbove0.7": {
            "observedPredictedPieces": 0, "correctPredictedPieces": 0,
            "wrongPredictedPieces": 0, "reliableExactBoards": 0,
            "reliableWrongBoards": 0,
        },
        "reusedBoardsWithoutPerSquareConfidence": 0,
    }


def _add_prediction(counts: dict[str, Any], expected: np.ndarray, predictions: list[dict[str, Any]]) -> None:
    inferred = np.full(64, -1, dtype=np.int64)
    confidences = np.full(64, np.nan, dtype=np.float64)
    board_confidence: float | None = None
    abstained = True
    if len(predictions) == 1:
        prediction = predictions[0]
        cells = prediction.get("cellsA1First")
        board = prediction.get("board")
        if isinstance(cells, list) and len(cells) == 64 and hasattr(board, "score"):
            abstained = bool(prediction.get("abstained", True))
            board_confidence = float(board.score)
            for index, cell in enumerate(cells):
                label = cell.get("label") if isinstance(cell, dict) else None
                confidence = cell.get("confidence") if isinstance(cell, dict) else None
                if isinstance(label, str) and len(label) == 1 and label in CANONICAL_CLASSES[1:] and isinstance(confidence, (int, float)) and np.isfinite(confidence):
                    inferred[index] = CANONICAL_CLASSES.index(label)
                    confidences[index] = float(confidence)
    # A missing predicted piece is classified as empty for raw accuracy, while
    # its confidence remains unavailable. A missing board stays unknown.
    raw_prediction = np.where(inferred < 0, 0, inferred) if len(predictions) == 1 else inferred
    correct = raw_prediction == expected
    exact = bool(correct.all()) and not abstained
    occupied = expected != 0
    counts["processedBoards"] += 1
    counts["exactBoards"] += int(exact)
    counts["nonExactBoards"] += int(not exact)
    counts["correctSquares"] += int(correct.sum())
    counts["wrongSquares"] += int((~correct).sum())
    counts["occupiedTotal"] += int(occupied.sum())
    counts["occupiedCorrect"] += int((correct & occupied).sum())
    counts["missedBoardSquares"] += int((raw_prediction < 0).sum())
    matrix = np.asarray(counts["confusionActualRowsPredictedColumns"])
    np.add.at(matrix, (expected, np.where(raw_prediction < 0, 13, raw_prediction)), 1)
    counts["confusionActualRowsPredictedColumns"] = matrix.tolist()
    for class_index, symbol in enumerate(CANONICAL_CLASSES):
        mask = expected == class_index
        counts["perClass"][symbol]["total"] += int(mask.sum())
        counts["perClass"][symbol]["correct"] += int((correct & mask).sum())
    masks = {"empty": expected == 0, "white": (expected >= 1) & (expected <= 6), "black": expected >= 7, "occupied": occupied}
    for name, mask in masks.items():
        counts["color"][name]["total"] += int(mask.sum())
        counts["color"][name]["correct"] += int((correct & mask).sum())
    observed = np.isfinite(confidences)
    accepted = observed & (confidences >= CONFIDENCE_FLOOR)
    confidence_values = confidences[observed]
    confidence = counts["detectedPieceConfidence"]
    confidence["count"] += int(observed.sum())
    confidence["sum"] += float(confidence_values.sum())
    if confidence_values.size:
        confidence["minimum"] = min(float(confidence_values.min()), confidence["minimum"] if confidence["minimum"] is not None else float("inf"))
    qualified = counts["pieceAndBoardConfidenceQualifiedAtOrAbove0.7"]
    qualified["observedPredictedPieces"] += int(accepted.sum())
    qualified["correctPredictedPieces"] += int((accepted & correct).sum())
    qualified["wrongPredictedPieces"] += int((accepted & ~correct).sum())
    board_reliable = not abstained and board_confidence is not None and board_confidence >= CONFIDENCE_FLOOR and bool(np.all(confidences[inferred > 0] >= CONFIDENCE_FLOOR))
    qualified["reliableExactBoards"] += int(exact and board_reliable)
    qualified["reliableWrongBoards"] += int((not exact) and board_reliable)


def _merge_reused(counts: dict[str, Any], detector: dict[str, Any]) -> int:
    boards = detector.get("boards")
    if boards != 12 or detector.get("squares") != 768:
        raise DevelopmentError("smoke aggregate does not cover the expected first 12 boards")
    counts["processedBoards"] = boards
    counts["exactBoards"] = int(detector["exactBoards"])
    counts["nonExactBoards"] = boards - counts["exactBoards"]
    counts["correctSquares"] = int(detector["correctSquares"])
    counts["wrongSquares"] = 768 - counts["correctSquares"]
    counts["occupiedTotal"] = int(detector["occupiedTotal"])
    counts["occupiedCorrect"] = int(detector["occupiedCorrect"])
    counts["missedBoardSquares"] = int(detector["missedBoardSquares"])
    counts["perClass"] = detector["perClass"]
    counts["color"]["white"] = detector["color"]["white"]
    counts["color"]["black"] = detector["color"]["black"]
    counts["color"]["occupied"] = {"total": counts["occupiedTotal"], "correct": counts["occupiedCorrect"]}
    empty_total = 768 - counts["occupiedTotal"]
    empty_correct = counts["correctSquares"] - counts["occupiedCorrect"]
    counts["color"]["empty"] = {"total": empty_total, "correct": empty_correct}
    counts["confusionActualRowsPredictedColumns"] = detector["confusionActualRowsPredictedColumns"]
    observed = detector["detectedPieceConfidence"]
    counts["detectedPieceConfidence"] = {"count": int(observed["count"]), "minimum": observed["minimum"], "sum": float(observed["mean"]) * int(observed["count"])}
    counts["reusedBoardsWithoutPerSquareConfidence"] = boards
    return boards


def verify_reuse(proof_path: Path | None, smoke_path: Path, dataset_manifest: Path, labels_path: Path, model_path: Path) -> dict[str, Any] | None:
    smoke = _read_object(smoke_path, "native smoke report")
    smoke_manifest = ROOT / "data/full/smoke/manifest.json"
    source_lock = ROOT / "source-lock.json"
    required = {
        "smokeReportSha256": sha256_file(smoke_path),
        "smokeManifestSha256": sha256_file(smoke_manifest),
        "datasetManifestSha256": sha256_file(dataset_manifest),
        "developmentLabelsSha256": sha256_file(labels_path),
        "sourceLockSha256": sha256_file(source_lock),
        "adapterSha256": sha256_file(ROOT / "alternatives.py"),
        "modelSha256": sha256_file(model_path),
    }
    if proof_path is not None:
        proof = _read_object(proof_path, "smoke reuse proof")
        if proof.get("schemaVersion") != 1 or proof.get("status") != "passed" or any(proof.get(name) != digest for name, digest in required.items()):
            raise DevelopmentError("smoke reuse proof does not bind every current input")
    if smoke.get("status") != "completed" or any(smoke.get(name) != digest for name, digest in {"manifestSha256": required["smokeManifestSha256"], "developmentLabelsSha256": required["developmentLabelsSha256"], "adapterSha256": required["adapterSha256"], "modelSha256": required["modelSha256"]}.items()):
        raise DevelopmentError("smoke report identities differ from current inputs")
    manifest = _read_object(smoke_manifest, "smoke manifest")
    entries = manifest.get("inputs")
    if not isinstance(entries, list) or [entry.get("truthBoards", [{}])[0].get("devIndex") for entry in entries[:12]] != list(range(12)):
        raise DevelopmentError("smoke positives are not development indices 0..11")
    verification = _read_object(ROOT / "manifests/dataset-verification.json", "dataset verification")
    rgb_hashes = verification.get("devRgbHashes")
    if not isinstance(rgb_hashes, dict) or any(entry.get("sha256") != rgb_hashes.get(f"synthetic-v3-dev-{index:05d}.png") for index, entry in enumerate(entries[:12])):
        raise DevelopmentError("smoke inputs do not match the reviewed native development RGB images")
    detector = smoke.get("detectorDiagnostic")
    if not isinstance(detector, dict):
        raise DevelopmentError("smoke report lacks aggregate detector diagnostics")
    dataset = _read_object(dataset_manifest, "dataset manifest")
    artifacts = dataset.get("artifacts")
    dev = artifacts.get("dev") if isinstance(artifacts, dict) else None
    label_record = dev.get("labels") if isinstance(dev, dict) else None
    source_record = dataset.get("generatorLock")
    if not isinstance(label_record, dict) or label_record.get("sha256") != required["developmentLabelsSha256"] or not isinstance(source_record, dict) or source_record.get("sha256") != required["sourceLockSha256"]:
        raise DevelopmentError("dataset manifest does not bind development labels and source lock")
    return detector


def _decision(counts: dict[str, Any], reason: str | None) -> dict[str, Any]:
    processed = counts["processedBoards"]
    remaining = BOARD_COUNT - processed
    exact_upper = (counts["exactBoards"] + remaining) / BOARD_COUNT
    square_upper = (counts["correctSquares"] + remaining * 64) / SQUARE_COUNT
    raw_failed = counts["nonExactBoards"] > MAX_NONEXACT or counts["wrongSquares"] > MAX_WRONG_SQUARES
    confidence_tuning = "unneeded: raw upper bound already fails" if raw_failed else "not selected by this fixed-threshold diagnostic"
    return {
        "status": "STOP" if raw_failed or reason else "completed",
        "reason": reason or ("raw promotion target is mathematically unreachable" if raw_failed else "all development boards processed"),
        "rawExactUpperBound": exact_upper, "rawSquareUpperBound": square_upper,
        "maximumNonExactBoards": MAX_NONEXACT, "maximumWrongSquares": MAX_WRONG_SQUARES,
        "thresholdTuning": confidence_tuning,
    }


def report(counts: dict[str, Any], started: float, identities: dict[str, Any], reason: str | None, reused: int) -> dict[str, Any]:
    processed = counts["processedBoards"]
    confidence = counts["detectedPieceConfidence"]
    confidence["mean"] = confidence["sum"] / confidence["count"] if confidence["count"] else None
    del confidence["sum"]
    for group in (*counts["perClass"].values(), *counts["color"].values()):
        group["accuracy"] = group["correct"] / group["total"] if group["total"] else None
        group["errors"] = group["total"] - group["correct"]
    return {
        "schemaVersion": 1, "status": "completed" if reason is None and processed == BOARD_COUNT else "stopped",
        "kind": "nakst-full-development-native-diagnostic", "candidate": "nakst",
        "command": "timeout 60s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/nakst_development.py",
        "commit": _command_output(("git", "rev-parse", "HEAD")), "scriptSha256": sha256_file(Path(__file__)),
        "environment": {"python": platform.python_version(), "machine": platform.machine(), "provider": "CPUExecutionProvider", "threads": 1},
        "input": {"split": "dev", "denominatorBoards": BOARD_COUNT, "denominatorSquares": SQUARE_COUNT, "actualBoardsProcessed": processed, "reusedBoards": reused, "testLoaded": False, **identities},
        "raw": counts, "decision": _decision(counts, reason),
        "confidencePolicy": {"classificationThreshold": CONFIDENCE_FLOOR, "emptySquareConfidenceAvailable": False, "inventedEmptyConfidence": False, "fullSquareReliabilityGateAvailable": False, "qualifiedCountsCover": "observed predicted pieces and board detection only"},
        "orientation": {"input": "native", "assumption": "A1", "inferred": False},
        "elapsedSeconds": time.monotonic() - started, "internalStopSeconds": INTERNAL_SECONDS, "outerCeilingSeconds": OUTPUT_CEILING_SECONDS,
    }


def run(output: Path, reuse_proof: Path | None = None, smoke_report: Path | None = None, session_factory: Callable[[Path], Any] = NakstSession, clock: Callable[[], float] = time.monotonic) -> dict[str, Any]:
    if output.exists():
        raise DevelopmentError("refusing to overwrite retained development evidence")
    started = clock()
    data = ROOT / "data/full"
    manifest_path, labels_path = data / "dataset-manifest.json", data / "dev.labels.json"
    model_path = ROOT / "cache/alternatives/nakst-best.onnx"
    dataset = load_split(data, "dev")
    if dataset.board_count != BOARD_COUNT:
        raise DevelopmentError("development split must contain exactly 384 boards")
    verify_artifact(model_path, NAKST_SHA256, NAKST_BYTES)
    rgb_paths = verified_dev_rgb(data, manifest_path, labels_path)
    identities = {"datasetManifestSha256": sha256_file(manifest_path), "developmentLabelsSha256": sha256_file(labels_path), "sourceLockSha256": sha256_file(ROOT / "source-lock.json"), "adapterSha256": sha256_file(ROOT / "alternatives.py"), "modelSha256": sha256_file(model_path)}
    counts = empty_counts()
    smoke_path = smoke_report or ROOT / "runs/native-smoke-nakst-attempt-3.json"
    reuse_rejection: str | None = None
    try:
        reused_detector = verify_reuse(reuse_proof, smoke_path, manifest_path, labels_path, model_path)
    except DevelopmentError as error:
        reused_detector = None
        reuse_rejection = str(error)
    offset = _merge_reused(counts, reused_detector) if reused_detector is not None else 0
    identities["smokeReuse"] = {"reportSha256": sha256_file(smoke_path) if reused_detector is not None else None, "compatible": reused_detector is not None, "rejection": reuse_rejection}
    session = session_factory(model_path)
    reason: str | None = None
    try:
        for index in range(offset, BOARD_COUNT):
            if clock() - started >= INTERNAL_SECONDS:
                reason = "internal 55-second CPU deadline reached"
                break
            predictions = session.infer(load_rgb(rgb_paths[index]))
            _add_prediction(counts, dataset.labels[index], predictions)
            if counts["nonExactBoards"] > MAX_NONEXACT or counts["wrongSquares"] > MAX_WRONG_SQUARES:
                reason = "raw promotion target is mathematically unreachable"
                break
    except Exception as error:
        reason = f"inference stopped: {type(error).__name__}: {error}"
    result = report(counts, started, identities, reason, offset)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "runs/nakst-development.json")
    parser.add_argument("--reuse-proof", type=Path)
    parser.add_argument("--smoke-report", type=Path)
    arguments = parser.parse_args()
    try:
        result = run(arguments.output, arguments.reuse_proof, arguments.smoke_report)
    except (DatasetError, DevelopmentError, OSError, RuntimeError, ValueError) as error:
        if not arguments.output.exists():
            arguments.output.parent.mkdir(parents=True, exist_ok=True)
            arguments.output.write_text(json.dumps({"schemaVersion": 1, "status": "failed", "errorType": type(error).__name__, "error": str(error), "testLoaded": False}, indent=2) + "\n", encoding="utf-8")
        return 1
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
