"""CUDA-first, bounded reproduction trainer for the frozen TileNet recipe."""

from __future__ import annotations

import argparse
from io import BytesIO
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import re
import subprocess
import sys
import time
from typing import Any, Literal, Sequence

# cuBLAS consults this before the first CUDA operation. This setting, TF32
# disablement below, and deterministic kernels make restart comparison useful.
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")

import numpy as np
import onnx
from onnx import external_data_helper
import onnxruntime as ort
import torch
from torch import Tensor
from torch.nn import functional as F

from dataset import Dataset, DatasetError, load_split, sha256_file, subset_first
from tilenet_model import CLASS_ORDER, ExportNet, INPUT_NAME, INPUT_WIDTH, OUTPUT_NAME, TileNet, parameter_count


class TrainingError(RuntimeError):
    """A bounded run cannot safely continue."""


THREADS_CONFIGURED = False


@dataclass(frozen=True)
class Recipe:
    mode: Literal["pilot", "full"]
    seed: int
    train_boards: int
    dev_boards: int
    epochs: int
    batch_size: int
    learning_rate: float
    weight_decay: float
    label_smoothing: float
    wall_seconds: int
    onnx_atol: float
    onnx_rtol: float


@dataclass
class TrainResult:
    model: TileNet
    checkpoint: dict[str, Any]
    losses: list[dict[str, float]]
    elapsed_seconds: float
    resumed: bool


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_protocol(path: Path) -> tuple[dict[str, Any], str]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise TrainingError("unable to read the predeclared protocol") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise TrainingError("unsupported protocol schema")
    if value.get("architecture") != "TileNet-321805-unchanged" or value.get("classes") != CLASS_ORDER:
        raise TrainingError("protocol does not describe the frozen TileNet contract")
    return value, _sha256_bytes(raw)


def recipe_from_protocol(protocol: dict[str, Any], mode: Literal["pilot", "full"], seed: int) -> Recipe:
    if mode == "pilot":
        pilot = protocol.get("pilot")
        full = protocol.get("full")
        if not isinstance(pilot, dict) or not isinstance(full, dict) or seed != pilot.get("seed"):
            raise TrainingError("pilot seed or recipe differs from the predeclared protocol")
        return Recipe(
            mode,
            seed,
            _int(pilot, "trainBoards"),
            _int(pilot, "devBoards"),
            _int(pilot, "epochs"),
            _int(full, "batchSize"),
            _float(full, "learningRate"),
            _float(full, "weightDecay"),
            _float(full, "labelSmoothing"),
            _int(pilot, "wallSeconds"),
            _float(_object(protocol, "onnx"), "atol"),
            _float(_object(protocol, "onnx"), "rtol"),
        )
    full = protocol.get("full")
    if not isinstance(full, dict) or seed not in full.get("seeds", []):
        raise TrainingError("full seed or recipe differs from the predeclared protocol")
    return Recipe(
        mode,
        seed,
        _int(full, "trainBoards"),
        _int(full, "devBoards"),
        _int(full, "epochs"),
        _int(full, "batchSize"),
        _float(full, "learningRate"),
        _float(full, "weightDecay"),
        _float(full, "labelSmoothing"),
        _int(full, "wallSecondsPerSeed"),
        _float(_object(protocol, "onnx"), "atol"),
        _float(_object(protocol, "onnx"), "rtol"),
    )


