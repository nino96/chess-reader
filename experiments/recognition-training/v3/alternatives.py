"""Native, research-only adapters for the two issue #40 alternatives.

This module never downloads models and never loads user documents. It verifies
artifacts against the frozen identities before model loading and uses the
separately pinned research-only Pillow preprocessing dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import sys
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import torch

_PIL_TARGET = Path(__file__).with_name("cache") / "python"
if _PIL_TARGET.exists() and str(_PIL_TARGET) not in sys.path:
    sys.path.insert(0, str(_PIL_TARGET))
try:
    from PIL import Image
except ImportError as error:  # pragma: no cover - environment setup error
    raise RuntimeError("install the pinned preprocessing lock into v3/cache/python") from error


class AlternativeError(RuntimeError):
    """An artifact, input, or native output does not satisfy its frozen schema."""


CANONICAL_CLASSES = "1KQRBNPkqrbnp"
FENIFY_NATIVE_CLASSES = ("1", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k")
NAKST_CLASSES = (
    "board", "K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p",
)
FENIFY_TO_CANONICAL = np.asarray(
    [FENIFY_NATIVE_CLASSES.index(symbol) for symbol in CANONICAL_CLASSES], dtype=np.int64
)
IMAGENET_MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
IMAGENET_STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]
FENIFY_SHA256 = "baafc27099f4b0948a5136ebd3860f986fa4b5b016c83c859efa7649adb8968b"
FENIFY_BYTES = 127_147_094
NAKST_SHA256 = "6fdef8213ab818a71c69250e61e213a7b5471ffb05c0fae485e7d96040f9642c"
NAKST_BYTES = 103_737_229


def _rgb_input(rgb: np.ndarray, height: int, width: int) -> np.ndarray:
    if rgb.dtype != np.uint8 or rgb.shape != (height, width, 3):
        raise AlternativeError(f"expected uint8 RGB [{height},{width},3]")
    return rgb


def verify_artifact(path: Path, expected_sha256: str, expected_bytes: int) -> None:
    try:
        size = path.stat().st_size
        hasher = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                hasher.update(chunk)
        digest = hasher.hexdigest()
    except OSError as error:
        raise AlternativeError("alternative artifact is unavailable") from error
    if size != expected_bytes or digest != expected_sha256:
        raise AlternativeError("alternative artifact identity mismatch")


def prepare_fenify_rgb(rgb: np.ndarray) -> np.ndarray:
    """Reproduce the pinned predictor's grayscale -> Resize -> tensor path.

    Torchvision dispatches these transforms to Pillow for a PIL source image.
    Its default resize interpolation is bilinear and antialias is always applied
    for PIL input. The output is exactly 300x300 regardless of source aspect.
    """
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3 or not rgb.size:
        raise AlternativeError("expected nonempty uint8 RGB [height,width,3]")
    pil = Image.fromarray(rgb).convert("L").convert("RGB")
    pil = pil.resize((300, 300), resample=Image.Resampling.BILINEAR)
    chw = np.transpose(np.asarray(pil, dtype=np.float32) / 255.0, (2, 0, 1))
    return ((chw - IMAGENET_MEAN) / IMAGENET_STD)[None, ...]


def canonicalize_fenify_output(native: np.ndarray) -> np.ndarray:
    """Map native A1-first Fenify probabilities to canonical A1-first classes."""
    values = np.asarray(native)
    if values.shape != (1, 64, 13) or not np.isfinite(values).all():
        raise AlternativeError("Fenify output must be finite float [1,64,13]")
    if (values < 0).any() or (values > 1).any() or not np.allclose(values.sum(2), 1, atol=1e-5):
        raise AlternativeError("Fenify TorchScript output is not per-square softmax probability")
    return values[:, :, FENIFY_TO_CANONICAL].astype(np.float32, copy=False)


def inspect_fenify_artifact(path: Path) -> dict[str, Any]:
    """Load TorchScript structure without invoking forward."""
    verify_artifact(path, FENIFY_SHA256, FENIFY_BYTES)
    model = torch.jit.load(str(path), map_location="cpu")
    graph = str(model.graph)
    required = ("aten::reshape", "aten::softmax", "value=64", "value=13")
    if any(token not in graph for token in required):
        raise AlternativeError("Fenify graph lacks the pinned 64x13 softmax schema")
    return {"input": "float32 NCHW 1x3x300x300 (predictor contract)", "output": "1x64x13 softmax", "forwardRun": False}


class FenifySession:
    """One verified model load reused across the bounded smoke inputs."""
    def __init__(self, path: Path) -> None:
        inspect_fenify_artifact(path)
        self._model = torch.jit.load(str(path), map_location="cpu").eval()

    def infer(self, rgb: np.ndarray) -> np.ndarray:
        with torch.inference_mode():
            native = self._model(torch.from_numpy(prepare_fenify_rgb(rgb))).cpu().numpy()
        return canonicalize_fenify_output(native)


def inspect_nakst_artifact(path: Path) -> dict[str, Any]:
    """Validate pinned ONNX graph metadata without creating an inference session."""
    verify_artifact(path, NAKST_SHA256, NAKST_BYTES)
    model = onnx.load(str(path), load_external_data=False)
    if len(model.graph.input) != 1 or len(model.graph.output) != 1:
        raise AlternativeError("NAKST graph must have one input and one output")
    def shape(value: Any) -> list[int]:
        return [dimension.dim_value for dimension in value.type.tensor_type.shape.dim]
    input_value, output_value = model.graph.input[0], model.graph.output[0]
    if input_value.name != "images" or shape(input_value) != [1, 3, 640, 640]:
        raise AlternativeError("NAKST input schema differs from pinned NCHW graph")
    if output_value.name != "output0" or shape(output_value) != [1, 17, 8400]:
        raise AlternativeError("NAKST output schema differs from pinned YOLOv8 graph")
    if any(initializer.data_location == onnx.TensorProto.EXTERNAL for initializer in model.graph.initializer):
        raise AlternativeError("NAKST graph unexpectedly uses external tensor data")
    metadata = {item.key: item.value for item in model.metadata_props}
    return {"input": "images float32 [1,3,640,640] RGB/255", "output": "output0 float32 [1,17,8400] normalized-xywh+13 scores", "metadata": metadata, "forwardRun": False}


def prepare_nakst_rgb(rgb: np.ndarray) -> tuple[np.ndarray, dict[str, float | int]]:
    """Apply the frozen centered Pillow-bilinear 640 letterbox and RGB/255.

    The upstream card requires aspect-preserving centered padding but does not
    pin a resize implementation. This experiment pins Pillow rather than
    claiming byte parity with OpenCV's INTER_LINEAR implementation.
    """
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3 or not rgb.size:
        raise AlternativeError("expected nonempty uint8 RGB [height,width,3]")
    height, width = rgb.shape[:2]
    scale = min(640 / width, 640 / height)
    resized_width, resized_height = round(width * scale), round(height * scale)
    if resized_width < 1 or resized_height < 1:
        raise AlternativeError("image aspect ratio collapses a letterbox dimension")
    resized = Image.fromarray(rgb).resize(
        (resized_width, resized_height), resample=Image.Resampling.BILINEAR
    )
    left = (640 - resized_width) // 2
    top = (640 - resized_height) // 2
    canvas = Image.new("RGB", (640, 640), (114, 114, 114))
    canvas.paste(resized, (left, top))
    image = np.asarray(canvas, dtype=np.float32)
    tensor = np.transpose(image / 255.0, (2, 0, 1))[None, ...]
    return tensor, {"scale": scale, "left": left, "top": top, "resizedWidth": resized_width, "resizedHeight": resized_height}


class NakstSession:
    """One verified ORT session reused across the bounded smoke inputs."""
    def __init__(self, path: Path) -> None:
        inspect_nakst_artifact(path)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self._session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        self.numeric_aggregate: dict[str, float | int | None] = {
            "minimumPreClip": None,
            "maximumPreClip": None,
            "clippedScores": 0,
        }

    def infer(self, rgb: np.ndarray, confidence: float = 0.25, iou: float = 0.7) -> list[dict[str, Any]]:
        tensor, geometry = prepare_nakst_rgb(rgb)
        output = self._session.run(["output0"], {"images": tensor})[0]
        numeric: dict[str, float | int] = {}
        detections = decode_nakst(output, confidence=confidence, iou=iou, numeric=numeric)
        previous_minimum = self.numeric_aggregate["minimumPreClip"]
        previous_maximum = self.numeric_aggregate["maximumPreClip"]
        self.numeric_aggregate["minimumPreClip"] = min(
            float(numeric["minimumPreClip"]),
            float(previous_minimum) if previous_minimum is not None else float("inf"),
        )
        self.numeric_aggregate["maximumPreClip"] = max(
            float(numeric["maximumPreClip"]),
            float(previous_maximum) if previous_maximum is not None else float("-inf"),
        )
        self.numeric_aggregate["clippedScores"] = int(self.numeric_aggregate["clippedScores"] or 0) + int(numeric["clippedScores"])
        original = [
            _undo_letterbox(_normalized_to_letterbox(item), geometry, rgb.shape[1], rgb.shape[0])
            for item in detections
        ]
        return associate_nakst_boards(original)


@dataclass(frozen=True)
class Detection:
    xyxy: tuple[float, float, float, float]
    score: float
    class_id: int


def _iou(one: Detection, two: Detection) -> float:
    left, top = max(one.xyxy[0], two.xyxy[0]), max(one.xyxy[1], two.xyxy[1])
    right, bottom = min(one.xyxy[2], two.xyxy[2]), min(one.xyxy[3], two.xyxy[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    area_one = max(0.0, one.xyxy[2] - one.xyxy[0]) * max(0.0, one.xyxy[3] - one.xyxy[1])
    area_two = max(0.0, two.xyxy[2] - two.xyxy[0]) * max(0.0, two.xyxy[3] - two.xyxy[1])
    union = area_one + area_two - intersection
    return intersection / union if union else 0.0


def decode_nakst(
    output: np.ndarray,
    confidence: float = 0.25,
    iou: float = 0.7,
    max_detections: int = 300,
    numeric: dict[str, float | int] | None = None,
) -> list[Detection]:
    """Decode the confirmed exported YOLOv8 xywh+class-probability tensor."""
    values = np.asarray(output)
    if not 0 <= confidence <= 1 or not 0 <= iou <= 1 or not 1 <= max_detections <= 300:
        raise AlternativeError("invalid NAKST threshold or detection bound")
    if values.shape != (1, 17, 8400) or not np.isfinite(values).all():
        raise AlternativeError("NAKST output must be finite [1,17,8400]")
    rows = values[0].T
    scores = rows[:, 4:]
    minimum, maximum = float(scores.min()), float(scores.max())
    if minimum < -1e-6 or maximum > 1 + 1e-6:
        raise AlternativeError("NAKST graph output class scores are not probabilities")
    clipped = int(np.count_nonzero((scores < 0) | (scores > 1)))
    if numeric is not None:
        numeric.update({"minimumPreClip": minimum, "maximumPreClip": maximum, "clippedScores": clipped})
    scores = np.clip(scores, 0, 1)
    class_ids = scores.argmax(1)
    confidence_values = scores[np.arange(len(rows)), class_ids]
    candidates: list[Detection] = []
    for index in np.flatnonzero(confidence_values >= confidence):
        cx, cy, width, height = map(float, rows[index, :4])
        if width <= 0 or height <= 0:
            continue
        candidates.append(Detection((cx-width/2, cy-height/2, cx+width/2, cy+height/2), float(confidence_values[index]), int(class_ids[index])))
    candidates.sort(key=lambda item: (-item.score, item.class_id, item.xyxy))
    kept: list[Detection] = []
    for candidate in candidates:
        if all(candidate.class_id != previous.class_id or _iou(candidate, previous) <= iou for previous in kept):
            kept.append(candidate)
            if len(kept) == max_detections:
                break
    return kept


def _undo_letterbox(item: Detection, geometry: dict[str, float | int], width: int, height: int) -> Detection:
    scale, left, top = float(geometry["scale"]), float(geometry["left"]), float(geometry["top"])
    x1, y1, x2, y2 = item.xyxy
    box = (max(0.0, (x1-left)/scale), max(0.0, (y1-top)/scale), min(float(width), (x2-left)/scale), min(float(height), (y2-top)/scale))
    return Detection(box, item.score, item.class_id)


def _normalized_to_letterbox(item: Detection) -> Detection:
    """Convert the pinned export's normalized boxes to its 640px input frame."""
    return Detection(tuple(coordinate * 640 for coordinate in item.xyxy), item.score, item.class_id)


