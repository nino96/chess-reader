"""Validated loader for generated TileNet vectors.

Reports deliberately retain hashes and aggregate counts only. They never copy
board identifiers, input paths, FENs, or per-board class sequences.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np


Split = Literal["train", "dev", "test"]
VALID_SPLITS: frozenset[str] = frozenset(("train", "dev", "test"))
TILES_PER_BOARD = 64
TILE_VALUES = 1024
CLASS_COUNT = 13


class DatasetError(ValueError):
    """Raised for a malformed, altered, or incompatible generated corpus."""


@dataclass(frozen=True)
class Dataset:
    split: Split
    vectors: np.ndarray
    labels: np.ndarray
    vector_sha256: str
    labels_sha256: str
    manifest_sha256: str
    generator_sha256: str
    source_lock_sha256: str
    families: frozenset[str]
    board_count: int


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _object(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DatasetError(f"{name} must be an object")
    return cast(dict[str, Any], value)


def _integer(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise DatasetError(f"{name} must be an integer")
    return value


def _sha256(value: object, name: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise DatasetError(f"{name} must be a lowercase SHA-256 hex string")
    return value


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return _object(json.loads(path.read_text(encoding="utf-8")), path.name)
    except (OSError, json.JSONDecodeError) as error:
        raise DatasetError(f"unable to read {path.name}") from error


def _artifact(manifest: dict[str, Any], split: Split, name: str) -> dict[str, Any]:
    artifacts = _object(manifest.get("artifacts"), "manifest.artifacts")
    split_artifacts = _object(artifacts.get(split), f"manifest.artifacts.{split}")
    return _object(split_artifacts.get(name), f"manifest.artifacts.{split}.{name}")


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if _integer(manifest.get("schemaVersion"), "manifest.schemaVersion") != 1:
        raise DatasetError("unsupported dataset manifest schema")
    for required in ("sources", "generator", "splits", "artifacts", "exclusions"):
        if required not in manifest:
            raise DatasetError(f"manifest missing {required}")
    _object(manifest["sources"], "manifest.sources")
    generator = _object(manifest["generator"], "manifest.generator")
    _sha256(generator.get("sha256"), "manifest.generator.sha256")
    generator_lock = _object(manifest.get("generatorLock"), "manifest.generatorLock")
    _sha256(generator_lock.get("sha256"), "manifest.generatorLock.sha256")
    _object(manifest["splits"], "manifest.splits")
    exclusions = manifest["exclusions"]
    if not isinstance(exclusions, list) or not any(isinstance(value, str) and "corpus/v1" in value for value in exclusions):
        raise DatasetError("manifest must explicitly exclude corpus v1")


def _verify_artifact(path: Path, record: dict[str, Any], expected_bytes: int | None = None) -> str:
    expected_hash = _sha256(record.get("sha256"), "artifact.sha256")
    expected_length = _integer(record.get("byteLength"), "artifact.byteLength")
    if expected_bytes is not None and expected_length != expected_bytes:
        raise DatasetError("manifest artifact byte length disagrees with the declared shape")
    try:
        actual_length = path.stat().st_size
    except OSError as error:
        raise DatasetError("required dataset artifact is unavailable") from error
    if actual_length != expected_length:
        raise DatasetError("dataset artifact byte length does not match its manifest")
    actual_hash = sha256_file(path)
    if actual_hash != expected_hash:
        raise DatasetError("dataset artifact SHA-256 does not match its manifest")
    return actual_hash


def _parse_labels(path: Path, split: Split) -> tuple[np.ndarray, frozenset[str], set[str]]:
    root = _read_json(path)
    if _integer(root.get("schemaVersion"), "labels.schemaVersion") != 1:
        raise DatasetError("unsupported labels schema")
    if root.get("split") != split:
        raise DatasetError("labels split does not match the requested split")
    boards = root.get("boards")
    if not isinstance(boards, list) or not boards:
        raise DatasetError("labels.boards must be a non-empty array")
    ids: set[str] = set()
    families: set[str] = set()
    values: list[list[int]] = []
    for index, raw_board in enumerate(boards):
        board = _object(raw_board, f"labels.boards[{index}]")
        board_id = board.get("id")
        family = board.get("family")
        labels = board.get("labels")
        if not isinstance(board_id, str) or not board_id or board_id in ids:
            raise DatasetError("board ids must be non-empty and unique")
        if not isinstance(family, str) or not family:
            raise DatasetError("board family must be a non-empty string")
        if not isinstance(labels, list) or len(labels) != TILES_PER_BOARD:
            raise DatasetError("each board must have exactly 64 labels")
        parsed = [_integer(item, "tile label") for item in labels]
        if any(item < 0 or item >= CLASS_COUNT for item in parsed):
            raise DatasetError("tile labels must be in the inclusive range 0..12")
        ids.add(board_id)
        families.add(family)
        values.append(parsed)
    return np.asarray(values, dtype=np.int64), frozenset(families), ids


def load_split(data_dir: Path, split: Split) -> Dataset:
    """Load a hash-verified split without revealing its board-level contents."""

    if split not in VALID_SPLITS:
        raise DatasetError("unknown dataset split")
    # Corpus v1 is historical regression evidence only. Refusing this path at
    # the boundary makes it impossible to use it accidentally as a split.
    if "corpus" in data_dir.parts and "v1" in data_dir.parts:
        raise DatasetError("corpus v1 cannot be used for training or development splits")
    manifest_path = data_dir / "dataset-manifest.json"
    manifest = _read_json(manifest_path)
    manifest_sha256 = sha256_file(manifest_path)
    _validate_manifest(manifest)
    vector_path = data_dir / f"{split}.vectors.f32le"
    labels_path = data_dir / f"{split}.labels.json"
    labels, families, _ = _parse_labels(labels_path, split)
    board_count = len(labels)
    expected_bytes = board_count * TILES_PER_BOARD * TILE_VALUES * np.dtype("<f4").itemsize
    vector_record = _artifact(manifest, split, "vectors")
    labels_record = _artifact(manifest, split, "labels")
    if vector_record.get("path") != vector_path.name or labels_record.get("path") != labels_path.name:
        raise DatasetError("manifest artifact paths do not match the fixed split contract")
    shape = vector_record.get("shape")
    if shape != [board_count, TILES_PER_BOARD, TILE_VALUES]:
        raise DatasetError("manifest vector shape does not match labels")
    vector_hash = _verify_artifact(vector_path, vector_record, expected_bytes)
    labels_hash = _verify_artifact(labels_path, labels_record)
    vectors = np.fromfile(vector_path, dtype="<f4")
    if vectors.size != board_count * TILES_PER_BOARD * TILE_VALUES:
        raise DatasetError("vector file does not contain the declared float32 tensor")
    vectors = vectors.reshape(board_count, TILES_PER_BOARD, TILE_VALUES)
    if not np.isfinite(vectors).all() or (vectors < 0).any() or (vectors > 1).any():
        raise DatasetError("vectors must be finite normalized float32 values in [0, 1]")
    generator = _object(manifest["generator"], "manifest.generator")
    generator_lock = _object(manifest["generatorLock"], "manifest.generatorLock")
    return Dataset(split, vectors, labels, vector_hash, labels_hash, manifest_sha256, _sha256(generator.get("sha256"), "manifest.generator.sha256"), _sha256(generator_lock.get("sha256"), "manifest.generatorLock.sha256"), families, board_count)


def subset_first(dataset: Dataset, boards: int) -> Dataset:
    """Use the predeclared initial board prefix for the fixed-size CUDA pilot."""

    if boards <= 0 or boards > dataset.board_count:
        raise DatasetError("requested pilot prefix is outside the validated split")
    vectors = dataset.vectors[:boards].copy()
    labels = dataset.labels[:boards].copy()
    return Dataset(
        dataset.split,
        vectors,
        labels,
        hashlib.sha256(vectors.astype("<f4", copy=False).tobytes()).hexdigest(),
        hashlib.sha256(labels.astype("<i8", copy=False).tobytes()).hexdigest(),
        dataset.manifest_sha256,
        dataset.generator_sha256,
        dataset.source_lock_sha256,
        dataset.families,
        boards,
    )


def validate_family_partitions(data_dir: Path) -> dict[str, int]:
    """Verify all split identities and families before a protocol freeze.

    This is intentionally separate from training so a normal train command
    never loads a held-out test tensor before candidate freeze.
    """

    loaded = [load_split(data_dir, cast(Split, split)) for split in ("train", "dev", "test")]
    family_sets = [dataset.families for dataset in loaded]
    if family_sets[0] & family_sets[1] or family_sets[0] & family_sets[2] or family_sets[1] & family_sets[2]:
        raise DatasetError("whole style families must be disjoint across train, dev, and test")
    return {dataset.split: dataset.board_count for dataset in loaded}
