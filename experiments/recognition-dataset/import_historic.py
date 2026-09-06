"""Import the already-reviewed public historical pilot into the modern manifest.

This is a byte-preserving adapter only: it does not re-render, relabel or run
recognition.  It intentionally accepts only the pilot's public-a/b/c source
records and only records marked accepted in the frozen final manifest.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent
OLD_MANIFEST = ROOT / "work" / "manifest-final.json"
OLD_CROPS = ROOT / "work" / "crops"
OUT = ROOT / "work" / "modern"
PUBLIC_SOURCES = {"public-a", "public-b", "public-c"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def publish(path: Path, data: bytes) -> None:
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError("symlink output rejected")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("existing output differs")
        return
    fd, staged = tempfile.mkstemp(prefix=".historic-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.link(staged, path)
    finally:
        os.unlink(staged)


def read_json(path: Path) -> dict:
    if path.is_symlink() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("unsafe manifest")
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict): raise ValueError("object manifest required")
    return value


def proposal_hash(row: dict) -> str:
    value = {key: row.get(key) for key in ("id", "sourceId", "page", "rect", "placement", "orientation", "kind", "family", "split", "tags", "proposal")}
    return sha256((json.dumps(value, indent=2, sort_keys=True) + "\n").encode())


def import_records(manifest_path: Path = OLD_MANIFEST, crops: Path = OLD_CROPS, output: Path = OUT) -> dict:
    manifest = read_json(manifest_path)
    if manifest.get("schema") != 1 or not isinstance(manifest.get("records"), list):
        raise ValueError("unexpected frozen pilot manifest")
    records = []
    for old in manifest["records"]:
        if old.get("sourceId") not in PUBLIC_SOURCES or old.get("kind") != "board":
            continue
        decision_dir = manifest_path.parent / "decisions-final"
        decision_files = list(decision_dir.glob(f"{old.get('id', '')}-*.json")) if decision_dir.is_dir() else []
        decision_ok = any(read_json(path).get("decision") == "accepted" for path in decision_files)
        if not (old.get("reviewRecommendation") == "accepted" or decision_ok) or old.get("orientation") not in {"white-bottom", "black-bottom"}:
            continue
        old_id = old.get("id")
        if not isinstance(old_id, str) or not old_id.startswith(("public-a-", "public-b-", "public-c-")):
            raise ValueError("unexpected public pilot id")
        crop_path = crops / f"{old_id}.png"
        crop = crop_path.read_bytes()
        if sha256(crop) != old.get("cropSha256"):
            raise ValueError(f"pilot crop hash mismatch: {old_id}")
        new_id = f"historic-{old_id}"
        publish(output / "crops" / f"{new_id}.png", crop)
        record = {
            "id": new_id,
            "sourceId": f"historic-{old['sourceId']}",
            "page": old["page"],
            "rect": old["rect"],
            "placement": old["placement"],
            "orientation": old["orientation"],
            "kind": "board",
            "family": "historic-unresolved-typefoundry",
            "split": "train",
            "tags": [*old.get("tags", []), "historic-public-pilot", "lineage-unresolved"],
            "proposal": old["proposal"],
            "review": {"reviewer": "pilot-final-review", "type": "agent-assisted", "all64": True, "geometry": True, "status": "accepted"},
            "cropSha256": sha256(crop),
            "proposalSha256": proposal_hash({"id": new_id, "sourceId": f"historic-{old['sourceId']}", "page": old["page"], "rect": old["rect"], "placement": old["placement"], "orientation": old["orientation"], "kind": "board", "family": "historic-unresolved-typefoundry", "split": "train", "tags": [*old.get("tags", []), "historic-public-pilot", "lineage-unresolved"], "proposal": old["proposal"]}),
            "pageSha256": old["pageSha256"],
            "sourceSha256": old["sourceSha256"],
            "provenance": {"manifest": str(manifest_path.name), "originalId": old_id, "originalCrop": str(crop_path.name)},
        }
        records.append(record)
    if len(records) != 12:
        raise ValueError(f"expected 12 accepted public pilot boards, got {len(records)}")
    result = {"schema": 1, "role": "training-candidate", "source": "frozen-public-pilot", "records": records}
    output.mkdir(parents=True, exist_ok=True)
    target = output / "proposals-historic.json"
    payload = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    publish(target, payload)
    return {"records": len(records), "manifest": str(target), "bytes": sum(len((output / "crops" / f"historic-{r['provenance']['originalId']}.png").read_bytes()) for r in records)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--manifest", type=Path, default=OLD_MANIFEST); parser.add_argument("--crops", type=Path, default=OLD_CROPS); parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args(); print(json.dumps(import_records(args.manifest, args.crops, args.output), sort_keys=True))
