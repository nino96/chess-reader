# Test and evaluation strategy

Status: required delivery gates
Last updated: 2026-09-03

## 1. Purpose

Tests in this project do two jobs:

1. prevent known behavior from regressing; and
2. give coding agents objective feedback when implementation choices are still
   uncertain.

A passing unit suite alone is not evidence that a reader, recognizer, storage
system, or chess engine is usable. Each feature issue names the relevant gates
from this document and attaches machine-readable results to its pull request.

## 2. Agent implementation loop

For every issue, the coding agent follows this loop:

1. Read the issue, architecture, limitations, accepted ADRs, and current eval
   baselines.
2. Reproduce the failing/missing behavior with a test or fixture first when
   practical.
3. For a product slice, implement the smallest end-to-end change that reaches
   its user-visible checkpoint. For focused infrastructure, exercise the change
   through the nearest already-working product path.
4. Run the narrow unit/contract suite on each meaningful iteration.
5. Run the issue's browser/device/eval gates before declaring completion.
6. Compare generated metrics with the checked-in baseline and budgets.
7. Inspect screenshots/traces for visual and interaction changes.
8. Add a minimized licensed/synthetic regression fixture for every discovered
   bug whose input can be stored.
9. Attach commands, environment, JSON results, and relevant traces/screenshots
   to the pull request.
10. Update an ADR when evidence changes a dependency or architecture decision.

Agents may improve a baseline. They may not delete a failing fixture, loosen a
threshold, or mark a target unsupported without an explicit reviewed ADR.

## 3. Standard commands

The bootstrap issue provides the fast commands needed immediately. Subsystem
issues add their eval commands when the corresponding implementation first
exists. A command must not be introduced as a passing no-op or placeholder.
The intended stable root command set is:

```text
pnpm check                 typecheck + formatting + lint
pnpm test:unit             pure model/component tests
pnpm test:contract         adapters against shared contracts
pnpm test:e2e              Chromium + Firefox + WebKit critical paths
pnpm eval:recognition      golden accuracy + latency report
pnpm eval:reader           PDF/EPUB compatibility + coordinate report
pnpm eval:storage          durability, quota, migration, backup report
pnpm eval:engine           UCI, correctness, capability, latency report
pnpm eval:offline          service-worker/update/offline readiness
pnpm eval:all              all non-device release gates
```

The exact runner may evolve, but command intent and JSON output schemas remain
stable or are versioned.

## 4. Test pyramid

### Unit tests

- locators and normalized coordinate transforms
- content and cache identity
- import state machine transitions
- IndexedDB migrations and repository invariants
- FEN parsing, editor validation, move-tree operations, SAN presentation
- recognition result/confidence mapping
- UCI streaming parser and score normalization
- capability selection and settings clamps
- backup schema/checksums/referential integrity

### Contract tests

Every volatile adapter runs against a shared behavioral suite:

- `ReaderSurface`: locator restore, viewport events, projection, capture, dispose
- `BookStorage`: managed/reference availability, re-link, delete, interrupted
  import recovery
- `DiagramRecognizer`: cancellation, normalized results, no-board, confidence
- `ChessRules`: perft, special moves, undo, SAN, arbitrary starting FEN
- `AnalysisEngine`: handshake, streamed MultiPV, cancel, stale-output rejection,
  crash/restart

Fakes must simulate slow completion and out-of-order results; happy-path-only
adapters do not pass.

### Browser integration and E2E

CI runs the critical journey on Chromium, Firefox, and Playwright WebKit:

```text
install/open PWA
  -> import fixture book
  -> navigate/restore
  -> detect and tap diagram
  -> correct position
  -> play/undo/branch
  -> analyze
  -> reload offline and restore
```

Desktop, tablet, narrow-phone, touch, keyboard, reduced-motion, dark/light, and
landscape/portrait configurations are covered where meaningful.

Playwright WebKit is a pre-release-derived WebKit build, not branded iPad Safari.
It is an early signal, not the real-device sign-off.

### Real-device gates

At release checkpoints, run a scripted checklist on:

- one recent physical iPad running a supported iPadOS version;
- one Android 12+ physical device in the Capacitor wrapper; and
- one representative laptop browser.