def associate_nakst_boards(detections: list[Detection]) -> list[dict[str, Any]]:
    """Associate predicted pieces with predicted board boxes; never uses oracle bounds.

    Detector scores cannot provide empty-square probabilities. Cells therefore
    carry optional labels/confidence rather than fabricated probabilities.
    """
    boards = [item for item in detections if item.class_id == 0]
    pieces = [item for item in detections if item.class_id != 0]
    result: list[dict[str, Any]] = []
    for board in boards:
        left, top, right, bottom = board.xyxy
        if right <= left or bottom <= top:
            continue
        cells: list[dict[str, Any]] = [{"label": None, "confidence": None} for _ in range(64)]
        cell_detections: list[list[Detection]] = [[] for _ in range(64)]
        for piece in pieces:
            cx = (piece.xyxy[0] + piece.xyxy[2]) / 2
            cy = (piece.xyxy[1] + piece.xyxy[3]) / 2
            if not (left <= cx < right and top <= cy < bottom):
                continue
            file_index = min(7, int(8 * (cx-left) / (right-left)))
            rank_from_top = min(7, int(8 * (cy-top) / (bottom-top)))
            cell_detections[(7-rank_from_top) * 8 + file_index].append(piece)
        conflicts = 0
        for square, found in enumerate(cell_detections):
            if not found:
                continue
            found.sort(key=lambda item: (-item.score, item.class_id, item.xyxy))
            conflicts += max(0, len(found)-1)
            if len(found) == 1:
                chosen = found[0]
                cells[square] = {"label": NAKST_CLASSES[chosen.class_id], "confidence": chosen.score}
        result.append({"board": board, "cellsA1First": cells, "pieceConflicts": conflicts, "abstained": conflicts > 0, "emptyConfidenceAvailable": False, "orientationInferred": False})
    return result
