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

## Research measurement and candidate qualification (2026-09-05)

The owner authorized merging #35 as a completed investigation, retaining its
STOP decision and creating [training issue #38](https://github.com/nino96/chess-reader/issues/38). The frozen run measured
all 828 corpus observations without infrastructure failures, while experimental
hatch selections abstained 6/6 times in Firefox and WebKit. Requiring a research
candidate to recognize those inputs exactly conflated an experiment's delivery
with eligibility to adopt its result.

Make that distinction explicit in the executable evaluation contract:

- `pnpm eval:recognition` remains the required research measurement gate. It
  runs all three browser engines, the unchanged production goldens, the complete corpus
  comparison and the real experimental PDF path. Missing/malformed observations,
  inference errors, invalid timings/version, external requests and reliable
  wrong experimental outputs fail this command. Honest candidate abstentions
  remain reported qualification failures.
- `pnpm eval:recognition:qualify` runs the same suite and additionally requires
  the experimental PDF selections to return exact boards. Its reports and exit
  status retain the two failing browser cases; no expected-failure annotation,
  skip or browser exception is used. Passing this small product checkpoint is
  necessary but insufficient for adoption: all existing corpus, reliability,
  resource and device criteria still apply.
- CI measures all three engines. Research infrastructure may merge with valid
  measurements and a STOP decision; production adoption may not use that green
  measurement result to waive red qualification evidence.

This explicitly revises the research merge gate introduced in #35. It does not
revise a numeric threshold, the frozen candidate, corpus v1 or any historical
baseline. The original 25-pass/two-failure run is retained unchanged, with the
new contract and its validation recorded separately in the comparison report.
#24 remains open; physical-iPad testing is deferred/unrun.

## Issue #38 bounded classifier training (2026-09-05)

The [synthetic-first TileNet experiment](../../experiments/recognition-training/REPORT.md)
completed the bounded local GB10 CUDA pilot and both predeclared full seeds.
Neither retrained classifier produced an exact board on the locked held-out
source family (0/256 each; raw square accuracy 79.72%/80.12%). Improvements on
public corpus v1 do not establish generalization or permit production adoption.
The STOP recommendation remains in force.

A post-freeze diagnostic confirmed that the pinned native SVG renderer ignores
embedded CSS fills, affecting source appearance in training and held-out data.
This confounds the generalization interpretation; the results cannot establish
a TileNet architecture limit. Correct and verify rendering under a new
predeclared test lock before further training or architecture comparison.
Neither the learned-localizer nor whole-board context trigger is supported.
The original corpus and failed diagnostic remain intact; no second architecture
is trained here.

Reaffirm dedicated browser-worker/WASM inference, pinned self-hosted assets,
unchanged production recognition, and all existing confidence, accuracy,
privacy, offline and device gates. Experiment tooling and weights remain
separate from the PWA runtime. #24 stays open; physical-iPad testing remains
deferred/unrun. This evidence note changes no architectural decision or gate.

## Issue #38 corrected-renderer replication (2026-09-05)

The [versioned v2 experiment](../../experiments/recognition-training/v2/REPORT.md)
uses fidelity-verified SVG/PNG rendering and a new predeclared board/test lock.
Both full seeds completed but still produced zero exact held-out boards, with
systematic glyph/color transfer errors across plain and degraded conditions.
Source fidelity and full-data replay now pass. The original failed experiment
and corpus v1 remain unchanged; the test source family was previously exposed
and is explicitly not presented as blind independent validation.

Retain STOP production adoption. The shipped TileNet reads the identical inputs
substantially better, so these failures do not prove an architecture limit or
justify a whole-board model by themselves. Further licensed grayscale/glyph
coverage research needs a new independent test design. The heuristic localizer
remains unqualified; learned localization, including multiple-board pages,
remains a separate experiment. Dedicated worker/WASM inference, all existing
gates, unchanged production recognition and #24's deferred physical-iPad
requirement remain in force. No architectural decision or threshold changes.
