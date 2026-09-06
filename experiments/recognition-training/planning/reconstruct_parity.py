"""Reconstruct the shipped fused TileNet graph and prove pre-update parity.

This bounded feasibility check reads only the existing v2 train/development
vectors. It performs no optimization, checkpoint write, export, held-out test
access, or corpus-v1 access.

The layer topology and shipped parameter names derive from FENShot's MIT-licensed
TileNet implementation. Exact upstream source and license hashes are retained in
``experiments/recognition-training/TRAINING_PROVENANCE.md`` and ``NOTICES.md``.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time
from typing import Any, Sequence

import numpy as np
import onnx
from onnx import helper, numpy_helper
import onnxruntime as ort
import torch
from torch import Tensor, nn
from torch.nn import functional as F


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL = (
    ROOT
    / "node_modules/.pnpm/@scoriiu+fenshot@0.1.4_onnxruntime-web@1.29.0/"
    "node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx"
)
DEFAULT_DATA = ROOT / "experiments/recognition-training/v2/data/full"
DEFAULT_OUTPUT = Path(__file__).with_name("reconstruction-parity.json")
CLASS_ORDER = "1KQRBNPkqrbnp"
ATOL = 1e-5
RTOL = 1e-5
EXPECTED_SHIPPED_SHA256 = "883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d"
EXPECTED_DATASET_SHA256 = "509d7ebb604e02f23eb354d16bfead096c7b224d100c7d1a9213e102bf4f5544"


class ParityError(RuntimeError):
    """The shipped graph, source vectors, or reconstruction is incompatible."""


class FusedTileNet(nn.Module):
    """Trainable no-BN graph matching the shipped inference graph exactly."""

    def __init__(self) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(1, 32, 3, padding=1)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        self.conv3 = nn.Conv2d(64, 64, 3, padding=1)
        self.fc1 = nn.Linear(64 * 4 * 4, 256)
        self.fc2 = nn.Linear(256, 13)

    def forward(self, tiles: Tensor) -> Tensor:
        value = tiles.reshape(-1, 1, 32, 32)
        value = F.max_pool2d(F.relu(self.conv1(value)), 2)
        value = F.max_pool2d(F.relu(self.conv2(value)), 2)
        value = F.max_pool2d(F.relu(self.conv3(value)), 2)
        value = F.relu(self.fc1(value.flatten(1)))
        return F.softmax(self.fc2(value), dim=1)


EXPECTED_PARAMETERS = {
    "net.conv1.weight": (32, 1, 3, 3),
    "net.conv1.bias": (32,),
    "net.conv2.weight": (64, 32, 3, 3),
    "net.conv2.bias": (64,),
    "net.conv3.weight": (64, 64, 3, 3),
    "net.conv3.bias": (64,),
    "net.fc1.weight": (256, 1024),
    "net.fc1.bias": (256,),
    "net.fc2.weight": (13, 256),
    "net.fc2.bias": (13,),
}
PARAMETER_MAP = {name: name.removeprefix("net.") for name in EXPECTED_PARAMETERS}
EXPECTED_OPS = [
    "Shape", "Reshape", "Conv", "Relu", "MaxPool", "Conv", "Relu", "MaxPool",
    "Conv", "Relu", "MaxPool", "Concat", "Reshape", "Gemm", "Relu", "Gemm", "Softmax",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def command_output(command: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def attributes(node: onnx.NodeProto) -> dict[str, Any]:
    return {attribute.name: helper.get_attribute_value(attribute) for attribute in node.attribute}


def validate_graph(model: onnx.ModelProto) -> dict[str, np.ndarray]:
    if [(item.domain, item.version) for item in model.opset_import] != [("", 17)]:
        raise ParityError("shipped model must use only ONNX opset 17")
    if [node.op_type for node in model.graph.node] != EXPECTED_OPS:
        raise ParityError("shipped graph operator sequence changed")
    if [item.name for item in model.graph.input] != ["tiles"] or [item.name for item in model.graph.output] != ["probs"]:
        raise ParityError("shipped graph interface changed")
    if any(item.data_location == onnx.TensorProto.EXTERNAL or item.external_data for item in model.graph.initializer):
        raise ParityError("external ONNX tensor data is not permitted")
    initializer = {item.name: numpy_helper.to_array(item) for item in model.graph.initializer}
    if set(initializer) != set(EXPECTED_PARAMETERS) | {"val_6", "val_32"}:
        raise ParityError("shipped graph initializer set changed")
    for name, shape in EXPECTED_PARAMETERS.items():
        value = initializer[name]
        if value.shape != shape or value.dtype != np.float32 or not np.isfinite(value).all():
            raise ParityError(f"incompatible initializer {name}")
    if initializer["val_6"].tolist() != [-1, 1, 32, 32] or initializer["val_32"].tolist() != [1024]:
        raise ParityError("shipped reshape constants changed")
    convs = [node for node in model.graph.node if node.op_type == "Conv"]
    pools = [node for node in model.graph.node if node.op_type == "MaxPool"]
    gemms = [node for node in model.graph.node if node.op_type == "Gemm"]
    if any(attributes(node) != {"auto_pad": b"NOTSET", "dilations": [1, 1], "group": 1, "pads": [1, 1, 1, 1], "strides": [1, 1]} for node in convs):
        raise ParityError("shipped convolution attributes changed")
    if any(attributes(node) != {"auto_pad": b"NOTSET", "ceil_mode": 0, "dilations": [1, 1], "kernel_shape": [2, 2], "pads": [0, 0, 0, 0], "storage_order": 0, "strides": [2, 2]} for node in pools):
        raise ParityError("shipped pooling attributes changed")
    if any(attributes(node) != {"alpha": 1.0, "beta": 1.0, "transA": 0, "transB": 1} for node in gemms):
        raise ParityError("shipped linear attributes changed")
    softmax = next(node for node in model.graph.node if node.op_type == "Softmax")
    if attributes(softmax) != {"axis": 1}:
        raise ParityError("shipped softmax attributes changed")
    onnx.checker.check_model(model)
    return initializer


def negative_checks(model: onnx.ModelProto) -> dict[str, bool]:
    missing = copy.deepcopy(model)
    del missing.graph.initializer[0]
    altered = copy.deepcopy(model)
    conv = next(node for node in altered.graph.node if node.op_type == "Conv")
    next(attribute for attribute in conv.attribute if attribute.name == "pads").ints[:] = [0, 0, 0, 0]
    results: dict[str, bool] = {}
    for name, candidate in (("missingInitializerRejected", missing), ("changedAttributeRejected", altered)):
        try:
            validate_graph(candidate)
        except ParityError:
            results[name] = True
        else:
            results[name] = False
    if not all(results.values()):
        raise ParityError("graph validation negative check failed")
    return results


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ParityError(f"{path.name} must contain an object")
    return value


def fixed_vectors(data_dir: Path) -> tuple[np.ndarray, list[dict[str, Any]], dict[str, str]]:
    manifest_path = data_dir / "dataset-manifest.json"
    manifest_hash = sha256_file(manifest_path)
    if manifest_hash != EXPECTED_DATASET_SHA256:
        raise ParityError("dataset manifest is not the reviewed canonical v2 manifest")
    manifest = read_json(manifest_path)
    selected: list[dict[str, Any]] = []
    vectors: list[np.ndarray] = []
    hashes: dict[str, str] = {"datasetManifest": manifest_hash}
    all_classes: set[int] = set()
    for split in ("train", "dev"):
        record = manifest["artifacts"][split]
        vector_path = data_dir / record["vectors"]["path"]
        label_path = data_dir / record["labels"]["path"]
        if sha256_file(vector_path) != record["vectors"]["sha256"] or sha256_file(label_path) != record["labels"]["sha256"]:
            raise ParityError(f"{split} artifacts differ from the v2 manifest")
        hashes[f"{split}Vectors"] = record["vectors"]["sha256"]
        hashes[f"{split}Labels"] = record["labels"]["sha256"]
        labels = read_json(label_path)
        boards = labels.get("boards")
        if not isinstance(boards, list):
            raise ParityError(f"{split} labels have no boards")
        shape = tuple(record["vectors"]["shape"])
        mapped = np.memmap(vector_path, dtype="<f4", mode="r", shape=shape)
        families = set(manifest["splits"][split]["families"])
        for family in sorted(families):
            for style in ("flat", "hatch", "halftone"):
                matches = [(index, board) for index, board in enumerate(boards) if board.get("family") == family and board.get("render", {}).get("style") == style]
                if not matches:
                    raise ParityError(f"no {split} {family}/{style} parity vector")
                index, board = matches[0]
                value = np.asarray(mapped[index], dtype=np.float32).copy()
                if value.shape != (64, 1024) or not np.isfinite(value).all():
                    raise ParityError("selected vectors are invalid")
                vectors.append(value)
                board_classes = set(board.get("labels", []))
                all_classes.update(board_classes)
                selected.append({
                    "split": split, "index": index, "family": family, "style": style,
                    "vectorSha256": sha256_bytes(value.astype("<f4", copy=False).tobytes()),
                    "classes": sorted(board_classes),
                })
    if all_classes != set(range(13)):
        raise ParityError("fixed parity vectors do not span all 13 classes")
    stacked = np.concatenate(vectors, axis=0)
    hashes["fixedVectors"] = sha256_bytes(stacked.astype("<f4", copy=False).tobytes())
    return stacked, selected, hashes


def reconstruct(initializer: dict[str, np.ndarray]) -> FusedTileNet:
    model = FusedTileNet()
    state = model.state_dict()
    if set(state) != set(PARAMETER_MAP.values()):
        raise ParityError("reconstruction parameter set changed")
    with torch.no_grad():
        for source, target in PARAMETER_MAP.items():
            tensor = torch.from_numpy(np.array(initializer[source], copy=True))
            if tensor.shape != state[target].shape:
                raise ParityError(f"parameter mapping shape mismatch for {source}")
            state[target].copy_(tensor)
    model.load_state_dict(state, strict=True)
    return model


def run(model_path: Path, data_dir: Path) -> dict[str, Any]:
    started = time.perf_counter()
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    model_hash = sha256_file(model_path)
    if model_hash != EXPECTED_SHIPPED_SHA256:
        raise ParityError("model is not the reviewed shipped FENShot artifact")
    shipped = onnx.load(model_path, load_external_data=False)
    initializer = validate_graph(shipped)
    negatives = negative_checks(shipped)
    inputs, selection, input_hashes = fixed_vectors(data_dir)
    reconstructed = reconstruct(initializer)
    tensor = torch.from_numpy(inputs)
    reconstructed.eval()
    with torch.inference_mode():
        eval_output = reconstructed(tensor).numpy()
    reconstructed.train()
    with torch.inference_mode():
        train_output = reconstructed(tensor).numpy()
    if not np.array_equal(eval_output, train_output):
        raise ParityError("train/eval outputs differ despite the no-stochastic-layer graph")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    shipped_output = session.run(["probs"], {"tiles": inputs})[0]
    expected_shape = (len(inputs), 13)
    if shipped_output.shape != expected_shape or eval_output.shape != expected_shape:
        raise ParityError("shipped or reconstructed output shape changed")
    if not np.isfinite(shipped_output).all() or not np.isfinite(eval_output).all():
        raise ParityError("shipped or reconstructed output contains nonfinite values")
    difference = np.abs(shipped_output.astype(np.float64) - eval_output.astype(np.float64))
    argmax_equal = np.array_equal(np.argmax(shipped_output, axis=1), np.argmax(eval_output, axis=1))
    close = np.allclose(shipped_output, eval_output, atol=ATOL, rtol=RTOL)
    if not close or not argmax_equal:
        raise ParityError("reconstruction does not meet the frozen numeric and argmax parity rule")
    return {
        "schemaVersion": 1,
        "status": "passed",
        "kind": "shipped-fenshot-pre-update-reconstruction-parity",
        "scope": {
            "optimizationSteps": 0, "weightsWritten": False, "heldOutTestLoaded": False,
            "corpusV1Loaded": False, "productionChanged": False,
            "coverageLimitation": "Existing v2 train/dev families and render styles only; no new pristine styles were acquired.",
        },
        "command": "timeout 120s experiments/recognition-training/.venv/bin/python experiments/recognition-training/planning/reconstruct_parity.py",
        "commit": command_output(("git", "rev-parse", "HEAD")),
        "environment": {
            "python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine(),
            "torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": ort.__version__,
            "provider": "CPUExecutionProvider", "intraOpThreads": 1, "interOpThreads": 1,
        },
        "model": {
            "pathRole": "@scoriiu/fenshot@0.1.4 shipped chess-tiles-v2.onnx",
            "sha256": model_hash, "bytes": model_path.stat().st_size,
            "opset": 17, "classOrder": CLASS_ORDER, "trainableParameters": 321485,
            "mapping": PARAMETER_MAP, "batchNormalization": "absent/fused", "dropout": "absent",
        },
        "inputs": {"hashes": input_hashes, "selectedBoards": selection, "boards": len(selection), "tiles": len(inputs)},
        "parity": {
            "atol": ATOL, "rtol": RTOL, "identicalArgmax": argmax_equal,
            "allClose": close, "maxAbsoluteDifference": float(difference.max()),
            "meanAbsoluteDifference": float(difference.mean()), "trainEvalByteIdentical": True,
        },
        "validation": {"allTenFloatingPointParametersMapped": True, **negatives},
        "elapsedSeconds": time.perf_counter() - started,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    try:
        result = run(arguments.model.resolve(), arguments.data_dir.resolve())
        exit_code = 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        result = {"schemaVersion": 1, "status": "failed", "error": str(error)}
        exit_code = 1
    result["scriptSha256"] = sha256_file(Path(__file__))
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
