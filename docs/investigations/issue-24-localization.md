# Issue #24: localization versus classifier diagnosis

Date: 2026-09-05. Status: causal diagnosis complete; full feasibility spike open.
Issue: [#24 — P0 spike: prove printed-book recognition viability](https://github.com/nino96/chess-reader/issues/24).
Measurement base commit: `636458bb2095ec54030450e47653724f48e3c575`; the raw
record retains the dirty-tree status and source hash from that run, before
the diagnostic changes were committed. Dependency #2 implementation is merged (PRs #25
and #30); its reopened physical-device work is separate.

## Finding

The dominant hatch failure is **board localization**, not an inability of the
pinned classifier to read this hatch texture. Keep the classifier for the next
experiment and investigate a bounded, selection-aware localization patch/fork.
This is a direction for #24, not approval of a production replacement or an
assertion that the recognition gate is met.

On identical captured pixels, supplying the true board corners changes hatch
exact-board accuracy from **2/48 to 47/48**. Correct classification is still not
universal: the same one square fails on both the flat and hatched exact-bound
controls at the same low-resolution setting. That remaining failure belongs
to the rasterization/preprocessing/classification path, not localization;
this experiment does not isolate those three further.

| Style     | Path                         | Exact boards | Reliable exact boards | Reliable wrong boards | Square accuracy |
| --------- | ---------------------------- | -----------: | --------------------: | --------------------: | --------------: |
| Flat gray | Pinned pipeline              |        48/48 |                 46/48 |                  0/48 |            100% |
| Flat gray | Exact bounds (oracle)        |        47/48 |                 46/48 |                  0/48 |         99.967% |
| Hatched   | Pinned pipeline              |         2/48 |                  0/48 |                  4/48 |         38.118% |
| Hatched   | Reject external detected box |         1/48 |                  0/48 |                  0/48 |         16.146% |
| Hatched   | Exact bounds (oracle)        |        47/48 |                 38/48 |                  0/48 |         99.967% |

The oracle is **not an implementable localization algorithm**: it knows fixture
geometry. Its 47 correct hatch reads include 9 below the unchanged 0.7 minimum
square-confidence threshold. Do not lower that threshold to make the result
look usable. The low-resolution error is top-left index 59 (d1), at a 320 px
selection with 5% padding on each side; both styles get 63/64 squares correct
and mark the result unreliable.

The oracle's recorded detection/IoU fields are supplied by construction and
are not detection evidence. Only its classification/confidence/orientation
measurements are meaningful comparisons.

Square accuracy here counts every expected square across all 48 captures;
a no-board result contributes zero correct squares. "Reliable" means the
existing minimum-confidence threshold, not user acceptance. Low-confidence
boards can still appear in the correction editor. The bounds-rejection path
is a diagnostic-only safety filter, not a shipped behavior change.

## Controlled experiment

The [diagnostic test](../../packages/test-fixtures/tests/localization-diagnostic.test.ts)
locks a matched pair of redistributable PDFs in the
[fixture manifest](../../packages/test-fixtures/manifest.json): the existing
flat-gray fixture and its existing generator's 45-degree hatch variant.
Position, chessnut glyphs, piece size, layout, and absence of an outer border
are identical. Only dark-square fill changes. Both PDFs have recorded hashes;
the regeneration test verifies both byte-for-byte. Synthetic content is CC0;
the glyphs retain their Apache-2.0 provenance and notices.

The predeclared matrix is eight selection edges
`320, 384, 512, 640, 768, 896, 1024, 1280` px and six margins
`0, 0.01, 0.02, 0.03, 0.05, 0.08` of board width per side. Every paired trial
uses the same grayscale buffer, `extractTiles`, ONNX weights, single-thread
WASM runtime, and `probsToPlacement`. The normal path calls unchanged
`recognizeGray`; the oracle calls the same classifier with geometric bounds.
The safety-filter control rejects a normal result whose box leaves the image.
No model, detector, or production adapter was changed or tuned.

The Node rasterizer draws directly into a translated selection canvas and
preserves fractional coordinates. The product captures a rounded integer
crop of a rendered page and caps upscale at 4x. These are deliberately
controlled diagnostic images, not byte-identical product captures; the 1280 px
rows also exceed the product's configured 1024 px limit. This explains why the
new counts must not be called an exact reproduction of the historical 1/48
sweep in the issue, whose raw matrix is not checked in. Both measurements
exhibit catastrophic hatch sensitivity.

## Mechanism and confidence failure

Inspection of the pinned FENShot source explains the measurements:

1. Gradient projections and regularly spaced peaks locate the board. Hatch
   edges can generate competing peaks inside squares. The returned box may
   describe a tiny internal pattern or a displaced whole board.
2. The one-axis fallback searches windows starting outside the image;
   grid-snap and parity adjustments also lack a final bounds guard.
3. Tile extraction samples outside the image by repeating its edge pixels.
   Those synthetic rows/columns can look confidently empty to a classifier.
4. Arbitration chooses the raw or snapped read by **mean tile confidence**;
   reliability then depends only on the weakest tile. Neither establishes
   that the selected box contains the intended complete board.
5. Our [pipeline](../../apps/web/src/recognition/pipeline.ts) forwards that box
   and reliability, and our
   [worker](../../apps/web/src/recognition/workerCore.ts) uses those corners
   directly for extraction. Orientation runs after classification; it cannot
   create the upstream displacement seen here.

Primary source: pinned upstream
[detector](https://github.com/scoriiu/fenshot/blob/5e68f7a04e1261328572caf74a2d4a44a342a6c7/packages/fenshot/src/detect.ts),
[tile extraction](https://github.com/scoriiu/fenshot/blob/5e68f7a04e1261328572caf74a2d4a44a342a6c7/packages/fenshot/src/tiles.ts), and
[recognition arbitration](https://github.com/scoriiu/fenshot/blob/5e68f7a04e1261328572caf74a2d4a44a342a6c7/packages/fenshot/src/recognize.ts).

All four reliable wrong hatch reads in this matrix have external corners.
For example, the 512 px / 3% selection returns `(-45, 76)–(438, 559)` despite
true corners near `(14.49, 14.49)–(497.51, 497.51)`, with minimum confidence
0.899 and mean confidence 0.957. Those scores do not measure board alignment.
The largest overlap among these four wrong reads is only 0.620 IoU.

Rejecting such boxes eliminates these four reliable errors, but leaves **zero
reliable correct hatch results**. It is insufficient as a solution. Do not
simply clamp the box and rescale: clipping a displaced board changes its tile
geometry without restoring the missing ranks. Next, evaluate candidates
constrained by the manual selection and actual 8×8 boundary evidence, while
retaining honest rejection of partial boards and negatives. IoU >= 0.9 alone
is also too coarse to guarantee correctly aligned individual tiles.

Orientation is not independently qualified: both fixtures are white-oriented.
The oracle returns the expected orientation in 48/48 cases for both styles;
the normal hatch path does so for all 40 detected results, including bad
positions. This is not evidence that reversed or pawn-sparse positions work.

## Alternatives and the supplied architecture discussion

The suggested training-first decision tree is sensible only after separating
stages. This result supports localization work first. Running the **same**
weights and localization on a server would not fix the demonstrated failure.
A faster device changes latency, not the incorrect corners.

[FENShot's training pipeline](https://github.com/scoriiu/fenshot/tree/main/tools/tile-classifier)
does exist and includes procedural hatch examples. Its
[training script](https://github.com/scoriiu/fenshot/blob/main/tools/tile-classifier/train.py)
selects MPS or CPU; CUDA support would need adding for GPU training here.
That establishes feasibility of experimentation, not a need to retrain now.

Alternative source review (no alternative weights downloaded or executed):

| Candidate                                                   | Useful comparison                              | Constraints as shipped                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Fenify](https://github.com/notnil/fenify)                  | Whole-board classifier on the same exact crops | Requires an already-cropped board; no localizer or orientation detector. [CPU release model](https://github.com/notnil/fenify/releases/tag/v2023-07-10) is 127,147,094 bytes of TorchScript; Python/PyTorch/OpenCV, no browser-worker/WASM implementation. Repository MIT; private scan-based evaluation is not reproducible from published fixtures.             |
| [2d-chess-ocr](https://github.com/AndrewSpano/2d-chess-ocr) | Alternative complete detector/recognizer       | Published [ONNX models](https://huggingface.co/AndrewSpano/2d-chess-ocr/tree/main) are approximately 81.8 MB (medium) and 9.82 MB (nano), with Python preprocessing/postprocessing and no shipped browser path. Downstream MIT claim needs reconciliation with [Ultralytics' licensing of YOLO code and models](https://docs.ultralytics.com/help/contributing/). |

Fenify is a possible offline desktop technical benchmark, not a drop-in PWA
replacement. Its size and absent browser runtime are porting constraints, not
proof conversion is impossible. The 2d-chess-ocr licensing question must be
resolved before adopting it under #24's permissive-license criterion.
No accuracy or throughput claim for either is established by this review.
Cloud pricing and GX10 throughput estimates from the supplied chat were not
benchmarked or used for the decision. Server uploads are explicitly outside
#24 and conflict with the current product contract.

## Reproduction and evidence

From the repository root:

```sh
pnpm test:unit --project test-fixtures localization-diagnostic
CHESS_READER_DIAGNOSTIC_SWEEP=1 pnpm test:unit --project test-fixtures localization-diagnostic
pnpm check
pnpm test:unit
pnpm eval:recognition
pnpm test:e2e
```

The first command asserts exact, reliable oracle reads for both styles at
512/1024 px and 3% padding. The sweep retains those assertions while recording
all 96 settings, including errors. A passing diagnostic means its regression
assertions passed, **not that upstream recognition met the product gate**.
Output: `packages/test-fixtures/eval-results/localization-diagnostic[-sweep].json`.
The retained [raw sweep](../eval-baselines/issue-24-localization-sweep.json)
identifies base commit, dirty-tree status, diagnostic source hash, fixture
hashes/schema, model hash, runtime, environment, each candidate box, confidence,
error indices, orientation, IoU, and timing distributions. No book pixels or
predicted placements are logged in this diagnostic artifact.

Node 24.19.0, Linux ARM64, ONNX Runtime Web 1.29.0 WASM, one thread. Model
initialization is one observation, not a cold-start distribution. Per-style
pipeline and oracle timing distributions exclude PDF rendering, model
initialization, React, worker transport, and editor display; they are not iPad
latency or server-capacity estimates. Worker peak memory was not measured.

Validation on this working tree:

| Command                                             | Result                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                        | Passed: TypeScript, Prettier, ESLint.                                                                                                                         |
| `pnpm test:unit`                                    | 358/358 passed, 26 files; includes adapter contracts and fixture regeneration.                                                                                |
| Diagnostic sweep command above                      | Passed its regression assertions; recorded 96 captures and all reported accuracy failures.                                                                    |
| `pnpm eval:recognition`                             | 3 browser tests passed; 6/6 exact, reliable flat-gray reads per Chromium, Firefox and WebKit. Raw runs in `apps/web/eval-results/recognition-{browser}.json`. |
| `pnpm test:e2e`                                     | 219 passed; 15 pre-existing conditional skips (touch tests on desktop; keyboard tests on touch projects). All six configured projects ran.                    |
| `pnpm check:licenses`                               | Passed: 25 production packages.                                                                                                                               |
| Production build                                    | Passed as part of both browser commands.                                                                                                                      |
| Changed-document local links and `git diff --check` | Passed.                                                                                                                                                       |

The existing browser eval covers the flat-gray product path only; it does not
qualify a hatch fix. No production recognition behavior or layout changed, so
new layout evidence is N/A. Node child-process revision stamping, regeneration,
and license checking initially hit sandbox `EPERM`; rerunning those commands
outside the sandbox passed. Browser processes also ran outside the sandbox.
No gates were weakened. Separate `test:contract` and other subsystem `eval:*`
commands do not yet exist; existing contract tests ran under `test:unit`.

Two read-only agents reviewed the upstream failure mechanism, alternative
sources, and diagnostic validity. The lead implemented and reviewed the actual
diff and retained experiment. The diagnostic is a separate commit on
`issue-24-recognition-diagnosis`; no production recognition behavior changed.

## Remaining #24 decision blockers

Agent handoff: [#34](https://github.com/nino96/chess-reader/issues/34) owns
corpus expansion and stage-separated baselines; after it merges,
[#35](https://github.com/nino96/chess-reader/issues/35) owns candidate comparison
and the technical recommendation. These tasks do not implement #7's production
hotspots. Per the owner's updated priority, neither task waits for a physical
iPad test; that check remains deferred and explicitly unrun on parent #24.
The diagnostic foundation is on branch `issue-24-recognition-diagnosis`.
Start #34 from that branch and preserve its diagnostic fixture, test and
report; do not assume the foundation has already merged into `main`.

This diagnostic pair is **not** the locked feasibility corpus required to
close #24. Multiple hatch angles/densities, halftone/grayscale, scanned
styles, different glyphs/positions/orientations, and negative/partial boards
still need the common candidate comparison. A useful localization mitigation
has not yet been implemented or browser-benchmarked; bounds rejection alone
fails usability. Alternative runtime benchmarking remains unrun. A physical
iPad has not run a recommended patched path. These remain tracked in #24,
which continues to block #3 and #6.

ADR 0005's browser-worker/WASM constraints remain in force. The preferred
next direction is **patch/fork localization while retaining the pinned
classifier**, subject to the remaining corpus, alternative and physical-iPad
evidence. This diagnosis does not complete the issue's final ADR decision.
