# Issue #38: TileNet with verified synthetic rendering

Issue: [#38](https://github.com/nino96/chess-reader/issues/38), evidence for
[#24](https://github.com/nino96/chess-reader/issues/24).
[PR #37](https://github.com/nino96/chess-reader/pull/37) is merged at
`ccc575ffecbc98dd10bd8f497887d0e481bc1b77`; origin was fetched again before this
continuation. The [#35 comparison](../../../docs/investigations/issue-35-comparison.md)
and accepted [ADR 0005](../../../docs/decisions/0005-browser-recognition.md)
remain the constraints. No production recognizer or UI changes; no published
weights; physical iPad remains deferred/unrun.

**Result: rendering/data and runtime checks pass; both retrained candidates fail
promotion.** The bounded pilot and both full runs are complete. No further
training or production adoption follows this result.

## What was corrected and verified

The [original experiment](../REPORT.md) is preserved, including its failed SVG
diagnostic. Native SVG decoding dropped embedded CSS fills. The new generator
uses pinned Chromium SVG decoding to transparent 72px PNG, then native **PNG**
compositing. All 72 original asset hashes/licenses are unchanged. Source fidelity
is measured before the retained, documented 0.75px contour on white pieces.

The [passing source audit](reports/svg-fidelity.json) checks every glyph, exact
repeat PNG/RGBA in two fresh contexts, exact visible native PNG roundtrip,
independent Firefox rendering, distinct piece/color rasters and exact
class-versus-explicit-fill controls. There were zero external requests. Worst
normalized Chromium/Firefox differences were 0.003716 for white-composited RGB
and 0.002849 for alpha, below the predeclared 0.06/0.03 limits. These tolerate
antialiasing differences; the CSS regression control must match exactly.

A second defect was corrected: old previews omitted speckles that were present
in training pixels. Preview PNG decoding now must match the exact final RGBA
used by upstream grayscale/tile preprocessing. Tests prove the 13 class mapping,
A1-through-H8 orientation with an independently coded pixel grid, label-to-glyph
selection, deterministic rendering and all 18 texture/degradation combinations.

Full data generation was repeated independently and byte-matched, including
manifests, labels and vectors. A preflight caught nondeterministic manifest key
ordering from parallel glyph loading; canonical sorting fixed it before the
lock. Tensor bytes matched even in that preflight. Preflight pairs remain ignored
and separate; no model training or test inference occurred during these fixes.
After final formatting, both corpora were regenerated from the final source
(26.73 and 26.37 seconds) and passed exact replay.

The [automated quality report](reports/automated-quality.json) verifies hashes,
finite normalized tensors, whole-family split separation, all class and
condition distributions, and absence of old synthetic vectors/exact placements.
It does not load product corpus v1. The lead inspected all source glyphs, six
all-class condition sheets and actual development/test tensor boards; a Sol
worker independently inspected all twelve actual training tensor boards.
Across 25 reviewed image artifacts, labels, colors and alignment agreed; no
missing glyph or substantive clipping was found. Review images remain local
and their hashes are bound in [data-quality.json](manifests/data-quality.json).
Both trainer and freeze validate the actual automated report and image bytes.

## Locked corpus and protocol

[Protocol commit](https://github.com/nino96/chess-reader/commit/ac5bc3086375bf6a9a73de0367c94a5a83303756)
preceded the pilot. Dataset manifest SHA-256:
`509d7ebb604e02f23eb354d16bfead096c7b224d100c7d1a9213e102bf4f5544`.
The separate [held-out lock](manifests/test-lock-v2.json),
[sample identities](manifests/samples-v2.json) and
[texture/degradation identities](manifests/strata-v2.json) were committed before
training. No candidate or checkpoint uses test or corpus-v1 outcomes for selection.

| Split       | Boards |  Flat | Hatch | Halftone | Speckled |
| ----------- | -----: | ----: | ----: | -------: | -------: |
| Train       |  4,096 | 1,213 | 1,343 |    1,540 |    2,073 |
| Development |    256 |   102 |    60 |       94 |      134 |
| Held-out    |    256 |    87 |    69 |      100 |      123 |

All six families contain all three textures × three resolution reductions
(1/0.82/0.64) × two noise conditions. Train uses Chessnut and three Monge families;
development uses Firi; test uses RhosGFX. Original
[licenses/notices](../NOTICES.md), [training provenance](../TRAINING_PROVENANCE.md)
and [environment lock](../environment.md) apply unchanged.

The new boards use seed `0x381c0ffe`. RhosGFX artwork and prior test outcomes were
already exposed: this is a corrected-renderer replication with new held-out
boards, **not blind independent source-family validation**. Synthetic diagrams
include difficult hatch/downsampling/noise but do not establish real scanned-book
representativeness. Positions are image-supported synthetic arrangements, not
necessarily legal games. Corpus v1 is historical post-freeze regression only.

TileNet remains 321,805 parameters, fp32, 13 classes, opset 17,
`tiles[N,1024] -> probs[N,13]`. The fixed recipe is AdamW, batch 2,048, learning
rate 0.002, weight decay 0.0001, label smoothing 0.05, cosine schedule and 12
epochs. Earliest minimum development cross-entropy selects each checkpoint.
The pilot seed is 381; full seeds are 3811/3812. Budgets remain 600 seconds for
the pilot, 2,700 per full seed and 6,000 total. Every run is retained.

The confidence floor remains 0.7. Promotion requires ≥95% reliable exact boards,
≥99.5% confident-correct squares, zero reliable wrong, and the declared corpus-v1
non-regression rules. Low-confidence output is a failure. A raw-square percentage
cannot substitute for those gates. No production adoption follows automatically
from a passing classifier.

## CUDA execution and frozen CPU results

Both full runs used commit `fa020295cdafd97cc131cc990362d02f1c7a9520`. The
pilot and both seeds completed on the local NVIDIA GB10, with Python 3.12.3,
PyTorch 2.10.0+cu128 and ONNX Runtime CPU 1.22.1. The pinned build emits its
known capability-range warning for GB10; actual CUDA execution, deterministic
recovery and exports passed. This is measured execution, not inferred support
or throughput from hardware specifications.

| Run       | Selected epoch | Training/export seconds | ONNX bytes | Maximum parity error |
| --------- | -------------: | ----------------------: | ---------: | -------------------: |
| pilot     |              2 |                   1.996 |  1,288,448 |             5.96e-08 |
| full-3811 |              9 |                 245.873 |  1,288,448 |             2.38e-07 |
| full-3812 |              7 |                 247.519 |  1,288,448 |             2.38e-07 |

Total measured training/export time was 495.388 seconds;
including whole-attempt overhead, 499.714 seconds, below 6,000.
There were no failed training attempts and no extensions. Checkpoint recovery
matched all ten recorded state comparisons. The pilot browser suite passed
9/9. All exported models passed checker/operator/schema/no-sidecar gates and
the predeclared numeric tolerance on frozen training vectors.

The [candidate freeze](reports/candidates-freeze.json) was committed at
`8998d9c` before the first held-out inference. Both full checkpoints were
selected only from development loss (epochs 9 and 7). Model hashes and full
loss histories are retained in the individual run reports.

CPU evaluation on the same 256 held-out boards gave:

| Model             | Raw exact boards | Raw square accuracy | Reliable exact boards | Confident-correct squares | Reliable wrong |
| ----------------- | ---------------: | ------------------: | --------------------: | ------------------------: | -------------: |
| shipped           |          134/256 |             98.486% |                25/256 |    15108/16,384 (92.212%) |              3 |
| tilenet-full-3811 |            0/256 |             83.838% |                 0/256 |    12804/16,384 (78.149%) |              6 |
| tilenet-full-3812 |            0/256 |             84.662% |                 0/256 |    12879/16,384 (78.607%) |              1 |

Both retrained candidates fail all held-out promotion requirements, including
zero reliable wrong. The shipped control also fails the strict gate. These
are genuine frozen measurements on fidelity-verified data, not a new SVG
rendering failure. No test result led to revised weights, augmentation or
thresholds.

Product correctness E2E overlapped full CUDA training, and ordinary recognition
regression overlapped part of training and the brief CPU test evaluation. Their
timings describe that host load and are not isolated benchmarks. The experimental
browser comparison ran separately from those jobs.

## Browser entry correction

The first full-browser attempt stopped during test collection: the frozen
original configuration explicitly accepted only seeds 3801/3802. It executed
zero tests and no held-out browser inference. The failed command/log identity
is retained in [full-browser-attempt-1.json](reports/full-browser-attempt-1.json).

A versioned v2 entry explicitly accepts 3811/3812, while preserving the original
entry byte-for-byte. It reuses the original browser main/worker, protocol,
constants and Vite build. The evaluation body differs only in relative imports,
artifact paths and reported command; assertions, confidence floor, request
chunks, 60-second watchdog, 30-minute test ceiling, single worker and zero
retries are unchanged. Four configuration tests pass, including rejection of
the legacy seed pair; collection lists all 30 expected tests. TypeScript and
ESLint pass. No data, model, optimization or scoring change resulted.

## Failure interpretation and next decision

The [independent mismatch audit](reports/mismatch-analysis.json) finds a severe
held-out glyph/color transfer failure in both seeds. All empty squares are
correct, which inflates overall square accuracy: nonempty accuracy is only
43.42% and 46.30%, versus 95.92% for the shipped model. Training contains nearly
equal black and white piece counts, so simple missing-color labels do not
explain this.

Both candidates map all 867 held-out black pawns to white pawns, all 256 black
kings to white kings, and all 332 black queens to white kings. They also map all
295 white queens to white kings, so the failure includes glyph geometry as well
as color. The same direction appears across flat/hatch/halftone, all reductions,
and both noise groups. It is not a hatch-only failure.

The verified source rasters and reviewed tensors show correct color/identity;
there is no evidence of the old CSS defect recurring. The shipped TileNet reads
these same vectors much better, so this result does not prove an architecture
limit. It supports a separately predeclared investigation of broader licensed
glyph and grayscale/ink coverage, using fresh independent test families before
claiming generalization. This experiment cannot choose a unique remedy among
more families, grayscale-aware augmentation or optimization changes. Its
previously exposed RhosGFX family must not be recycled as an untouched future
test while tuning those choices.

**STOP promotion of both retrained candidates.** Preserve all runs; no further
training, threshold adjustment or replacement data belongs to this frozen
experiment. The #38 coverage decision trigger is supported; the whole-board
architecture trigger is not established. A learned localizer remains a separate
planned experiment under [#24](https://github.com/nino96/chess-reader/issues/24).
The #35 heuristic was not qualified, including its full-page/multiple-board
path. Nothing here makes that localizer adequate, and exact-crop classifier
scores do not measure localization. This run does not qualify a new TileNet
candidate to pair with it.

Public-domain chess diagrams may help a later independent print evaluation,
but none were acquired or needed to fix rendering here. The source/license
review and exact-edition requirements in the [original README](../README.md)
remain applicable. Synthetic-first data is reproducible and useful for bounded
research; source fidelity alone does not establish sufficient training coverage
or real-book representativeness.

## Completed browser evaluation

The [full browser validation](reports/full-browser-validation.json) passed
30/30 checks in 605.48 seconds at `be9fa31`: 18 model/split measurements,
nine fault groups and three metadata checks. CPU, Chromium, Firefox and WebKit
confusion matrices and all aggregate accuracy counts agree exactly. Measurement
and runtime correctness passing does **not** mean the model qualification gate
passes. All three models fail the held-out gate; both retrained models satisfy
only the historical corpus-v1 non-regression comparison.

The [comparison JSON](reports/comparison.json) retains all nine browser/model
entries, promotion checks and texture/resolution/noise strata. Texture results
are identical across browsers:

| Model             | Texture  | Boards | Raw exact | Reliable exact | Raw square accuracy |
| ----------------- | -------- | -----: | --------: | -------------: | ------------------: |
| shipped           | flat     |     87 |        64 |             18 |             99.335% |
| shipped           | hatch    |     69 |        35 |              4 |             98.573% |
| shipped           | halftone |    100 |        35 |              3 |             97.688% |
| tilenet-full-3811 | flat     |     87 |         0 |              0 |             82.902% |
| tilenet-full-3811 | hatch    |     69 |         0 |              0 |             84.239% |
| tilenet-full-3811 | halftone |    100 |         0 |              0 |             84.375% |
| tilenet-full-3812 | flat     |     87 |         0 |              0 |             84.159% |
| tilenet-full-3812 | hatch    |     69 |         0 |              0 |             84.851% |
| tilenet-full-3812 | halftone |    100 |         0 |              0 |             84.969% |

Per-stratum confident-square counts are unavailable in the shared per-board
measurement contract, so these are explicitly raw square accuracies. Aggregate
promotion still uses the unchanged confidence-aware thresholds.

Browser latency below is milliseconds, p50 / p95. Each model has three fresh
worker initializations and first-board samples, plus 12 warm samples (four
boards repeated three times). Raw reports also retain min/max, all observations
and 256-board full-pass distributions. Cold initialization includes local
fetch/hash and ORT initialization; it does not clear OS disk caches.

| Browser  | Model             | Cold initialization |     First board |      Warm board |
| -------- | ----------------- | ------------------: | --------------: | --------------: |
| chromium | shipped           |   1500.20 / 1745.00 |   33.30 / 33.30 |   18.30 / 18.50 |
| chromium | tilenet-full-3811 |   1506.50 / 1611.60 |   33.50 / 33.60 |   18.50 / 18.70 |
| chromium | tilenet-full-3812 |   1540.60 / 1635.10 |   33.10 / 34.00 |   18.50 / 18.60 |
| firefox  | shipped           |   1915.00 / 1983.00 | 450.00 / 452.00 | 439.00 / 443.00 |
| firefox  | tilenet-full-3811 |   1962.00 / 2025.00 | 447.00 / 448.00 | 438.00 / 443.00 |
| firefox  | tilenet-full-3812 |   1905.00 / 2069.00 | 450.00 / 450.00 | 443.00 / 447.00 |
| webkit   | shipped           |   1966.00 / 2015.00 |   34.00 / 41.00 |   17.00 / 18.00 |
| webkit   | tilenet-full-3811 |   1907.00 / 1915.00 |   34.00 / 69.00 |   18.00 / 18.00 |
| webkit   | tilenet-full-3812 |   1781.00 / 1933.00 |   62.00 / 79.00 |   18.00 / 18.00 |

Chromium 151.0.7922.34, Firefox 153.0 and Playwright WebKit 26.5 ran on Linux
ARM64 with single-thread self-hosted ORT-Web WASM. All nine fault groups passed
cancellation after progress, timeout recovery, corrupt-model rejection, warm
offline inference and zero external requests. Warm offline inference does not
prove a cold offline relaunch. Retrained model + WASM is 15,250,293 bytes; the
full deployed experimental runtime is 15,330,706 bytes. These artifact sizes
exclude source maps/build metadata and do not measure peak WASM memory.

## Validation and handoff

| Command / gate                                     | Result                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm check`                                       | Pass: types, formatting and lint                                |
| `pnpm test:unit`                                   | 386 passed                                                      |
| `pnpm check:licenses`                              | 25 production dependencies passed                               |
| `pnpm build`                                       | Passed; existing chunk-size warning retained                    |
| `pnpm test:e2e`                                    | 219 passed, 15 existing capability skips                        |
| `pnpm eval:recognition`                            | 42 passed, zero failed/skipped                                  |
| v2 Node renderer/data suites                       | 6 passed, including all 72 real SVG assets                      |
| v2 Python quality/freeze/summary suites            | 7 passed                                                        |
| v2 browser configuration suite                     | 4 passed, including legacy-seed rejection                       |
| Original Node/Python/browser unit suites           | Passed; 11 Python and 10 browser tests                          |
| SVG, dataset replay, quality lock and preservation | Passed                                                          |
| CUDA pilot, recovery and both declared full seeds  | Passed execution/export; both full candidates fail promotion    |
| CPU ONNX and full browser comparison               | Completed; 30 browser checks passed; accuracy failures retained |
| Physical iPad / manual VoiceOver                   | Deferred and unrun; #24 remains open                            |

Exact commands, environment, commits, raw artifact identities and failure
history are in [README.md](README.md), [pretraining validation](reports/pretraining-validation.json),
[product checks](reports/product-automated.json), [E2E evidence](reports/e2e-validation.json),
[product recognition evidence](reports/product-recognition-validation.json) and
[full browser evidence](reports/full-browser-validation.json). The existing E2E
skips cover desktop touch-only and touch-project keyboard-only cases; no gate
was weakened. Product correctness checks overlapped other host work as recorded
above; their latency is not an isolated benchmark. The separate qualification
command was not rerun and the existing recognition qualification failures are
not waived by the successful measurement suite.

The lead integrated and reviewed the changes. A Sol worker implemented and
independently audited renderer/tensor fidelity; a Terra worker implemented the
bounded experiment boundaries and checked product integration. Both contributed
bounded independent reviews. The original experiment, corpus v1, shipped
recognition and historical baselines remain unchanged, as verified by the
[preservation inventory](reports/preservation.json). No weights, training data,
source caches or generated images are committed. PR #39 is for review only;
no merge or #24 closure is authorized by this report.
