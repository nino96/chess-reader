"""Aggregate, privacy-safe CPU ONNX evaluation for a frozen candidate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import time
from typing import Any, Sequence

LEGACY_ROOT = Path(__file__).resolve().parents[1]
import sys
if str(LEGACY_ROOT) not in sys.path:
    sys.path.insert(0, str(LEGACY_ROOT))

import numpy as np
import onnxruntime as ort

from dataset import DatasetError, load_split, sha256_file
from tilenet_model import CLASS_COUNT, INPUT_NAME, INPUT_WIDTH, OUTPUT_NAME


class EvaluationError(RuntimeError):
    pass


CONFIDENCE_FLOOR = 0.7


def _commit() -> str | None:
    # Evaluation reports tolerate source archives without a Git checkout.
    import subprocess

    try:
        completed = subprocess.run(("git", "rev-parse", "HEAD"), capture_output=True, check=False, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return completed.stdout.strip() if completed.returncode == 0 else None


def _freeze_candidate(freeze_path: Path, model_path: Path, protocol_sha256: str, data_dir: Path) -> dict[str, Any]:
    try:
        freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvaluationError("held-out evaluation requires a valid frozen-candidates record") from error
    if not isinstance(freeze, dict) or freeze.get("schemaVersion") != 1 or freeze.get("runKind") != "full":
        raise EvaluationError("held-out evaluation freeze schema is invalid")
    if freeze.get("protocolSha256") != protocol_sha256:
        raise EvaluationError("held-out evaluation freeze does not bind this protocol")
    wrapper_path = data_dir / "vectors.manifest.json"
    if freeze.get("testManifestSha256") != sha256_file(wrapper_path):
        raise EvaluationError("held-out evaluation freeze does not bind the frozen test vectors")
    try:
        wrapper = json.loads(wrapper_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvaluationError("held-out vector manifest is unavailable") from error
    if (
        not isinstance(wrapper, dict)
        or wrapper.get("schemaVersion") != 1
        or wrapper.get("role") != "held-out-test"
        or wrapper.get("dtype") != "float32-le"
        or wrapper.get("shape") != [256, 64, 1024]
    ):
        raise EvaluationError("held-out vector manifest is invalid")
    test_vectors = data_dir / "test.vectors.f32le"
    test_labels = data_dir / "test.labels.json"
    if wrapper.get("sha256") != sha256_file(test_vectors) or wrapper.get("byteLength") != test_vectors.stat().st_size:
        raise EvaluationError("held-out vector bytes differ from the frozen test manifest")
    try:
        labels_root = json.loads(test_labels.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvaluationError("held-out labels are unavailable") from error
    labels = labels_root.get("boards") if isinstance(labels_root, dict) else None
    wrapper_labels = wrapper.get("labels")
    if not isinstance(labels, list) or not isinstance(wrapper_labels, list) or len(labels) != len(wrapper_labels):
        raise EvaluationError("held-out labels differ from the frozen test manifest")
    for board, frozen_board in zip(labels, wrapper_labels, strict=True):
        classes = frozen_board.get("classes") if isinstance(frozen_board, dict) else None
        if (
            not isinstance(board, dict)
            or not isinstance(frozen_board, dict)
            or not isinstance(frozen_board.get("boardId"), str)
            or not isinstance(classes, list)
            or len(classes) != 64
            or not all(isinstance(value, int) and not isinstance(value, bool) and 0 <= value < CLASS_COUNT for value in classes)
            or board.get("id") != frozen_board.get("boardId")
            or board.get("labels") != classes
        ):
            raise EvaluationError("held-out labels differ from the frozen test manifest")
    candidates = freeze.get("candidates")
    if not isinstance(candidates, list):
        raise EvaluationError("held-out evaluation freeze has no candidates")
    expected = {("shipped", None), ("tilenet-full-3811", 3811), ("tilenet-full-3812", 3812)}
    found = {(candidate.get("id"), candidate.get("seed")) for candidate in candidates if isinstance(candidate, dict)}
    if len(candidates) != 3 or found != expected:
        raise EvaluationError("held-out evaluation freeze must contain exactly shipped and both predeclared candidates")
    digest = sha256_file(model_path)
    size = model_path.stat().st_size
    matched: dict[str, Any] | None = None
    for candidate in candidates:
        if not isinstance(candidate, dict) or not isinstance(candidate.get("modelPath"), str):
            raise EvaluationError("held-out evaluation freeze candidate is invalid")
        frozen_path = (freeze_path.parent / candidate["modelPath"]).resolve()
        try:
            if sha256_file(frozen_path) != candidate.get("sha256") or frozen_path.stat().st_size != candidate.get("bytes"):
                raise EvaluationError("a frozen candidate changed after freeze")
        except OSError as error:
            raise EvaluationError("a frozen candidate is unavailable") from error
        if candidate.get("sha256") == digest and candidate.get("bytes") == size:
            matched = candidate
    if matched is None:
        raise EvaluationError("model is not an immutable candidate in the held-out evaluation freeze")
    return matched


def _distribution(values: list[float]) -> dict[str, float | int]:
    array = np.asarray(values, dtype=np.float64)
    if not len(array):
        raise EvaluationError("cannot report an empty latency or confidence distribution")
    return {
        "n": int(len(array)),
        "min": float(np.min(array)),
        "p50": float(np.quantile(array, 0.5)),
        "p95": float(np.quantile(array, 0.95)),
        "max": float(np.max(array)),
        "mean": float(np.mean(array)),
    }


def evaluate(model_path: Path, data_dir: Path, split: str, freeze_path: Path | None = None) -> dict[str, Any]:
    if split not in ("train", "dev", "test"):
        raise EvaluationError("split must be train, dev, or test")
    manifest_path = data_dir / "dataset-manifest.json"
    protocol_path = Path(__file__).with_name("protocol.json")
    protocol_sha256 = sha256_file(protocol_path)
    manifest_sha256 = sha256_file(manifest_path)
    candidate: dict[str, Any] | None = None
    if split == "test":
        if freeze_path is None:
            raise EvaluationError("held-out test evaluation requires --freeze before loading test data")
        candidate = _freeze_candidate(freeze_path, model_path, protocol_sha256, data_dir)
    dataset = load_split(data_dir, split)  # type: ignore[arg-type]
    started = time.perf_counter()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    cold_session_ms = (time.perf_counter() - started) * 1000
    inputs = dataset.vectors.reshape(-1, INPUT_WIDTH)
    labels = dataset.labels
    board_predictions: list[np.ndarray] = []
    board_confidences: list[np.ndarray] = []
    latency_ms: list[float] = []
    for board in range(dataset.board_count):
        begin = time.perf_counter()
        probabilities = session.run([OUTPUT_NAME], {INPUT_NAME: inputs[board * 64 : (board + 1) * 64]})[0]
        latency_ms.append((time.perf_counter() - begin) * 1000)
        if probabilities.shape != (64, CLASS_COUNT) or not np.isfinite(probabilities).all():
            raise EvaluationError("ONNX runtime returned invalid probabilities")
        board_predictions.append(np.argmax(probabilities, axis=1).astype(np.int64))
        board_confidences.append(np.max(probabilities, axis=1))
    predictions = np.stack(board_predictions)
    confidences = np.stack(board_confidences)
    correct = predictions == labels
    exact = np.all(correct, axis=1)
    reliable = np.min(confidences, axis=1) >= CONFIDENCE_FLOOR
    reliable_exact = exact & reliable
    reliable_wrong = ~exact & reliable
    confident_correct = correct & (confidences >= CONFIDENCE_FLOOR)
    confusion = np.zeros((CLASS_COUNT, CLASS_COUNT), dtype=np.int64)
    for actual in range(CLASS_COUNT):
        for predicted in range(CLASS_COUNT):
            confusion[actual, predicted] = int(np.sum((labels == actual) & (predictions == predicted)))
    per_class = []
    for actual in range(CLASS_COUNT):
        total = int(confusion[actual].sum())
        per_class.append({"class": actual, "total": total, "correct": int(confusion[actual, actual]), "accuracy": float(confusion[actual, actual] / total) if total else None})
    board_min = np.min(confidences, axis=1).tolist()
    board_mean = np.mean(confidences, axis=1).tolist()
    all_squares = dataset.board_count * 64
    observations = [
        {
            "index": index,
            "rawErrorSquares": int((~correct[index]).sum()),
            "minimumConfidence": float(np.min(confidences[index])),
            "meanConfidence": float(np.mean(confidences[index])),
            "reliable": bool(reliable[index]),
            "latencyMs": latency_ms[index],
        }
        for index in range(dataset.board_count)
    ]
    return {
        "schemaVersion": 1,
        "status": "completed",
        "command": ["python", "evaluate_onnx.py", "--model", "<model>", "--data-dir", "<data-dir>", "--split", split] + (["--freeze", "<freeze>"] if split == "test" else []),
        "commit": _commit(),
        "environment": {"python": platform.python_version(), "onnxruntime": ort.__version__, "provider": "CPUExecutionProvider"},
        "protocolSha256": protocol_sha256,
        "datasetManifestSha256": manifest_sha256,
        "candidate": {"id": candidate.get("id"), "seed": candidate.get("seed")} if candidate else None,
        "model": {"sha256": sha256_file(model_path), "bytes": model_path.stat().st_size},
        "input": {"split": split, "boards": dataset.board_count, "vectorSha256": dataset.vector_sha256, "labelsSha256": dataset.labels_sha256, "familyCount": len(dataset.families)},
        "confidenceFloor": CONFIDENCE_FLOOR,
        "raw": {"exactBoards": int(exact.sum()), "exactBoardAccuracy": float(exact.mean()), "correctSquares": int(correct.sum()), "squareAccuracy": float(correct.mean())},
        "confidenceQualified": {
            "reliableExactBoards": int(reliable_exact.sum()),
            "reliableExactBoardAccuracy": float(reliable_exact.mean()),
            "confidentCorrectSquares": int(confident_correct.sum()),
            "confidentSquareAccuracy": float(confident_correct.sum() / all_squares),
            "reliableWrongBoards": int(reliable_wrong.sum()),
            "lowConfidenceBoards": int((~reliable).sum()),
        },
        "confidence": {"boardMinimum": _distribution(board_min), "boardMean": _distribution(board_mean)},
        "perClass": per_class,
        "confusion": confusion.tolist(),
        "latencyMs": {"coldSessionSingleSample": cold_session_ms, "warmPerBoard": _distribution(latency_ms)},
        "observations": observations,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--split", required=True, choices=("train", "dev", "test"))
    parser.add_argument("--freeze", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        result = evaluate(arguments.model, arguments.data_dir, arguments.split, arguments.freeze)
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return 0
    except (DatasetError, EvaluationError, OSError, RuntimeError):
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(json.dumps({"schemaVersion": 1, "status": "failed", "error": "evaluation failed"}, indent=2) + "\n", encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