Record application commit, build manifest hash, OS/browser/device, storage
capabilities, cross-origin isolation, worker/WASM probes, memory warnings,
timings, result, notes, and evidence links in a versioned JSON schema under
release artifacts. Do not commit serial numbers or personal file paths.

## 5. Fixture corpus

`packages/test-fixtures/manifest.json` records for every fixture:

- stable id and SHA-256;
- source/generator and redistributable license;
- content type and feature tags;
- expected locators, rectangles, positions, orientation, and allowed tolerance;
- whether it is synthetic, public-domain, or transformed from an allowed source;
- known limitations and which eval suites consume it.

The minimum corpus includes:

- PDF: digital, scanned, rotated, mixed page sizes, two-page viewport, large
  file, corrupt file, password protected, zero/one/multiple diagrams;
- EPUB: EPUB 2/3, reflowable, fixed-layout, SVG/raster diagrams, repeated image,
  long chapter, RTL/vertical sample if supported, corrupt ZIP, zip bomb/path
  traversal, and malicious active-content samples;
- diagrams: common book fonts, hatching, grayscale, low resolution, reversed
  orientation, partial/false boards, annotations, and low-confidence pieces;
- chess: standard perft sets, special moves, SAN ambiguity, mate/stalemate,
  arbitrary full FENs, and nested variations;
- engine: complete/fragmented/malformed UCI logs, MultiPV interleaving, crash,
  timeout, and stale-session output.

Do not commit copyrighted user books. Reduce failures to synthetic equivalents
or retain them only in an explicitly local ignored corpus.

## 6. Recognition evaluation

For each model/runtime version, report:

- board-detection precision and recall at the declared rectangle IoU threshold;
- false-positive boards per negative page;
- exact piece-placement accuracy per board;
- square classification accuracy;
- orientation accuracy;
- calibration buckets for per-square/aggregate confidence;
- cold model initialization and warm recognition p50/p95;
- peak worker memory where measurable; and
- UI long tasks/jank while recognition runs.

Initial provisional usability gates on the reference iPad and Android device:

- no false positive on the required negative corpus;
- at least 95% exact-board accuracy on the core book corpus;
- at least 99.5% square accuracy;
- warm current-page recognition p50 no more than 1 second and p95 no more than
  2 seconds;
- cached result to tappable hotspot p95 no more than 100 ms; and
- no recognition-caused main-thread task over 100 ms during an active gesture.

These are targets to validate in the recognition issue, not claims about an
unmeasured device. A result below target triggers fixture inspection and
optimization; it does not silently change the threshold.

Every wrong confident square is higher priority than an honest low-confidence
result because the editor can recover the latter.

