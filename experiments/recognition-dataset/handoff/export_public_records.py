"""Export public-safe JSON annotations without exporting image/data payloads."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work" / "modern"
OUT = ROOT / "handoff" / "records"
FILES = (
    "proposals-wikibooks.json", "proposals-historic.json", "proposals-ctan-v4.json", "proposals-mpchess-v6.json",
    "review-decisions.json", "manifest.json", "pages.json", "preprocess-manifest.json", "coverage.json",
    "dataset/dataset-lock.json", "dataset/train.metadata.json", "dataset/dev.metadata.json", "reserved/held-out.metadata.json",
)
ALLOWED = {"wikibooks-chess", "ctan-chessboard", "ctan-mpchess", "historic-public-a", "historic-public-b", "historic-public-c", "frozen-public-pilot"}


def digest(data: bytes) -> str: return hashlib.sha256(data).hexdigest()


def validate_public(value: Any, key: str = "", enforce_sources: bool = True) -> None:
    if isinstance(value, dict):
        for name, item in value.items():
            if name.lower() in {"pdf", "imagebytes", "content", "fulltext"}: raise ValueError(f"payload field is not metadata: {name}")
            validate_public(item, name, enforce_sources)
    elif isinstance(value, list):
        for item in value: validate_public(item, key, enforce_sources)
    elif isinstance(value, str):
        allowed = ALLOWED if enforce_sources else ALLOWED | {"chess-puzzles", "plos-optimal-forgetting"}
        if key.lower() in {"sourceid", "source"} and value not in allowed:
            raise ValueError(f"source is outside public allowlist: {value}")
        if key.lower() in {"filename", "image", "path", "tensorpath"} and (value.startswith("/") or ".." in Path(value).parts):
            raise ValueError("unsafe metadata path")
        if any(marker in value.lower() for marker in ("/home/", "/root/", "private", "secret", "password")):
            raise ValueError("sensitive path or secret in metadata")


def safe(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('unsafe snapshot path')
    path = root / name
    if any(p.is_symlink() for p in [path, *path.parents]): raise ValueError('symlink snapshot path')
    return path


def publish(path: Path, payload: bytes) -> None:
    safe(path.parent, path.name)
    if path.exists():
        if path.read_bytes() != payload: raise ValueError('immutable snapshot differs')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.snapshot-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload); stream.flush(); os.fsync(stream.fileno())
        os.link(name, path)
    finally:
        os.unlink(name)


def build_index(source_root: Path, destination: Path) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for relative in FILES:
        source = safe(source_root, relative)
        if not source.is_file() or source.stat().st_size > 16*1024*1024: raise ValueError(f"metadata input missing or oversized: {relative}")
        value = json.loads(source.read_text(encoding="utf-8")); validate_public(value, enforce_sources=relative != "pages.json")
        payload = source.read_bytes()
        target = safe(destination, relative)
        publish(target, payload)
        entries.append({"original": f"work/modern/{relative}", "snapshot": relative, "sha256": digest(payload), "bytes": len(payload)})
    index = {"schema": 1, "kind": "public-metadata-only", "records": entries, "imagesPdfsTensorsWeights": False}
    publish(safe(destination, 'index.json'), (json.dumps(index, indent=2, sort_keys=True) + "\n").encode())
    return index


def verify_index(source_root: Path | None, destination: Path) -> dict[str, Any]:
    index_path = safe(destination, 'index.json')
    if index_path.stat().st_size > 1024*1024: raise ValueError('oversized snapshot index')
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("schema") != 1 or index.get("imagesPdfsTensorsWeights") is not False: raise ValueError("invalid handoff index")
    records = index.get('records')
    if not isinstance(records, list) or len(records) != len(FILES) or {r.get('snapshot') for r in records} != set(FILES): raise ValueError('snapshot membership differs')
    for item in records:
        relative = item['snapshot']
        if item.get('original') != 'work/modern/' + relative: raise ValueError('snapshot restore mapping differs')
        if not isinstance(item.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}',item['sha256']): raise ValueError('invalid snapshot digest')
        snapshot = safe(destination, relative)
        if type(item.get('bytes')) is not int or not 0 < item['bytes'] <= 16*1024*1024 or snapshot.stat().st_size != item['bytes']: raise ValueError('snapshot size mismatch')
        if digest(snapshot.read_bytes()) != item["sha256"]: raise ValueError(f"snapshot hash mismatch: {item['snapshot']}")
        validate_public(json.loads(snapshot.read_bytes()), enforce_sources=relative != 'pages.json')
        if source_root is not None:
            source = safe(source_root, relative)
            if digest(source.read_bytes()) != item["sha256"]: raise ValueError(f"source hash mismatch: {item['snapshot']}")
    return {"files": len(index["records"]), "bytes": sum(item["bytes"] for item in index["records"])}


def restore(index_dir: Path, work_root: Path) -> dict[str, Any]:
    if work_root.name != "modern" or work_root.parent.name != "work": raise ValueError("restore target must be an ignored work/modern directory")
    verify_index(None, index_dir)
    index = json.loads((index_dir / "index.json").read_text(encoding="utf-8")); count = 0
    pending = []
    for item in index["records"]:
        relative = Path(item["original"]).relative_to("work/modern")
        destination = safe(work_root, str(relative))
        payload = safe(index_dir, item['snapshot']).read_bytes()
        if digest(payload) != item["sha256"]: raise ValueError("handoff snapshot changed")
        if destination.exists() and destination.read_bytes() != payload: raise ValueError(f"restore conflict: {relative}")
        pending.append((destination, payload))
    for destination, payload in pending:
        publish(destination, payload)
        count += 1
    return {"restored": count}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--verify", action="store_true"); parser.add_argument("--restore", action="store_true"); parser.add_argument('--compare-workspace', action='store_true')
    args = parser.parse_args()
    if args.restore: print(json.dumps(restore(OUT, WORK), sort_keys=True))
    elif args.verify: print(json.dumps(verify_index(WORK if args.compare_workspace else None, OUT), sort_keys=True))
    else: print(json.dumps(build_index(WORK, OUT), sort_keys=True))
