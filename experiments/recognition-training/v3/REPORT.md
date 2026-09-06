# Bounded comparison result (#40)

The declared FENShot adaptation recipe and both public alternatives stop offline. Neither fine-tuning seed meets the accuracy/confidence gate; no candidate proceeds to fresh qualification or browser benchmarking. Production is unchanged, #24 stays open, PR #39 remains unmerged, and physical iPad is deferred/unrun.

## Same-input FENShot comparison

All three models below use the same 384 development boards from three independent attributed artwork groups, 24,576 squares, and 6,845 occupied squares. The retained confidence floor is 0.7. Low confidence counts as failure.

| Model           | Raw exact boards |   Occupied correct | Reliable exact boards | Confidently wrong boards | Confident correct squares / all |
| --------------- | ---------------: | -----------------: | --------------------: | -----------------------: | ------------------------------: |
| Shipped FENShot |          133/384 | 5446/6845 (79.56%) |                62/384 |                        6 |                          89.31% |
| full-3821       |          145/384 | 5404/6845 (78.95%) |               136/384 |                       81 |                          93.61% |
| full-3822       |          141/384 | 5397/6845 (78.85%) |               137/384 |                       86 |                          93.66% |

Both full runs completed twelve epochs and selected epoch 1 by the predeclared lowest equally family-averaged class-balanced development cross-entropy. Later near-zero training loss did not solve unseen-family errors. Both selected models have zero exact boards on the lyricsz development family. Fine-tuning increases confidence coverage substantially, including confidently wrong boards; the small raw exact-board gains do not establish a useful model.

| Model           | Pristine exact (129) | Degraded exact (255) | White errors (3409) | Black errors (3436) | White rooks correct |
| --------------- | -------------------: | -------------------: | ------------------: | ------------------: | ------------------: |
| Shipped FENShot |                   56 |                   77 |                 792 |                 607 |             277/420 |
| full-3821       |                   55 |                   90 |                 850 |                 591 |             265/420 |
| full-3822       |                   52 |                   89 |                 857 |                 591 |             265/420 |

[Comparison JSON](reports/comparison.json) includes every class, cross-color confusions, confidence distributions, family/condition strata and the predeclared improvement/regression deltas. [Learning curves](reports/learning-curves.csv) retain every epoch; the full run reports retain the underlying per-epoch diagnostics. The gate remains 95% reliable exact boards, 99.5% confident correct squares over all squares, and zero reliable wrong boards.

## Native public alternatives

| Candidate   | Inputs and observed result                                                                                                                                                                      | Decision                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fenify      | 12 exact crops + 6 negatives: 5/12 raw exact, 111/147 occupied correct; at 0.7, 4 reliable exact and 5 reliable wrong boards                                                                    | Stop: no error-free covered positive on the declared threshold grid                         |
| NAKSTStudio | Corrected 24-input smoke: 5/12 exact crops, 100/147 occupied correct. Development reused those 12; stopped after 14 additional crops at 9/26 exact, 264/355 occupied correct, 126 wrong squares | Stop: even perfect remaining predictions give at most 99.4873% square accuracy, below 99.5% |

These sample sizes differ and must not be ranked as a complete same-input accuracy benchmark. NAKST uses native RGB, predicted geometry only, class-aware NMS and predicted-board square association. Its export has normalized coordinates; the corrected exact-crop IoU range is 0.99181–0.99797. It detects boards in both loose selections and both two-board pages. Partial selections are detected but do not pass the tested board/piece confidence policy. Neither model infers orientation; NAKST has no empty-square confidence and receives no invented full-square reliability.

Two NAKST infrastructure attempts are retained. The first lacked timing instrumentation and failed on tiny sigmoid rounding drift; the second corrected drift but exposed normalized-coordinate decoding. Its earlier geometry and page counts are superseded. Final tests verify a 1e-6 numerical tolerance (no extra sigmoid), clipping and normalized-to-letterbox-to-original geometry. The final smoke repeats only the affected adapter check. First-attempt time is conservatively charged at 60 seconds; adding 15.3434 and 15.7920 seconds keeps the native NAKST smoke charge at 91.1354/120 seconds. Fenify took 4.0682/120 seconds and was not rerun. Native development rejection took 9.4664/60 seconds.

[Fenify raw smoke](reports/native-smoke-fenify.json), [final NAKST raw smoke](reports/native-smoke-nakst.json), [initial infrastructure failure](reports/native-smoke-nakst-attempt-1.json), [superseded geometry attempt](reports/native-smoke-nakst-attempt-2.json), and [bounded NAKST development evidence](reports/nakst-development.json) retain the observations and hashes. Artifact licenses and dataset-provenance/distribution limitations remain in the [candidate record](alternative-provenance.json); local research inference does not establish production distribution clearance.

## Data, training and retained evidence

The [protocol](protocol.json), [data-quality evidence](manifests/data-quality.json) and [pretraining lock](manifests/pretraining-lock.json) were committed at `4033984` before GPU training. Six train, three development and three qualification attributed artwork groups produce 4,096/384/384 synthetic boards. All 4,864 outputs replay byte-identically; all 36 family/condition groups include all 13 classes. Twenty-four source/tensor sheets were visually reviewed. Attribution groups do not prove absence of stylistic influence; related training artwork stays within train. Data operations used a conservatively recorded 199.39/600 seconds. No model saw the qualification split.

Shipped reconstruction/parity evidence is reused from [planning](../planning/reconstruction-parity.json); all ten learned tensors initialize the fused no-BatchNorm graph. The narrow trainer test additionally checks its pre-update outputs against shipped ONNX. The 60-second mechanics pilot performs an uninterrupted trajectory and a real minibatch interruption/recovery trajectory; weights, history and selected epoch/score match exactly.

