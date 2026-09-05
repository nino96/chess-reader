# ADR 0005: Run fenshot directly in a browser worker

Status: accepted
Date: 2026-09-03

## Context

The earlier Android design required porting fenshot preprocessing and board
detection to Kotlin. The web-first platform can use the original TypeScript
implementation and its small ONNX model directly.

## Decision

- Pin and use the MIT-licensed fenshot package and model.
- Run ONNX Runtime Web with WebAssembly as the compatibility baseline.
- Perform recognition in a dedicated worker and self-host all runtime/model
  assets.
- Treat WebGPU or threaded WASM only as measured optional acceleration.
- Preserve `DiagramRecognizer` so another implementation remains possible.

## Consequences

The implementation stays close to upstream golden behavior and works offline
on Safari/iPad without a Kotlin port. Worker, canvas, and asset-cache behavior
must be evaluated on real iPad hardware.

## Issue #24 diagnostic evidence (2026-09-05)

The [controlled flat/hatch experiment](../investigations/issue-24-localization.md)
finds localization to be the dominant failure for the matched fixture pair:
the same classifier reads 47/48 hatch captures exactly with true corners,
versus 2/48 through unchanged detection. A bounds-rejection control removes
the four reliable wrong reads but does not recover reliable hatch recognition.

The browser-worker/WASM decision remains in force; no production implementation
changes here. Investigate a selection-aware localization patch/fork before
retraining or replacing the classifier. The final keep/patch/replace decision
remains blocked on #24's broader corpus, alternative comparison, and physical
iPad evidence. This note is diagnostic evidence, not that final decision.

## Issue #34 expanded baseline (2026-09-05)

The [locked 16-page corpus](../investigations/issue-34-corpus.md) records
unchanged browser-worker/WASM results separately for exact bounds, loose
selections and full pages. All three browsers measure 24/42 exact oracle
boards versus 9/42 on each recognizer path. Classification errors remain with
true corners, and negative/partial pages produce unreliable false detections.
These results fail the expanded provisional accuracy/detection targets.

This change reaffirms the existing browser-worker/WASM constraints and leaves
production recognition unchanged. It is not approval of FENShot's viability.
[#35](https://github.com/nino96/chess-reader/issues/35) owns candidate comparison
and the technical recommendation; #24 stays open with final physical-iPad
evidence explicitly deferred/unrun. No gate is lowered here.

## Issue #35 candidate decision (2026-09-05)

The [frozen comparison](../investigations/issue-35-comparison.md) recommends
**STOP production adoption for now**: neither unchanged FENShot nor the bounded
localization prototype meets the unchanged accuracy gate. The prototype raises
exact boards from 9/42 to 15/42 on each non-oracle path and removes v1
negative/partial false outputs, but misses boards and retains classifier errors.
True-bound classification is still only 24/42 exact. The prototype's hatch
PDF path additionally abstains in Firefox and WebKit; those two exactness
assertions remain failing. The unchanged production goldens and E2E pass.
2d-chess-ocr YOLO is disqualified before execution because the downstream MIT
labels do not reconcile with identified upstream model license terms.

Reaffirm the dedicated browser-worker, pinned self-hosted assets and WASM
constraints. The prototype is evaluation-only and is not a selected replacement;
the production pipeline continues using pinned upstream FENShot. Neither this
continuity nor a passing Chromium-only CI job establishes recognition viability.
No accuracy, negative, confidence or device gate is lowered. #24 stays open,
continues blocking #3/#6, and retains physical-iPad evidence as deferred/unrun.

Exact-bound failures justify a separately scoped TileNet training experiment
using pinned, fully licensed data and a new unseen validation set. The available
GB10 is training hardware, not a proposed inference service. A learned localizer
is appropriate when full-page coverage/alignment remains inadequate; a small
whole-board CNN is a later comparison if tile classification still fails with
correct geometry. Footprints and deployment suitability for hypothetical models
must be measured, not assumed. See the comparison's decision triggers and
provenance requirements. Production hotspots remain #7.
