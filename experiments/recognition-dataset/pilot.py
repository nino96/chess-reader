"""Offline, selected-page dataset preparation. No inference or training entry point."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
MANIFEST_NAME = "manifest.json"
REVIEW_DIR = "review"
DECISION_DIR = "decisions"
REVIEW_PAGE = "review.html"
Image.MAX_IMAGE_PIXELS = 10_000_000
ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
PIECES = "KQRBNPkqrbnp"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def read_json(path: Path):
    if path.is_symlink() or path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("unsafe JSON input")
    return json.loads(path.read_bytes())


def safe_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("invalid opaque identifier")
    return value


def publish(path: Path, data: bytes):
    """Atomic no-replace publication; identical replay is permitted."""
    if any(parent.is_symlink() for parent in path.parents):
        raise ValueError("symlink output directory rejected")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("symlink output rejected")
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("existing output differs; use a new version")
        return
    fd, name = tempfile.mkstemp(prefix=".stage-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.link(name, path)
    finally:
        os.unlink(name)


def placement_cells(value):
    if not isinstance(value, str) or len(value) > 71:
        raise ValueError("invalid placement")
    ranks = value.split("/")
    if len(ranks) != 8:
        raise ValueError("placement must contain eight ranks")
    cells = []
    for rank in ranks:
        expanded = []
        for char in rank:
            if char in "12345678":
                expanded.extend("." * int(char))
            elif char in PIECES:
                expanded.append(char)
            else:
                raise ValueError("unknown placement class")
        if len(expanded) != 8:
            raise ValueError("rank must contain eight squares")
        cells.extend(expanded)
    return cells


def validate_rect(rect, size):
    if not isinstance(rect, list) or len(rect) != 4 or any(type(v) is not int for v in rect):
        raise ValueError("rectangle requires four integer pixels")
    x, y, width, height = rect
    if min(x, y) < 0 or min(width, height) < 8 or x + width > size[0] or y + height > size[1]:
        raise ValueError("rectangle outside page")
    return tuple(rect)


def validate_splits(records):
    """Fail closed on transitive lineage, duplicate pixels/positions and exposure."""
    seen = {}
    for row in records:
        role = row.get("split")
        if role not in {"train", "dev", "qualification", "clean-regression", "diagnostic"}:
            raise ValueError("invalid split")
        if role == "qualification" and row.get("exposed", True):
            raise ValueError("exposed sample cannot be qualification")
        if role != "diagnostic" and row.get("lineageStatus") != "reviewed":
            raise ValueError("unresolved lineage cannot enter a learning split")
        for field in ("workGroup", "editionGroup", "lineageGroup", "imageSha256", "positionGroup", "sequenceGroup"):
            value = row.get(field)
            if not isinstance(value, str) or not value:
                raise ValueError("missing split identity")
            key = (field, value)
            # Clean regression may share the reserved evaluation component but never train.
            compatible = {role, seen.get(key, role)}
            if len(compatible) > 1 and compatible != {"clean-regression", "qualification"}:
                raise ValueError("cross-split source or duplicate leakage")
            seen[key] = role


def catalog_and_lock():
    from intake import verify as verify_intake
    catalog = read_json(ROOT / "sources.json")
    sources = {safe_id(row["id"]): row for row in catalog["sources"]}
    lock = verify_intake(ROOT)
    return sources, lock


def proposal_hash(row):
    return digest(json_bytes({"placement": row.get("placement"),
                              "proposal": row.get("proposal", {"method": "unlabeled"}),
                              "orientation": row.get("orientation")}))


def png_bytes(image):
    from io import BytesIO
    stream = BytesIO()
    image.save(stream, format="PNG", optimize=False)
    return stream.getvalue()


def render():
    sources, lock = catalog_and_lock()
    selected = read_json(ROOT / "pilot-pages.json")
    jobs = [(row["sourceId"], page) for row in selected["sources"] for page in row["pages"]]
    if len(jobs) > 36 or len(set(jobs)) != len(jobs):
        raise ValueError("page budget or duplicate page violation")
    started = time.monotonic()
    rows = []
    for sid, page in jobs:
        if sid not in sources or type(page) is not int or page < 1 or page > 1000:
            raise ValueError("invalid selected page")
        if time.monotonic() - started > 570:
            raise ValueError("rasterization budget exhausted")
        with tempfile.TemporaryDirectory(prefix="chess-page-") as temp:
            prefix = Path(temp) / "page"
            subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile",
                            "-scale-to", "1800", "-png", str(ROOT / "cache" / f"{sid}.pdf"),
                            str(prefix)], check=True, timeout=30, capture_output=True)
            with Image.open(prefix.with_suffix(".png")) as decoded:
                if decoded.width * decoded.height > 10_000_000:
                    raise ValueError("page pixel cap")
                data = png_bytes(decoded.convert("RGB"))
                size = list(decoded.size)
            name = f"{sid}-p{page:04}.png"
            publish(WORK / "pages" / name, data)
            rows.append({"sourceId": sid, "page": page, "image": name,
                         "size": size, "sha256": digest(data),
                         "sourceSha256": lock["sources"][sid]["originalSha256"]})
    publish(WORK / "pages.json", json_bytes({"schema": 1, "pages": rows}))
    contact(rows)
    print(json.dumps({"pages": len(rows), "elapsedSeconds": round(time.monotonic() - started, 3)}))


def contact(rows):
    for sid in sorted({r["sourceId"] for r in rows}):
        group = [r for r in rows if r["sourceId"] == sid]
        sheet = Image.new("RGB", (1200, math.ceil(len(group) / 4) * 500), "white")
        draw = ImageDraw.Draw(sheet)
        for index, row in enumerate(group):
            image = Image.open(WORK / "pages" / row["image"]).convert("RGB")
            image.thumbnail((290, 470))
            x, y = (index % 4) * 300, (index // 4) * 500
            sheet.paste(image, (x, y + 22))
            draw.text((x + 5, y + 3), f"{sid} / PDF page {row['page']}", fill="black")
        publish(WORK / "review" / f"{sid}-pages.png", png_bytes(sheet))


def extract():
    sources, _ = catalog_and_lock()
    pages = {(row["sourceId"], row["page"]): row for row in read_json(WORK / "pages.json")["pages"]}
    regions = read_json(WORK / "regions.json")
    rows = regions["regions"]
    if len(rows) > 24 or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("region budget or duplicate id violation")
    manifests = []
    for row in rows:
        rid = safe_id(row["id"])
        sid = safe_id(row["sourceId"])
        if sid not in sources or row["kind"] not in {"board", "negative", "partial"}:
            raise ValueError("unknown source or region kind")
        page = pages[(sid, row["page"])]
        page_data = (WORK / "pages" / page["image"]).read_bytes()
        if digest(page_data) != page["sha256"]:
            raise ValueError("page changed after extraction")
        image = Image.open(WORK / "pages" / page["image"]).convert("RGB")
        x, y, width, height = validate_rect(row["rect"], image.size)
        crop = image.crop((x, y, x + width, y + height))
        native = png_bytes(crop)
        publish(WORK / "crops" / f"{rid}.png", native)
        cell_values = placement_cells(row["placement"]) if row.get("placement") else None
        if row["kind"] == "board" and row.get("orientation") not in {"white-bottom", "black-bottom", "unknown"}:
            raise ValueError("orientation must be explicit")
        proposal = row.get("proposal", {"method": "unlabeled"})
        if proposal.get("method") not in {"manual-visual", "notation", "model", "unlabeled"}:
            raise ValueError("unknown proposal method")
        if proposal.get("method") == "model" and not all(proposal.get(k) for k in ("modelSha256", "preprocessSha256")):
            raise ValueError("model proposal must identify exact inputs")
        tensors = Image.new("L", (256, 256), 255)
        for rank in range(8):
            for file in range(8):
                tile = crop.crop((round(file * width / 8), round(rank * height / 8),
                                  round((file + 1) * width / 8), round((rank + 1) * height / 8)))
                # Diagnostic serialization only; not claimed to be FENShot preprocessing.
                tensors.paste(tile.convert("L").resize((32, 32), Image.Resampling.BILINEAR), (file * 32, rank * 32))
        if row["kind"] == "board":
            publish(WORK / "tensors" / f"{rid}.png", png_bytes(tensors))
        degraded = crop.resize((max(8, width // 2), max(8, height // 2)), Image.Resampling.BILINEAR)
        degraded = degraded.resize(crop.size, Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(0.45))
        publish(WORK / "degraded" / f"{rid}.png", png_bytes(degraded))
        sheet = Image.new("RGB", (1280, 710), "white")
        draw = ImageDraw.Draw(sheet)
        middle = tensors if row["kind"] == "board" else crop.convert("L")
        middle_title = "32px grayscale tiles" if row["kind"] == "board" else "Grayscale; no board tensor"
        for px, target, title in ((10, crop, "Native crop"), (440, middle, middle_title),
                                  (870, degraded, "Illustrative downsample + blur")):
            preview = target.convert("RGB")
            if row["kind"] == "board":
                preview = preview.resize((400, 400), Image.Resampling.NEAREST)
            else:
                preview.thumbnail((400, 400), Image.Resampling.NEAREST)
            sheet.paste(preview, (px, 35))
            draw.text((px, 10), f"{rid}: {title}", fill="black")
        for index in range(9 if row["kind"] == "board" else 0):
            position = 35 + index * 50
            draw.line((10, position, 410, position), fill="#d94b20", width=1)
            draw.line((10 + index * 50, 35, 10 + index * 50, 435), fill="#d94b20", width=1)
        if cell_values:
            shown = cell_values if row["orientation"] == "white-bottom" else list(reversed(cell_values))
            for rank in range(8):
                draw.text((20, 455 + rank * 26), "  ".join(shown[rank * 8:rank * 8 + 8]), fill="black")
            draw.text((440, 455), "Uppercase white; lowercase black; dot empty. Proposal, not truth.", fill="black")
        publish(WORK / REVIEW_DIR / f"{rid}.png", png_bytes(sheet))
        record = {**row, "cropSha256": digest(native), "pageSha256": page["sha256"],
                  "proposalSha256": proposal_hash(row),
                  "sourceSha256": page["sourceSha256"], "exposed": True, "split": "diagnostic"}
        manifests.append(record)
    publish(WORK / MANIFEST_NAME, json_bytes({"schema": 1, "records": manifests}))
    body = "".join(f'<section><h2>{html.escape(r["id"])}</h2><img width="1280" src="{REVIEW_DIR}/{r["id"]}.png" alt="Native crop, grid, tensor and degradation review"></section>' for r in manifests)
    publish(WORK / REVIEW_PAGE, ("<!doctype html><meta charset=utf-8><meta http-equiv=Content-Security-Policy content=\"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'\"><title>Public dataset pilot review</title><h1>Public pilot: diagnostic, not qualification</h1>" + body).encode())
    print(json.dumps({"regions": len(manifests), "status": "proposed-only"}))


def review(rid, reviewer, decision):
    rid, reviewer = safe_id(rid), safe_id(reviewer)
    if decision not in {"accepted", "quarantined"}:
        raise ValueError("explicit review decision required")
    rows = read_json(WORK / MANIFEST_NAME)["records"]
    row = next(r for r in rows if r["id"] == rid)
    if digest((WORK / "crops" / f"{rid}.png").read_bytes()) != row["cropSha256"]:
        raise ValueError("stale image review")
    if proposal_hash(row) != row["proposalSha256"]:
        raise ValueError("stale proposal review")
    if decision == "accepted" and row["kind"] == "board":
        placement_cells(row.get("placement"))
        if row.get("orientation") not in {"white-bottom", "black-bottom"}:
            raise ValueError("unknown orientation must be quarantined")
    result = {"schema": 1, "id": rid, "reviewer": reviewer, "decision": decision,
              "all64SquaresReviewed": decision == "accepted" and row["kind"] == "board",
              "geometryReviewed": True, "cropSha256": row["cropSha256"],
              "proposalSha256": row["proposalSha256"]}
    publish(WORK / DECISION_DIR / f"{rid}-{reviewer}.json", json_bytes(result))


def verify():
    sources, _ = catalog_and_lock()
    rows = read_json(WORK / MANIFEST_NAME)["records"]
    accepted, quarantined, pending = 0, 0, 0
    for row in rows:
        rid = safe_id(row["id"])
        if digest((WORK / "crops" / f"{rid}.png").read_bytes()) != row["cropSha256"]:
            raise ValueError("crop integrity mismatch")
        if row["sourceId"] not in sources:
            raise ValueError("unregistered source")
        if proposal_hash(row) != row["proposalSha256"]:
            raise ValueError("proposal content changed")
        decisions = [read_json(path) for path in sorted((WORK / DECISION_DIR).glob(f"{rid}-*.json"))]
        for decision in decisions:
            if any(decision[key] != row[key] for key in ("cropSha256", "proposalSha256")):
                raise ValueError("stale label decision")
            if decision.get("geometryReviewed") is not True:
                raise ValueError("geometry review required")
            if decision.get("decision") == "accepted" and row["kind"] == "board":
                if decision.get("all64SquaresReviewed") is not True:
                    raise ValueError("all-square review required")
                if row.get("orientation") not in {"white-bottom", "black-bottom"}:
                    raise ValueError("accepted orientation must be known")
        if not decisions:
            pending += 1
        elif any(d["decision"] == "quarantined" for d in decisions):
            quarantined += 1
        elif all(d["decision"] == "accepted" for d in decisions):
            if row["kind"] == "board":
                placement_cells(row["placement"])
            accepted += 1
        else:
            raise ValueError("unknown review state")
    result = {"schema": 1, "acceptedRegions": accepted, "quarantinedRegions": quarantined,
              "pendingRegions": pending, "trainingReady": False, "qualificationFrozen": False,
              "reason": "Pilot exposed; source lineage and full coverage gates remain pending"}
    print(json.dumps(result))
    return result


def main():
    global MANIFEST_NAME, REVIEW_DIR, DECISION_DIR, REVIEW_PAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["render", "extract", "review", "verify"])
    parser.add_argument("--id")
    parser.add_argument("--reviewer")
    parser.add_argument("--decision", choices=["accepted", "quarantined"])
    parser.add_argument("--revision", help="New explicit review revision; prior outputs remain immutable")
    args = parser.parse_args()
    if args.revision:
        revision = safe_id(args.revision)
        MANIFEST_NAME = f"manifest-{revision}.json"
        REVIEW_DIR = f"review-{revision}"
        DECISION_DIR = f"decisions-{revision}"
        REVIEW_PAGE = f"review-{revision}.html"
    if WORK.is_symlink() or (ROOT / "cache").is_symlink():
        raise ValueError("symlink workspace rejected")
    if args.command == "render":
        render()
    elif args.command == "extract":
        extract()
    elif args.command == "review":
        review(args.id, args.reviewer, args.decision)
    else:
        verify()


if __name__ == "__main__":
    main()