| Run       | Result                       | Training/export/diagnostic elapsed | Ledger charge | Selected epoch | Maximum ONNX parity difference |
| --------- | ---------------------------- | ---------------------------------: | ------------: | -------------: | -----------------------------: |
| pilot     | Completed; accuracy rejected |                            7.668 s |       7.726 s |              1 |                 5.96046448e-07 |
| full-3821 | Completed; accuracy rejected |                          170.437 s |     170.503 s |              1 |                 9.53674316e-07 |
| full-3822 | Completed; accuracy rejected |                          175.787 s |     175.849 s |              1 |                 1.43051147e-06 |

Total ledger charge: **354.078/1260 seconds**. Charges include environment/report finalization, so they are slightly larger than run-report elapsed times. Full seeds stay below their 600-second ceilings; no extra seeds, epochs, scratch runs or sweeps were added. Strict fp32 ONNX parity uses identical argmax, `atol=rtol=1e-5`, six development boards covering all classes and three styles. Export is dynamic-batch opset 17 with no external tensor sidecar.

[Candidate freeze](manifests/candidate-freeze.json) binds selected weights, ONNX exports and full last-state recovery checkpoints. **Selected-best checkpoints contain weights and selection metadata only; optimizer/scheduler/RNG recovery is from the separate last-state checkpoint.** No best-checkpoint optimizer recovery is claimed. Run reports: [pilot](reports/pilot/run-report.json), [3821](reports/full-3821/run-report.json), [3822](reports/full-3822/run-report.json).

Historical scratch controls remain on their original development corpus: both 0/256 exact boards and 0/276 correct white rooks. The [7.22-second diagnostic](../v2/reports/failure-diagnostic-dev.json) and [failure analysis](../v2/FAILURE_ANALYSIS.md) were reused by hash, not rerun. Those figures are not a same-dataset comparison with v3. Original/v2 experiments, corpus v1, production code, fixtures, dependencies and lockfile are unchanged.

## Reproduction and verification

The exact isolated commands used for reached stages are:

```sh
node experiments/recognition-training/v3/scripts/fetch-sources.mjs
node experiments/recognition-training/v3/scripts/build-source-lock.mjs --initial
node experiments/recognition-training/v3/scripts/data-preflight.mjs
timeout 594s node experiments/recognition-training/v3/scripts/generate-dataset.mjs --approved
timeout 520s node experiments/recognition-training/v3/scripts/verify-generated.mjs
timeout 75s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/trainer.py --protocol experiments/recognition-training/v3/protocol.json --run pilot --device cuda
timeout 615s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/trainer.py --protocol experiments/recognition-training/v3/protocol.json --run full-3821 --device cuda
timeout 615s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/trainer.py --protocol experiments/recognition-training/v3/protocol.json --run full-3822 --device cuda
timeout 120s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/native_smoke.py --candidate fenify
timeout 120s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/native_smoke.py --candidate nakst
timeout 60s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/native_smoke.py --candidate nakst --attempt 2 --ceiling 60
timeout 44s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/native_smoke.py --candidate nakst --attempt 3 --ceiling 44
timeout 60s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/diagnostic.py --model node_modules/.pnpm/@scoriiu+fenshot@0.1.4_onnxruntime-web@1.29.0/node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx --data-dir experiments/recognition-training/v3/data/full --output experiments/recognition-training/v3/runs/shipped-development.json
timeout 60s experiments/recognition-training/.venv/bin/python experiments/recognition-training/v3/nakst_development.py
pnpm check
node --test experiments/recognition-training/v3/tests/*.test.mjs
experiments/recognition-training/.venv/bin/python -m unittest discover -s experiments/recognition-training/v3/tests -p 'test_*.py'
git diff --check
```

Root type/format/lint checks pass. The focused JavaScript runner reports two passing test files; Python reports 27 passing tests. Additional checks covered all manifest/asset identities, full data replay, canonical loader schema, local links, aggregate recounts and preservation/privacy of staged artifacts. Earlier source typing, formatting and native-decoder failures were fixed before final checks; no gate was weakened. The command block includes the retry attempt selectors omitted from native JSON command strings and expands the shipped diagnostic placeholders; external timeout includes startup, while the trainer enforces its smaller internal GPU-labelled wall-time budget. Re-execution must use a new separately approved experiment directory rather than overwrite these retained outcomes.

Environment: Linux ARM64, local NVIDIA GB10, driver 580.159.03, Python 3.12.3, Torch 2.10.0+cu128, ONNX 1.18.0, ONNX Runtime 1.22.1. Torch warns that the GB10 compute capability is 12.1 while its advertised support ends at 12.0; these runs completed, and recovery/export parity passed. This evidence does not remove that environment limitation. CPU timings are bounded diagnostic observations, not browser performance measurements.

Stages 2–3 (browser compatibility, fresh qualification, full browser accuracy/latency/fault work) were **not reached: offline rejection**. Product suites were **not applicable: production unchanged**, under the [staged policy](../../../docs/evaluation.md#staged-isolated-model-experiments). Existing historical product evidence remains historical, not a new pass. Physical iPad is **deferred/unrun**. No ADR threshold or architecture was changed.

Independent agents handled source/data construction and verification, trainer/recovery implementation, native adapters, and a final read-only data/trainer audit. The lead reviewed code and evidence, corrected native schema/input-boundary issues before final evaluation, owned training/evaluation and integrated the handoff. All failed candidates are retained; #24 remains the follow-up for improving transfer and meeting product/device gates.
