# Issue #35: localization candidate comparison

Issue: [#35](https://github.com/nino96/chess-reader/issues/35), execution slice of
[#24](https://github.com/nino96/chess-reader/issues/24). Dependency #34 merged in
[PR #36](https://github.com/nino96/chess-reader/pull/36), merge commit
`ae4e9061b812c07ee6a84e448050cf5de6ccc9a8`, confirmed before branching from updated
`origin/main`. Physical-iPad testing is deferred/unrun by owner instruction.

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
