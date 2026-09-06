"""Bounded, data-only feasibility trainer for the real-diagram pilot.

This module is deliberately separate from the frozen v3 trainer.  It loads
only the hash-locked train and dev NPZs and never exposes a qualification path.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import sys
import time
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent
V3 = ROOT.parent / "recognition-training" / "v3"
if str(V3) not in sys.path:
    sys.path.insert(0, str(V3))

from trainer import CLASS_ORDER, LogitTileNet, ExportNet, initialize_shipped, mean_available_class_cross_entropy  # noqa: E402
import torch  # noqa: E402
import onnxruntime as ort  # noqa: E402

torch.set_num_threads(4)

CLASS_COUNT = len(CLASS_ORDER)
TILE_WIDTH = 1024
BOARD_TILES = 64
MAX_NPZ_BYTES = 2 * 1024 * 1024 * 1024


class FeasibilityError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _object(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FeasibilityError(f"{name} must be an object")
    return value


def _read_metadata(path: Path, count: int) -> list[dict[str, Any]]:
    try:
        root = _object(json.loads(path.read_text(encoding="utf-8")), "metadata")
    except (OSError, json.JSONDecodeError) as error:
        raise FeasibilityError("metadata is unavailable or invalid") from error
    boards = root.get("boards")
    if not isinstance(boards, list) or len(boards) != count:
        raise FeasibilityError("metadata board count does not match arrays")
    seen: set[str] = set()
    for board in boards:
        item = _object(board, "metadata board")
        for field in ("id", "sourceId", "family", "condition"):
            if not isinstance(item.get(field), str) or not item[field]:
                raise FeasibilityError(f"metadata missing {field}")
        if item["id"] in seen:
            raise FeasibilityError("metadata board IDs overlap")
        seen.add(item["id"])
        if not isinstance(item.get("clean"), bool) or not isinstance(item.get("exposed"), bool):
            raise FeasibilityError("metadata clean/exposed fields are invalid")
    return boards


def load_split(data_dir: Path, split: str) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    if split not in {"train", "dev"}:
        raise FeasibilityError("qualification/test data is unavailable to this trainer")
    tiles_path, labels_path, metadata_path = (data_dir / f"{split}.{suffix}" for suffix in ("npz", "labels.npz", "metadata.json"))
    # Accept the specified split.npz containing both arrays; reject a second
    # labels artifact to avoid ambiguous inputs.
    labels_path = data_dir / f"{split}.npz"
    if not tiles_path.is_file() or tiles_path.is_symlink() or tiles_path.stat().st_size > MAX_NPZ_BYTES:
        raise FeasibilityError(f"{split} tensor artifact is invalid")
    if not metadata_path.is_file() or metadata_path.is_symlink():
        raise FeasibilityError(f"{split} metadata artifact is missing")
    try:
        with np.load(tiles_path, allow_pickle=False) as archive:
            if set(archive.files) != {"tiles", "labels"}:
                raise FeasibilityError(f"{split} NPZ must contain only tiles and labels")
            tiles = np.asarray(archive["tiles"])
            labels = np.asarray(archive["labels"])
    except (OSError, ValueError, KeyError) as error:
        raise FeasibilityError(f"{split} NPZ is invalid") from error
    if tiles.dtype != np.float32 or labels.dtype != np.int64 or tiles.ndim != 3 or labels.ndim != 2:
        raise FeasibilityError("arrays have incompatible dtype or rank")
    if tiles.shape[1:] != (BOARD_TILES, TILE_WIDTH) or labels.shape != tiles.shape[:1] + (BOARD_TILES,):
        raise FeasibilityError("arrays have incompatible board shape")
    if not np.isfinite(tiles).all() or np.any(tiles < 0) or np.any(tiles > 1):
        raise FeasibilityError("tiles must be finite normalized float32 values")
    if np.any(labels < 0) or np.any(labels >= CLASS_COUNT):
        raise FeasibilityError("labels contain an unknown class")
    metadata = _read_metadata(metadata_path, len(tiles))
    return tiles, labels, metadata


def verify_lock(data_dir: Path) -> dict[str, Any]:
    lock_path = data_dir / "dataset-lock.json"
    if lock_path.is_symlink() or not lock_path.is_file():
        raise FeasibilityError("dataset lock is missing")
    lock = _object(json.loads(lock_path.read_text(encoding="utf-8")), "dataset lock")
    if lock.get("schema") != 1 or set(lock.get("splits", {})) != {"train", "dev"}:
        raise FeasibilityError("dataset lock must contain train and dev only")
    for split in ("train", "dev"):
        tiles_path = data_dir / f"{split}.npz"
        metadata_path = data_dir / f"{split}.metadata.json"
        entry = _object(lock["splits"].get(split), f"lock.{split}")
        if entry.get("tilesSha256") != sha256(tiles_path) or entry.get("metadataSha256") != sha256(metadata_path):
            raise FeasibilityError(f"{split} bytes differ from lock")
    return lock


def load_protocol(path: Path, run_name: str) -> dict[str, Any]:
    try:
        protocol = _object(json.loads(path.read_text(encoding="utf-8")), "protocol")
    except (OSError, json.JSONDecodeError) as error:
        raise FeasibilityError("protocol is unavailable or invalid") from error
    runs = _object(protocol.get("runs"), "protocol.runs")
    if protocol.get("schema") != 1 or protocol.get("issue") != 41 or run_name not in runs:
        raise FeasibilityError("protocol schema, issue, or run is invalid")
    if protocol.get("aggregateNewSeconds") != 900 or protocol.get("priorChargedSeconds") != 354.078:
        raise FeasibilityError("aggregate budget differs from the reviewed protocol")
    if protocol.get("shippedModel") != "packages/test-fixtures/node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx":
        raise FeasibilityError("protocol shipped model path differs from the pinned FENShot model")
    run = _object(runs[run_name], f"protocol.runs.{run_name}")
    for field in ("seed", "epochs", "maxSeconds", "minimumUpdates"):
        if not isinstance(run.get(field), (int, float)) or run[field] <= 0:
            raise FeasibilityError(f"protocol run field {field} is invalid")
    if run_name == "pilot" and (run["epochs"] != 2 or run["minimumUpdates"] != 1 or run["maxSeconds"] != 60):
        raise FeasibilityError("pilot recipe must be the reviewed two-epoch recovery pilot")
    if run_name != "pilot" and (run["epochs"] != 40 or run["minimumUpdates"] < 200 or run["maxSeconds"] != 420):
        raise FeasibilityError("full recipe must be the reviewed 40-epoch bounded run")
    if run["minimumUpdates"] <= 0:
        raise FeasibilityError("protocol minimum update gate is too low")
    return protocol


def family_order(metadata: list[dict[str, Any]], seed: int) -> np.ndarray:
    groups: dict[str, list[int]] = {}
    for index, board in enumerate(metadata):
        groups.setdefault(board["family"], []).append(index)
    if not groups:
        raise FeasibilityError("training metadata has no families")
    rng = random.Random(seed)
    for values in groups.values():
        rng.shuffle(values)
    # Equal-family sampling: smaller families are deterministically cycled so
    # every epoch exposes the same number of boards from every lineage.
    per_family = max(len(values) for values in groups.values())
    order: list[int] = []
    for offset in range(per_family):
        for family in sorted(groups):
            values = groups[family]
            order.append(values[offset % len(values)])
    return np.asarray(order, dtype=np.int64)


def diagnose(probabilities: np.ndarray, labels: np.ndarray, metadata: list[dict[str, Any]], floor: float = 0.7) -> dict[str, Any]:
    if probabilities.shape != (*labels.shape, CLASS_COUNT):
        raise FeasibilityError("probability and label shapes differ")
    predictions = probabilities.argmax(axis=2); confidence = probabilities.max(axis=2)
    correct = predictions == labels; exact = correct.all(axis=1); occupied = labels != 0
    board_accepted = (confidence >= floor).all(axis=1)
    true = probabilities[np.arange(len(labels))[:, None], np.arange(BOARD_TILES)[None, :], labels]
    by_family: dict[str, dict[str, Any]] = {}
    for family in sorted({item["family"] for item in metadata}):
        mask = np.asarray([item["family"] == family for item in metadata])
        by_family[family] = {"boards": int(mask.sum()), "exactBoards": int(exact[mask].sum()), "occupiedCorrect": int((correct[mask] & occupied[mask]).sum()), "occupied": int(occupied[mask].sum())}
    per_class = {}
    for index, symbol in enumerate(CLASS_ORDER):
        mask = labels == index
        per_class[symbol] = {"correct": int((correct & mask).sum()), "total": int(mask.sum()), "accuracy": float((correct & mask).sum() / mask.sum()) if mask.any() else None}
    return {"rawExactBoards": int(exact.sum()), "boards": len(labels), "occupiedCorrect": int((correct & occupied).sum()), "occupied": int(occupied.sum()), "reliableExactBoards": int((exact & board_accepted).sum()), "confidentWrongBoards": int((~exact & board_accepted).sum()), "confidentCorrectSquares": int((correct & (confidence >= floor)).sum()), "confidentSquares": int((confidence >= floor).sum()), "perClass": per_class, "byFamily": by_family, "byCondition": {condition: {"boards": sum(item["condition"] == condition for item in metadata), "exactBoards": int(exact[np.asarray([item["condition"] == condition for item in metadata])].sum())} for condition in sorted({item["condition"] for item in metadata})}}


def development_score(probabilities: np.ndarray, labels: np.ndarray, metadata: list[dict[str, Any]]) -> float:
    true = np.clip(probabilities[np.arange(len(labels))[:, None], np.arange(BOARD_TILES)[None, :], labels], 1e-30, 1)
    values = []
    for family in sorted({item["family"] for item in metadata}):
        board_mask = np.asarray([item["family"] == family for item in metadata])
        for index in range(CLASS_COUNT):
            chosen = labels[board_mask] == index
            if chosen.any():
                values.append(float((-np.log(true[board_mask][chosen])).mean()))
    return float(np.mean(values)) if values else float("inf")


def load_augmentation(directory: Path, data_dir: Path, metadata: list[dict[str, Any]]) -> np.ndarray:
    lock = _object(json.loads((directory/'bank-lock.json').read_text()),'augmentation lock')
    path = directory/'bank.npz'
    if lock.get('trainTilesSha256') != sha256(data_dir/'train.npz') or lock.get('bankSha256') != sha256(path):
        raise FeasibilityError('augmentation bank identity differs')
    if lock.get('parentIds') != [row['id'] for row in metadata]:
        raise FeasibilityError('augmentation parent order differs')
    with np.load(path,allow_pickle=False) as data:
        if set(data.files)!={'tiles'}: raise FeasibilityError('invalid augmentation arrays')
        bank=data['tiles']
    if bank.dtype!=np.float32 or bank.shape!=(len(metadata),3,64,1024) or not np.isfinite(bank).all() or np.any(bank<0) or np.any(bank>1):
        raise FeasibilityError('invalid augmentation tensor shape or values')
    return bank


def epoch_views(tiles: np.ndarray, bank: np.ndarray | None, seed: int) -> np.ndarray:
    if bank is None: return tiles
    rng=np.random.default_rng(seed)
    choices=rng.choice(4,size=len(tiles),p=[.5,1/6,1/6,1/6])
    result=tiles.copy()
    for index,choice in enumerate(choices):
        if choice: result[index]=bank[index,choice-1]
    return result


def infer_probabilities(model: torch.nn.Module, tiles: np.ndarray, device: torch.device, batch_size: int = 512) -> np.ndarray:
    values = tiles.reshape(-1, TILE_WIDTH)
    outputs: list[np.ndarray] = []
    model.eval()
    with torch.inference_mode():
        for offset in range(0, len(values), batch_size):
            logits = model(torch.from_numpy(values[offset:offset + batch_size]).to(device)).cpu()
            outputs.append(torch.softmax(logits, dim=1).numpy())
    return np.concatenate(outputs, axis=0).reshape(len(tiles), BOARD_TILES, CLASS_COUNT)


def train_once(tiles: np.ndarray, labels: np.ndarray, metadata: list[dict[str, Any]], dev_tiles: np.ndarray, dev_labels: np.ndarray, dev_metadata: list[dict[str, Any]], model: torch.nn.Module, seed: int, epochs: int = 40, max_seconds: float = 420, batch_size: int = 512, learning_rate: float = 1e-5, minimum_learning_rate: float = 1e-6, weight_decay: float = 1e-4, minimum_updates: int = 200, device: str = "cpu", checkpoint: Path | None = None, resume: bool = False, stop_after_epoch: int | None = None, augmentation_bank: np.ndarray | None = None) -> dict[str, Any]:
    if device == "cuda" and not torch.cuda.is_available():
        raise FeasibilityError("CUDA is unavailable")
    torch.manual_seed(seed); np.random.seed(seed)
    torch.use_deterministic_algorithms(True)
    target = torch.device(device)
    model = model.to(target)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    epoch_order_length = len(family_order(metadata, seed)) * BOARD_TILES
    steps = (epoch_order_length + batch_size - 1) // batch_size
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs * steps, eta_min=minimum_learning_rate)
    started = time.monotonic(); updates = 0; curves = []; best = (float("inf"), None); best_state: dict[str, torch.Tensor] | None = None; start_epoch = 0
    if resume and checkpoint is not None and checkpoint.is_file():
        try:
            state = torch.load(checkpoint, map_location=target, weights_only=False)
            model.load_state_dict(state["model"]); optimizer.load_state_dict(state["optimizer"]); scheduler.load_state_dict(state["scheduler"])
            updates = int(state["updates"]); curves = state["curves"]; best = tuple(state["best"]); best_state = state.get("bestModel"); start_epoch = int(state["epoch"])
        except (OSError, KeyError, RuntimeError, ValueError) as error:
            raise FeasibilityError("checkpoint recovery failed") from error
    for epoch in range(start_epoch, epochs):
        model.train()
        epoch_loss = torch.zeros((), device=target)
        epoch_tiles = 0
        order = family_order(metadata, seed + epoch)
        flat = (order[:, None] * BOARD_TILES + np.arange(BOARD_TILES)[None, :]).reshape(-1)
        flat_tiles = epoch_views(tiles,augmentation_bank,seed+epoch).reshape(-1, TILE_WIDTH); flat_labels = labels.reshape(-1)
        for offset in range(0, len(flat), batch_size):
            if time.monotonic() - started >= max_seconds:
                status = "budget-truncated"
                result = {"status": status, "updates": updates, "curves": curves, "model": model}
                if checkpoint is not None: _save_checkpoint(checkpoint, model, optimizer, scheduler, updates, curves, best, best_state, epoch)
                return result
            indices = flat[offset : offset + batch_size]
            xb = torch.from_numpy(flat_tiles[indices]).to(target); yb = torch.from_numpy(flat_labels[indices]).to(target)
            optimizer.zero_grad(set_to_none=True)
            loss = mean_available_class_cross_entropy(model(xb), yb)
            loss.backward(); optimizer.step(); scheduler.step(); updates += 1
            epoch_loss += loss.detach() * len(indices)
            epoch_tiles += len(indices)
        model.eval()
        probabilities = infer_probabilities(model, dev_tiles, target)
        curve = diagnose(probabilities, dev_labels, dev_metadata)
        score = development_score(probabilities, dev_labels, dev_metadata)
        curves.append({"epoch": epoch + 1, "updates": updates, "trainCrossEntropy": float(epoch_loss.cpu()) / epoch_tiles, "devScore": score, "diagnostic": curve})
        if score < best[0]:
            best = (score, epoch + 1)
            best_state = {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}
        if checkpoint is not None: _save_checkpoint(checkpoint, model, optimizer, scheduler, updates, curves, best, best_state, epoch + 1)
        if stop_after_epoch == epoch + 1:
            return {"status": "interrupted", "updates": updates, "curves": curves, "bestScore": best[0], "bestEpoch": best[1], "model": model}
    if best_state is None:
        raise FeasibilityError("training produced no development checkpoint")
    model.load_state_dict(best_state)
    status = "completed" if updates >= minimum_updates else "inconclusive"
    return {"status": status, "updates": updates, "curves": curves, "bestScore": best[0], "bestEpoch": best[1], "model": model}


def _save_checkpoint(path: Path, model: torch.nn.Module, optimizer: torch.optim.Optimizer, scheduler: Any, updates: int, curves: list[dict[str, Any]], best: tuple[float, Any], best_state: dict[str, torch.Tensor] | None, epoch: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save({"model": model.state_dict(), "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(), "updates": updates, "curves": curves, "best": best, "bestModel": best_state, "epoch": epoch}, temporary)
    os.replace(temporary, path)


def pilot_recovery(
    tiles: np.ndarray,
    labels: np.ndarray,
    metadata: list[dict[str, Any]],
    dev_tiles: np.ndarray,
    dev_labels: np.ndarray,
    dev_metadata: list[dict[str, Any]],
    model: torch.nn.Module,
    seed: int,
    *,
    epochs: int,
    max_seconds: float,
    minimum_updates: int,
    device: str,
    checkpoint: Path,
    augmentation_bank: np.ndarray | None = None,
) -> tuple[torch.nn.Module, dict[str, Any], dict[str, Any]]:
    """Prove checkpoint recovery by comparing two complete trajectories.

    The pilot's wall-clock allowance is shared by the uninterrupted reference,
    interrupted prefix, and resumed suffix.  This deliberately fails if the
    proof cannot complete inside the reviewed allowance; callers must not turn
    that failure into a claimed recovery flag.
    """
    if max_seconds <= 0:
        raise FeasibilityError("invalid pilot recovery budget")
    started = time.monotonic()
    trajectory_budget = max_seconds / 3.0

    def run(copy_model: bool, **kwargs: Any) -> dict[str, Any]:
        if time.monotonic() - started >= max_seconds:
            raise FeasibilityError("pilot recovery budget exhausted")
        result = train_once(
            tiles, labels, metadata, dev_tiles, dev_labels, dev_metadata,
            copy.deepcopy(model) if copy_model else model, seed,
            epochs=epochs, max_seconds=trajectory_budget, minimum_updates=minimum_updates,
            device=device, checkpoint=checkpoint, augmentation_bank=augmentation_bank, **kwargs,
        )
        if result["status"] not in {"completed", "interrupted"}:
            raise FeasibilityError("pilot recovery trajectory did not complete")
        return result

    reference = run(True)
    interrupted = run(True, stop_after_epoch=1)
    if interrupted["status"] != "interrupted":
        raise FeasibilityError("pilot interruption was not observed")
    recovered = run(True, resume=True)
    elapsed = time.monotonic() - started
    if elapsed > max_seconds:
        raise FeasibilityError("pilot recovery exceeded its wall-clock cap")
    comparisons = {
        "selectedWeightsIdentical": all(
            torch.equal(value.detach().cpu(), recovered["model"].state_dict()[name].detach().cpu())
            for name, value in reference["model"].state_dict().items()
        ),
        "historyIdentical": reference.get("curves") == recovered.get("curves"),
        "bestEpochIdentical": reference.get("bestEpoch") == recovered.get("bestEpoch"),
        "bestScoreIdentical": reference.get("bestScore") == recovered.get("bestScore"),
    }
    if not all(comparisons.values()):
        raise FeasibilityError("pilot resumed trajectory differs from uninterrupted reference")
    proof = {
        "performed": True,
        "equivalent": True,
        "interruptionEpoch": 1,
        "comparisons": comparisons,
        "elapsedSeconds": elapsed,
    }
    return recovered["model"], recovered, proof


def require_completed_pilot(report: dict[str, Any]) -> None:
    recovery = report.get("recovery")
    if report.get("status") != "completed" or report.get("recoveryEquivalent") is not True:
        raise FeasibilityError("full run requires equivalent pilot recovery")
    if not isinstance(recovery, dict) or recovery.get("performed") is not True or recovery.get("equivalent") is not True:
        raise FeasibilityError("full run requires executed pilot recovery proof")


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def ledger_start(path: Path, run_name: str, reservation: float, *, resume: bool = False) -> dict[str, Any]:
    if reservation <= 0:
        raise FeasibilityError("invalid run reservation")
    try:
        ledger = _object(json.loads(path.read_text(encoding="utf-8")), "budget ledger") if path.exists() else {"schema": 1, "budgetSeconds": 900.0, "attempts": []}
    except (OSError, json.JSONDecodeError) as error:
        raise FeasibilityError("budget ledger is invalid") from error
    attempts = ledger.get("attempts")
    if ledger.get("schema") != 1 or not isinstance(attempts, list):
        raise FeasibilityError("budget ledger schema is invalid")
    active = [item for item in attempts if isinstance(item, dict) and item.get("run") == run_name and item.get("status") == "reserved"]
    if active:
        if not resume:
            raise FeasibilityError("run has an unfinished reservation; use --resume")
        return active[-1]
    if any(isinstance(item, dict) and item.get("run") == run_name for item in attempts):
        raise FeasibilityError("run already has a terminal ledger entry")
    charged = sum(float(item.get("reservedSeconds", 0)) for item in attempts if isinstance(item, dict))
    if charged + reservation > 900.0:
        raise FeasibilityError("new training budget exhausted")
    entry = {"run": run_name, "status": "reserved", "reservedSeconds": reservation, "startedAt": time.time()}
    attempts.append(entry)
    ledger["attempts"] = attempts; ledger["chargedSeconds"] = charged + reservation
    atomic_json(path, ledger)
    return entry


def ledger_finish(path: Path, run_name: str, status: str) -> None:
    ledger = _object(json.loads(path.read_text(encoding="utf-8")), "budget ledger")
    attempts = ledger.get("attempts")
    if not isinstance(attempts, list):
        raise FeasibilityError("budget ledger attempts are invalid")
    matches = [item for item in attempts if isinstance(item, dict) and item.get("run") == run_name and item.get("status") == "reserved"]
    if len(matches) != 1:
        raise FeasibilityError("run reservation is missing or duplicated")
    matches[0]["status"] = status; matches[0]["finishedAt"] = time.time()
    atomic_json(path, ledger)


def baseline(data_dir: Path, shipped: Path, dev: tuple[np.ndarray, np.ndarray, list[dict[str, Any]]], output: Path) -> dict[str, Any]:
    tiles, labels, metadata = dev
    values = tiles.reshape(-1, TILE_WIDTH).astype(np.float32, copy=False)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 4
    session = ort.InferenceSession(str(shipped), sess_options=options, providers=["CPUExecutionProvider"])
    chunks: list[np.ndarray] = []
    for offset in range(0, len(values), 512):
        chunks.append(np.asarray(session.run(["probs"], {"tiles": values[offset:offset + 512]})[0]))
    probabilities = np.concatenate(chunks, axis=0).reshape(len(tiles), BOARD_TILES, CLASS_COUNT)
    output.parent.mkdir(parents=True, exist_ok=True)
    probability_path = output.with_suffix('.probabilities.npy')
    with probability_path.open('xb') as stream: np.save(stream, probabilities, allow_pickle=False)
    result = {"status": "baseline", "devTilesSha256": sha256(data_dir / "dev.npz"), "shippedSha256": sha256(shipped), "probabilitiesSha256": sha256(probability_path), "diagnostic": diagnose(probabilities, labels, metadata)}
    atomic_json(output, result)
    return result


def validate_export(path: Path, model: torch.nn.Module, tiles: np.ndarray) -> dict[str, Any]:
    values = tiles.reshape(-1, TILE_WIDTH).astype(np.float32, copy=False)
    expected = infer_probabilities(model.cpu(), tiles, torch.device("cpu")).reshape(-1, CLASS_COUNT)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 4
    session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
    chunks: list[np.ndarray] = []
    for offset in range(0, len(values), 512):
        chunks.append(np.asarray(session.run(["probs"], {"tiles": values[offset:offset + 512]})[0]))
    actual = np.concatenate(chunks, axis=0)
    if not np.array_equal(expected.argmax(axis=1), actual.argmax(axis=1)) or not np.allclose(expected, actual, atol=1e-5, rtol=1e-5):
        raise FeasibilityError("ONNX/PyTorch parity failed")
    probability_path = path.with_suffix('.probabilities.npy')
    with probability_path.open('xb') as stream: np.save(stream, actual.reshape(len(tiles), BOARD_TILES, CLASS_COUNT), allow_pickle=False)
    return {"sha256": sha256(path), "probabilitiesSha256": sha256(probability_path), "tiles": int(len(values)), "maximumAbsoluteError": float(np.max(np.abs(expected - actual)))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--run", choices=("pilot", "real-only", "degraded"), required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        protocol = load_protocol(args.protocol, args.run)
        from preflight_feasibility import verify as verify_preflight
        verify_preflight()
        data_dir = (args.protocol.parent / protocol["dataDir"]).resolve()
        output = (args.protocol.parent / protocol["outputDir"]).resolve()
        lock = verify_lock(data_dir)
        train = load_split(data_dir, "train"); dev = load_split(data_dir, "dev")
        shipped = (REPO_ROOT / protocol["shippedModel"]).resolve()
        run_dir = output / args.run
        if (run_dir / "run-report.json").exists() and not args.resume: raise FeasibilityError("run is already complete")
        if args.run != "pilot":
            pilot_report_path = output / "pilot" / "run-report.json"
            if not pilot_report_path.exists(): raise FeasibilityError("full run requires completed pilot")
            pilot_report = _object(json.loads(pilot_report_path.read_text(encoding="utf-8")), "pilot report")
            require_completed_pilot(pilot_report)
        started = time.monotonic()
        baseline_path = output / "baseline-dev.json"
        if not baseline_path.exists(): baseline(data_dir, shipped, dev, baseline_path)
        else:
            existing = _object(json.loads(baseline_path.read_text(encoding="utf-8")), "baseline")
            if existing.get("devTilesSha256") != sha256(data_dir / "dev.npz") or existing.get("shippedSha256") != sha256(shipped):
                raise FeasibilityError("baseline hash identity differs")
        ledger = output / "budget-ledger.json"
        run = _object(protocol["runs"][args.run], args.run)
        reservation = ledger_start(ledger, args.run, float(run["maxSeconds"]), resume=args.resume)
        from recover_fenshot import load_recovered
        model = load_recovered((args.protocol.parent/protocol['baseDir']).resolve(), shipped)
        bank = load_augmentation((args.protocol.parent/protocol['augmentationDir']).resolve(),data_dir,train[2]) if args.run in ('pilot','degraded') else None
        if args.run == "pilot":
            model, result, recovery = pilot_recovery(
                train[0], train[1], train[2], dev[0], dev[1], dev[2], model,
                int(run["seed"]), epochs=int(run["epochs"]),
                max_seconds=float(run["maxSeconds"]),
                minimum_updates=int(run["minimumUpdates"]), device=args.device,
                checkpoint=run_dir / "checkpoint.pt",
                augmentation_bank=bank,
            )
        else:
            recovery = None
            result = train_once(train[0], train[1], train[2], dev[0], dev[1], dev[2], model, int(run["seed"]), epochs=int(run["epochs"]), max_seconds=float(run["maxSeconds"]), minimum_updates=int(run["minimumUpdates"]), device=args.device, checkpoint=run_dir / "checkpoint.pt", resume=args.resume, augmentation_bank=bank)
        elapsed = time.monotonic() - started
        model_path = run_dir / "candidate.onnx"
        if result["status"] == "completed":
            model_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = model_path.with_suffix(".tmp")
            torch.onnx.export(ExportNet(result["model"].cpu().eval()), torch.from_numpy(dev[0].reshape(-1, TILE_WIDTH)[:1]).float(), temporary, input_names=["tiles"], output_names=["probs"], dynamic_axes={"tiles": {0: "n"}, "probs": {0: "n"}}, opset_version=17, external_data=False, dynamo=False)
            os.replace(temporary, model_path)
        parity = validate_export(model_path, result["model"], dev[0]) if model_path.exists() else None
        elapsed = time.monotonic() - started
        if elapsed > float(run["maxSeconds"]):
            raise FeasibilityError("run wall-time ceiling reached")
        atomic_json(run_dir / "run-report.json", {"schema": 1, "status": result["status"], "run": args.run, "seed": run["seed"], "updates": result["updates"], "elapsedSeconds": elapsed, "dataLock": lock, "curves": result["curves"], "bestEpoch": result.get("bestEpoch"), "bestScore": result.get("bestScore"), "modelSha256": sha256(model_path) if model_path.exists() else None, "parity": parity, "recovery": recovery, "recoveryEquivalent": bool(recovery and recovery.get("performed") is True and recovery.get("equivalent") is True)})
        ledger_finish(ledger, args.run, "completed" if result["status"] == "completed" else "failed")
        print(json.dumps({"status": result["status"], "updates": result["updates"], "bestEpoch": result.get("bestEpoch")}))
        return 0 if result["status"] == "completed" else 1
    except (FeasibilityError, OSError, RuntimeError, ValueError) as error:
        if "ledger" in locals() and "reservation" in locals() and reservation.get("status") == "reserved":
            try:
                ledger_finish(ledger, args.run, "failed")
            except (FeasibilityError, OSError, json.JSONDecodeError):
                pass
        print(f"feasibility training failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
