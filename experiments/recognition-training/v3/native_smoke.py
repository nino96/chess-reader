"""Bounded native development smoke; never opens qualification inputs."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time

import numpy as np
import torch
import onnxruntime as ort
from alternatives import FenifySession, NakstSession, Image, CANONICAL_CLASSES
from diagnostic import evaluate_probabilities, load_board_metadata

ROOT = Path(__file__).resolve().parent
GRID = (0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.99)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def smoke_policy(exacts: list[bool], scores: list[float], negative_scores: list[float]) -> dict:
    """A tiny compatibility screen, not the full development promotion gate."""
    feasible = [t for t in GRID if any(e and s >= t for e, s in zip(exacts, scores))
                and not any(s >= t for s in negative_scores)
                and not any(not e and s >= t for e, s in zip(exacts, scores))]
    return {"thresholdGrid": list(GRID), "feasibleSmokeThresholds": feasible,
            "passed": bool(feasible) and any(exacts),
            "reason": "advance to full development only" if feasible else "STOP: no error-free covered exact positive at any predeclared threshold",
            "finalConfidencePolicyFrozen": False}


def iou(a, b) -> float:
    x = max(a[0], b[0]); y = max(a[1], b[1])
    right = min(a[2], b[2]); bottom = min(a[3], b[3])
    inter = max(0, right-x)*max(0, bottom-y)
    union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1])-inter
    return inter/union if union > 0 else 0.0


def run(candidate: str, output: Path, ceiling: int = 120) -> dict:
    if output.exists():
        raise ValueError("refusing to overwrite retained smoke evidence")
    started = time.monotonic()
    lock = json.loads((ROOT/'manifests/native-smoke-lock.json').read_text())
    if lock.get('status') != 'passed' or lock.get('schemaVersion') != 1:
        raise ValueError('native smoke inputs are not locked')
    for relative, expected in lock['sha256'].items():
        path = (ROOT/relative).resolve(); path.relative_to(ROOT)
        if digest(path) != expected:
            raise ValueError('native smoke locked input changed')
    torch.set_num_threads(1); torch.set_num_interop_threads(1)
    data = ROOT / "data/full"
    manifest_path = data / "smoke/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    entries = manifest["inputs"]
    if len(entries) != 24:
        raise ValueError("native smoke requires the frozen 24-input manifest")
    labels_root = json.loads((data / "dev.labels.json").read_text())
    dev_labels = np.asarray([b["labels"] for b in labels_root["boards"]], dtype=np.int64)
    dev_metadata = load_board_metadata(data)
    artifact = ROOT / ("cache/alternatives/fenify-cpu.pt" if candidate == "fenify" else "cache/alternatives/nakst-best.onnx")
    session = FenifySession(artifact) if candidate == "fenify" else NakstSession(artifact)
    observations = []; exacts = []; exact_scores = []; negative_scores = []
    probs = []; truth = []; metadata = []; latencies = []
    detector_truth = []; detector_predictions = []; detector_confidences = []
    for index, entry in enumerate(entries):
        if time.monotonic()-started >= ceiling - 5:
            raise TimeoutError("native smoke wall-time budget reached")
        if candidate == "fenify" and entry["kind"] not in ("positive-exact-board", "negative-page"):
            continue
        image_path = (data / "smoke" / entry["id"]).resolve()
        image_path.relative_to(data.resolve())
        if digest(image_path) != entry["sha256"]:
            raise ValueError("smoke image hash mismatch")
        with Image.open(image_path) as image:
            rgb = np.asarray(image.convert("RGB"))
        tick = time.monotonic()
        prediction = session.infer(rgb)
        latencies.append(time.monotonic()-tick)
        observation = {"inputIndex": index, "kind": entry["kind"]}
        complete = [b for b in entry["truthBoards"] if b["complete"]]
        if candidate == "fenify":
            score = float(prediction.max(2).min())
            observation["minimumSquareConfidence"] = score
            if entry["kind"] == "negative-page":
                negative_scores.append(score)
            else:
                board_index = complete[0]["devIndex"]
                expected = dev_labels[board_index]
                exact = bool(np.array_equal(prediction[0].argmax(1), expected))
                exacts.append(exact); exact_scores.append(score)
                probs.append(prediction[0]); truth.append(expected); metadata.append(dev_metadata[board_index])
                observation["exact"] = exact
        else:
            observation["detectedBoards"] = len(prediction)
            observation["expectedCompleteBoards"] = len(complete)
            observation["pieceConflicts"] = sum(p["pieceConflicts"] for p in prediction)
            board_scores = []
            for p in prediction:
                values = [c["confidence"] for c in p["cellsA1First"] if c["confidence"] is not None]
                board_scores.append(min([p["board"].score, *values]) if values and not p["abstained"] else 0.0)
            if not complete:
                negative_scores.extend(board_scores)
                observation["partialOrNegativeBoardScores"] = board_scores
            if entry["kind"] == "positive-exact-board":
                expected = dev_labels[complete[0]["devIndex"]]
                exact = False; score = 0.0
                inferred = np.full(64, -1, dtype=np.int64)
                if len(prediction) == 1:
                    p = prediction[0]
                    inferred = np.asarray([CANONICAL_CLASSES.index(c["label"]) if c["label"] is not None else 0 for c in p["cellsA1First"]])
                    exact = bool(np.array_equal(inferred, expected)) and not p["abstained"]
                    score = board_scores[0]
                    observation["correctSquares"] = int((inferred == expected).sum())
                    observation["occupiedCorrect"] = int(((inferred == expected) & (expected != 0)).sum())
                    observation["occupiedTotal"] = int((expected != 0).sum())
                detector_truth.append(expected); detector_predictions.append(inferred)
                detector_confidences.extend(c["confidence"] for p in prediction for c in p["cellsA1First"] if c["confidence"] is not None)
                exacts.append(exact); exact_scores.append(score); observation["exact"] = exact
            overlaps = []
            for b in complete:
                r = b["rect"]; box = [r["x"], r["y"], r["x"]+r["width"], r["y"]+r["height"]]
                overlaps.append(max([iou(box,p["board"].xyxy) for p in prediction],default=0.0))
            observation["truthBoardBestIoU"] = overlaps
        observations.append(observation)
    metrics = evaluate_probabilities(np.stack(probs), np.stack(truth), metadata) if probs else None
    detector_metrics = None
    if detector_truth:
        y = np.stack(detector_truth); predicted = np.stack(detector_predictions); correct = predicted == y
        occupied = y != 0
        matrix = np.zeros((13, 14), dtype=np.int64)
        np.add.at(matrix, (y.ravel(), np.where(predicted < 0, 13, predicted).ravel()), 1)
        detector_metrics = {"boards":len(y), "exactBoards":sum(exacts), "squares":int(y.size), "correctSquares":int(correct.sum()),
            "occupiedTotal":int(occupied.sum()), "occupiedCorrect":int((correct & occupied).sum()),
            "perClass":{c:{"total":int((y==i).sum()),"correct":int((correct & (y==i)).sum())} for i,c in enumerate(CANONICAL_CLASSES)},
            "color":{name:{"total":int(mask.sum()),"correct":int((correct & mask).sum())} for name,mask in {"white":(y>=1)&(y<=6),"black":y>=7}.items()},
            "confusionActualRowsPredictedColumns":matrix.tolist(),"confusionColumns":CANONICAL_CLASSES+"?",
            "detectedPieceConfidence":{"count":len(detector_confidences),"minimum":min(detector_confidences,default=None),"mean":float(np.mean(detector_confidences)) if detector_confidences else None},
            "missedBoardSquares":int((predicted<0).sum()),"emptyConfidenceAvailable":False,"orientationInferred":False}
    result = {"schemaVersion":1,"status":"completed","candidate":candidate,
        "command":f"timeout {ceiling}s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/native_smoke.py --candidate {candidate} --ceiling {ceiling}",
        "commit":subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
        "scriptSha256":digest(Path(__file__)),"adapterSha256":digest(ROOT/'alternatives.py'),
        "modelSha256":digest(artifact),"manifestSha256":digest(manifest_path),
        "developmentLabelsSha256":digest(data/'dev.labels.json'),
        "preprocessingLockSha256":digest(ROOT/'requirements-preprocessing.lock'),
        "environment":{"python":platform.python_version(),"machine":platform.machine(),"torch":torch.__version__,"onnxruntime":ort.__version__,"threads":1,"provider":"CPUExecutionProvider"},
        "inputsRun":len(observations),"rawExactBoards":sum(exacts),"exactBoardInputs":len(exacts),
        "observations":observations,"classifierDiagnostic":metrics,"detectorDiagnostic":detector_metrics,
        "smokeDecision":smoke_policy(exacts,exact_scores,negative_scores),
        "latencySeconds":{"samples":latencies,"p50":float(np.quantile(latencies,.5)),"p95":float(np.quantile(latencies,.95)),"maximum":max(latencies)},
        "elapsedSeconds":time.monotonic()-started,"ceilingSeconds":ceiling,
        "numericProbabilityBounds": session.numeric_aggregate if candidate == "nakst" else None,
        "limitations":{"orientationInferred":False,"localizationTested":candidate=='nakst',"emptySquareConfidenceAvailable":candidate=='fenify',"notFreshQualification":True,"latencyUse":"smoke observations only; not an isolated performance benchmark"}}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    return result


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',choices=['fenify','nakst'],required=True)
    parser.add_argument('--ceiling',type=int,choices=[44,60,120],default=120)
    parser.add_argument('--attempt',type=int,choices=[1,2,3],default=1)
    args=parser.parse_args()
    suffix='' if args.attempt == 1 else f'-attempt-{args.attempt}'
    output=ROOT/'runs'/f'native-smoke-{args.candidate}{suffix}.json'
    started=time.monotonic()
    try:
        result=run(args.candidate,output,args.ceiling)
    except Exception as error:
        if not output.exists():
            output.parent.mkdir(parents=True,exist_ok=True)
            output.write_text(json.dumps({'schemaVersion':1,'status':'failed','candidate':args.candidate,'errorType':type(error).__name__,'error':str(error),'elapsedSeconds':time.monotonic()-started,'ceilingSeconds':args.ceiling,'scriptSha256':digest(Path(__file__)),'adapterSha256':digest(ROOT/'alternatives.py')},indent=2)+'\n')
        return 1
    print(json.dumps({k:result[k] for k in ['candidate','inputsRun','rawExactBoards','exactBoardInputs','smokeDecision','elapsedSeconds']}))
    return 0


if __name__=='__main__':
    raise SystemExit(main())
