# Issue #35: localization candidate comparison

Issue: [#35](https://github.com/nino96/chess-reader/issues/35), execution slice of
[#24](https://github.com/nino96/chess-reader/issues/24). Dependency #34 merged in
[PR #36](https://github.com/nino96/chess-reader/pull/36), merge commit
`ae4e9061b812c07ee6a84e448050cf5de6ccc9a8`, confirmed before branching from updated
`origin/main`. Physical-iPad testing is deferred/unrun by owner instruction.

## Recommendation: STOP production adoption for now

Neither executed candidate meets the unchanged accuracy gate. The bounded
localizer improves detection and rejects the tested negative/partial inputs,
but reaches only **15/42 exact boards (35.71%)** on either non-oracle path.
The retained classifier also fails with true geometry (24/42, 57.14%). The
alternative is disqualified before execution by unresolved model licensing.
Do not replace the production recognizer or advance #24's downstream viability
checkpoint on this evidence. Keep the existing demo and the prototype as
research artifacts; this is **not approval of upstream FENShot**.

The software comparison is complete, with failing candidate evidence retained.
The original frozen `pnpm eval:recognition` run finished **25 passed, 2 failed**: the experimental hatch
PDF abstains in Firefox and WebKit. These exactness failures are retained under
`pnpm eval:recognition:qualify`; the revised default command validates research
measurements under the explicit [ADR 0005 policy](../decisions/0005-browser-recognition.md).
The unchanged product goldens pass in all three browsers. Physical iPad is
**deferred/unrun**, and #24 remains open with final acceptance blocked.
The next bounded research step is the TileNet training experiment below;
localization coverage and capture sensitivity also justify testing a learned
localizer. Whole-board classification has a later, explicit trigger.

## Protocol declared before candidate measurement

Preserve [corpus v1](../../packages/test-fixtures/corpus/v1/OVERVIEW.md), manifest
SHA-256 `767c0e91c7c685495a8d1be37fc8605208ca9e2dc6b672c39ea2d47567189b7a`,
and all [unchanged #34 baselines](issue-34-corpus.md). No new corpus version,
fixture removal, or confidence/accuracy threshold change is authorized here.

Development inputs are synthetic unit grids, the original flat/hatch PDFs,
and the v1 pair `flat-gray-middlegame-white` and
`matched-hatch-45-middlegame-white`. The remaining 14 pages are held out from
mitigation tuning. Their historical upstream scores are already public: this
is a held-out candidate experiment, not blind validation or independent book
representativeness evidence. Freeze the candidate implementation before the
first full-corpus candidate run; retain every failure afterward.

The three candidates are unchanged FENShot, a bounded pixel-based localization
prototype retaining the same classifier weights, and an alternative recognizer
with either execution evidence or a precise pre-execution product-contract
disqualification. Source review alone is never labelled a benchmark.

Use the existing 46-input plan, unchanged crops and scoring: exact bounds are
classifier-only diagnostics; loose selections have 8% padding per side; full
pages receive pixels only, without truth, expected board count or user hints.
Use three fresh sequential worker sessions per candidate/browser. Missed and
duplicate boards and every negative/partial output remain failures. Report
stage/style and development/held-out groups separately. An empty output is
abstention, not accuracy; zero reliable wrong with zero useful coverage cannot
win the comparison.

The prototype generates complete square 8×8 candidates using spatial evidence,
requires boundaries inside the image, limits search and output count, and does
not choose geometry by mean classifier confidence. It neither clamps upstream
corners nor receives the known board rectangle. Manual selections use the same
detector on their smaller pixel inputs. FENShot's 0.7 minimum confidence floor,
classifier and orientation resolver are retained; orientation ambiguity remains
a measured limitation. No model training or new runtime dependency is included.

A separate evaluation build at `/localized.html` exercises the existing React
PDF selection, capture, `DiagramRecognizer`, real worker and editable board.
It swaps the factory only at build time and is absent from ordinary production
builds. A selection containing multiple candidates abstains rather than choosing
by confidence. Production automatic hotspots, UI projection, page prefetch and
cache lifecycle remain [#7](https://github.com/nino96/chess-reader/issues/7).

Stage time excludes decode/crop, conversion, worker transport, initialization
and editor paint. Worker round trip also excludes PDF capture and editor paint;
it is not complete user latency. Fresh sessions do not purge browser/disk
caches. Report cold/warm distributions without extrapolating device latency.
Model/runtime bytes and hashes remain pinned; memory fields identify exactly
what is observable and do not stand in for unmeasured worker/WASM peak memory.

The recommendation must retain the 95% exact-board, 99.5% square, negative and
reference-device latency criteria in [evaluation §6](../evaluation.md#6-recognition-evaluation).
Failing any criterion stays explicit. #24 remains open and continues to own the
final acceptance and downstream blockers.

## Frozen prototype and development record

`integral-checkerboard-v1` accepts the existing 4096-pixel adapter bound but
block-averages to at most 256 pixels per edge for its search. Corpus inputs
remain at most 1024 pixels. The existing PDF capture can round a configured
1024-pixel edge to 1025; its production capture policy is not changed here.
Search uses size factor 1.1, quarter-cell coarse steps (minimum two pixels),
48 spatially diverse coarse seeds and 96 refined states. It requires signed
checkerboard contrast of at least 14, score at least 1.15 and support on all
eight ranks/files; a near-overlapping materially distinct geometry within
3.5% score triggers abstention. At most four candidates reach classification.
The nominal minimum board is 64 pixels; a minimum 24-pixel reduced board
also limits small-board resolution on large inputs.

Native refinement checks near-edge background completeness on all 64 squares,
then searches a phase radius of `min(32, 3 * downsampleScale)` and a small
position/size neighborhood using checkerboard and all seven internal horizontal
and vertical edge projections. Geometry is decided before classification.
The synchronous geometry search is bounded; a user cancel rejects the main
request immediately and stale results are dropped. Worker messages cannot
interrupt a synchronous JavaScript section; cancellation checks around each
asynchronous classifier call prevent remaining candidate inference. The worker
watchdog retains its existing termination/recovery behavior. This is not #6's
complete production scheduling/hardening work.

Pre-freeze development exposed and retained these findings:

1. Initial sparse coarse search abstained on both v1 development pages.
   Denser, spatially diverse seeds recovered complete candidates.
2. Background-patch scores had broad alignment plateaus: both development PDF
   paths initially produced 0/6 exact, unreliable boards. Native edge refinement
   recovered the flat PDF (6/6), while hatch still failed (0/6).
3. The actual synthetic hatch capture (977×1025 pixels) exposed a candidate
   missing edge strips. Near-edge completeness and bounded phase refinement
   recovered 6/6 exact hatch reads, with editing and flipping tested. The two
   v1 development pages retained exact bounds for both full-page and loose
   inputs. No held-out page informed these changes.

These are development observations, not independent accuracy evidence. The
existing 0.7 confidence floor, accuracy targets, corpus bytes, upstream baseline
and product golden assertions were never lowered. The new PDF exactness checks
failed during development and passed after the geometric correction.

## Frozen comparison results

The first and only full-corpus candidate run used clean freeze commit
`0bd66cf6a8ac2ec5966b2457bb179cb4a2ca0687`. No candidate source changed after
viewing held-out results. All 828 planned observations completed: two candidates
× 46 inputs × three sessions × three browsers. Corpus workers had zero
infrastructure failures and zero recorded external requests. The command's two
failures are separate experimental PDF-product assertions, not missing corpus
measurements. Counts are identical across Chromium 151.0.7922.34, Firefox 153.0
and Playwright WebKit 26.5 on Linux ARM64, Node 24.19.0, the GB10 host, CPU/WASM
single-thread inference. These are 14 board designs repeated three times per
browser, not 42 independent examples.

| Input/candidate                             | Exact boards |     Square accuracy | Matched / expected | Detection precision | Reliable exact | Reliable wrong |
| ------------------------------------------- | -----------: | ------------------: | -----------------: | ------------------: | -------------: | -------------: |
| Exact bounds, either candidate (diagnostic) |        24/42 | 2643/2688 (98.326%) |                N/A |                 N/A |          12/42 |              0 |
| Loose selection, unchanged                  |         9/42 | 1479/2688 (55.022%) |              24/42 |      24/45 (53.33%) |           6/42 |              0 |
| Loose selection, prototype                  |        15/42 | 2052/2688 (76.339%) |              33/42 |        33/33 (100%) |           6/42 |              0 |
| Full page, unchanged                        |         9/42 | 1320/2688 (49.107%) |              21/42 |      21/39 (53.85%) |           3/42 |              0 |
| Full page, prototype                        |        15/42 | 1881/2688 (69.978%) |              30/42 |        30/30 (100%) |           9/42 |              0 |

Prototype misses remain 9/42 manual and 12/42 full-page, with grid-aligned
counts 30/42 and 27/42 respectively. It returns no candidates on any of the
text/table negatives or partial-board inputs. It has no external boxes,
duplicates or reliable wrong study positions on v1. However, each multi-board
page still produces just one candidate, so both pages miss a complete board.
Zero false positives and zero reliable wrong results do not compensate for
low useful coverage. Upstream's four reliable wrong shifted reads in the
preserved #24 diagnostic remain a known defect of the unchanged demo; the v1
counts do not erase them or establish that this prototype fixes every legacy
capture condition.

The six development board observations are exact on both prototype paths.
The held-out 36 board observations are only 9/36 exact, versus 6/36 for upstream,
with 18/36 exact in the oracle. A useful held-out gain is sparse 45-degree hatch
localization. A regression remains: the small flat diagram's loose selection
on `two-boards-flat-hatch` was 3/3 exact/reliable upstream and is now missed 3/3.
Dense hatch, degraded and halftone failures remain visible. All per-input/style
results are in the [comparison table](../eval-baselines/issue-35-summary.md)
and raw [Chromium](../eval-baselines/issue-35-localized-chromium.json),
[Firefox](../eval-baselines/issue-35-localized-firefox.json), and
[WebKit](../eval-baselines/issue-35-localized-webkit.json) reports. The rerun
controls are retained separately as `issue-35-control-*.json`; none of the
historical #34 baseline files is overwritten.

Identifiable orientation is correct on 27/39 expected prototype boards for
each recognizer path, versus 18/39 upstream and 36/39 in the oracle. The
pawnless black oracle still gets orientation wrong, and the pinned resolver
still cannot acknowledge the three ambiguous-truth observations. Recognition
never invents side-to-move, castling or other non-image FEN state. Geometry
improvement is not proof of orientation or classifier qualification.

### Cost and browser product path

| Browser  | Prototype model initialization p50/p95 (n=3), ms | Manual model-warm stage p50/p95 (n=48), ms | Full-page model-warm stage p50/p95 (n=48), ms |
| -------- | -----------------------------------------------: | -----------------------------------------: | --------------------------------------------: |
| Chromium |                                    498.7 / 529.4 |                              492.2 / 991.7 |                                 856.1 / 968.2 |
| Firefox  |                                    589.6 / 626.0 |                            1225.7 / 2076.6 |                               1854.5 / 1983.7 |
| WebKit   |                                    542.6 / 570.1 |                             409.2 / 1203.0 |                                 732.0 / 828.5 |

The first manual call in each session includes deferred candidate-module
initialization. Vite bundles worker dynamic imports into the worker artifact,
so the control worker still parses the candidate code; it does not execute
candidate localization. The rerun shares that harness environment. Historical
cold timings are therefore references, not a byte-identical worker-start
comparison. Timings exclude decode/crop, grayscale conversion, transport,
initialization and editor paint. They are not iPad or training throughput.
Firefox's host timings exceed the numeric p50 target, but the actual reference
physical-device latency gate remains unrun.

No new weights/runtime are downloaded: the unchanged ONNX is 1,289,483 bytes
and WASM is 13,961,845 bytes (15,251,328 binary bytes combined), with pinned
hashes reverified in every corpus worker. This is not the total application
transfer size. The frozen build's ordinary worker is 82,373 bytes and its
experimental product worker 89,202 bytes (uncompressed JavaScript); the prototype
also adds maintenance of a 551-line geometry implementation. That complexity
and runtime cost are not justified for production by the observed accuracy.
Peak worker/WASM memory and UI long-task distributions were not measured; no
main-page heap or host RAM value is substituted for them. Those qualifications
remain on #24. Existing offline asset packaging/readiness remains #3; local,
self-hosted inference is not a claim of offline reload readiness today.

The separate [real-PDF product records](../eval-baselines/issue-35-product-selection.json)
use three fresh worker/page sessions and two captures each. Flat PDFs are
6/6 exact and reliable in every browser; hatch is 6/6 in Chromium and **0/6
(no-board) in both Firefox and WebKit**. The existing upstream flat golden
remains 6/6 exact/reliable in each browser
([retained records](../eval-baselines/issue-35-product-goldens.json)). This is a
real capture-path sensitivity despite identical corpus-PNG results; the cause
was not isolated after the freeze and must not be labelled a browser defect or
hidden by tuning against these failures. Flat selection/edit/flip works through
the shared reader and board in all three browsers. The candidate's hatch
exactness checks remain failing rather than being weakened or skipped.

Prototype flat worker-round-trip cold p50/p95 is 1142/1185 ms Chromium,
3299/3338 ms Firefox and 1555/1557 ms WebKit (n=3 each); warm p50/p95 is
829/833, 2763/2771 and 1290/1297 ms (n=3 each). Chromium hatch cold is
1263/1283 ms and warm 910/912 ms. Failed hatch abstentions still consume warm
p50/p95 3896/3906 ms Firefox and 1283/1293 ms WebKit. These round trips start
**after PDF capture**, exclude editor paint, and preserve failed outcomes;
they are not complete end-to-end user latency. Fresh sessions do not purge
browser/disk caches. See raw records for every observation and distribution.

## Alternative: pre-execution disqualification

**2d-chess-ocr YOLO/ONNX is disqualified before execution for this comparison.**
The required permissive, compatible model license is not established by its
conflicting provenance. No alternative weights were downloaded or executed.
There are no alternative corpus accuracy, latency or memory results.

Source review on 2026-09-05 pins the repository to
[`94d6a8157524825fcfda4f27c430577eec04b356`](https://github.com/AndrewSpano/2d-chess-ocr/commit/94d6a8157524825fcfda4f27c430577eec04b356)
and weights to Hugging Face revision
[`03d9df9fc14fade1a3579683fd0de215b3864ee1`](https://huggingface.co/api/models/AndrewSpano/2d-chess-ocr/revision/03d9df9fc14fade1a3579683fd0de215b3864ee1?blobs=true).
The repository and model metadata label the work MIT. However, the
[training instructions](https://github.com/AndrewSpano/2d-chess-ocr/blob/94d6a8157524825fcfda4f27c430577eec04b356/model_training/README.md)
start from `yolo26m.pt`, and the
[trainer](https://github.com/AndrewSpano/2d-chess-ocr/blob/94d6a8157524825fcfda4f27c430577eec04b356/model_training/train_yolo.py)
and [exporter](https://github.com/AndrewSpano/2d-chess-ocr/blob/94d6a8157524825fcfda4f27c430577eec04b356/model_training/export_yolo.py)
use Ultralytics. Its locked Ultralytics 8.4.54 corresponds to
[`03f5a8046c11f73828b4c51d469cbb29c5d4e0a7`](https://github.com/ultralytics/ultralytics/tree/03f5a8046c11f73828b4c51d469cbb29c5d4e0a7),
whose [package metadata](https://github.com/ultralytics/ultralytics/blob/03f5a8046c11f73828b4c51d469cbb29c5d4e0a7/pyproject.toml)
declares AGPL-3.0 and whose
[license statement](https://github.com/ultralytics/ultralytics/blob/03f5a8046c11f73828b4c51d469cbb29c5d4e0a7/README.md#license)
covers its software and AI models. The downstream MIT label does not establish
that the upstream model rights were relicensed. Under the existing
[dependency policy](../dependency-policy.md), conflicting/AGPL model provenance
requires review; this slice neither obtains a grant nor changes the permissive
candidate criterion. This is an evidence-based eligibility decision for #35,
not a legal determination that future clarified licensing or another model is
impossible.

The immutable publisher metadata above supplies these exact values; hashes
are publisher LFS metadata, **not local verification of downloaded bytes**:

| ONNX asset               |      Bytes | SHA-256                                                            |
| ------------------------ | ---------: | ------------------------------------------------------------------ |
| `yolo26m-finetuned.onnx` | 81,764,872 | `a8e78afa8e00cd7ee39a941f888327bd85a12c3cf5c2140a4fa882ea3f7abff7` |
| `yolo26n-finetuned.onnx` |  9,817,138 | `d098a71847fac9b98e9cfcfde5854cee8b518d96503b2f006aa561f8b627db39` |

The [shipped inference](https://github.com/AndrewSpano/2d-chess-ocr/blob/94d6a8157524825fcfda4f27c430577eec04b356/model_inference.py)
loads ONNX through Python Ultralytics; no browser-worker implementation is
provided. ONNX export suggests possible browser porting, not verified browser
compatibility. The [download helper](https://github.com/AndrewSpano/2d-chess-ocr/blob/94d6a8157524825fcfda4f27c430577eec04b356/download_models.py)
is unpinned and unfiltered, fetching the full published repository (783,833,540
bytes at this revision, including six weight files), rather than only the nano
ONNX. A reviewed local port could avoid those extra assets, but not resolve the
license conflict by itself. Upstream GPU accuracy/throughput claims are not
substituted for a run on corpus v1.

Fenify was also checked at release/main
[`e9a4fd252ea4be322c560a9b78a2b9da31f49735`](https://github.com/notnil/fenify/tree/e9a4fd252ea4be322c560a9b78a2b9da31f49735).
Its [predictor](https://github.com/notnil/fenify/blob/e9a4fd252ea4be322c560a9b78a2b9da31f49735/src/board_predictor.py)
uses `torch.jit.load` and a resized 300×300 exact board crop; its
[README](https://github.com/notnil/fenify/blob/e9a4fd252ea4be322c560a9b78a2b9da31f49735/README.md)
explicitly excludes localization and orientation detection. Its CPU
[release asset](https://github.com/notnil/fenify/releases/tag/v2023-07-10)
is 127,147,094 bytes; publisher SHA-256 is unavailable (`digest: null` in the
release API). The repository is MIT, but release-model license scope is not
separately established here. It supplies Python/PyTorch, not a browser-worker
path. These are constraints, not proof conversion is impossible. No Fenify
weights were downloaded and no benchmark is claimed. The allowed alternative
accounting for this time box is the evidenced 2d-chess-ocr disqualification above;
Fenify is additional source review only, not an omitted promised fourth run.

## Training options and decision triggers

The owner's proposed training options are part of this decision. The available
GX10/GB10 can support a separately scoped local training investigation; #35 does
not turn into an open-ended training program. Training hardware and deployment
hardware have different roles: any resulting model must still pass local,
offline browser-worker/WASM evaluation on the target devices. No server endpoint
or book upload is introduced.

| Option                                 | When to consider it                                                                                                                                                       | Next bounded experiment                                                                                                                                                                                                                                         | What would justify adoption                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retrained FENShot TileNet              | Exact-bound classifier controls fail across styles even after geometry is correct. This trigger is already present in v1 (24/42 exact boards, 98.326% squares).           | Retain the architecture/export contract and compare current weights against a reproducible training run with licensed style/degradation coverage; distinguish fine-tuning from random initialization.                                                           | Improved held-out exact-board and square accuracy without increasing reliable wrong results, followed by improvement on non-oracle manual/full-page paths and browser/device size/latency gates. |
| Tiny learned board localizer + TileNet | A bounded pixel localizer still misses complete boards or misaligns grids on held-out full pages and loose selections.                                                    | Train a permissively licensed detector from scratch on separately generated complete-page layouts, including multi-board, text/grid negatives and partial boards; emit complete-board geometry or abstention. Keep TileNet fixed to isolate localization gains. | Better recall/IoU and sub-square alignment with zero accepted negative/partial positions; retain classifier controls so localization gains cannot hide classification failures.                  |
| Small whole-board CNN                  | Correct localization plus a bounded tile-classifier training experiment still fails the exact-board gate; investigate whether spatial context helps piece classification. | Compare a small model producing 64×13 image-relative square outputs on identical crops, without legality-based repair or invented non-image state.                                                                                                              | Better held-out exact-board accuracy and calibrated confidence than TileNet at acceptable measured model size, memory and browser latency; then validate the complete detector-to-editor path.   |

The two-stage learned-localizer + TileNet option directly addresses detection
while allowing classifier improvements to be measured independently. The
whole-board CNN is a later comparison, not an assumed cure: global context can
also learn position priors and confidently fill in unsupported pieces. Include
sparse, unusual and ambiguous positions and retain manual correction.

The current TileNet asset is 1,289,483 bytes. “Few MB” for either proposed new
architecture is a design budget, **not a measured footprint**. Training from
scratch is available as an experimental choice, not automatically preferable
to retaining or fine-tuning the existing small architecture. Before allocating
a longer training effort, require a fixed data generator/seed, permissive
provenance for glyphs and weights, a bounded run budget, reproducible export and
the unchanged evaluation targets. Do not train on corpus v1: it has already
been used to choose this research direction, so preserve it as a historical
regression set and create a separately versioned unseen validation set before
training. The existing 14-page candidate holdout is not a fresh holdout for a
model whose training choices were informed by this report.

These experiments remain tracked by [#24](https://github.com/nino96/chess-reader/issues/24).
They require a separate scope decision after the present comparison; none is
silently absorbed into #7's production hotspots or #6's durable cache.

### GB10 and the existing training code

Read-only host verification returned `NVIDIA GB10`, driver `580.159.03` from
`nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader`.
The query reports memory total as `N/A`, not zero. The sandboxed process could
not see the GPU device nodes; the host-context check succeeded. No training run,
throughput, usable training memory or CUDA/PyTorch inference was benchmarked.
The host has CUDA SDK 13.0.3 / nvcc 13.0.88; the system Python environment does
not have the Torch/ONNX training dependencies installed. This is a preparation
requirement for the follow-up, not a claim that the GB10 is unavailable.

The FENShot tile-classifier tree is identical at pinned v0.1.4
`5e68f7a04e1261328572caf74a2d4a44a342a6c7` and reviewed current main
`f964fd16de798f73db3ea0f9f1e374e4052a2665` (tree object
`c3a26f4fca2c643e41031944d8c1b533b8100acb`). Its
[training implementation](https://github.com/scoriiu/fenshot/blob/f964fd16de798f73db3ea0f9f1e374e4052a2665/tools/tile-classifier/train.py)
constructs a fresh TileNet, rather than loading the shipped weights. It has
321,805 trainable parameters and exports softmax ONNX opset 17 with dynamic
`[N,1024] -> [N,13]`. Thus “retrain FENShot” can already mean training the same
small architecture from scratch, rather than designing a new architecture.
The code selects MPS or CPU only; a CUDA-first selection and verified CUDA build
are required to use the GB10. Existing seeds alone do not establish identical
results across GPU libraries and kernels.

Do not reuse the upstream
[asset downloader](https://github.com/scoriiu/fenshot/blob/f964fd16de798f73db3ea0f9f1e374e4052a2665/tools/tile-classifier/download-assets.ts)
without a provenance review: it uses mutable Lila `master` and Chess.com CDN
URLs without exact revision/hash/license records. Begin a bounded capacity
experiment with the already accepted Apache-2.0 Chessnut glyphs and CC0 print
styles, explicitly retaining the single-family limitation. Qualification needs
additional independently licensed families and a manifest of source revisions,
hashes, generator/config, seeds, checkpoint/export identity and notices.

A concrete next experiment is 2–3 predeclared training seeds on the unchanged
TileNet architecture, with validation split by whole glyph/style/degradation
families rather than individual tiles. Select checkpoints using that grouped
validation, freeze exports before evaluation, and retain every seed's result.
Promotion requires PyTorch/ONNX numeric parity, input/output/class-order checks,
ORT-Web execution in Chromium/Firefox/WebKit, exact/loose/full-page accuracy,
negative/partial abstention, complete download size, cold/warm and observable
memory measurements, cancellation/recovery, offline requests and the real PDF
selection/editor path. Physical-iPad qualification remains outstanding on #24.

## Frozen-run verification and #24 acceptance mapping

| Command/check                                                             | Result                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                              | Passed: strict TypeScript, Prettier and ESLint. Initial lint issues in new tests were fixed without changing assertions.                                                                                                                                             |
| `pnpm test:unit`                                                          | Passed: 386 tests in 29 files, including existing adapter contracts, exact corpus regeneration, seven localizer tests and cancellation-between-classifier regression.                                                                                                |
| `pnpm test:e2e`                                                           | Passed: 219 tests; 15 existing conditional touch/keyboard skips. All six configured projects ran, including Chromium, Firefox and WebKit real-model product paths.                                                                                                   |
| `pnpm eval:recognition`                                                   | **Failed: 25 passed, 2 failed.** All 828 corpus observations and paired reports completed. Experimental hatch PDF exactness fails in Firefox/WebKit (6/6 abstentions each); original product goldens pass 6/6 per browser. No candidate gate is weakened or skipped. |
| `pnpm check:licenses`                                                     | Passed: 25 production packages; no added dependency/model/runtime/font. Alternative weight execution was disqualified before download.                                                                                                                               |
| Production/evaluation build                                               | Passed as part of browser commands. Ordinary output excludes the evaluation entries and candidate module.                                                                                                                                                            |
| Changed-document links, formatting, `git diff --check`                    | Passed on final evidence documentation.                                                                                                                                                                                                                              |
| Physical supported iPad                                                   | **Deferred/unrun** by owner instruction; final #24 acceptance remains blocked.                                                                                                                                                                                       |
| Separate contracts/other subsystem evals                                  | Not present; contracts ran in `test:unit`. No placeholder command added.                                                                                                                                                                                             |
| Peak worker memory, full user-latency and gesture long-task qualification | Unrun/unmeasured; stage and worker round-trip timings are explicitly narrower. Tracked by #24.                                                                                                                                                                       |

The failed experimental checks are deliberate retained evidence of the candidate
failing its proposed product behavior, not approved new baselines. The original draft was not merge-ready with its conflated research/qualification
gate. The explicit research handoff policy below separates these contracts;
it does not qualify the candidate or alter this frozen run's outcome.

| Parent #24 criterion                                                               | Evidence/status                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked corpus and provenance                                                       | Met by #34; all v1 bytes and historical baselines preserved and hash-asserted.                                                                                                                                                          |
| Per-style localization, placement, orientation, confidence, abstention and latency | Met for software measurement: separate control/candidate/oracle reports, all misses and unreliable results retained. Numeric accuracy criteria fail.                                                                                    |
| Three candidate paths or precise pre-execution failure                             | Met: upstream and mitigation executed on identical inputs; 2d-chess-ocr YOLO disqualified by specific incompatible/unresolved license provenance. No alternative accuracy claimed.                                                      |
| Physical-iPad result for recommended browser path                                  | **Unmet/deferred.** No production candidate recommended; parent final acceptance stays blocked.                                                                                                                                         |
| Explicit keep/patch/replace/stop recommendation                                    | **STOP production adoption**; a patch is promising research evidence but not a qualified recognizer. TileNet training is justified now, learned localization has a defined trigger, and whole-board CNN comparison has a later trigger. |
| ADR 0005 updated                                                                   | Reaffirm browser-worker/WASM constraints with this failure evidence and no production recognizer replacement.                                                                                                                           |

The exact remaining #24 blockers are low exact/square accuracy even with true
bounds, prototype misses and capture-path sensitivity, poor Firefox host
latency, unqualified memory/interaction costs, no licensed executed replacement,
and final physical-device evidence. #24 remains open and continues blocking
#3/#6. No #7 hotspots or #6 cache work is included.

For later device work, once a browser candidate clears software qualification:

1. Record supported physical iPad model, iPadOS, Safari/Home Screen mode, commit,
   asset hashes and worker/WASM capabilities.
2. Run the same synthetic flat/hatch and negative/partial selections through
   real PDF capture, editing and orientation correction; retain failures.
3. Measure at least three fresh sessions and a declared warm-repeat matrix,
   separating capture, initialization, inference, transport and editor response;
   record available memory evidence and gesture long tasks.
4. Cancel/reselect during work, edit before a late result, and background/resume;
   prove stale output cannot replace a correction. Offline reload/durability
   requirements remain with their implementing issues, not assumed here.

Delegation: one worker implemented localization on declared development inputs;
one implemented and reviewed comparison accounting/protocol/source integrity;
a read-only explorer verified alternative/training provenance and reviewed the
product seam. The lead owned the design, experimental product integration,
cancellation correction, source freeze, diff/visual review, full commands and
recommendation. Hardware access required host-context execution; no models were
trained. Reviewed synthetic screenshots show the existing scrollable editor;
no layout redesign or physical-iPad sizing claim is made (#29 remains separate).

## Research handoff contract

After reviewing the failed experiment, the owner authorized a research handoff,
merge and [a separate in-repository TileNet training issue (#38)](https://github.com/nino96/chess-reader/issues/38).
[ADR 0005](../decisions/0005-browser-recognition.md) and
[the evaluation policy](../evaluation.md#issue-35-research-measurement-and-qualification)
explicitly revise the research merge gate: `pnpm eval:recognition` requires
complete valid measurements, safe candidate outputs and unchanged production
goldens. `pnpm eval:recognition:qualify` additionally retains exact experimental
PDF assertions. Both run the complete three-browser suite, with qualification
PASS/FAIL and reasons in product reports regardless of the command's exit status.
CI now measures all three engines.

This changes the test contract, not the candidate or its measured accuracy.
The frozen localizer, corpus v1 and all previously committed raw JSON remain
byte-for-byte unchanged. An abstention is valid measurement data and a failed
recognition result. Numeric corpus gates and physical-device acceptance remain
unchanged; even a passing product qualification command alone cannot satisfy
#24. The STOP recommendation remains in force.

### Handoff validation

Both full commands ran from clean commit
`17b06e9b38b18003f40459d138f871e178e48821` on the same Linux ARM64 host and pinned
browser/runtime versions as the frozen experiment:

| Command/check                      | Actual result                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                       | Passed: types, formatting and lint.                                                                                                                                                                                                                                                                                                           |
| `pnpm test:unit`                   | 386 passed in 29 files, including existing contracts.                                                                                                                                                                                                                                                                                         |
| `pnpm eval:recognition`            | **42 passed**, 9.1 minutes, all three browsers.                                                                                                                                                                                                                                                                                               |
| `pnpm eval:recognition:qualify`    | **40 passed, 2 failed**, 9.2 minutes, exit 1. Firefox and WebKit hatch selections each abstain 6/6; all original product goldens pass.                                                                                                                                                                                                        |
| `pnpm check:licenses`              | Passed: 25 production packages.                                                                                                                                                                                                                                                                                                               |
| Full E2E and builds                | [All source-commit CI jobs passed](https://github.com/nino96/chess-reader/actions/runs/33977684876), including the three E2E jobs covering all six configured projects and the expanded three-browser measurement matrix. The earlier local 219-pass/15-existing-skip E2E evidence remains applicable; this revision changes no product code. |
| Frozen evidence integrity          | 41 corpus/baseline/source/report files checked byte-for-byte against `04c3adf`; no changes.                                                                                                                                                                                                                                                   |
| Local links and `git diff --check` | Passed.                                                                                                                                                                                                                                                                                                                                       |
| Physical iPad                      | **Deferred/unrun**; #24 remains open.                                                                                                                                                                                                                                                                                                         |

The extra 15 checks are five meaningful assessment regressions in each browser
project: explicit mode, malformed/error data, the actual no-board contract,
reliable-wrong safety, and run completeness/cold sequence. They do not replace
a browser selection, corpus observation or production golden.

The [handoff product records](../eval-baselines/issue-35-handoff-product-selection.json)
retain all 12 per-fixture/browser/mode reports, including raw observations and
qualification FAIL reasons. The
[validation artifact](../eval-baselines/issue-35-handoff-validation.json) records
command exits, source/environment, hashes, raw rerun timings and distributions.
All 1,656 corpus observations across both commands have identical non-timing
fields, including full scored geometry/confidence records, to the original
`issue-35-control-*` and `issue-35-localized-*` references. Those original files
remain the retained raw accuracy evidence; rerun JSON paths/hashes are recorded
without replacing them. CI uploads the measurement reports as separate
per-browser artifacts. Qualification JSON and traces remain in their distinct
local directories described in [testing](../testing.md#issue-35-comparison).

A delegated implementation worker validated the harness, and an independent
read-only reviewer approved the explicit policy and final code contract. The
lead inspected the diffs, corrected no-board/version validation during review,
verified preserved bytes and ran both full commands. This approves the research
handoff with its STOP outcome; it does not approve a recognizer or waive #24's
unmet accuracy/resource/device criteria. #38 owns the next training experiment.
