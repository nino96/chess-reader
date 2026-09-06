"""Bounded FENShot fused-weight fine-tuner for issue #40.

Training reads only hash-locked train/development tensors. Qualification data
is intentionally absent from every code path in this module.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
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
from typing import Any, Sequence

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")

import numpy as np
import onnx
from onnx import external_data_helper
import onnxruntime as ort
import torch
from torch import Tensor, nn
from torch.nn import functional as F

EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
PLANNING_ROOT = EXPERIMENT_ROOT / "planning"
if str(EXPERIMENT_ROOT) not in sys.path:
    sys.path.insert(0, str(EXPERIMENT_ROOT))
if str(PLANNING_ROOT) not in sys.path:
    sys.path.insert(0, str(PLANNING_ROOT))

from dataset import Dataset, DatasetError, load_split, sha256_file, subset_first
from reconstruct_parity import EXPECTED_SHIPPED_SHA256, PARAMETER_MAP, validate_graph
from diagnostic import CLASS_COUNT, CLASS_ORDER, evaluate_probabilities, infer_onnx, load_board_metadata

INPUT_NAME = "tiles"
OUTPUT_NAME = "probs"
INPUT_WIDTH = 1024
EXPECTED_PARAMETERS = 321_485
THREADS_CONFIGURED = False


class TrainingError(RuntimeError):
    """A run cannot safely proceed under the frozen protocol."""


class LogitTileNet(nn.Module):
    """The shipped fused/no-BN graph with logits exposed for stable CE."""

    def __init__(self) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(1, 32, 3, padding=1)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        self.conv3 = nn.Conv2d(64, 64, 3, padding=1)
        self.fc1 = nn.Linear(64 * 4 * 4, 256)
        self.fc2 = nn.Linear(256, CLASS_COUNT)

    def forward(self, tiles: Tensor) -> Tensor:
        value = tiles.reshape(-1, 1, 32, 32)
        value = F.max_pool2d(F.relu(self.conv1(value)), 2)
        value = F.max_pool2d(F.relu(self.conv2(value)), 2)
        value = F.max_pool2d(F.relu(self.conv3(value)), 2)
        value = F.relu(self.fc1(value.flatten(1)))
        return self.fc2(value)


class ExportNet(nn.Module):
    def __init__(self, model: LogitTileNet) -> None:
        super().__init__()
        self.model = model

    def forward(self, tiles: Tensor) -> Tensor:
        return F.softmax(self.model(tiles), dim=1)


@dataclass(frozen=True)
class Recipe:
    name: str
    seed: int
    train_boards: int
    dev_boards: int
    epochs: int
    max_seconds: float
    batch_size: int
    learning_rate: float
    minimum_learning_rate: float
    weight_decay: float
    confidence_floor: float
    histogram_edges: tuple[float, ...]
    onnx_atol: float
    onnx_rtol: float


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TrainingError(f"{description} is unavailable or invalid") from error
    if not isinstance(value, dict):
        raise TrainingError(f"{description} must contain an object")
    return value


def _number(value: dict[str, Any], name: str, *, integer: bool = False, allow_zero: bool = False) -> float | int:
    item = value.get(name)
    valid = isinstance(item, int) if integer else isinstance(item, (int, float))
    if not valid or isinstance(item, bool) or not np.isfinite(item) or item < 0 or (not allow_zero and item == 0):
        raise TrainingError(f"protocol {name} is invalid")
    return int(item) if integer else float(item)


def load_protocol(path: Path, run_name: str) -> tuple[dict[str, Any], Recipe, str]:
    raw = path.read_bytes()
    protocol = _read_object(path, "protocol")
    if protocol.get("schemaVersion") != 1 or protocol.get("issue") != 40:
        raise TrainingError("protocol schema or issue differs from issue #40")
    if protocol.get("architecture") != "FENShot-fused-TileNet-no-BN" or protocol.get("classes") != CLASS_ORDER or protocol.get("dtype") != "float32":
        raise TrainingError("protocol model contract differs from the reconstructed shipped graph")
    training = protocol.get("training")
    runs = protocol.get("runs")
    diagnostic = protocol.get("diagnostic")
    export = protocol.get("export")
    if not all(isinstance(item, dict) for item in (training, runs, diagnostic, export)) or run_name not in runs:
        raise TrainingError("protocol training/run/diagnostic/export objects are incomplete")
    if training.get("scheduler") != "cosine" or training.get("sampling") != "equal-family-condition-board" or _number(training, "labelSmoothing", allow_zero=True) != 0:
        raise TrainingError("protocol changes the frozen scheduler, sampler, or smoothing rule")
    if training.get("checkpointEveryBatches") != 32:
        raise TrainingError("protocol checkpoint cadence must be 32 minibatches")
    expected_runs = {
        "pilot": (3820, 256, 1, 60),
        "full-3821": (3821, 4096, 12, 600),
        "full-3822": (3822, 4096, 12, 600),
    }
    if set(runs) != set(expected_runs):
        raise TrainingError("protocol run set differs from the bounded comparison")
    for name, expected in expected_runs.items():
        run = runs[name]
        actual = (run.get("seed"), run.get("trainBoards"), run.get("epochs"), run.get("maxGpuSeconds"))
        if actual != expected or run.get("devBoards") != 384:
            raise TrainingError(f"protocol {name} recipe differs from issue #40")
    if protocol.get("aggregateMaxGpuSeconds") != 1260 or export.get("opset") != 17 or export.get("input") != INPUT_NAME or export.get("output") != OUTPUT_NAME or export.get("externalData") is not False:
        raise TrainingError("protocol aggregate budget or ONNX contract differs from issue #40")
    if (_number(training, "batchSize", integer=True), _number(training, "learningRate"), _number(training, "minimumLearningRate"), _number(training, "weightDecay")) != (512, 1e-4, 1e-6, 1e-4):
        raise TrainingError("protocol optimizer recipe differs from issue #40")
    run = runs[run_name]
    edges = diagnostic.get("histogramEdges")
    if not isinstance(edges, list) or len(edges) < 2:
        raise TrainingError("protocol confidence histogram is invalid")
    confidence_floor = float(_number(diagnostic, "confidenceFloor"))
    onnx_atol, onnx_rtol = float(_number(export, "atol")), float(_number(export, "rtol"))
    if confidence_floor != 0.7 or onnx_atol != 1e-5 or onnx_rtol != 1e-5:
        raise TrainingError("protocol confidence or export parity thresholds differ from issue #40")
    promotion = protocol.get("promotion")
    if not isinstance(promotion, dict) or promotion.get("minimumReliableExactBoardAccuracy") != 0.95 or promotion.get("minimumConfidentCorrectSquareAccuracy") != 0.995 or promotion.get("maximumReliableWrong") != 0 or promotion.get("lowConfidenceCountsAsFailure") is not True:
        raise TrainingError("protocol reliability gates differ from issue #40")
    recipe = Recipe(run_name, run["seed"], run["trainBoards"], 384, run["epochs"], float(run["maxGpuSeconds"]), 512, 1e-4, 1e-6, 1e-4, confidence_floor, tuple(map(float, edges)), onnx_atol, onnx_rtol)
    return protocol, recipe, _sha256_bytes(raw)


def resolve_paths(protocol_path: Path, protocol: dict[str, Any]) -> dict[str, Path]:
    raw = protocol.get("paths")
    required = ("datasetDir", "shippedModel", "dataQualityManifest", "pretrainingLock", "outputDir")
    if not isinstance(raw, dict) or any(not isinstance(raw.get(name), str) or not raw[name] for name in required):
        raise TrainingError("protocol paths are incomplete")
    base = protocol_path.parent
    return {name: (base / raw[name]).resolve() for name in required}


def verify_pretraining_lock(paths: dict[str, Path], protocol_hash: str) -> dict[str, str]:
    lock = _read_object(paths["pretrainingLock"], "pretraining lock")
    quality = _read_object(paths["dataQualityManifest"], "data-quality manifest")
    manifest = paths["datasetDir"] / "dataset-manifest.json"
    if lock.get("schemaVersion") != 1 or lock.get("status") != "passed" or quality.get("schemaVersion") != 1 or quality.get("status") != "passed":
        raise TrainingError("pretraining lock and data-quality evidence must be passing")
    dataset_manifest = _read_object(paths["datasetDir"] / "dataset-manifest.json", "dataset manifest")
    actual = {
        "protocolSha256": protocol_hash,
        "datasetManifestSha256": sha256_file(manifest),
        "dataQualitySha256": sha256_file(paths["dataQualityManifest"]),
        "shippedModelSha256": sha256_file(paths["shippedModel"]),
        "trainerSha256": sha256_file(Path(__file__)),
        "diagnosticSha256": sha256_file(Path(__file__).with_name("diagnostic.py")),
        "datasetLoaderSha256": sha256_file(EXPERIMENT_ROOT / "dataset.py"),
        "reconstructParitySha256": sha256_file(PLANNING_ROOT / "reconstruct_parity.py"),
        "requirementsLockSha256": sha256_file(EXPERIMENT_ROOT / "requirements.lock"),
    }
    locked_impl = lock.get("implementationSha256")
    for name, digest in actual.items():
        expected = locked_impl.get(name.removesuffix("Sha256")) if name.endswith("Sha256") and name not in ("protocolSha256", "datasetManifestSha256", "dataQualitySha256", "shippedModelSha256") and isinstance(locked_impl, dict) else lock.get(name)
        if expected != digest:
            raise TrainingError(f"pretraining lock does not bind {name}")
    generator_lock = dataset_manifest.get("generatorLock")
    source_lock_hash = generator_lock.get("sha256") if isinstance(generator_lock, dict) else None
    source_lock_relative = generator_lock.get("path") if isinstance(generator_lock, dict) else None
    quality_root = paths["dataQualityManifest"].resolve().parents[1]
    if not isinstance(source_lock_relative, str) or not source_lock_relative:
        raise TrainingError("dataset manifest has no source-lock path")
    source_lock_path = (quality_root / source_lock_relative).resolve()
    if quality_root not in source_lock_path.parents or not source_lock_path.is_file() or sha256_file(source_lock_path) != source_lock_hash:
        raise TrainingError("source-lock bytes differ from the dataset manifest")
    if quality.get("datasetManifestSha256") != actual["datasetManifestSha256"] or quality.get("protocolSha256") != protocol_hash or quality.get("sourceLockSha256") != source_lock_hash:
        raise TrainingError("data-quality evidence does not bind the protocol, dataset, and source lock")
    checks = quality.get("checks")
    if not isinstance(checks, dict) or not checks or any(value is not True for value in checks.values()):
        raise TrainingError("data-quality checks are incomplete or failed")
    review = quality.get("visualReview")
    artifacts = review.get("artifactSha256") if isinstance(review, dict) else None
    if not isinstance(review, dict) or review.get("status") != "passed" or not isinstance(review.get("reviewer"), str) or not review["reviewer"] or not isinstance(artifacts, dict) or not artifacts:
        raise TrainingError("reviewed visual evidence is incomplete")
    for relative, expected in artifacts.items():
        if not isinstance(relative, str) or not isinstance(expected, str) or len(expected) != 64:
            raise TrainingError("visual-review artifact identity is invalid")
        artifact = (quality_root / relative).resolve()
        if quality_root not in artifact.parents or not artifact.is_file() or sha256_file(artifact) != expected:
            raise TrainingError("visual-review artifact differs from reviewed evidence")
    if actual["shippedModelSha256"] != EXPECTED_SHIPPED_SHA256:
        raise TrainingError("shipped model hash differs from reconstruction-parity evidence")
    return actual


def configure_determinism(seed: int) -> None:
    global THREADS_CONFIGURED
    torch.set_num_threads(4)
    if not THREADS_CONFIGURED:
        torch.set_num_interop_threads(1)
        THREADS_CONFIGURED = True
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False


def initialize_shipped(model_path: Path) -> LogitTileNet:
    graph = onnx.load(model_path, load_external_data=False)
    initializer = validate_graph(graph)
    model = LogitTileNet()
    if sum(value.numel() for value in model.parameters()) != EXPECTED_PARAMETERS:
        raise TrainingError("fused model parameter count changed")
    state = model.state_dict()
    if set(state) != set(PARAMETER_MAP.values()):
        raise TrainingError("fused model parameter names changed")
    with torch.no_grad():
        for source, target in PARAMETER_MAP.items():
            state[target].copy_(torch.from_numpy(np.array(initializer[source], copy=True)))
    model.load_state_dict(state, strict=True)
    return model


def _atomic_torch(value: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(value, temporary)
    os.replace(temporary, path)
    temporary_hash = path.with_suffix(path.suffix + ".sha256.tmp")
    temporary_hash.write_text(sha256_file(path) + "\n", encoding="ascii")
    os.replace(temporary_hash, path.with_suffix(path.suffix + ".sha256"))


def _load_checkpoint(path: Path) -> dict[str, Any]:
    hash_path = path.with_suffix(path.suffix + ".sha256")
    if not hash_path.is_file() or hash_path.read_text(encoding="ascii").strip() != sha256_file(path):
        raise TrainingError("checkpoint integrity record does not match")
    value = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise TrainingError("checkpoint schema is invalid")
    return value


def _atomic_json(value: dict[str, Any], path: Path, *, immutable: bool = False) -> None:
    encoded = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    if path.exists():
        if immutable and path.read_bytes() != encoded:
            raise TrainingError(f"immutable artifact already exists: {path.name}")
        if immutable:
            return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encoded)
    os.replace(temporary, path)


def balanced_board_order(metadata: list[dict[str, Any]], board_count: int, rng: np.random.Generator) -> np.ndarray:
    groups: dict[tuple[str, str, str, str], list[int]] = {}
    for index, board in enumerate(metadata):
        key = (board["family"], board["style"], board["reduction"], board["speckles"])
        groups.setdefault(key, []).append(index)
    if not groups:
        raise TrainingError("no family/condition groups are available")
    keys = sorted(groups)
    selected: list[int] = []
    offsets = {key: 0 for key in keys}
    shuffled = {key: rng.permutation(groups[key]).tolist() for key in keys}
    while len(selected) < board_count:
        for key in rng.permutation(keys):
            tuple_key = tuple(key) if isinstance(key, np.ndarray) else key
            values = shuffled[tuple_key]
            offset = offsets[tuple_key]
            if offset == len(values):
                values = rng.permutation(groups[tuple_key]).tolist()
                shuffled[tuple_key] = values
                offset = 0
            selected.append(values[offset])
            offsets[tuple_key] = offset + 1
            if len(selected) == board_count:
                break
    return np.asarray(selected, dtype=np.int64)


def development_score(probabilities: np.ndarray, labels: np.ndarray, metadata: list[dict[str, Any]]) -> tuple[float, dict[str, float]]:
    true_probs = probabilities.reshape(-1, CLASS_COUNT)[np.arange(labels.size), labels.ravel()].reshape(labels.shape)
    losses = -np.log(np.clip(true_probs, 1e-30, 1))
    family_scores: dict[str, float] = {}
    for family in sorted({item["family"] for item in metadata}):
        boards = np.asarray([item["family"] == family for item in metadata])
        class_means = [float(losses[boards][labels[boards] == index].mean()) for index in range(CLASS_COUNT) if np.any(labels[boards] == index)]
        if len(class_means) != CLASS_COUNT:
            raise TrainingError(f"development family {family} does not contain all classes")
        family_scores[family] = float(np.mean(class_means))
    return float(np.mean(list(family_scores.values()))), family_scores


def infer_torch(model: LogitTileNet, vectors: np.ndarray, device: torch.device) -> np.ndarray:
    model.eval()
    flat = vectors.reshape(-1, INPUT_WIDTH)
    chunks = []
    with torch.inference_mode():
        for offset in range(0, len(flat), 512):
            logits = model(torch.from_numpy(flat[offset : offset + 512]).to(device=device, dtype=torch.float32))
            chunks.append(F.softmax(logits, dim=1).cpu().numpy())
    return np.concatenate(chunks).reshape(vectors.shape[0], 64, CLASS_COUNT)


def mean_available_class_cross_entropy(logits: Tensor, labels: Tensor) -> Tensor:
    """Average per-class mean CE over the classes present in this minibatch."""
    losses = F.cross_entropy(logits, labels, reduction="none")
    means = [losses[labels == class_index].mean() for class_index in range(CLASS_COUNT) if bool(torch.any(labels == class_index))]
    if not means:
        raise TrainingError("minibatch has no labels")
    return torch.stack(means).mean()


def train(recipe: Recipe, train_set: Dataset, dev_set: Dataset, train_meta: list[dict[str, Any]], dev_meta: list[dict[str, Any]], initial: LogitTileNet, device: torch.device, run_dir: Path, deadline: float, run_identity: dict[str, Any] | None = None, resume: bool = False, interrupt_after_batches: int | None = None) -> tuple[LogitTileNet, dict[str, Any]]:
    if train_set.board_count < recipe.train_boards or dev_set.board_count != recipe.dev_boards:
        raise TrainingError("dataset board counts differ from the protocol")
    if recipe.train_boards < train_set.board_count:
        train_set = subset_first(train_set, recipe.train_boards)
        train_meta = train_meta[:recipe.train_boards]
    model = initial.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=recipe.learning_rate, weight_decay=recipe.weight_decay)
    steps = (recipe.train_boards * 64 + recipe.batch_size - 1) // recipe.batch_size
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=recipe.epochs * steps, eta_min=recipe.minimum_learning_rate)
    checkpoint_path = run_dir / "checkpoint-last.pt"
    rng = np.random.default_rng(recipe.seed)
    epoch, batch_offset, order = 0, 0, None
    epoch_loss_sum, epoch_loss_batches = 0.0, 0
    history: list[dict[str, Any]] = []
    best_score, best_epoch, best_path = float("inf"), None, None
    first_gradient_norm, weights_changed = None, False
    nonzero_gradient_parameters: set[str] = set()
    initial_state = {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}
    if resume:
        checkpoint = _load_checkpoint(checkpoint_path)
        if checkpoint.get("recipe") != asdict(recipe):
            raise TrainingError("checkpoint recipe differs from this run")
        model.load_state_dict(checkpoint["model"]); optimizer.load_state_dict(checkpoint["optimizer"]); scheduler.load_state_dict(checkpoint["scheduler"])
        rng.bit_generator.state = checkpoint["numpyGenerator"]
        epoch, batch_offset, order = checkpoint["epoch"], checkpoint["batchOffset"], checkpoint["boardOrder"]
        history = checkpoint["history"]; best_score = checkpoint["bestScore"]; best_epoch = checkpoint["bestEpoch"]; best_path = checkpoint["bestPath"]
        first_gradient_norm = checkpoint["firstGradientNorm"]; weights_changed = checkpoint["weightsChanged"]
        nonzero_gradient_parameters = set(checkpoint.get("nonzeroGradientParameters", []))
        initial_state = checkpoint["initialState"]
        epoch_loss_sum = float(checkpoint["epochLossSum"])
        epoch_loss_batches = int(checkpoint["epochLossBatches"])
    identity = run_identity or {"recipe": asdict(recipe), "trainVectorsSha256": train_set.vector_sha256, "trainLabelsSha256": train_set.labels_sha256, "devVectorsSha256": dev_set.vector_sha256, "devLabelsSha256": dev_set.labels_sha256, "datasetManifestSha256": train_set.manifest_sha256}
    if resume and checkpoint.get("runIdentity") != identity:
        raise TrainingError("checkpoint data/configuration identity differs from this run")
    completed_batches = 0
    while epoch < recipe.epochs:
        if order is None:
            order = balanced_board_order(train_meta, recipe.train_boards, rng).tolist()
        flat_indices = (np.asarray(order)[:, None] * 64 + np.arange(64)[None, :]).reshape(-1)
        vectors = train_set.vectors.reshape(-1, INPUT_WIDTH)
        labels = train_set.labels.reshape(-1)
        model.train()
        for offset in range(batch_offset, len(flat_indices), recipe.batch_size):
            if time.monotonic() >= deadline:
                raise TrainingError("run wall-time ceiling reached")
            indices = flat_indices[offset : offset + recipe.batch_size]
            xb = torch.from_numpy(vectors[indices]).to(device=device, dtype=torch.float32)
            yb = torch.from_numpy(labels[indices]).to(device=device)
            optimizer.zero_grad(set_to_none=True)
            loss = mean_available_class_cross_entropy(model(xb), yb)
            if not torch.isfinite(loss):
                raise TrainingError("training loss became nonfinite")
            loss.backward()
            norms = [parameter.grad.detach().norm() for parameter in model.parameters() if parameter.grad is not None]
            gradient_norm = float(torch.linalg.vector_norm(torch.stack(norms)).item())
            if not np.isfinite(gradient_norm) or gradient_norm <= 0:
                raise TrainingError("gradients are nonfinite or zero")
            first_gradient_norm = first_gradient_norm or gradient_norm
            nonzero_gradient_parameters.update(name for name, parameter in model.named_parameters() if parameter.grad is not None and bool(torch.any(parameter.grad != 0)))
            optimizer.step(); scheduler.step()
            epoch_loss_sum += float(loss.detach().item())
            epoch_loss_batches += 1
            weights_changed = weights_changed or any(not torch.equal(value.detach().cpu(), initial_state[name]) for name, value in model.state_dict().items())
            batch_offset = offset + len(indices)
            checkpoint = {"schemaVersion": 1, "recipe": asdict(recipe), "runIdentity": identity, "epoch": epoch, "batchOffset": batch_offset, "boardOrder": order, "model": model.state_dict(), "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(), "numpyGenerator": rng.bit_generator.state, "history": history, "bestScore": best_score, "bestEpoch": best_epoch, "bestPath": best_path, "firstGradientNorm": first_gradient_norm, "weightsChanged": weights_changed, "nonzeroGradientParameters": sorted(nonzero_gradient_parameters), "initialState": initial_state, "epochLossSum": epoch_loss_sum, "epochLossBatches": epoch_loss_batches}
            completed_batches += 1
            should_interrupt = interrupt_after_batches == completed_batches
            if completed_batches % 32 == 0 or should_interrupt:
                _atomic_torch(checkpoint, checkpoint_path)
            if should_interrupt:
                return model, {**checkpoint, "interrupted": True}
        probabilities = infer_torch(model, dev_set.vectors, device)
        score, family_scores = development_score(probabilities, dev_set.labels, dev_meta)
        diagnostic = evaluate_probabilities(probabilities, dev_set.labels, dev_meta, recipe.confidence_floor, recipe.histogram_edges)
        epoch_number = epoch + 1
        if epoch_loss_batches <= 0:
            raise TrainingError("epoch contains no optimization minibatches")
        record = {"epoch": epoch_number, "trainMeanAvailableClassCrossEntropyPerMinibatch": epoch_loss_sum / epoch_loss_batches, "trainMinibatches": epoch_loss_batches, "developmentScore": score, "familyClassBalancedCrossEntropy": family_scores, "learningRate": scheduler.get_last_lr()[0], "diagnostic": diagnostic}
        _atomic_json({"schemaVersion": 1, "status": "completed", **record}, run_dir / f"epoch-{epoch_number:02d}-diagnostic.json", immutable=True)
        history.append(record)
        if score < best_score:
            best_score, best_epoch = score, epoch_number
            best_path = f"best-epoch-{epoch_number:02d}.pt"
            _atomic_torch({"schemaVersion": 1, "recipe": asdict(recipe), "epoch": epoch_number, "developmentScore": score, "model": {name: value.detach().cpu() for name, value in model.state_dict().items()}}, run_dir / best_path)
        epoch, batch_offset, order = epoch_number, 0, None
        epoch_loss_sum, epoch_loss_batches = 0.0, 0
        checkpoint.update({"epoch": epoch, "batchOffset": 0, "boardOrder": None, "history": history, "bestScore": best_score, "bestEpoch": best_epoch, "bestPath": best_path, "epochLossSum": epoch_loss_sum, "epochLossBatches": epoch_loss_batches})
        _atomic_torch(checkpoint, checkpoint_path)
    if best_path is None:
        raise TrainingError("no development checkpoint was selected")
    best = _load_checkpoint(run_dir / best_path)
    model.load_state_dict(best["model"])
    changed_parameters = sorted(name for name, value in model.state_dict().items() if not torch.equal(value.cpu(), initial_state[name]))
    expected_names = sorted(name for name, _ in model.named_parameters())
    if sorted(nonzero_gradient_parameters) != expected_names or changed_parameters != expected_names:
        raise TrainingError("not every shipped fused parameter received a gradient and changed")
    return model, {"history": history, "bestScore": best_score, "bestEpoch": best_epoch, "bestPath": best_path, "firstGradientNorm": first_gradient_norm, "weightsChanged": weights_changed, "changedParameters": changed_parameters, "nonzeroGradientParameters": sorted(nonzero_gradient_parameters), "interrupted": False}


def _export_vectors(dataset: Dataset, metadata: list[dict[str, Any]]) -> tuple[np.ndarray, dict[str, Any]]:
    selected: list[int] = []
    styles = sorted({item["style"] for item in metadata})
    for style in styles:
        selected.append(next(index for index, item in enumerate(metadata) if item["style"] == style))
    covered = set(dataset.labels[selected].ravel().tolist())
    for index, board_labels in enumerate(dataset.labels):
        if covered == set(range(CLASS_COUNT)):
            break
        if set(board_labels.tolist()) - covered:
            selected.append(index)
            covered.update(board_labels.tolist())
    selected = sorted(set(selected))
    if covered != set(range(CLASS_COUNT)):
        raise TrainingError("export parity subset does not span all classes")
    vectors = dataset.vectors[selected].reshape(-1, INPUT_WIDTH).copy()
    return vectors, {"boards": len(selected), "tiles": len(vectors), "classes": CLASS_ORDER, "styles": styles, "sha256": _sha256_bytes(vectors.astype("<f4", copy=False).tobytes())}


def export_and_validate(model: LogitTileNet, dataset: Dataset, metadata: list[dict[str, Any]], output: Path, recipe: Recipe, deadline: float) -> dict[str, Any]:
    if time.monotonic() >= deadline:
        raise TrainingError("run wall-time ceiling reached before export")
    model = model.cpu().eval(); export = ExportNet(model).eval()
    parity_vectors, parity_input = _export_vectors(dataset, metadata)
    inputs = torch.from_numpy(parity_vectors).float()
    with torch.inference_mode():
        expected = export(inputs).numpy()
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(export, inputs, output, input_names=[INPUT_NAME], output_names=[OUTPUT_NAME], dynamic_axes={INPUT_NAME: {0: "n"}, OUTPUT_NAME: {0: "n"}}, opset_version=17, external_data=False, dynamo=False)
    graph = onnx.load(output, load_external_data=False); onnx.checker.check_model(graph)
    if [item.name for item in graph.graph.input] != [INPUT_NAME] or [item.name for item in graph.graph.output] != [OUTPUT_NAME] or any(external_data_helper.uses_external_data(item) for item in graph.graph.initializer):
        raise TrainingError("export interface or sidecar contract failed")
    opset = next((item.version for item in graph.opset_import if item.domain in ("", "ai.onnx")), None)
    in_shape = graph.graph.input[0].type.tensor_type.shape.dim; out_shape = graph.graph.output[0].type.tensor_type.shape.dim
    if opset != 17 or len(in_shape) != 2 or in_shape[1].dim_value != INPUT_WIDTH or len(out_shape) != 2 or out_shape[1].dim_value != CLASS_COUNT or not in_shape[0].dim_param or not out_shape[0].dim_param:
        raise TrainingError("export schema or dynamic batch contract failed")
    options = ort.SessionOptions(); options.intra_op_num_threads = 1; options.inter_op_num_threads = 1
    actual = ort.InferenceSession(str(output), sess_options=options, providers=["CPUExecutionProvider"]).run([OUTPUT_NAME], {INPUT_NAME: inputs.numpy()})[0]
    maximum = float(np.abs(expected - actual).max())
    if not np.isfinite(actual).all() or not np.allclose(expected, actual, atol=recipe.onnx_atol, rtol=recipe.onnx_rtol) or not np.array_equal(expected.argmax(1), actual.argmax(1)):
        raise TrainingError("export numeric, finite-output, or argmax parity failed")
    if list(output.parent.glob(output.name + ".*")):
        raise TrainingError("export created a forbidden sidecar")
    return {"sha256": sha256_file(output), "bytes": output.stat().st_size, "opset": 17, "dynamicBatch": True, "externalData": False, "operators": sorted({node.op_type for node in graph.graph.node}), "parity": {"atol": recipe.onnx_atol, "rtol": recipe.onnx_rtol, "maximumAbsoluteError": maximum, "identicalArgmax": True, "finite": True, "input": parity_input}}


def _ledger_start(path: Path, run_name: str, ceiling: float) -> tuple[int, float]:
    ledger = _read_object(path, "budget ledger") if path.exists() else {"schemaVersion": 1, "aggregateCeilingSeconds": 1260, "attempts": []}
    attempts = ledger.get("attempts")
    if ledger.get("aggregateCeilingSeconds") != 1260 or not isinstance(attempts, list):
        raise TrainingError("budget ledger is invalid")
    if any(item.get("status") == "running" for item in attempts):
        raise TrainingError("budget ledger contains a pending attempt; concurrent or unreviewed recovery is forbidden")
    charged = sum(float(item.get("chargedSeconds", 0)) for item in attempts)
    run_charged = sum(float(item.get("chargedSeconds", 0)) for item in attempts if item.get("run") == run_name)
    available = min(1260 - charged, ceiling - run_charged)
    if available <= 0:
        raise TrainingError("aggregate training budget is exhausted")
    reserved = min(ceiling, available)
    attempts.append({"run": run_name, "ceilingSeconds": ceiling, "reservedSeconds": reserved, "chargedSeconds": reserved, "status": "running", "startedUnixSeconds": time.time()})
    _atomic_json(ledger, path)
    return len(attempts) - 1, reserved


def _ledger_finish(path: Path, index: int, status: str, elapsed: float) -> None:
    ledger = _read_object(path, "budget ledger")
    attempt = ledger["attempts"][index]
    attempt.update({"status": status, "elapsedSeconds": elapsed, "chargedSeconds": elapsed})
    _atomic_json(ledger, path)


def _same_state(left: nn.Module, right: nn.Module) -> bool:
    return all(torch.equal(value.detach().cpu(), right.state_dict()[name].detach().cpu()) for name, value in left.state_dict().items())


def verify_pilot_recovery(recipe: Recipe, train_set: Dataset, dev_set: Dataset, train_meta: list[dict[str, Any]], dev_meta: list[dict[str, Any]], shipped_path: Path, device: torch.device, run_dir: Path, deadline: float, identity: dict[str, Any]) -> tuple[LogitTileNet, dict[str, Any], dict[str, Any]]:
    configure_determinism(recipe.seed)
    reference_model, reference = train(recipe, train_set, dev_set, train_meta, dev_meta, initialize_shipped(shipped_path), device, run_dir / "recovery-reference", deadline, identity)
    configure_determinism(recipe.seed)
    _, interrupted = train(recipe, train_set, dev_set, train_meta, dev_meta, initialize_shipped(shipped_path), device, run_dir, deadline, identity, interrupt_after_batches=1)
    if not interrupted.get("interrupted") or interrupted.get("batchOffset") != recipe.batch_size:
        raise TrainingError("pilot did not persist the declared minibatch interruption")
    recovered_model, recovered = train(recipe, train_set, dev_set, train_meta, dev_meta, initialize_shipped(shipped_path), device, run_dir, deadline, identity, resume=True)
    comparisons = {
        "selectedWeightsIdentical": _same_state(reference_model, recovered_model),
        "historyIdentical": reference["history"] == recovered["history"],
        "bestEpochIdentical": reference["bestEpoch"] == recovered["bestEpoch"],
        "bestScoreIdentical": reference["bestScore"] == recovered["bestScore"],
    }
    if not all(comparisons.values()):
        raise TrainingError("pilot resumed trajectory differs from uninterrupted reference")
    return recovered_model, recovered, {"performed": True, "interruptionBatch": 1, "checkpointCadenceBatches": 32, "equivalent": True, "comparisons": comparisons}


def _command_output(command: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def _environment() -> dict[str, Any]:
    summary = _command_output(("nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"))
    banner = _command_output(("nvidia-smi",))
    toolkit = re.search(r"CUDA Version:\s*([^\s|]+)", banner or "")
    return {
        "python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine(),
        "torch": torch.__version__, "torchCudaToolkit": torch.version.cuda, "onnx": onnx.__version__, "onnxruntime": ort.__version__,
        "device": "cuda", "cudaDevice": torch.cuda.get_device_name(0), "nvidiaSmiSummary": summary,
        "nvidiaDriverReportedCuda": toolkit.group(1) if toolkit else None,
    }


def ensure_elapsed_within_available(elapsed: float, available_seconds: float) -> None:
    if elapsed > available_seconds:
        raise TrainingError("run wall-time ceiling reached during final diagnostics")


def run(protocol_path: Path, run_name: str, device_name: str, resume: bool = False) -> dict[str, Any]:
    protocol, recipe, protocol_hash = load_protocol(protocol_path, run_name)
    paths = resolve_paths(protocol_path, protocol)
    locks = verify_pretraining_lock(paths, protocol_hash)
    if device_name != "cuda" or not torch.cuda.is_available():
        raise TrainingError("real protocol runs require an available CUDA device")
    output_root = paths["outputDir"]; run_dir = output_root / run_name
    if (run_dir / "run-report.json").exists():
        raise TrainingError("completed run report already exists")
    if (run_dir / "checkpoint-last.pt").exists() and not resume and run_name != "pilot":
        raise TrainingError("incomplete run artifacts require explicit --resume")
    if run_name != "pilot":
        pilot = _read_object(output_root / "pilot" / "run-report.json", "pilot run report")
        recovery = pilot.get("recovery")
        if pilot.get("status") != "completed" or not isinstance(recovery, dict) or recovery.get("performed") is not True or recovery.get("equivalent") is not True or not isinstance(pilot.get("export"), dict):
            raise TrainingError("full training requires completed pilot recovery and export proof")
    train_set = load_split(paths["datasetDir"], "train")
    dev_set = load_split(paths["datasetDir"], "dev")
    train_meta = load_board_metadata(paths["datasetDir"], "train")
    dev_meta = load_board_metadata(paths["datasetDir"], "dev")
    configure_determinism(recipe.seed)
    identity = {"protocolSha256": protocol_hash, **locks, "recipe": asdict(recipe), "trainVectorsSha256": train_set.vector_sha256, "trainLabelsSha256": train_set.labels_sha256, "devVectorsSha256": dev_set.vector_sha256, "devLabelsSha256": dev_set.labels_sha256}
    ledger_path = output_root / "budget-ledger.json"
    attempt, available_seconds = _ledger_start(ledger_path, run_name, recipe.max_seconds)
    started = time.monotonic(); deadline = started + available_seconds
    status = "failed"
    try:
        recovery: dict[str, Any] | None = None
        if run_name == "pilot":
            if resume:
                raise TrainingError("pilot recovery proof is an atomic two-trajectory run and cannot use --resume")
            model, training, recovery = verify_pilot_recovery(recipe, train_set, dev_set, train_meta, dev_meta, paths["shippedModel"], torch.device("cuda"), run_dir, deadline, identity)
        else:
            model = initialize_shipped(paths["shippedModel"])
            model, training = train(recipe, train_set, dev_set, train_meta, dev_meta, model, torch.device("cuda"), run_dir, deadline, identity, resume=resume)
        export = export_and_validate(model, dev_set, dev_meta, run_dir / "candidate.onnx", recipe, deadline)
        probabilities = infer_onnx(run_dir / "candidate.onnx", dev_set.vectors)
        final_diagnostic = evaluate_probabilities(probabilities, dev_set.labels, dev_meta, recipe.confidence_floor, recipe.histogram_edges)
        _atomic_json({"schemaVersion": 1, "status": "completed", **final_diagnostic}, run_dir / "candidate-development-diagnostic.json", immutable=True)
        elapsed = time.monotonic() - started
        ensure_elapsed_within_available(elapsed, available_seconds)
        result = {"schemaVersion": 1, "status": "completed", "run": run_name, "command": f"python experiments/recognition-training/v3/trainer.py --protocol experiments/recognition-training/v3/protocol.json --run {run_name}", "commit": _command_output(("git", "rev-parse", "HEAD")), "scriptSha256": sha256_file(Path(__file__)), "recipe": asdict(recipe), "locks": locks, "training": training, "recovery": recovery, "export": export, "finalDevelopmentDiagnostic": final_diagnostic, "testLoaded": False, "orientation": "native/A1 assumed; not inferred", "elapsedSeconds": elapsed, "environment": _environment()}
        _atomic_json(result, run_dir / "run-report.json", immutable=True)
        status = "completed"
        return result
    except Exception as error:
        elapsed = time.monotonic() - started
        failure = {"schemaVersion": 1, "status": "failed", "run": run_name, "attempt": attempt + 1, "command": f"python experiments/recognition-training/v3/trainer.py --protocol experiments/recognition-training/v3/protocol.json --run {run_name}", "commit": _command_output(("git", "rev-parse", "HEAD")), "scriptSha256": sha256_file(Path(__file__)), "locks": locks, "errorType": type(error).__name__, "error": str(error), "elapsedSeconds": elapsed, "testLoaded": False, "environment": _environment()}
        _atomic_json(failure, run_dir / f"failed-attempt-{attempt + 1:02d}.json", immutable=True)
        raise
    finally:
        _ledger_finish(ledger_path, attempt, status, time.monotonic() - started)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--run", choices=("pilot", "full-3821", "full-3822"), required=True)
    parser.add_argument("--device", choices=("cuda",), default="cuda")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        run(args.protocol.resolve(), args.run, args.device, args.resume)
        return 0
    except (DatasetError, TrainingError, OSError, RuntimeError, ValueError) as error:
        print(f"training failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