Issue #34's [locked feasibility protocol](investigations/issue-34-corpus.md)
extends the existing recognition command with observational browser reports
for exact-bound classification, loose selection and full-page detection.
Oracle geometry is excluded from detection scores, and missed boards remain
in accuracy denominators. These reports expose candidate failures; their
successful execution does not waive the provisional gates above or replace
the existing real-worker product golden assertions. Physical-iPad testing is
deferred for #34/#35 by owner instruction, with final device acceptance still
tracked on [#24](https://github.com/nino96/chess-reader/issues/24).

Corpus v1 byte regeneration is a required gate in the canonical Linux ARM64
GNU / Node 24.19.0 environment, with the frozen dependency lockfile. Native
x64 Skia rendering has measured one-level channel drift; the committed
inputs, exact hash assertions and accuracy targets remain unchanged.
The complete check/unit/license/build CI job runs on ARM64, while the
existing E2E and real-model evaluation jobs run on x64. See the
[regeneration evidence](investigations/issue-34-corpus.md#canonical-regeneration-environment).

## 7. Reader and hotspot evaluation

### PDF gates

- reopen/process restart returns to the expected page and scroll neighborhood;
- rectangles stay within 4 CSS pixels or 1% of displayed board size, whichever
  is larger, after zoom, scroll, rotation, resize, and panel movement;
- stale hotspots cannot be tapped after a viewport change;
- bounded capture never exceeds its documented pixel/memory ceiling; and
- adjacent partially visible pages retain distinct coordinate spaces.

### EPUB renderer scorecard

Readium Web/Thorium Web and EPUB.js each receive 0 (fail), 1 (workaround), or 2
(native/good) for:

1. local Blob/ArrayBuffer opening without a required application server;
2. PWA offline operation;
3. reflowable EPUB 2/3 compatibility;
4. fixed-layout compatibility;
5. stable locator restoration after reflow;
6. visible-image enumeration and rectangle projection;
7. iPad memory and interaction performance;
8. TOC and accessibility behavior;
9. disabling scripts/network and isolating parent storage;
10. COOP/COEP and Stockfish-thread compatibility;
11. maintained dependency/API risk; and
12. bundle size and integration complexity.

Items 1, 2, 5, 6, and 9 are mandatory and cannot be compensated by points in
other rows. Raw fixtures, implementation notes, bundle reports, and iPad
evidence accompany the scored ADR.

### EPUB security gates

Test publications attempt script execution, parent/local storage access,
external fetch/image/font/CSS loads, top navigation, popups, downloads, form
submission, `javascript:` URLs, path traversal, oversized decompression, and
bridge-message spoofing. Passing means no external request or parent-origin data
access occurred; a console warning alone is not sufficient.

## 8. Storage and recovery evaluation

Use real implementations plus fault-injection adapters to cover:

- `navigator.storage.persist()` granted, denied, and absent;
- estimate unavailable and quota smaller than an import;
- `QuotaExceededError` at every import phase;
- interruption/termination between every journal transition;
- OPFS file missing, truncated, wrong hash, or orphaned;
- IndexedDB migration upgrade, rollback, corruption, and multi-tab
  `versionchange` coordination;
- reference-mode close/reopen and content-hash re-link;
- user-cleared origin followed by backup restore/reimport;
- backup export, unsupported future version, altered checksum, broken reference,
  duplicate merge, and restore rollback;
- private-mode warning and session-only behavior; and
- storage pressure drill on real iPad where practical.

Invariant checks after every injected failure:

- no ready row points to partial bytes;
- no existing book/study data was lost;
- orphaned staging data is recoverable/collectable;
- reimporting identical bytes is idempotent; and
- a user correction is never overwritten by recognition cache repair.

## 9. Service-worker/offline evaluation

- first online install reaches an explicitly verified offline-ready state;
- airplane-mode cold start opens the app and a managed PDF/EPUB;
- recognition and the configured Stockfish variant initialize offline;
- an interrupted asset update continues using the old complete version;
- a bad hash or missing NNUE/model prevents activation and reports repair steps;
- activating a valid update does not discard unsaved state or IndexedDB data;
- cache cleanup never removes the active version; and
- deployment smoke tests verify CSP, COOP, COEP, CORP/CORS, MIME types, and
  `crossOriginIsolated` rather than checking configuration files only.

## 10. Chess and Stockfish evaluation

### Chess rules

- standard perft reference positions at practical depths;
- castling through check, en passant discovered check, all promotions,
  pins/check/mate/stalemate, SAN ambiguity, and non-starting full FEN;
- exact full-FEN reconstruction across undo/redo and nested branches; and
- persisted tree integrity under branch promote/delete operations.

### Stockfish

- verify the pinned build/NNUE provenance and upstream bench signature;
- UCI handshake and option discovery;
- known mate fixtures and legal PVs from arbitrary FENs;
- deterministic single-thread fixed-depth smoke output for the pinned build;
- portable and threaded worker paths when capabilities allow;
- correct score perspective, mate values, and MultiPV indexing;
- stop acknowledgement or worker termination within one second;
- no stale info after rapid position/session changes;
- allocation failure retries a conservative profile; and
- background/suspend/crash recreates the engine without losing study state.

Exact centipawn equality is asserted only for a pinned deterministic fixture. A
version update establishes a reviewed new baseline rather than weakening a test.

## 11. Interaction, visual, and accessibility gates

- screenshot baselines for phone, iPad split-view widths, tablet landscape, and
  desktop at stable fixture state;
- visual comparison for board orientation, overlays, confidence marks,
  promotion, move tree, MultiPV, errors, and storage health;
- pointer routing proves book gestures work outside the panel and board gestures
  never move/scroll the book;
- keyboard-only reading, diagram activation, board editing/moves, and engine
  control;
- minimum touch targets and safe-area behavior;
- axe/automated accessibility checks plus manual VoiceOver checkpoint on iPad;
- focus restoration when the panel opens/closes; and
- 200% text/zoom without losing essential controls.

## 12. Performance and resource budgets

Record cold/warm distributions rather than one run. The first measured vertical
slice establishes reference-device baselines for:

- app-shell cold and offline start;
- first PDF page and first EPUB spine item;
- page turn/reflow and locator persistence;
- recognition initialization/inference;
- cached hotspot and board opening;
- Stockfish nodes/second, stop latency, worker memory, and thermal observation;
- large-book import throughput and peak memory; and
- installed asset/book storage footprint.

During reading gestures, p95 rendered frame time should remain within the target
display's smooth-interaction budget and no project-owned long task should exceed
100 ms. Expensive jobs use bounded concurrency and expose cancellation.

## 13. Pull-request evidence template

Every implementation PR includes:

```text
Issue:
Commit:
Commands run:
Automated suites and browser projects:
Fixture manifest version:
Eval JSON artifact links:
Before/after metric comparison:
Devices/OS/browser used:
Screenshots/traces:
Known limitations:
ADR updated (yes/no, link):
```

“Tests pass” without command, environment, and artifact detail is not sufficient
for a reader/recognition/storage/engine issue.

## Issue #35 research measurement and qualification

The [frozen candidate comparison](investigations/issue-35-comparison.md) retains
the existing thresholds and all v1 baseline inputs. The original full command
reported 25 passed and two failed experimental hatch-PDF exactness checks
(Firefox/WebKit abstain). Those historical records remain unchanged.

The explicit [ADR 0005 update](decisions/0005-browser-recognition.md) separates
the research merge gate from candidate qualification:

| Command                         | Required outcome                                                                                                                                      | Meaning                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm eval:recognition`         | Complete, well-formed measurements, zero infrastructure/privacy failures and zero reliable wrong candidate outputs; unchanged production goldens pass | The investigation is reproducible. Candidate misses and inaccurate/unreliable reads are still recorded. |
| `pnpm eval:recognition:qualify` | All measurement requirements plus exact experimental PDF recognition                                                                                  | A necessary product checkpoint for this candidate; the current Firefox/WebKit hatch cases still fail.   |

Both commands execute the real three-browser corpus and PDF paths. Explicit
configuration metadata selects the contract; qualification uses separate product
report filenames. Reports expose qualification PASS/FAIL and reasons independently
of measurement exit status. No skip, expected failure, browser exception or
threshold reduction is permitted. CI runs the measurement contract in Chromium,
Firefox and WebKit, preserving production-golden assertions.

Passing either command does not establish production viability. All provisional
corpus accuracy, detection, confidence, latency and device gates remain required
for #24; a candidate below them remains ineligible. The technical recommendation
is STOP production adoption pending the bounded classifier/localizer research
and device qualifications tracked in #24. Physical iPad remains deferred/unrun.

## Issue #38 isolated training evidence

The [TileNet training report](../experiments/recognition-training/REPORT.md)
applies a [predeclared protocol](../experiments/recognition-training/protocol.json)
to a separate licensed synthetic train/development/test corpus. Corpus v1 and
all historical baselines remain unchanged and are used only for post-freeze
regression. Neither seed meets held-out promotion criteria. Improved public
regression scores do not override that failure. A post-freeze SVG fidelity
diagnostic also fails: the native decoder drops embedded CSS fills, so the
held-out failure is not clean evidence of architecture/generalization limits.
The original data stays frozen; rendering correction requires a new test lock.

CUDA training, CPU parity/inference and isolated three-browser classifier
measurements supplement the existing PDF selection -> worker -> editable-board
checkpoint. Experiment commands, source locks, failed attempts, confidence-aware
metrics, raw timing distributions and provenance are retained under
`experiments/recognition-training/`. No production recognizer, threshold or
qualification command changes. #24 remains open and physical iPad is deferred/unrun.

The [separately locked v2 replication](../experiments/recognition-training/v2/REPORT.md)
corrects SVG decoding and verifies all glyphs, tile/label ordering, degradation
pixels, full deterministic replay and reviewed tensor images before training.
Both bounded CUDA seeds still fail the held-out classifier gate; the original
experiment and historical inputs remain intact. Newly generated test boards
use previously exposed source artwork, so they are not blind new-family
validation. Hatch and degradation results are reported separately. This finding
supports further independent corpus-coverage research, not production adoption
or an architecture-limit claim. #24 and its deferred physical-iPad gate remain.
