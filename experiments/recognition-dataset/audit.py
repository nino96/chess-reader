"""Audit the real local pilot and emit a public-safe, hash-bound preparation record."""
from __future__ import annotations

import argparse
from collections import Counter
import contextlib
import io
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys

import PIL
from PIL import Image
import pilot


def run(revision):
    root, work = pilot.ROOT, pilot.WORK
    revision = pilot.safe_id(revision)
    pilot.MANIFEST_NAME = f"manifest-{revision}.json"
    pilot.DECISION_DIR = f"decisions-{revision}"
    with contextlib.redirect_stdout(io.StringIO()):
        review = pilot.verify()
    sources, _ = pilot.catalog_and_lock()
    rows = pilot.read_json(work / pilot.MANIFEST_NAME)["records"]
    split_rows = []
    for row in rows:
        source = sources[row["sourceId"]]
        split_rows.append({"split": "diagnostic", "exposed": True,
                           "lineageStatus": source["lineageStatus"],
                           **{key: source[key] for key in ("workGroup", "editionGroup", "lineageGroup")},
                           "imageSha256": row["cropSha256"],
                           "positionGroup": pilot.digest(pilot.json_bytes(row.get("placement"))) if row.get("placement") else row["id"],
                           "sequenceGroup": source["workGroup"]})
    pilot.validate_splits(split_rows)
    accepted = []
    decisions = {}
    for row in rows:
        entries = [pilot.read_json(path) for path in sorted((work / pilot.DECISION_DIR).glob(f"{row['id']}-*.json"))]
        decisions[row["id"]] = "accepted" if entries and all(d["decision"] == "accepted" for d in entries) else "quarantined-or-pending"
        if row["kind"] == "board" and decisions[row["id"]] == "accepted":
            accepted.append(row)
    classes = Counter()
    densities = Counter()
    for row in accepted:
        cells = pilot.placement_cells(row["placement"])
        classes.update(cells)
        n = sum(cell != "." for cell in cells)
        densities["single-piece" if n < 2 else "sparse-2-8" if n <= 8 else "medium-9-20" if n <= 20 else "dense-21-plus"] += 1
    kinds = Counter(row["kind"] for row in rows)
    tags = Counter(tag for row in accepted for tag in row["tags"])
    perceptual = {}
    for row in accepted:
        with Image.open(work / "crops" / f"{row['id']}.png") as image:
            small = image.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
            pixels = list(small.getdata())
            perceptual[row["id"]] = sum(int(pixels[y * 9 + x] > pixels[y * 9 + x + 1]) << (y * 8 + x)
                                        for y in range(8) for x in range(8))
    near_duplicates = []
    ids = sorted(perceptual)
    for index, left in enumerate(ids):
        for right in ids[index + 1:]:
            distance = (perceptual[left] ^ perceptual[right]).bit_count()
            if distance <= 8:
                near_duplicates.append({"left": left, "right": right, "distance": distance,
                                        "decision": "co-grouped diagnostic; similarity does not prove shared artwork"})
    artifacts = {}
    for directory in ("pages", "crops", "tensors", "degraded", "review-final", "decisions-final"):
        for path in sorted((work / directory).glob("*")):
            if path.is_symlink() or not path.is_file():
                raise ValueError("unexpected artifact")
            artifacts[str(path.relative_to(work))] = pilot.digest(path.read_bytes())
    for name in ("regions.json", "pages.json", pilot.MANIFEST_NAME, "review-final.html"):
        artifacts[name] = pilot.digest((work / name).read_bytes())
    reusable = ["docs/investigations/issue-24-localization.md",
                "experiments/recognition-training/v2/FAILURE_ANALYSIS.md",
                "experiments/recognition-training/v2/reports/failure-diagnostic-dev.json",
                "experiments/recognition-training/v3/REPORT.md",
                "experiments/recognition-training/v3/reports/comparison.json",
                "experiments/recognition-training/planning/reconstruction-parity.json"]
    repo = root.parent.parent
    preserved = subprocess.run(["git", "diff", "--quiet", "c613aed15dfe4ec9e85b7557b01805c4fb3be187", "--",
                                "apps", "packages", "experiments/recognition-training", "pnpm-lock.yaml",
                                "docs/eval-baselines", "docs/decisions", "docs/evaluation.md"], cwd=repo).returncode == 0
    if not preserved:
        raise ValueError("frozen or production input changed")
    command = ["python3", "experiments/recognition-dataset/audit.py", "--revision", revision]
    tools = {}
    for name in ("pdftoppm", "pdfinfo"):
        path = shutil.which(name)
        if not path:
            raise ValueError("missing renderer")
        result = subprocess.run([name, "-v"], capture_output=True, text=True, check=True)
        tools[name] = {"version": (result.stderr or result.stdout).splitlines()[0],
                       "binarySha256": pilot.digest(Path(path).read_bytes())}
    pngs = [path for path in work.rglob("*.png") if path.is_file()]
    storage = sum(path.stat().st_size for directory in (root / "cache", work)
                  for path in directory.rglob("*") if path.is_file() and not path.name.startswith("preparation-"))
    if storage > 1024 ** 3:
        raise ValueError("pilot storage ceiling exceeded")
    split_counts = Counter(row["split"] for row in split_rows)
    group_count = len({r["lineageGroup"] for r in split_rows if r["lineageStatus"] == "reviewed"})
    gates = {"trainCount": split_counts["train"] >= 1200, "devCount": split_counts["dev"] >= 240,
             "qualificationCount": split_counts["qualification"] >= 240,
             "cleanRegressionCount": split_counts["clean-regression"] >= 120,
             "independentComponents": group_count >= 12,
             "allClasses": all(classes[key] > 0 for key in ".KQRBNPkqrbnp")}
    report = {
        "schema": "recognition-dataset-preparation-1", "issue": 41,
        "baseCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
        "sourceState": "uncommitted preparation files identified by hashes", "command": command,
        "environment": {"system": platform.system(), "machine": platform.machine(),
                        "python": platform.python_version(), "pillow": PIL.__version__, "tools": tools,
                        "browser": "not run; offline extraction only", "device": "local host, no physical iPad"},
        "review": review, "regions": len(rows), "acceptedBoards": len(accepted),
        "kindCounts": dict(kinds), "acceptedByPublicSource": dict(Counter(r["sourceId"] for r in accepted)),
        "classCounts": {key: classes[key] for key in ".KQRBNPkqrbnp"},
        "densityCounts": dict(densities), "acceptedTags": dict(tags),
        "pageCounts": dict(Counter(r["sourceId"] for r in pilot.read_json(work / "pages.json")["pages"])),
        "reviewDecisions": decisions,
        "perceptualDuplicateScreen": {"method": "64-bit horizontal dHash, Hamming <=8; proposal only",
                                      "pairs": near_duplicates, "crossSplitPairs": 0},
        "coverageGaps": ["only two works yield boards in the 36-page pilot", "design independence unresolved",
                         "no pristine flat/colored-board examples", "no dense middlegames", "incomplete class coverage",
                         "no real multiple-board page", "no source-held-out dev or fresh qualification samples"],
        "qualificationGate": {"pass": all(gates.values()), "checks": gates,
                              "reason": "All pilot records are exposed diagnostic inputs; coverage and lineage requirements are unmet",
                              "splitCounts": dict(split_counts), "reviewedIndependentComponents": group_count},
        "sourceTerms": "See sources.json and provenance-lock.json; no universal distribution clearance",
        "artifactSha256": artifacts,
        "implementationSha256": {name: pilot.digest((root / name).read_bytes()) for name in ("intake.py", "pilot.py", "audit.py", "sources.json", "pilot-pages.json", "PLAN.md")},
        "reusedEvidenceSha256": {name: pilot.digest((repo / name).read_bytes()) for name in reusable},
        "preservation": {"productionAndFrozenInputsUnchanged": preserved, "comparisonBase": "c613aed15dfe4ec9e85b7557b01805c4fb3be187"},
        "resources": {"storageBytes": storage, "pngCountIncludingSupersededReviews": len(pngs), "gpuSeconds": 0,
                      "modelInferenceRuns": 0, "apiImageUploads": 0},
        "stages": {"preparationPilot": "executed", "fullDataGate": "fail: insufficient coverage and unresolved lineage",
                   "training": "not authorized/not run", "qualification": "not reached", "product": "not applicable: unchanged", "physicalIpad": "deferred/unrun"},
    }
    pilot.publish(work / f"preparation-{revision}.json", pilot.json_bytes(report))
    print(json.dumps({"acceptedBoards": len(accepted), "regions": len(rows), "storageBytes": storage,
                      "dataQualification": "FAIL", "report": f"work/preparation-{revision}.json"}))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default="final")
    parser.add_argument("--qualify", action="store_true", help="Return nonzero unless the actual data qualification gate passes")
    args = parser.parse_args()
    result = run(args.revision)
    if args.qualify and not result["qualificationGate"]["pass"]:
        sys.exit(1)
