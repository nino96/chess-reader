"""Recover the pinned FENShot ONNX weights into a hash-bound Torch state.

This is a CPU-only preparation step.  It does not train, alter the frozen
trainer, or expose qualification data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np
import torch
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
V3 = ROOT.parent / "recognition-training" / "v3"
PLANNING = V3.parent / "planning"
if str(V3) not in sys.path:
    sys.path.insert(0, str(V3))
from trainer import CLASS_ORDER, EXPECTED_PARAMETERS, LogitTileNet, initialize_shipped  # noqa: E402

torch.set_num_threads(4)
STATE_NAME = "fenshot-recovered.pt"
REPORT_NAME = "fenshot-recovered.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"invalid JSON object: {path.name}")
    return value


def _dev(data_dir: Path) -> tuple[np.ndarray, str, str]:
    npz = data_dir / "dev.npz"
    metadata = data_dir / "dev.metadata.json"
    if npz.is_symlink() or metadata.is_symlink() or not npz.is_file() or not metadata.is_file():
        raise ValueError("dev artifacts are missing or symlinked")
    with np.load(npz, allow_pickle=False) as archive:
        if set(archive.files) != {"tiles", "labels"}:
            raise ValueError("dev NPZ schema differs")
        tiles = np.asarray(archive["tiles"])
    if tiles.dtype != np.float32 or tiles.ndim != 3 or tiles.shape[1:] != (64, 1024):
        raise ValueError("dev tensor shape differs")
    return tiles, sha256(npz), sha256(metadata)


def _ort_probs(shipped: Path, tiles: np.ndarray) -> np.ndarray:
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 4
    session = ort.InferenceSession(str(shipped), sess_options=options, providers=["CPUExecutionProvider"])
    values = tiles.reshape(-1, 1024)
    chunks = [np.asarray(session.run(["probs"], {"tiles": values[i:i + 512]})[0]) for i in range(0, len(values), 512)]
    output = np.concatenate(chunks).reshape(len(tiles), 64, len(CLASS_ORDER))
    if not np.isfinite(output).all() or np.any(output < 0) or not np.allclose(output.sum(axis=2), 1, atol=1e-5, rtol=1e-5):
        raise ValueError("shipped ONNX output is not normalized")
    return output


def _torch_probs(model: LogitTileNet, tiles: np.ndarray) -> np.ndarray:
    values = tiles.reshape(-1, 1024)
    chunks: list[np.ndarray] = []
    model.eval()
    with torch.inference_mode():
        for i in range(0, len(values), 512):
            chunks.append(torch.softmax(model(torch.from_numpy(values[i:i + 512])), dim=1).numpy())
    return np.concatenate(chunks).reshape(len(tiles), 64, len(CLASS_ORDER))


def _report(base: Path) -> dict[str, Any]:
    return _json(base / REPORT_NAME)


def _verify_report(report: dict[str, Any], base: Path, shipped: Path, data_dir: Path) -> None:
    state = base / STATE_NAME
    if report.get("schema") != 1 or report.get("stateSha256") != sha256(state):
        raise ValueError("recovered state hash differs")
    expected = {
        "shippedSha256": sha256(shipped),
        "trainerSha256": sha256(V3 / "trainer.py"),
        "reconstructSha256": sha256(PLANNING / "reconstruct_parity.py"),
    }
    if any(report.get(key) != value for key, value in expected.items()):
        raise ValueError("recovery code or shipped model differs")
    tiles, tiles_hash, metadata_hash = _dev(data_dir)
    if report.get("devTilesSha256") != tiles_hash or report.get("devMetadataSha256") != metadata_hash:
        raise ValueError("dev inputs differ from recovery report")
    model = load_recovered(base, shipped, verify=False)
    reference = _ort_probs(shipped, tiles)
    actual = _torch_probs(model, tiles)
    if not np.array_equal(reference.argmax(axis=2), actual.argmax(axis=2)) or not np.allclose(reference, actual, atol=1e-5, rtol=1e-5):
        raise ValueError("recovered Torch/ONNX parity failed")


def load_recovered(base: Path, shipped: Path, *, verify: bool = True) -> LogitTileNet:
    report = _report(base)
    state_path = base / STATE_NAME
    if report.get("stateSha256") != sha256(state_path):
        raise ValueError("recovered state hash differs")
    if verify:
        expected={'shippedSha256':sha256(shipped),'trainerSha256':sha256(V3/'trainer.py'),'reconstructSha256':sha256(PLANNING/'reconstruct_parity.py')}
        if any(report.get(key)!=value for key,value in expected.items()) or report.get('parity',{}).get('identicalArgmax') is not True:
            raise ValueError('recovered base identity or recorded parity differs')
    payload = torch.load(state_path, map_location="cpu", weights_only=True)
    if not isinstance(payload, dict) or payload.get("schema") != 1 or not isinstance(payload.get("state"), dict):
        raise ValueError("recovered state schema is invalid")
    model = LogitTileNet()
    model.load_state_dict(payload["state"], strict=True)
    if sum(value.numel() for value in model.parameters()) != EXPECTED_PARAMETERS:
        raise ValueError("recovered parameter count differs")
    return model


def prepare(base: Path, shipped: Path, data_dir: Path) -> dict[str, Any]:
    base.mkdir(parents=True, exist_ok=True)
    state_path = base / STATE_NAME
    report_path = base / REPORT_NAME
    if state_path.exists() or report_path.exists():
        if not state_path.is_file() or not report_path.is_file():
            raise ValueError("recovery artifacts are incomplete")
        _verify_report(_report(base), base, shipped, data_dir)
        return _report(base)
    tiles, tiles_hash, metadata_hash = _dev(data_dir)
    model = initialize_shipped(shipped).cpu().eval()
    reference = _ort_probs(shipped, tiles)
    actual = _torch_probs(model, tiles)
    if not np.array_equal(reference.argmax(axis=2), actual.argmax(axis=2)) or not np.allclose(reference, actual, atol=1e-5, rtol=1e-5):
        raise ValueError("recovered Torch/ONNX parity failed")
    temporary = state_path.with_suffix(".tmp")
    torch.save({"schema": 1, "state": model.state_dict()}, temporary)
    os.link(temporary, state_path)
    temporary.unlink()
    report = {
        "schema": 1, "stateSha256": sha256(state_path), "shippedSha256": sha256(shipped),
        "devTilesSha256": tiles_hash, "devMetadataSha256": metadata_hash,
        "trainerSha256": sha256(V3 / "trainer.py"), "reconstructSha256": sha256(PLANNING / "reconstruct_parity.py"),
        "classOrder": CLASS_ORDER, "parameterCount": EXPECTED_PARAMETERS,
        "graph": {"input": "tiles", "output": "probs", "opset": 17},
        "torchVersion": torch.__version__, "parity": {"identicalArgmax": True, "atol": 1e-5, "rtol": 1e-5},
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _verify_report(report, base, shipped, data_dir)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, default=ROOT / "work/modern/base")
    parser.add_argument("--shipped", type=Path, default=REPO / "packages/test-fixtures/node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx")
    parser.add_argument("--data", type=Path, default=ROOT / "work/modern/dataset")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    print(json.dumps((_verify_report(_report(args.base), args.base, args.shipped, args.data) or _report(args.base)) if args.verify else prepare(args.base, args.shipped, args.data), sort_keys=True))