def _object(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TrainingError(f"{name} must be an object")
    child = value.get(name)
    if not isinstance(child, dict):
        raise TrainingError(f"{name} must be an object")
    return child


def _int(value: dict[str, Any], name: str) -> int:
    item = value.get(name)
    if not isinstance(item, int) or isinstance(item, bool) or item <= 0:
        raise TrainingError(f"protocol {name} must be a positive integer")
    return item


def _float(value: dict[str, Any], name: str) -> float:
    item = value.get(name)
    if not isinstance(item, (int, float)) or isinstance(item, bool) or not np.isfinite(item) or item <= 0:
        raise TrainingError(f"protocol {name} must be a positive number")
    return float(item)


def _run_optional(command: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    output = result.stdout.strip()
    return output if result.returncode == 0 and output else None


def _commit() -> str | None:
    return _run_optional(("git", "rev-parse", "HEAD"))


def _environment(device: torch.device) -> dict[str, Any]:
    nvidia_smi = _run_optional(("nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"))
    nvidia_banner = _run_optional(("nvidia-smi",))
    cuda_match = re.search(r"CUDA Version:\s*([^\s|]+)", nvidia_banner or "")
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "torch": torch.__version__,
        "torchCuda": torch.version.cuda,
        "onnx": onnx.__version__,
        "onnxruntime": ort.__version__,
        "device": str(device),
        "cudaAvailable": torch.cuda.is_available(),
        "cudaDevice": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
        "nvidiaSmi": {"command": ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"], "result": nvidia_smi, "hostCuda": cuda_match.group(1) if cuda_match else None},
    }


def require_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise TrainingError("CUDA was requested, but PyTorch cannot access a CUDA device")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    raise TrainingError("device must be exactly cuda or cpu")


def configure_determinism(seed: int) -> None:
    global THREADS_CONFIGURED
    torch.set_num_threads(4)
    if not THREADS_CONFIGURED:
        torch.set_num_interop_threads(1)
        THREADS_CONFIGURED = True
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.set_float32_matmul_precision("highest")


def _rng_state() -> dict[str, Any]:
    numpy_state = np.random.get_state()
    return {
        "python": random.getstate(),
        "numpy": {
            "bitGenerator": numpy_state[0],
            "state": torch.from_numpy(numpy_state[1].copy()),
            "position": int(numpy_state[2]),
            "hasGaussian": int(numpy_state[3]),
            "cachedGaussian": float(numpy_state[4]),
        },
        "torch": torch.get_rng_state(),
        "cuda": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None,
    }


def _restore_rng(state: dict[str, Any]) -> None:
    random.setstate(state["python"])
    numpy_state = state["numpy"]
    np.random.set_state(
        (
            numpy_state["bitGenerator"],
            numpy_state["state"].cpu().numpy(),
            int(numpy_state["position"]),
            int(numpy_state["hasGaussian"]),
            float(numpy_state["cachedGaussian"]),
        )
    )
    torch.set_rng_state(state["torch"])
    if state.get("cuda") is not None and torch.cuda.is_available():
        torch.cuda.set_rng_state_all([value.to("cuda") for value in state["cuda"]])


def _atomic_save(value: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(value, temporary)
    os.replace(temporary, path)
    hash_temporary = path.with_suffix(path.suffix + ".sha256.tmp")
    hash_temporary.write_text(sha256_file(path) + "\n", encoding="ascii")
    os.replace(hash_temporary, path.with_suffix(path.suffix + ".sha256"))


def _load_checkpoint(path: Path, _device: torch.device) -> dict[str, Any]:
    hash_path = path.with_suffix(path.suffix + ".sha256")
    try:
        expected_hash = hash_path.read_text(encoding="ascii").strip()
    except OSError as error:
        raise TrainingError("checkpoint integrity record is unavailable") from error
    if len(expected_hash) != 64 or expected_hash != sha256_file(path):
        raise TrainingError("checkpoint integrity record does not match the local checkpoint")
    try:
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise TrainingError("checkpoint cannot be recovered") from error
    if not isinstance(checkpoint, dict) or checkpoint.get("schemaVersion") != 1:
        raise TrainingError("checkpoint schema is invalid")
    return checkpoint


def _flatten(dataset: Dataset) -> tuple[np.ndarray, np.ndarray]:
    return dataset.vectors.reshape(-1, INPUT_WIDTH), dataset.labels.reshape(-1)


def _evaluate_loss(model: TileNet, vectors: np.ndarray, labels: np.ndarray, device: torch.device, batch_size: int) -> float:
    model.eval()
    weighted_loss = 0.0
    with torch.no_grad():
        for offset in range(0, len(labels), batch_size):
            xb = torch.from_numpy(vectors[offset : offset + batch_size]).to(device=device, dtype=torch.float32)
            yb = torch.from_numpy(labels[offset : offset + batch_size]).to(device=device)
            weighted_loss += float(F.cross_entropy(model(xb), yb, reduction="sum").item())
    return weighted_loss / len(labels)


def augment(inputs: Tensor, generator: torch.Generator) -> Tensor:
    """The upstream fixed gain/bias/noise photometric augmentation."""

    count = inputs.shape[0]
    gain = 1.0 + (torch.rand(count, 1, device=inputs.device, generator=generator) - 0.5) * 0.3
    bias = (torch.rand(count, 1, device=inputs.device, generator=generator) - 0.5) * 0.12
    noise = torch.randn(inputs.shape, device=inputs.device, generator=generator) * 0.015
    return (inputs * gain + bias + noise).clamp(0, 1)


def train(
    recipe: Recipe,
    train_set: Dataset,
    dev_set: Dataset,
    device: torch.device,
    checkpoint_path: Path,
    resume: bool,
    stop_after_epoch: int | None = None,
    deadline: float | None = None,
) -> TrainResult:
    if train_set.board_count != recipe.train_boards or dev_set.board_count != recipe.dev_boards:
        raise TrainingError("dataset board counts differ from the predeclared recipe")
    if stop_after_epoch is not None and not 1 <= stop_after_epoch < recipe.epochs:
        raise TrainingError("stop-after-epoch must be before the fixed final epoch")
    train_vectors, train_labels = _flatten(train_set)
    dev_vectors, dev_labels = _flatten(dev_set)
    model = TileNet().to(device)
    if parameter_count(model) != 321_805:
        raise TrainingError("TileNet parameter count differs from the frozen architecture")
    optimizer = torch.optim.AdamW(model.parameters(), lr=recipe.learning_rate, weight_decay=recipe.weight_decay)
    steps_per_epoch = (len(train_labels) + recipe.batch_size - 1) // recipe.batch_size
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=recipe.epochs * steps_per_epoch)
    augmentation_rng = torch.Generator(device=device)
    augmentation_rng.manual_seed(recipe.seed)
    start_epoch = 0
    best_loss = float("inf")
    best_epoch: int | None = None
    best_state: dict[str, Tensor] | None = None
    losses: list[dict[str, float]] = []
    elapsed_before = 0.0
    resumed = False
    if resume:
        checkpoint = _load_checkpoint(checkpoint_path, device)
        if checkpoint.get("recipe") != recipe.__dict__:
            raise TrainingError("checkpoint recipe differs from this fixed run")
        model.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        scheduler.load_state_dict(checkpoint["scheduler"])
        augmentation_rng.set_state(checkpoint["augmentationRng"])
        _restore_rng(checkpoint["rng"])
        start_epoch = int(checkpoint["epoch"])
        best_loss = float(checkpoint["bestLoss"])
        best_epoch = checkpoint["bestEpoch"]
        best_state = checkpoint["bestState"]
        losses = checkpoint["losses"]
        elapsed_before = float(checkpoint["elapsedSeconds"])
        resumed = True
    started = time.monotonic()
    for epoch in range(start_epoch, recipe.epochs):
        model.train()
        permutation = np.random.permutation(len(train_labels))
        total_loss = 0.0
        for offset in range(0, len(permutation), recipe.batch_size):
            if (deadline is not None and time.monotonic() > deadline) or elapsed_before + time.monotonic() - started > recipe.wall_seconds:
                raise TrainingError("predeclared training wall-time ceiling reached")
            indices = permutation[offset : offset + recipe.batch_size]
            xb = torch.from_numpy(train_vectors[indices]).to(device=device, dtype=torch.float32)
            yb = torch.from_numpy(train_labels[indices]).to(device=device)
            optimizer.zero_grad(set_to_none=True)
            loss = F.cross_entropy(model(augment(xb, augmentation_rng)), yb, label_smoothing=recipe.label_smoothing)
            loss.backward()
            optimizer.step()
            scheduler.step()
            total_loss += float(loss.item()) * len(indices)
        dev_loss = _evaluate_loss(model, dev_vectors, dev_labels, device, recipe.batch_size)
        losses.append({"epoch": float(epoch + 1), "trainMeanCrossEntropy": total_loss / len(train_labels), "devMeanCrossEntropy": dev_loss})
        if dev_loss < best_loss:
            best_loss = dev_loss
            best_epoch = epoch + 1
            best_state = {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}
        elapsed = elapsed_before + time.monotonic() - started
        checkpoint = {
            "schemaVersion": 1,
            "recipe": recipe.__dict__,
            "epoch": epoch + 1,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "augmentationRng": augmentation_rng.get_state(),
            "rng": _rng_state(),
            "bestLoss": best_loss,
            "bestEpoch": best_epoch,
            "bestState": best_state,
            "losses": losses,
            "elapsedSeconds": elapsed,
        }
        _atomic_save(checkpoint, checkpoint_path)
        if stop_after_epoch == epoch + 1:
            return TrainResult(model, checkpoint, losses, elapsed, resumed)
    final_checkpoint = _load_checkpoint(checkpoint_path, device)
    if best_state is None or best_epoch is None:
        raise TrainingError("no checkpoint was selected")
    model.load_state_dict(best_state)
    model.eval()
    final_checkpoint["selectedEpoch"] = best_epoch
    final_checkpoint["selectedDevLoss"] = best_loss
    final_checkpoint["lastModel"] = final_checkpoint["model"]
    final_checkpoint["model"] = model.state_dict()
    _atomic_save(final_checkpoint, checkpoint_path)
    return TrainResult(model, final_checkpoint, losses, float(final_checkpoint["elapsedSeconds"]), resumed)


def export_and_validate(model: TileNet, train_set: Dataset, recipe: Recipe, output: Path, deadline: float | None = None) -> dict[str, Any]:
    if deadline is not None and time.monotonic() > deadline:
        raise TrainingError("predeclared training wall-time ceiling reached before export")
    output.parent.mkdir(parents=True, exist_ok=True)
    model = model.cpu().eval()
    export = ExportNet(model).eval()
    frozen_vectors = torch.from_numpy(train_set.vectors.reshape(-1, INPUT_WIDTH)[:64].copy()).float()
    with torch.no_grad():
        torch_values = export(frozen_vectors).numpy()
    torch.onnx.export(
        export,
        frozen_vectors,
        output,
        input_names=[INPUT_NAME],
        output_names=[OUTPUT_NAME],
        dynamic_axes={INPUT_NAME: {0: "n"}, OUTPUT_NAME: {0: "n"}},
        opset_version=17,
        external_data=False,
        dynamo=False,
    )
    model_proto = onnx.load_model(output, load_external_data=False)
    onnx.checker.check_model(model_proto)
    if len(model_proto.graph.input) != 1 or len(model_proto.graph.output) != 1:
        raise TrainingError("exported ONNX graph must have exactly one input and one output")
    if model_proto.graph.input[0].name != INPUT_NAME or model_proto.graph.output[0].name != OUTPUT_NAME:
        raise TrainingError("exported ONNX schema does not match the frozen names")
    input_shape = model_proto.graph.input[0].type.tensor_type.shape.dim
    output_shape = model_proto.graph.output[0].type.tensor_type.shape.dim
    if (
        model_proto.graph.input[0].type.tensor_type.elem_type != onnx.TensorProto.FLOAT
        or model_proto.graph.output[0].type.tensor_type.elem_type != onnx.TensorProto.FLOAT
        or len(input_shape) != 2
        or len(output_shape) != 2
        or input_shape[1].dim_value != INPUT_WIDTH
        or output_shape[1].dim_value != len(CLASS_ORDER)
        or not input_shape[0].dim_param
        or not output_shape[0].dim_param
    ):
        raise TrainingError("exported ONNX tensor types or dynamic shapes differ from the frozen contract")
    default_opset = next((entry.version for entry in model_proto.opset_import if entry.domain in ("", "ai.onnx")), None)
    if default_opset != 17:
        raise TrainingError("exported ONNX opset differs from the frozen contract")
    if any(external_data_helper.uses_external_data(tensor) for tensor in model_proto.graph.initializer):
        raise TrainingError("exported ONNX model contains an external-data sidecar")
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 1
    session_options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(output), sess_options=session_options, providers=["CPUExecutionProvider"])
    output_values = session.run([OUTPUT_NAME], {INPUT_NAME: frozen_vectors.numpy()})[0]
    if output_values.shape != (len(frozen_vectors), len(CLASS_ORDER)):
        raise TrainingError("ONNX runtime returned an incompatible output shape")
    maximum = float(np.max(np.abs(torch_values - output_values)))
    if not np.allclose(torch_values, output_values, atol=recipe.onnx_atol, rtol=recipe.onnx_rtol):
        raise TrainingError(f"PyTorch/ONNX numeric parity failed (max absolute difference {maximum:.8g})")
    if deadline is not None and time.monotonic() > deadline:
        raise TrainingError("predeclared training wall-time ceiling reached during export")
    return {
        "sha256": sha256_file(output),
        "bytes": output.stat().st_size,
        "operators": sorted({node.op_type for node in model_proto.graph.node}),
        "onnxParity": {"atol": recipe.onnx_atol, "rtol": recipe.onnx_rtol, "vectors": len(frozen_vectors), "vectorsSha256": hashlib.sha256(frozen_vectors.numpy().astype("<f4", copy=False).tobytes()).hexdigest(), "maximumAbsoluteError": maximum, "passed": True},
        "onnxChecker": "passed",
        "cpuOnnxRuntime": "passed",
        "externalData": False,
    }


def _same_state(left: dict[str, Tensor], right: dict[str, Tensor]) -> bool:
    return left.keys() == right.keys() and all(torch.equal(left[name].cpu(), right[name].cpu()) for name in left)


def _checkpoint_digest(value: Any) -> str:
    serialized = BytesIO()
    torch.save(value, serialized)
    return hashlib.sha256(serialized.getvalue()).hexdigest()


def verify_resume(
    recipe: Recipe, train_set: Dataset, dev_set: Dataset, device: torch.device, run_dir: Path, deadline: float
) -> tuple[TrainResult, dict[str, Any]]:
    reference_path = run_dir / "resume-reference.pt"
    recovered_path = run_dir / "checkpoint.pt"
    configure_determinism(recipe.seed)
    reference = train(recipe, train_set, dev_set, device, reference_path, resume=False, deadline=deadline)
    configure_determinism(recipe.seed)
    interrupted = train(recipe, train_set, dev_set, device, recovered_path, resume=False, stop_after_epoch=1, deadline=deadline)
    if interrupted.checkpoint["epoch"] != 1:
        raise TrainingError("pilot interruption did not persist the first epoch")
    recovered = train(recipe, train_set, dev_set, device, recovered_path, resume=True, deadline=deadline)
    comparisons = {
        "selectedModel": _same_state(reference.model.state_dict(), recovered.model.state_dict()),
        "lastModel": _same_state(reference.checkpoint["lastModel"], recovered.checkpoint["lastModel"]),
        "optimizer": _checkpoint_digest(reference.checkpoint["optimizer"]) == _checkpoint_digest(recovered.checkpoint["optimizer"]),
        "scheduler": _checkpoint_digest(reference.checkpoint["scheduler"]) == _checkpoint_digest(recovered.checkpoint["scheduler"]),
        "rng": _checkpoint_digest(reference.checkpoint["rng"]) == _checkpoint_digest(recovered.checkpoint["rng"]),
        "augmentationRng": torch.equal(reference.checkpoint["augmentationRng"], recovered.checkpoint["augmentationRng"]),
        "epoch": reference.checkpoint["epoch"] == recovered.checkpoint["epoch"],
        "losses": reference.losses == recovered.losses,
        "selectedEpoch": reference.checkpoint["selectedEpoch"] == recovered.checkpoint["selectedEpoch"],
        "selectedDevLoss": reference.checkpoint["selectedDevLoss"] == recovered.checkpoint["selectedDevLoss"],
    }
    if not all(comparisons.values()):
        raise TrainingError("interrupted and resumed training diverged from uninterrupted training")
    elapsed = recipe.wall_seconds - max(0.0, deadline - time.monotonic())
    recovered.elapsed_seconds = elapsed
    return recovered, {"performed": True, "checkpointEpoch": 1, "equivalent": True, "comparisons": comparisons, "aggregateElapsedSeconds": elapsed}


def _dataset_summary(dataset: Dataset) -> dict[str, Any]:
    return {
        "boards": dataset.board_count,
        "vectorSha256": dataset.vector_sha256,
        "labelsSha256": dataset.labels_sha256,
        "datasetManifestSha256": dataset.manifest_sha256,
        "generatorSha256": dataset.generator_sha256,
        "sourceLockSha256": dataset.source_lock_sha256,
        "familyCount": len(dataset.families),
    }


def _canonical_manifest_sha256(data_dir: Path) -> str:
    """Bind a run to the reviewed dataset manifest before split tensors load."""

    actual = data_dir / "dataset-manifest.json"
    canonical = Path(__file__).resolve().parent / "manifests" / "dataset-v1.json"
    try:
        actual_hash = sha256_file(actual)
        canonical_hash = sha256_file(canonical)
    except OSError as error:
        raise TrainingError("the generated or committed dataset manifest is unavailable") from error
    if actual_hash != canonical_hash:
        raise TrainingError("generated dataset manifest does not match the committed dataset-v1 manifest")
    return canonical_hash


def _implementation_hashes() -> dict[str, str]:
    root = Path(__file__).resolve().parent
    try:
        return {
            "trainer.py": sha256_file(root / "trainer.py"),
            "dataset.py": sha256_file(root / "dataset.py"),
            "tilenet_model.py": sha256_file(root / "tilenet_model.py"),
            "requirements.lock": sha256_file(root / "requirements.lock"),
        }
    except OSError as error:
        raise TrainingError("a required reviewed training implementation file is unavailable") from error


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _redacted_command(args: argparse.Namespace) -> list[str]:
    """Record the executable recipe without publishing local filesystem paths."""

    command = ["python", "trainer.py", "--protocol", "<protocol>", "--data-dir", "<data-dir>", "--run-dir", "<run-dir>", "--mode", args.mode, "--seed", str(args.seed), "--device", args.device]
    if args.resume:
        command.append("--resume")
    if args.verify_resume:
        command.append("--verify-resume")
    return command


def _pilot_report_allows_full(run_dir: Path, manifest_sha256: str) -> None:
    pilot_report = run_dir.parent / "pilot" / "run-report.json"
    try:
        report = json.loads(pilot_report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TrainingError("full runs require the completed predeclared pilot report") from error
    if not isinstance(report, dict) or report.get("status") != "completed":
        raise TrainingError("full runs require a successful predeclared pilot")
    recovery = report.get("recovery")
    model = report.get("model")
    data = report.get("data")
    if not isinstance(recovery, dict) or recovery.get("equivalent") is not True:
        raise TrainingError("full runs require successful interrupted/resumed recovery evidence")
    if not isinstance(model, dict) or model.get("onnxParity", {}).get("passed") is not True or model.get("cpuOnnxRuntime") != "passed":
        raise TrainingError("full runs require successful pilot export parity and CPU ONNX evidence")
    if not isinstance(data, dict) or not isinstance(data.get("train"), dict) or data["train"].get("datasetManifestSha256") != manifest_sha256:
        raise TrainingError("pilot and full run must use the same frozen dataset manifest")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=("pilot", "full"), required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--verify-resume", action="store_true")
    args = parser.parse_args(argv)
    report_path = args.run_dir / "run-report.json"
    if report_path.exists() and not args.resume:
        # A completed or failed attempt is evidence. A distinct attempt needs
        # its own explicit run directory.
        return 2
    if report_path.exists() and args.resume:
        try:
            prior = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return 2
        if not isinstance(prior, dict) or prior.get("status") == "completed":
            return 2
        attempt = report_path.with_name("run-report.attempt-1.json")
        if attempt.exists():
            return 2
        os.replace(report_path, attempt)
    attempt_started = time.monotonic()
    run_started: float | None = None
    base_report: dict[str, Any] = {"schemaVersion": 1, "status": "failed", "command": _redacted_command(args), "commit": _commit()}
    try:
        if platform.python_version() != "3.12.3":
            raise TrainingError("real training runs require Python 3.12.3")
        if args.device != "cuda":
            raise TrainingError("real training runs require --device cuda")
        protocol, protocol_hash = _load_protocol(args.protocol)
        recipe = recipe_from_protocol(protocol, args.mode, args.seed)
        if args.verify_resume != (args.mode == "pilot"):
            raise TrainingError("the predeclared pilot must verify recovery; full runs must not add a second training path")
        device = require_device(args.device)
        configure_determinism(recipe.seed)
        manifest_sha256 = _canonical_manifest_sha256(args.data_dir)
        if recipe.mode == "full":
            _pilot_report_allows_full(args.run_dir, manifest_sha256)
        train_set = load_split(args.data_dir, "train")
        dev_set = load_split(args.data_dir, "dev")
        if train_set.families & dev_set.families:
            raise TrainingError("train and development style families must be disjoint")
        if recipe.mode == "pilot":
            train_set = subset_first(train_set, recipe.train_boards)
            dev_set = subset_first(dev_set, recipe.dev_boards)
        base_report.update(
            {
                "protocolSha256": protocol_hash,
                "implementationSha256": _implementation_hashes(),
                "run": {"mode": recipe.mode, "seed": recipe.seed, "wallSeconds": recipe.wall_seconds, "epochs": recipe.epochs, "batchSize": recipe.batch_size},
                "environment": _environment(device),
                "data": {"train": _dataset_summary(train_set), "dev": _dataset_summary(dev_set)},
            }
        )
        if args.verify_resume:
            run_started = time.monotonic()
            deadline = run_started + recipe.wall_seconds
            result, recovery = verify_resume(recipe, train_set, dev_set, device, args.run_dir, deadline)
        else:
            run_started = time.monotonic()
            deadline = run_started + recipe.wall_seconds
            result = train(recipe, train_set, dev_set, device, args.run_dir / "checkpoint.pt", args.resume, deadline=deadline)
            recovery = {"performed": False}
        model_path = args.run_dir / "candidate.onnx"
        model_info = export_and_validate(result.model, train_set, recipe, model_path, deadline=deadline)
        measured_elapsed = time.monotonic() - run_started
        if measured_elapsed > recipe.wall_seconds:
            raise TrainingError("predeclared training wall-time ceiling reached")
        checkpoint_path = args.run_dir / "checkpoint.pt"
        base_report.update(
            {
                "status": "completed",
                "checkpoint": {"sha256": sha256_file(checkpoint_path), "selectedEpoch": result.checkpoint["selectedEpoch"], "selectedDevLoss": result.checkpoint["selectedDevLoss"]},
                "model": {"modelPath": model_path.name, **model_info},
                "candidate": {"id": f"tilenet-{recipe.mode}-{recipe.seed}", "seed": recipe.seed, "modelPath": model_path.name, "sha256": model_info["sha256"], "bytes": model_info["bytes"]},
                "losses": result.losses,
                "recovery": recovery,
                "elapsedSeconds": measured_elapsed,
                "measuredTrainingTiles": recipe.train_boards * 64 * recipe.epochs * (2 if recipe.mode == "pilot" else 1),
                "measuredTrainingTilesPerSecond": (recipe.train_boards * 64 * recipe.epochs * (2 if recipe.mode == "pilot" else 1)) / measured_elapsed if measured_elapsed else None,
            }
        )
    except (DatasetError, TrainingError, OSError, RuntimeError) as error:
        base_report["error"] = str(error)
        if run_started is not None:
            base_report["elapsedSeconds"] = time.monotonic() - run_started
    base_report["attemptWallSeconds"] = time.monotonic() - attempt_started
    _write_report(report_path, base_report)
    return 0 if base_report["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
