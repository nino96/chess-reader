"""Verify completed feasibility artifacts and write public aggregate results."""
from __future__ import annotations

import csv
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work" / "modern"
DATA = WORK / "dataset"
RUNS = WORK / "feasibility-runs"
NAMES = ("pilot", "real-only", "degraded")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024): h.update(chunk)
    return h.hexdigest()


def read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict): raise ValueError(f"object required: {path}")
    return value


def public(value: Any, key: str = "") -> Any:
    hidden = {"exactIds", "gainedIds", "lostIds", "ids", "sourceId", "sourceIds", "path", "file"}
    if isinstance(value, dict): return {k: public(v, k) for k, v in value.items() if k not in hidden and "absolute" not in k.lower()}
    if isinstance(value, list): return [public(v, key) for v in value]
    return value


def preflight(reports: dict[str, dict[str, Any]]) -> dict[str, str]:
    lock = read(DATA / "dataset-lock.json")
    if lock.get("schema") != 1: raise ValueError("dataset lock schema mismatch")
    for name, report in reports.items():
        if report.get("dataLock") != lock: raise ValueError(f"report data lock differs: {name}")
    for split in ("train", "dev"):
        entry = lock.get("splits", {}).get(split)
        if not isinstance(entry, dict): raise ValueError(f"missing dataset lock split: {split}")
        if entry.get("tilesSha256") != sha256(DATA / f"{split}.npz") or entry.get("metadataSha256") != sha256(DATA / f"{split}.metadata.json"):
            raise ValueError(f"dataset lock bytes differ: {split}")
    shipped = Path(__file__).resolve().parents[3] / "packages/test-fixtures/node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx"
    if not shipped.is_file(): raise ValueError("pinned shipped model missing")
    if read(RUNS / "baseline-dev.json").get("shippedSha256") != sha256(shipped): raise ValueError("baseline shipped hash differs")
    if read(RUNS / "baseline-dev.json").get("devTilesSha256") != sha256(DATA / "dev.npz"): raise ValueError("baseline dev hash differs")
    return {"dataset/dataset-lock.json": sha256(DATA / "dataset-lock.json"), "dataset/train.npz": sha256(DATA / "train.npz"), "dataset/dev.npz": sha256(DATA / "dev.npz"), "dataset/train.metadata.json": sha256(DATA / "train.metadata.json"), "dataset/dev.metadata.json": sha256(DATA / "dev.metadata.json"), "shipped-model.onnx": sha256(shipped)}


def verify_run(name: str, report: dict[str, Any]) -> dict[str, str]:
    run = RUNS / name; model = run / "candidate.onnx"; probs = run / "candidate.probabilities.npy"
    if report.get("status") != "completed" or not model.is_file() or not probs.is_file(): raise ValueError(f"incomplete run: {name}")
    if report.get("modelSha256") != sha256(model) or report.get("parity", {}).get("sha256") != sha256(model): raise ValueError(f"model identity mismatch: {name}")
    if report.get("parity", {}).get("probabilitiesSha256") != sha256(probs): raise ValueError(f"probability identity mismatch: {name}")
    return {f"feasibility-runs/{name}/run-report.json": sha256(run / "run-report.json"), f"feasibility-runs/{name}/candidate.onnx": sha256(model), f"feasibility-runs/{name}/candidate.probabilities.npy": sha256(probs)}


def curve_rows(reports: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for name, report in reports.items():
        for curve in report.get("curves", []):
            d = curve.get("diagnostic", {})
            rows.append({"run": name, "epoch": curve.get("epoch"), "updates": curve.get("updates"), "trainCrossEntropy": curve.get("trainCrossEntropy"), "devScore": curve.get("devScore"), "rawExactBoards": d.get("rawExactBoards"), "reliableExactBoards": d.get("reliableExactBoards"), "confidentWrongBoards": d.get("confidentWrongBoards"), "occupiedCorrect": d.get("occupiedCorrect"), "occupied": d.get("occupied")})
    return rows


def export() -> dict[str, Any]:
    sys.path.insert(0, str(ROOT))
    from preflight_feasibility import verify
    verify()
    reports = {name: read(RUNS / name / "run-report.json") for name in NAMES}
    freeze = preflight(reports)
    hashes = dict(freeze)
    for name, report in reports.items(): hashes.update(verify_run(name, report))
    baseline = read(RUNS / "baseline-dev.json"); baseline_probs = RUNS / "baseline-dev.probabilities.npy"
    if baseline.get("probabilitiesSha256") != sha256(baseline_probs): raise ValueError("baseline probability identity mismatch")
    hashes.update({"feasibility-runs/baseline-dev.json": sha256(RUNS / "baseline-dev.json"), "feasibility-runs/baseline-dev.probabilities.npy": sha256(baseline_probs), "feasibility-runs/comparison-dev.json": sha256(RUNS / "comparison-dev.json"), "pretraining-lock.json": sha256(WORK / "pretraining-lock.json"), "modern-sources.json": sha256(ROOT / "modern-sources.json")})
    base_report = WORK / "base" / "fenshot-recovered.json"
    base_state = WORK / "base" / "fenshot-recovered.pt"
    if read(base_report)['stateSha256'] != sha256(base_state): raise ValueError('recovery base changed')
    hashes["base/fenshot-recovered.json"] = sha256(base_report)
    hashes["base/fenshot-recovered.pt"] = sha256(base_state)
    comparison = read(RUNS / "comparison-dev.json"); ledger = read(RUNS / "budget-ledger.json")
    elapsed = sum(float(reports[name].get("elapsedSeconds", 0)) for name in NAMES)
    result = {"schema": 1, "status": "completed-artifacts-verified", "commit": subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip(), "split": comparison.get("split"), "heldOutScored": comparison.get("heldOutScored"), "qualificationPassed": comparison.get("qualificationPassed"), "baseline": public(comparison.get("baseline", {})), "candidates": {name: public(comparison.get("candidates", {}).get(name, {})) for name in ("real-only", "degraded")}, "pilot": {"status": reports["pilot"]["status"], "recoveryEquivalent": reports["pilot"].get("recoveryEquivalent"), "bestEpoch": reports["pilot"].get("bestEpoch"), "updates": reports["pilot"].get("updates")}, "data": {"boards": comparison.get("baseline", {}).get("boards"), "trainTilesSha256": reports["real-only"]["dataLock"]["splits"]["train"]["tilesSha256"], "devTilesSha256": reports["real-only"]["dataLock"]["splits"]["dev"]["tilesSha256"]}, "curves": {"csv": "learning-curves.csv", "rows": len(curve_rows(reports))}, "resources": {"actualElapsedSeconds": elapsed, "reservedNewSeconds": ledger.get("chargedSeconds"), "priorChargedSeconds": 354.078, "aggregateChargedSeconds": float(ledger.get("chargedSeconds", 0)) + 354.078}, "environment": {"python": os.sys.version.split()[0], "torch": importlib.metadata.version("torch"), "onnxruntime": importlib.metadata.version("onnxruntime")}, "artifactSha256": hashes}
    result['frozenInputsSha256'] = read(WORK/'pretraining-lock.json')['files']
    (ROOT / "results-public.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    rows = curve_rows(reports)
    with (ROOT / "learning-curves.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    return result


if __name__ == "__main__": export()
