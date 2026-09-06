"""Bounded byte-replay audit for retained public modern page renders.

This is a post-training audit.  It never rewrites retained pages, manifests, or
catalogs.  It re-renders the frozen page plan with the same pdftoppm/Pillow
recipe, compares bytes, and records source/page/crop hash links.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work" / "modern"
CATALOG = ROOT / "modern-sources.json"
PLAN = ROOT / "modern-pages.json"
PAGES = WORK / "pages.json"
MANIFEST = WORK / "manifest.json"
LOCK = WORK / "pretraining-lock.json"
OUT = WORK / "page-provenance-audit.json"
MAX_PAGE_SECONDS = 30
MAX_TOTAL_SECONDS = 1200
MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def read(path: Path) -> dict:
    if path.is_symlink() or path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError(f"unsafe JSON artifact: {path}")
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError(f"JSON object required: {path}")
    return value


def valid_page_result(row: dict) -> bool:
    """Return whether a replay row proves byte identity with retained metadata."""
    return (
        row.get("byteIdentical") is True
        and row.get("renderedSha256") == row.get("retainedSha256") == row.get("expectedSha256")
        and row.get("renderedSize") == row.get("retainedSize")
    )


def valid_crop_link(row: dict) -> bool:
    """Return whether a replayed crop matches both retained and manifest hashes."""
    return (
        row.get("cropByteIdentical") is True
        and row.get("replayedCropSha256") == row.get("cropSha256")
    )


def verify_saved(path: Path) -> dict:
    """Verify an existing audit without invoking pdftoppm."""
    audit = read(path)
    catalog = read(CATALOG)
    sources = modern_extract.validate_catalog(catalog) if "modern_extract" in globals() else None
    if sources is None:
        sys.path.insert(0, str(ROOT))
        import modern_extract  # pylint: disable=import-outside-toplevel
        sources = modern_extract.validate_catalog(catalog)
    if audit.get("catalogSha256") != digest(CATALOG.read_bytes()):
        raise ValueError("saved audit catalog hash is stale")
    if audit.get("pagesJsonSha256") != digest(PAGES.read_bytes()):
        raise ValueError("saved audit pages metadata hash is stale")
    if audit.get("manifestSha256") != digest(MANIFEST.read_bytes()):
        raise ValueError("saved audit manifest hash is stale")
    if not LOCK.is_file() or audit.get("pretrainingLockSha256") != digest(LOCK.read_bytes()):
        raise ValueError("saved audit pretraining lock hash is stale")
    sys.path.insert(0, str(ROOT))
    import preflight_feasibility  # pylint: disable=import-outside-toplevel
    preflight = preflight_feasibility.verify()
    retained = read(PAGES); retained_rows = retained.get("pages", [])
    by_key = {(r["sourceId"], r["page"]): r for r in retained_rows}
    if len(audit.get("pageResults", [])) != len(retained_rows):
        raise ValueError("saved audit page count mismatch")
    for result in audit["pageResults"]:
        key = (result["sourceId"], result["page"])
        expected = by_key.get(key)
        if expected is None:
            raise ValueError("saved audit names unknown page")
        actual = (WORK / "pages" / expected["image"]).read_bytes()
        if digest(actual) != expected["sha256"] or list(Image.open(WORK / "pages" / expected["image"]).size) != expected["size"]:
            raise ValueError("retained page bytes changed")
        checked = {**result, "expectedSha256": expected["sha256"]}
        if not valid_page_result(checked):
            raise ValueError(f"saved page audit mismatch: {key}")
        source = sources[result["sourceId"]]
        if result["sourceSha256"] != source["expectedSha256"] or result["rightsSha256"] != source["expectedRightsSha256"]:
            raise ValueError(f"saved source provenance mismatch: {key}")
        if digest((ROOT / "cache" / "modern" / source["filename"]).read_bytes()) != source["expectedSha256"]:
            raise ValueError("source bytes changed")
        if digest((ROOT / "work" / "modern-intake" / source["rightsFilename"]).read_bytes()) != source["expectedRightsSha256"]:
            raise ValueError("rights bytes changed")
    manifest = read(MANIFEST)
    manifest_rows = {r["id"]: r for r in manifest.get("records", [])}
    if len(audit.get("cropLinks", [])) != audit.get("cropLinkCount"):
        raise ValueError("saved audit crop count mismatch")
    for link in audit["cropLinks"]:
        row = manifest_rows.get(link["id"])
        page = by_key.get((link["sourceId"], link["page"]))
        if row is None or page is None or not valid_crop_link(link):
            raise ValueError(f"saved crop audit mismatch: {link.get('id')}")
        crop = (WORK / "crops" / f"{row['id']}.png").read_bytes()
        if digest(crop) != row.get("cropSha256") or digest(crop) != link.get("cropSha256"):
            raise ValueError(f"crop bytes changed: {row['id']}")
        if row.get("pageSha256") != page["sha256"] or row.get("sourceSha256") != link["sourceSha256"]:
            raise ValueError(f"manifest linkage changed: {row['id']}")
    result = {"preflight": preflight, "pages": len(retained_rows), "identicalPages": audit["byteIdenticalPages"], "crops": len(audit["cropLinks"]), "identicalCrops": audit["byteIdenticalCrops"], "auditSha256": digest(path.read_bytes())}
    print(json.dumps(result, sort_keys=True))
    return result


def run() -> dict:
    started = time.monotonic()
    # Reuse the checked-in extraction validator and exact PNG encoder without
    # invoking its mutating CLI path.
    sys.path.insert(0, str(ROOT))
    import modern_extract  # pylint: disable=import-outside-toplevel

    catalog = read(CATALOG)
    sources = modern_extract.validate_catalog(catalog)
    page_plan = read(PLAN).get("sources")
    retained = read(PAGES)
    manifest = read(MANIFEST)
    if not isinstance(page_plan, list) or not isinstance(retained.get("pages"), list):
        raise ValueError("page plan/pages metadata missing")
    retained_by_key = {(row["sourceId"], row["page"]): row for row in retained["pages"]}
    jobs = [(row["sourceId"], page) for row in page_plan for page in row["pages"]]
    if len(jobs) > modern_extract.MAX_PAGES:
        raise ValueError("page replay exceeds extraction page budget")
    if len(jobs) != len(retained_by_key) or set(jobs) != set(retained_by_key):
        raise ValueError("retained pages do not match frozen page plan")

    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise ValueError("pdftoppm unavailable")
    version = subprocess.run([pdftoppm, "-v"], capture_output=True, text=True, check=False)
    renderer_text = (version.stdout + version.stderr).strip()
    renderer_hash = digest(Path(pdftoppm).read_bytes())
    results = []
    output_bytes = 0
    for index, (source_id, page_number) in enumerate(jobs):
        if time.monotonic() - started > MAX_TOTAL_SECONDS:
            raise TimeoutError("total page replay budget exhausted")
        source = sources[source_id]
        pdf = ROOT / "cache" / "modern" / source["filename"]
        if digest(pdf.read_bytes()) != source["expectedSha256"]:
            raise ValueError(f"source hash mismatch: {source_id}")
        rights = ROOT / "work" / "modern-intake" / source["rightsFilename"]
        if digest(rights.read_bytes()) != source["expectedRightsSha256"]:
            raise ValueError(f"rights snapshot hash mismatch: {source_id}")
        expected = retained_by_key[(source_id, page_number)]
        page_started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="page-provenance-") as temp:
            prefix = Path(temp) / "page"
            subprocess.run(
                [pdftoppm, "-f", str(page_number), "-l", str(page_number), "-singlefile", "-scale-to", str(modern_extract.MAX_LONG_EDGE), "-png", str(pdf), str(prefix)],
                check=True,
                timeout=MAX_PAGE_SECONDS,
                capture_output=True,
            )
            rendered_path = prefix.with_suffix(".png")
            with Image.open(rendered_path) as decoded:
                if decoded.width * decoded.height > modern_extract.MAX_PIXELS:
                    raise ValueError(f"page pixel cap exceeded: {source_id}:{page_number}")
                image = decoded.convert("RGB")
                rendered = modern_extract._png(image)
                size = list(image.size)
        elapsed = time.monotonic() - page_started
        if elapsed > MAX_PAGE_SECONDS:
            raise TimeoutError(f"page replay exceeded budget: {source_id}:{page_number}")
        retained_path = WORK / "pages" / expected["image"]
        retained_bytes = retained_path.read_bytes()
        output_bytes += len(rendered)
        if output_bytes > MAX_OUTPUT_BYTES:
            raise ValueError("replay output budget exhausted")
        results.append({
            "sourceId": source_id,
            "page": page_number,
            "image": expected["image"],
            "sourceSha256": source["expectedSha256"],
            "rightsSha256": source["expectedRightsSha256"],
            "renderedSha256": digest(rendered),
            "retainedSha256": digest(retained_bytes),
            "byteIdentical": rendered == retained_bytes,
            "renderedSize": size,
            "retainedSize": expected["size"],
            "seconds": round(elapsed, 6),
            "ordinal": index,
        })
        results[-1]["expectedSha256"] = expected.get("sha256")
        if not valid_page_result(results[-1]):
            raise ValueError(f"retained page replay mismatch: {source_id}:{page_number}")

    page_by_key = {(r["sourceId"], r["page"]): r for r in results}
    crop_links = []
    for row in manifest.get("records", []):
        key = (row.get("sourceId"), row.get("page"))
        if key not in page_by_key or row.get("sourceId") not in sources:
            continue
        page = retained_by_key[key]
        crop_path = WORK / "crops" / f"{row['id']}.png"
        with Image.open(WORK / "pages" / page["image"]) as source_image:
            image = source_image.convert("RGB")
            x, y, width, height = modern_extract.validate_rect(row["rect"], image.size)
            crop = modern_extract._png(image.crop((x, y, x + width, y + height)))
        retained_crop = crop_path.read_bytes()
        crop_links.append({
            "id": row["id"],
            "sourceId": row["sourceId"],
            "page": row["page"],
            "sourceSha256": sources[row["sourceId"]]["expectedSha256"],
            "pageSha256": page["sha256"],
            "manifestPageSha256": row.get("pageSha256"),
            "cropSha256": row.get("cropSha256"),
            "replayedCropSha256": digest(crop),
            "cropByteIdentical": crop == retained_crop,
        })
        if row.get("sourceSha256") != sources[row["sourceId"]]["expectedSha256"]:
            raise ValueError(f"manifest source hash mismatch: {row['id']}")
        if row.get("pageSha256") != page["sha256"]:
            raise ValueError(f"manifest page hash mismatch: {row['id']}")
        if not valid_crop_link(crop_links[-1]):
            raise ValueError(f"manifest crop hash mismatch: {row['id']}")
    output = {
        "schema": 1,
        "role": "posttraining-page-provenance-audit",
        "catalogSha256": digest(CATALOG.read_bytes()),
        "pagesJsonSha256": digest(PAGES.read_bytes()),
        "manifestSha256": digest(MANIFEST.read_bytes()),
        "pretrainingLockSha256": digest(LOCK.read_bytes()) if LOCK.is_file() else None,
        "pagesCatalogSha256": retained.get("catalogSha256"),
        "pagesCatalogHashMatchesCurrent": retained.get("catalogSha256") == digest(CATALOG.read_bytes()),
        "pageMetadataSourceShaNullCount": sum(r.get("sourceSha256") is None for r in retained["pages"]),
        "renderer": {"path": pdftoppm, "sha256": renderer_hash, "version": renderer_text},
        "implementationSha256": digest((ROOT / "modern_extract.py").read_bytes()),
        "elapsedSeconds": round(time.monotonic() - started, 6),
        "replayedPages": len(results),
        "byteIdenticalPages": sum(r["byteIdentical"] for r in results),
        "pageResults": results,
        "cropLinks": crop_links,
        "cropLinkCount": len(crop_links),
        "byteIdenticalCrops": sum(r["cropByteIdentical"] for r in crop_links),
        "budgets": {"maxSecondsPerPage": MAX_PAGE_SECONDS, "maxTotalSeconds": MAX_TOTAL_SECONDS, "maxOutputBytes": MAX_OUTPUT_BYTES},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = json_bytes(output)
    if OUT.exists() and OUT.read_bytes() != data:
        # Rendering duration is intentionally recorded but is not an identity
        # field; permit an idempotent replay when every byte/hash/result agrees.
        previous = read(OUT)
        comparable = lambda value: {**value, "elapsedSeconds": None, "pageResults": [
            {**row, "seconds": None} for row in value["pageResults"]
        ]}
        if comparable(previous) != comparable(output):
            raise ValueError("existing provenance audit differs")
    if not OUT.exists():
        OUT.write_bytes(data)
    print(json.dumps({"pages": len(results), "identicalPages": output["byteIdenticalPages"], "crops": len(crop_links), "identicalCrops": output["byteIdenticalCrops"], "seconds": output["elapsedSeconds"]}, sort_keys=True))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", type=Path, metavar="SAVED_AUDIT")
    args = parser.parse_args()
    if args.verify:
        run_verify = verify_saved
        run_verify(args.verify)
    else:
        run()
