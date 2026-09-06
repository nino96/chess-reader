"""Bounded extraction for the source-diverse modern-document collection.

This module deliberately does not acquire sources or infer labels.  A catalog
may only name an explicitly approved local PDF, and regions are proposals
until a review record binds their image and proposal hashes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import re
from io import BytesIO

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
DEFAULT_CATALOG = ROOT / "modern-sources.json"
DEFAULT_REGIONS = ROOT / "work" / "modern" / "regions.json"
DEFAULT_WORK = ROOT / "work" / "modern"
MAX_PAGES = 180
MAX_REGIONS = 500
MAX_PAGE_SECONDS = 30
MAX_TOTAL_SECONDS = 1200
MAX_LONG_EDGE = 2400
MAX_PIXELS = 10_000_000
PIECES = set("KQRBNPkqrbnp")
SPLITS = {"train", "dev", "held-out", "clean-regression", "diagnostic"}
ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def publish(path: Path, data: bytes) -> None:
    """Publish atomically, permitting only an identical replay."""
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError("symlink output rejected")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("existing output differs; choose a new revision")
        return
    fd, staged = tempfile.mkstemp(prefix=".modern-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(staged, path)
    finally:
        os.unlink(staged)


def read_json(path: Path) -> dict:
    if path.is_symlink() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("unsafe JSON input")
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value


def placement_cells(value: str) -> list[str]:
    if not isinstance(value, str) or len(value) > 71:
        raise ValueError("invalid image-relative placement")
    cells: list[str] = []
    for rank in value.split("/"):
        row: list[str] = []
        for char in rank:
            if char in "12345678":
                row.extend("." * int(char))
            elif char in PIECES:
                row.append(char)
            else:
                raise ValueError("unknown piece class")
        if len(row) != 8:
            raise ValueError("placement rank is not eight squares")
        cells.extend(row)
    if len(cells) != 64:
        raise ValueError("placement is not eight ranks")
    return cells


def validate_rect(rect: object, size: tuple[int, int]) -> tuple[int, int, int, int]:
    if not isinstance(rect, list) or len(rect) != 4 or any(type(v) is not int for v in rect):
        raise ValueError("rectangle requires four integer pixels")
    x, y, width, height = rect
    if x < 0 or y < 0 or width < 8 or height < 8 or x + width > size[0] or y + height > size[1]:
        raise ValueError("rectangle outside page")
    return x, y, width, height


def canonical_proposal(row: dict) -> dict:
    return {key: row.get(key) for key in ("id", "sourceId", "page", "rect", "placement", "orientation", "kind", "family", "split", "tags", "proposal")}


def validate_catalog(catalog: dict, root: Path = ROOT) -> dict[str, dict]:
    rows = catalog.get("sources")
    if not isinstance(rows, list) or not rows:
        raise ValueError("modern catalog has no sources")
    out: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not ID.fullmatch(row["id"]) or row["id"] in out:
            raise ValueError("invalid or duplicate source id")
        if row.get("rights", {}).get("acquisition") != "approved":
            raise ValueError("source is not approved for this extraction")
        path = Path(row.get("path", row.get("filename", "")))
        if not path.is_absolute():
            path = (root / "cache" / "modern" / path).resolve()
        else:
            path = path.resolve()
        allowed = (root / "cache" / "modern").resolve()
        if allowed not in path.parents:
            raise ValueError("source path is outside approved modern cache")
        if any(parent.is_symlink() for parent in [path, *path.parents]) or not path.is_file():
            raise ValueError("approved source PDF is missing or symlinked")
        if path.suffix.lower() != ".pdf":
            raise ValueError("approved source must be PDF")
        expected = row.get("sha256", row.get("expectedSha256"))
        if not isinstance(expected, str) or len(expected) != 64 or sha256(path.read_bytes()) != expected:
            raise ValueError("approved source hash is required and must match")
        out[row["id"]] = {**row, "path": path}
    return out


def validate_region(row: dict, pages: dict[tuple[str, int], dict], sources: dict[str, dict], work: Path = DEFAULT_WORK) -> None:
    if not isinstance(row.get("id"), str) or not ID.fullmatch(row["id"]) or row.get("sourceId") not in sources:
        raise ValueError("invalid region identity")
    key = (row["sourceId"], row.get("page"))
    if key not in pages or row.get("kind") not in {"board", "negative", "partial"}:
        raise ValueError("region page or kind is not admitted")
    if row.get("split") not in SPLITS:
        raise ValueError("invalid region split")
    if row.get("orientation") not in {"white-bottom", "black-bottom", "unknown"}:
        raise ValueError("invalid orientation")
    placement = row.get("placement")
    if row["kind"] == "board":
        if row.get("orientation") == "unknown" or placement is None:
            raise ValueError("accepted board requires known orientation and placement")
        placement_cells(placement)
    elif placement is not None:
        placement_cells(placement)
    image = Image.open(work / "pages" / pages[key]["image"])
    validate_rect(row.get("rect"), image.size)
    proposal = row.get("proposal")
    if not isinstance(proposal, dict) or not isinstance(proposal.get("method"), str):
        raise ValueError("proposal method required")
    if proposal["method"] == "model" and not proposal.get("modelSha256"):
        raise ValueError("model proposals require model hash")


def render(catalog_path: Path = DEFAULT_CATALOG, work: Path = DEFAULT_WORK) -> None:
    sources = validate_catalog(read_json(catalog_path))
    page_plan_path = ROOT / "modern-pages.json"
    if not page_plan_path.is_file():
        raise ValueError("modern-pages.json page plan is required")
    page_plan = read_json(page_plan_path).get("sources")
    if not isinstance(page_plan, list):
        raise ValueError("modern page plan has no sources")
    jobs = []
    for row in page_plan:
        if not isinstance(row, dict) or row.get("sourceId") not in sources:
            raise ValueError("page plan names unknown source")
        pages = row.get("pages")
        if not isinstance(pages, list): raise ValueError("page plan pages missing")
        jobs.extend((row["sourceId"], page) for page in pages)
    if len(jobs) > MAX_PAGES or len(set(jobs)) != len(jobs):
        raise ValueError("page budget or duplicate page violation")
    started = time.monotonic(); rows = []
    for sid, page in jobs:
        if time.monotonic() - started > MAX_TOTAL_SECONDS:
            raise ValueError("total rasterization budget exhausted")
        with tempfile.TemporaryDirectory(prefix="modern-page-") as temp:
            prefix = Path(temp) / "page"
            subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-scale-to", str(MAX_LONG_EDGE), "-png", str(sources[sid]["path"]), str(prefix)], check=True, timeout=MAX_PAGE_SECONDS, capture_output=True)
            with Image.open(prefix.with_suffix(".png")) as decoded:
                if decoded.width * decoded.height > MAX_PIXELS:
                    raise ValueError("page pixel cap exceeded")
                image = decoded.convert("RGB"); data = _png(image)
                size = list(image.size)
        name = f"{sid}-p{page:04}.png"
        publish(work / "pages" / name, data)
        rows.append({"sourceId": sid, "page": page, "image": name, "size": size, "sha256": sha256(data), "sourceSha256": sources[sid].get("sha256")})
    publish(work / "pages.json", json_bytes({"schema": 1, "catalogSha256": sha256(catalog_path.read_bytes()), "pages": rows}))
    _contacts(rows, work)


def _png(image: Image.Image) -> bytes:
    stream = BytesIO(); image.save(stream, format="PNG", optimize=False); return stream.getvalue()


def _contacts(rows: list[dict], work: Path) -> None:
    for sid in sorted({row["sourceId"] for row in rows}):
        group = [row for row in rows if row["sourceId"] == sid]
        for batch, start in enumerate(range(0, len(group), 12), start=1):
            subset = group[start:start + 12]
            sheet = Image.new("RGB", (1200, ((len(subset) + 3) // 4) * 500), "white")
            draw = ImageDraw.Draw(sheet)
            for index, row in enumerate(subset):
                with Image.open(work / "pages" / row["image"]) as image:
                    image = image.convert("RGB"); image.thumbnail((290, 470))
                    x, y = (index % 4) * 300, (index // 4) * 500
                    sheet.paste(image, (x, y + 22)); draw.text((x + 5, y + 3), f"{sid} / PDF page {row['page']}", fill="black")
            publish(work / "review" / f"{sid}-pages-{batch:02}.png", _png(sheet))


def extract(catalog_path: Path = DEFAULT_CATALOG, work: Path = DEFAULT_WORK, regions_path: Path = DEFAULT_REGIONS) -> None:
    sources = validate_catalog(read_json(catalog_path)); page_data = read_json(work / "pages.json"); pages = {(r["sourceId"], r["page"]): r for r in page_data.get("pages", [])}
    rows = read_json(regions_path).get("records", [])
    if not isinstance(rows, list) or len(rows) > MAX_REGIONS or len({r.get("id") for r in rows}) != len(rows): raise ValueError("invalid region collection")
    output = []
    for row in rows:
        validate_region(row, pages, sources, work)
        page = pages[(row["sourceId"], row["page"])]
        with Image.open(work / "pages" / page["image"]) as source:
            source = source.convert("RGB"); x, y, width, height = validate_rect(row["rect"], source.size)
            crop = source.crop((x, y, x + width, y + height)); native = _png(crop)
            rid = row["id"]; publish(work / "crops" / f"{rid}.png", native)
            margin = max(1, round(min(width, height) * 0.05)); loose = source.crop((max(0, x-margin), max(0, y-margin), min(source.width, x+width+margin), min(source.height, y+height+margin)))
            publish(work / "loose" / f"{rid}.png", _png(loose))
            review = crop.copy(); draw = ImageDraw.Draw(review); draw.rectangle((0, 0, width-1, height-1), outline="red", width=max(1, width//300))
            for n in range(1, 8): draw.line((n*width/8, 0, n*width/8, height), fill="red", width=1); draw.line((0, n*height/8, width, n*height/8), fill="red", width=1)
            publish(work / "review" / f"{rid}.png", _png(review))
            entry = dict(row); entry["cropSha256"] = sha256(native); entry["looseSha256"] = sha256(_png(loose)); entry["proposalSha256"] = sha256(json_bytes(canonical_proposal(row))); entry["pageSha256"] = page["sha256"]
            output.append(entry)
    publish(work / "manifest.json", json_bytes({"schema": 2, "catalogSha256": sha256(catalog_path.read_bytes()), "records": output}))


def verify(work: Path = DEFAULT_WORK) -> dict:
    manifest = read_json(work / "manifest.json"); records = manifest.get("records", []); accepted = 0
    for row in records:
        if row.get("kind") != "board": continue
        if row.get("orientation") == "unknown" or len(placement_cells(row.get("placement", ""))) != 64: raise ValueError("board has incomplete label")
        if row.get("review", {}).get("status") != "accepted" or row.get("review", {}).get("all64") is not True or row.get("review", {}).get("geometry") is not True: raise ValueError("board lacks immutable visual review")
        crop = work / "crops" / f"{row['id']}.png"
        if sha256(crop.read_bytes()) != row.get("cropSha256"): raise ValueError("crop hash mismatch")
        if row.get("proposalSha256") != sha256(json_bytes(canonical_proposal(row))): raise ValueError("proposal hash mismatch")
        accepted += 1
    return {"records": len(records), "acceptedBoards": accepted, "readyForPreprocess": accepted > 0}


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("command", choices=("render", "extract", "verify")); parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG); parser.add_argument("--work", type=Path, default=DEFAULT_WORK); parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS); args = parser.parse_args()
    if args.command == "render": render(args.catalog, args.work)
    elif args.command == "extract": extract(args.catalog, args.work, args.regions)
    else: print(json.dumps(verify(args.work), sort_keys=True))
    return 0


if __name__ == "__main__": raise SystemExit(main())
