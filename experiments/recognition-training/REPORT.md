# Issue #38: TileNet training result

**STOP: neither predeclared seed meets the held-out classifier promotion gate.**
The bounded CUDA runs completed, but a subsequently confirmed native SVG
rendering defect confounds the interpretation of their held-out failure.
These are measurements on the frozen rendered inputs, not clean evidence of
TileNet's generalization or architectural limits. No model is adopted or published. Production recognition remains
unchanged, [#24](https://github.com/nino96/chess-reader/issues/24) stays open,
and physical-iPad testing is **deferred/unrun**.

[PR #37](https://github.com/nino96/chess-reader/pull/37) was merged at
`ccc575ffecbc98dd10bd8f497887d0e481bc1b77` before this branch was created from
updated `origin/main`. The [#35 comparison](../../docs/investigations/issue-35-comparison.md)
and [ADR 0005](../../docs/decisions/0005-browser-recognition.md) remain applicable.

## Frozen design and data

The [protocol](protocol.json) was committed at `5f6233476bdc09d0ea28da715142cbf3bc5a9b7e`
before the CUDA pilot. It declares unchanged TileNet (321,805 parameters),
fp32 opset 17, `tiles [N,1024] -> probs [N,13]`, class order `1KQRBNPkqrbnp`,
confidence floor 0.7, seeds 3801/3802, twelve epochs and development-loss-only
checkpoint selection. No threshold, augmentation, source, epoch or architecture
was changed after test outcomes became available.

The [dataset manifest](manifests/dataset-v1.json),
[sample inventory](manifests/samples-v1.json), and
[pretraining held-out lock](manifests/test-lock-v1.json) identify 4,096 training,
256 development and 256 test boards. All tiles from a board stay together.
Training uses Chessnut and three Maurizio Monge families, with the Monge author
family kept wholly in training. Firi is development-only; Rhosgfx is test-only.
All roles include flat/hatch/halftone and the declared degradations. The intended
comparison was transfer to one unseen source family, not unseen degradation
regimes or real scanned books; the fidelity defect below limits that interpretation. Positions are synthetic and are not constrained to legal games.

The dataset SHA-256 is
`10b347f5f88693fd18d63b49b4b2f81156cf673820145c82949e1d425743a401`.
Every downloaded SVG has a pinned revision, byte hash and license evidence in
[source-lock.mjs](source-lock.mjs) and [NOTICES.md](NOTICES.md). Sources are
Apache-2.0, MIT, CC-BY-4.0 and CC0-1.0; notices describe the print derivatives.
The full upstream TileNet MIT notice is in [TRAINING_PROVENANCE.md](TRAINING_PROVENANCE.md).
No book bytes or experimental weights are committed.

Corpus v1 never entered training, development validation, checkpoint selection
or tuning. Its post-freeze exact-bound vectors use pinned upstream grayscale
and tile extraction. All candidates receive identical vector bytes, whose hash
is `7c2edc21aef5b2b1f9d994e31cd72f968f2b93aac6ed992a4a89062fc97e9974`.
The shipped control reproduces the historical 8/14 raw exact and 881/896
correct-square counts. Native-canvas preprocessing is not claimed byte-identical
to every browser-canvas decoding path; the unchanged product evaluation separately
exercises the existing browser capture path. Public corpus-v1 outcomes are
regression evidence, not a fresh generalization test.

## CUDA execution and export

The local NVIDIA GB10 ran Python 3.12.3, PyTorch 2.10.0+cu128 (CUDA runtime
12.8), ONNX 1.18.0 and CPU ONNX Runtime 1.22.1. Driver 580.159.03 reports CUDA
13.0. The PyTorch build warned that its advertised capability range ends at
12.0 while this GPU reports 12.1; actual CUDA execution and recovery passed.
The [hashed environment lock](requirements.lock) contains 36 resolved ARM64
wheels. [environment.md](environment.md) records setup and exact commands.

| Run           |   Selected epoch | Training/development/export seconds | Attempt wall seconds | ONNX bytes |
| ------------- | ---------------: | ----------------------------------: | -------------------: | ---------: |
| Pilot seed 38 | Development only |                               2.087 |                3.428 |  1,288,448 |
| Seed 3801     |          6 of 12 |                             230.596 |              231.929 |  1,288,448 |
| Seed 3802     |          9 of 12 |                             233.326 |              234.594 |  1,288,448 |

Both full runs were made at `d838cf14c676a8cc0eb247f74d7f6faeba76679b`, within
2,700 seconds per seed. No full run was extended. The successful pilot verified
exact checkpoint recovery across model, optimizer, scheduler, RNG and losses.
Both candidates passed ONNX checking, no-external-sidecar checks, schema/operator
validation, CPU inference and PyTorch/ONNX parity on 64 frozen training vectors
at predeclared `atol=1e-5`, `rtol=1e-4`. Full epoch losses, source/data hashes,
checkpoint identities, environment and parity errors are in
[3801](reports/full-3801.json) and [3802](reports/full-3802.json).

The [candidate freeze](reports/candidates-freeze.json) was written after both
runs completed and before any held-out or corpus-v1 inference. Seed 3801's ONNX
SHA-256 is `1397e6f5dcf45ebb4a3111ba4de754df661bab343bdec560ffe675b917fdae2d`;
seed 3802's is `91f176d32e3f351727bcb8989939129ee7015ed4caaac5e68c7eea36c4bfd14f`.
The shipped control is 1,289,483 bytes with SHA-256
`883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d`.

Failed attempts are retained, not replaced with passing summaries:

- [Pilot attempt 1](reports/pilot-attempt-1.json) stopped before an optimizer
  update because the loss omitted the model forward call. A real optimizer-step
  regression test was added.
- [Pilot attempt 2](reports/pilot-attempt-2.json) exposed CUDA RNG restoration
  requiring a CPU ByteTensor. A minimized regression test was added. Its report
  is explicitly reconstructed from retained checkpoints and the observed error.
- The [successful pilot](reports/pilot.json) and
  [pilot browser validation](reports/pilot-browser-validation.json) retain the
  initial metadata-filename failure and its focused correction.
- [Full browser attempt 1](reports/full-browser-attempt-1.json) rejected duplicate
  historical annotation IDs before execution. The wrapper now hashes page plus
  annotation identity; vector bytes are unchanged.

The first two pilot failures did not record complete attempt wall time. Their
known timings and missing accounting are explicit in the reports, so an exact
all-attempt aggregate under the 6,000-second ceiling cannot be reconstructed.
The successful pilot and both full runs have complete timing evidence. A
[separate conservative reconstruction](reports/budget-accounting.json) bounds
all pilot activity, including debugging and browser checks, by the 531-second
Git commit window from implementation to retained pilot evidence. Adding both
full attempt durations gives an inferred upper bound of 997.524 seconds, below
6,000 seconds. This wall-clock inference is not a substitute for the missing
per-attempt monotonic timings and does not count failures as zero cost.

## Accuracy and decision

CPU held-out results are [shipped](reports/cpu-shipped.json),
[3801](reports/cpu-tilenet-full-3801.json), and
[3802](reports/cpu-tilenet-full-3802.json). The unchanged promotion targets require
at least 244/256 reliable exact boards, at least 16,303/16,384 correct squares
at confidence ≥0.7, zero reliable wrong boards, and no corpus-v1 regression.
Low-confidence outputs remain failures even when argmax is correct.

| Locked held-out set | Raw exact boards |    Raw correct squares | Confidence-qualified correct squares | Reliable exact | Reliable wrong |
| ------------------- | ---------------: | ---------------------: | -----------------------------------: | -------------: | -------------: |
| Shipped             |            2/256 | 14,372/16,384 (87.72%) |               13,384/16,384 (81.69%) |              0 |              1 |
| Seed 3801           |            0/256 | 13,062/16,384 (79.72%) |               12,542/16,384 (76.55%) |              0 |              0 |
| Seed 3802           |            0/256 | 13,127/16,384 (80.12%) |               12,530/16,384 (76.48%) |              0 |              0 |

| Corpus-v1 exact bounds | Raw exact boards | Raw correct squares | Reliable exact | Reliable wrong |
| ---------------------- | ---------------: | ------------------: | -------------: | -------------: |
| Shipped                |             8/14 |    881/896 (98.33%) |              4 |              0 |
| Seed 3801              |            12/14 |    894/896 (99.78%) |              9 |              0 |
| Seed 3802              |            12/14 |    894/896 (99.78%) |              8 |              0 |

Both candidates improve this public regression set, but fail the untouched
held-out set decisively. There is no post-test seed selection. Neither candidate
is eligible for a later integration decision.

The [post-freeze mismatch analysis](mismatch-analysis.md) records per-class
counts and systematic glyph collapses. Empty squares make up 71.75% of test
squares; non-empty accuracy is only 28.22%/29.62% for the two seeds. The visual
review and controlled renderer diagnostic below show that the initial
source-family coverage explanation was incomplete.

### Confirmed source-rendering confound

The pinned native SVG renderer ignores embedded CSS class fills. A synthetic
rectangle with an embedded class specifying a light fill renders black through
native canvas, while its explicit-fill equivalent and both Chromium renders
are identical and light. On the identical pinned Rhosgfx white-queen SVG, native
rendering yields 2,358 dark and 154 light nontransparent pixels; Chromium yields 811 dark
and 1,636 light. This is a semantic fill difference, not merely edge antialiasing.

The affected CSS mechanism occurs in 36/48 training glyph assets (all three
Monge families) and 9/12 held-out Rhosgfx assets; the development Firi assets and
training Chessnut assets have none. The [reproducible diagnostic](scripts/svg-fidelity.mjs)
and [raw evidence](reports/svg-fidelity.json) retain **FAIL**. These counts identify
assets using the affected mechanism, not a claim that every pixel or tile in
those families is wrong. The frozen hashes and labels still identify the exact
inputs actually used, but provenance alone did not establish rendering fidelity.

The models fail promotion on those frozen inputs. Their failure cannot now be
attributed solely to missing licensed family coverage, and cannot justify a
whole-board architecture experiment. The next step under
[#24](https://github.com/nino96/chess-reader/issues/24) is a separate data-quality
experiment: correct and verify SVG style fidelity, review source appearance,
and declare a new untouched test lock before any further training. Broader
licensed print coverage can then be evaluated. The learned-localizer trigger
is not met because the classifier gate failed; no second architecture is
trained or opened here.

The rendering defect was found after test outcomes, so this issue deliberately
preserves the original generator, corpus hashes, candidates and all measurements.
There is no corrected-data rerun or post-test tuning disguised as the original
experiment. Synthetic generation was sufficient to exercise the bounded CUDA
and browser pipeline, but this corpus is not faithful enough to answer the
intended generalization question cleanly. Verified public-domain print diagrams
would also help a future real-book evaluation; [the source discussion](README.md#public-domain-material)
explains access and provenance requirements.

## Browser measurement method and retained failures

The isolated harness runs pinned ORT WebAssembly in a dedicated worker on
Ubuntu 24.04.4 LTS ARM64, kernel `6.17.0-1021-nvidia`, using Chromium
151.0.7922.34, Firefox 153.0 and Playwright WebKit 26.5. These desktop processes
are not physical iPad evidence. CPU reports use ONNX Runtime 1.22.1 with one
intra-op and one inter-op thread.

Each model/vector role receives one complete pass, three fresh worker/session
initializations and first-board observations, then twelve warm observations
(four boards repeated three times). Initialization includes local vector/model
fetch and hashing plus ORT initialization; it is not a cold OS/browser restart.
Full-pass and warm-subset timings remain separately labeled. CPU's single
session-start observation is explicitly a single sample; its per-board latency
array/distribution includes the first inference after initialization. Browser
cold and warm distributions remain separate measurements. Bundle bytes are deployed assets, not peak resident memory.

[Full browser attempt 2](reports/full-browser-attempt-2.json) passed 27 checks
and failed the three Firefox held-out passes. Its single 256-board request
exceeded the unchanged 60-second watchdog: the measured 14-board Firefox
control had a 439 ms median, implying about 112 seconds for 256 boards. The
[retained raw attempt](reports/browser-attempt-2/) includes every completed
measurement. Large traces remain ignored because they can contain vectors and
model bytes.

The final harness divides each complete pass into sequential requests of at
most sixteen boards within the same initialized session, checks every returned
index and concatenates the complete original order. It records the request
count and retains the 60-second watchdog. This changes request granularity,
not inputs, predictions, promotion criteria or per-board timing definitions.
No failed observation is removed from the experiment history.

Fault checks cover cancellation after real progress, deliberate watchdog
termination and recovery in a fresh worker, corrupted-model integrity rejection
before inference, warm initialized offline inference, and zero non-same-origin
requests. Warm offline is not cold offline reload/readiness; that product gate
remains [#3](https://github.com/nino96/chess-reader/issues/3). Peak memory,
physical-iPad performance and real scanned-book generalization remain unmeasured
under [#24](https://github.com/nino96/chess-reader/issues/24).

## Final browser results

[The final run](reports/full-browser-validation.json) passed all 30 infrastructure,
inference, fault and metadata checks (10.1 minutes). The eighteen full measurements
cover all three models on both vector roles in all three browsers. Raw accuracy,
confidence-qualified counts and reliable exact/wrong counts agree with the tables
above in every browser and, for held-out inputs, with CPU inference.
[The derived comparison](reports/comparison.json) applies every predeclared gate
to every seeded candidate/browser, hashes its raw inputs, and records STOP.

Held-out timing distributions below use milliseconds; the linked raw reports
also retain min/max, all per-board observations, confidence and per-class errors.

| Browser / candidate                                                                               | Cold initialization p50 / p95 (n=3) | First board p50 / p95 (n=3) | Warm subset p50 / p95 (n=12) | Full pass p50 / p95 (n=256) |
| ------------------------------------------------------------------------------------------------- | ----------------------------------: | --------------------------: | ---------------------------: | --------------------------: |
| [chromium / shipped](reports/browser-chromium-shipped-print-held-out-v1.json)                     |                     1648.9 / 1750.4 |                 33.0 / 33.5 |                  18.2 / 18.5 |                 18.3 / 18.6 |
| [chromium / tilenet-full-3801](reports/browser-chromium-tilenet-full-3801-print-held-out-v1.json) |                     1594.5 / 1619.3 |                 33.4 / 33.6 |                  18.5 / 18.7 |                 18.6 / 18.8 |
| [chromium / tilenet-full-3802](reports/browser-chromium-tilenet-full-3802-print-held-out-v1.json) |                     1532.9 / 1612.2 |                 33.2 / 33.4 |                  18.5 / 18.8 |                 18.6 / 18.8 |
| [firefox / shipped](reports/browser-firefox-shipped-print-held-out-v1.json)                       |                     2131.0 / 2195.0 |               448.0 / 448.0 |                436.0 / 442.0 |               437.0 / 442.0 |
| [firefox / tilenet-full-3801](reports/browser-firefox-tilenet-full-3801-print-held-out-v1.json)   |                     2103.0 / 2150.0 |               446.0 / 448.0 |                436.0 / 444.0 |               436.0 / 441.0 |
| [firefox / tilenet-full-3802](reports/browser-firefox-tilenet-full-3802-print-held-out-v1.json)   |                     2143.0 / 2213.0 |               448.0 / 448.0 |                440.0 / 447.0 |               440.0 / 445.0 |
| [webkit / shipped](reports/browser-webkit-shipped-print-held-out-v1.json)                         |                     1864.0 / 1972.0 |                 54.0 / 78.0 |                  17.0 / 18.0 |                 17.0 / 18.0 |
| [webkit / tilenet-full-3801](reports/browser-webkit-tilenet-full-3801-print-held-out-v1.json)     |                     1852.0 / 1953.0 |                 35.0 / 48.0 |                  18.0 / 18.0 |                 18.0 / 18.0 |
| [webkit / tilenet-full-3802](reports/browser-webkit-tilenet-full-3802-print-held-out-v1.json)     |                     1864.0 / 1882.0 |                 56.0 / 65.0 |                  17.0 / 18.0 |                 18.0 / 18.0 |

Each candidate is 1,288,448 bytes. Pinned ORT WASM is 13,961,845 bytes;
candidate plus WASM is 15,250,293 bytes. Including the deployed evaluation
HTML/JS/WASM yields 15,330,706 bytes per candidate, versus 15,331,741 bytes
for the shipped control. No experimental model is bundled into the product.
Model/runtime integrity and all nine cancellation/timeout/integrity/warm-offline
fault groups passed with zero non-same-origin requests. Physical iPad remains
deferred/unrun; these timings cannot be extrapolated to it.

## Validation and handoff

[Experiment validation](reports/experiment-validation.json),
[product validation](reports/product-validation.json), and
[preservation evidence](reports/preservation.json) retain commands, commit,
environment, counts and artifact identities. The final source-fidelity diagnostic
is a **reported failure**, so this is not an all-green experiment or a clean
answer to the intended generalization question.

| Command / evidence                                                                               | Result                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                     | TypeScript, formatting and full ESLint pass after recorded integration fixes.                                 |
| `node --test experiments/recognition-training/tests/*.test.mjs`                                  | 7 pass; split/sample-content leakage and immutable artifact checks.                                           |
| Isolated browser Vitest command in README                                                        | 10 pass; protocol, freeze selection and identity checks.                                                      |
| Python unittest command in README                                                                | 11 pass; model contract, optimizer update, recovery, split/evaluation boundaries and promotion thresholds.    |
| Frozen CPU evaluation, all three models                                                          | Complete; both candidates fail numeric promotion criteria.                                                    |
| Full experiment Playwright command in README                                                     | 30 pass across Chromium, Firefox and WebKit; accuracy failures remain recorded.                               |
| `node experiments/recognition-training/scripts/svg-fidelity.mjs --output runs/svg-fidelity.json` | **FAIL, exit 1**: native class fill differs from explicit-fill and Chromium controls.                         |
| `node experiments/recognition-training/freeze.ts --verify-only`                                  | Pass; original candidates, data locks and checkpoint selection verified without writes.                       |
| `node experiments/recognition-training/regression.ts`                                            | Pass; identical frozen vector bytes retained and source provenance recorded.                                  |
| `node experiments/recognition-training/verify-preservation.ts`                                   | Pass; 140 protected files equal merged #37, including corpus v1, historical baselines and production sources. |
| `pnpm test:unit`                                                                                 | 386 pass in 29 files.                                                                                         |
| `pnpm test:e2e`                                                                                  | 219 pass, 15 existing touch/keyboard capability skips, six browser/device-emulation projects.                 |
| `pnpm eval:recognition`                                                                          | 42 pass, Chromium/Firefox/WebKit; existing PDF selection -> worker -> editable-board path retained.           |
| `pnpm check:licenses`                                                                            | Pass, 25 production packages. Experiment source/model notices are separately pinned and reviewed.             |
| `pnpm build`                                                                                     | Pass; existing bundle-size warning remains.                                                                   |

The product evaluation's experimental hatch-PDF qualification still fails in
Firefox/WebKit, as recorded in the
[Firefox](reports/product-regression/issue-35-product-measurement-pdf-synthetic-hatched-01-firefox.json)
and [WebKit](reports/product-regression/issue-35-product-measurement-pdf-synthetic-hatched-01-webkit.json)
raw reports. The measurement contract passes without changing these outcomes.
`pnpm eval:recognition:qualify` was not rerun: #38 requires the measurement gate,
and the retained #35 qualification failure remains applicable. No qualification
claim is made. Commands for other subsystem evaluations or a separate contract
suite do not exist; applicable contract cases run within the existing unit suite.

Nine reviewable product-path reports are archived under
[product-regression](reports/product-regression/). The three original production
recognition reports contain placement strings; their review copies remove those
strings, preserve metrics and record the original raw SHA-256. Larger raw corpus
reports and traces remain local under the exact paths in product validation.
No historical baseline is rewritten. No new UI/layout screenshot is required
because product behavior and layout are unchanged; existing E2E exercised the
working slice. Physical iPad and manual VoiceOver remain deferred/unrun.

Delegated work covered the data generator/provenance, CUDA trainer/environment,
browser harness/product validation, and independent artifact review. Lead review
integrated the fixes, checked actual diffs, inspected frozen input tiles, retained
the renderer failure, and validated the final evidence. The PR requests review
of the experiment and its limitations; it does not authorize model adoption,
merge, or closing #24.
