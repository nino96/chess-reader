# Bounded pretrained comparison: preparation for #24

Status: preparation, not an executable training lock. Updated 2026-09-06.
Tracks [#38](https://github.com/nino96/chess-reader/issues/38) and
[PR #39](https://github.com/nino96/chess-reader/pull/39); the next executable
experiment must be scoped separately under
[#24](https://github.com/nino96/chess-reader/issues/24), which remains open.
PR #37 was confirmed merged on 2026-09-05. Production and all frozen experiment
files/corpus v1 remain unchanged. Physical iPad is deferred/unrun.

The updated issue supersedes the prospective matched-scratch suggestion in the
[frozen failure analysis](../v2/FAILURE_ANALYSIS.md): retain failed scratch
controls; do not retrain them by default. This comparison tests practical
adaptation and pretrained alternatives, not an initialization-only causal claim.

## Arms and ordering

1. Shipped FENShot 0.1.4, unchanged, confidence floor 0.7.
2. FENShot adaptation, seeds **3821 and 3822**, using all learned shipped
   Conv/FC weights in an explicitly fused **no-BatchNorm** differentiable graph.
   New optimizer; no claim of original optimizer recovery or resumed upstream
   training trajectory. A partial transfer or random initialization is not this arm.
3. Historical failed scratch controls 3811/3812, plus the preserved original
   experiment. Reuse their existing observations on identical historical inputs;
   do not imply that they have been measured on future new data.
4. At most two independent pretrained comparators. Candidate provenance and
   eligibility are recorded separately below; native screening precedes adapters.
   No second-line sweep, architecture training, detector training or distillation.

First verify artifact identity, reconstruction and pre-update numeric/argmax
parity. Then finish data/source eligibility, renderer checks and the new split
lock. No training or comparative accuracy benchmark before those prerequisites.

## Preparation budget and parity protocol

The preparation command has a **120-second wall-time CPU ceiling**, one CPU
thread for Torch/ORT, no GPU training, no optimizer step and no fresh-test or
corpus-v1 access. It compares a deterministic, hash-bound subset of existing
train/development vectors covering all 13 labels and available source/degradation
styles. This is numeric equivalence evidence, not accuracy qualification or proof
of coverage of future unacquired print/pristine sources.

Transfer all ten floating-point initializers, validate graph topology and
attributes, compare fp32 probabilities at **atol=1e-5, rtol=1e-5** and require
**identical argmax on every vector**. Record maximum absolute difference, input
indices/hashes, source graph hash, class coverage, script hash, commit, environment
and exact command. Fail closed on unexpected graph, missing tensors, external
data, nonfinite output or parity disagreement; no tolerance adjustment or retries
with a changed subset. This proves a fused inference-equivalent starting point,
not recoverability of the original BatchNorm decomposition.

## Proposed executable budget (not started)

These are ceilings, not estimated throughput or permission to extend. Freeze the
complete source manifests and executable configuration in the separate experiment
before any command. Count failed attempts against these totals.

| Work                                       | Ceiling                                                                                       | Stop rule                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Data generation/fidelity and visual sheets | 600 CPU seconds                                                                               | Any source, split, label, renderer or readability failure blocks training              |
| Fixed adaptation pilot, seed 3820          | 60 GPU seconds, one epoch, 256 train boards                                                   | Fail on CUDA, gradients, checkpoint recovery, export or parity error                   |
| Two adaptation runs, seeds 3821/3822       | 12 epochs and 600 GPU seconds each; **1,260 GPU seconds total including pilot**               | No extension or seed replacement; retain interrupted/failed runs                       |
| Native alternative smoke                   | At most 24 development inputs and 120 seconds per comparator; 240 seconds total               | Invalid schema/decoding, no exact positive board, or accepted negative stops that lane |
| Development diagnostics                    | 60 CPU seconds per candidate; 300 seconds total for shipped, two adapted and two alternatives | Apply the offline gates below; no browser confirmation of failure                      |
| Fresh qualification, only frozen survivors | 120 seconds per candidate; 600 seconds total                                                  | Accuracy/reliability failure stops browser qualification                               |
| Changed export compatibility smoke         | 60 seconds per engine per changed graph; at most three graphs, 540 seconds total              | Fixed vectors only; parity/schema/worker failure stops that lane                       |

No full browser accuracy/latency/fault budget is allocated in this preparation.
If a frozen candidate passes offline qualification, declare that bounded matrix
and expected duration before execution, using existing harness measurements.
Product integration is a separate stage. Do not rerun unchanged product suites.
Native CPU/GPU inference time must be reported separately from training; a timeout
is an incomplete run, never a low-accuracy result. Dependency acquisition time is
not benchmark throughput. These limits need enforcing in the future runner.

## Data requirements before the executable lock

Proposed fixed size: **4,096 training boards, 384 validation boards and 384 fresh
qualification boards**, with 128 boards per each of at least three independent
validation/test source groups. Training needs at least six source groups. Group
by artist/source lineage, not merely named piece-set variants. Validation/test
artists must be disjoint from training and each other. If enough eligible groups
cannot be acquired, stop and report the gap; do not relabel related styles.

Balance each group across pristine, hatch and other low-fidelity print conditions;
include every piece/color with independently verified labels. Keep boards intact
across splits. Use new placement seeds 3830/3831/3832 for train/dev/test and lock
source membership, sample identities, counts, generator and byte hashes before
training. Keep exposed Firi/RhosGFX data diagnostic only and corpus v1 entirely
outside generation, training, validation, calibration and selection. Novelty is
relative to our experiment exposure: unknown upstream training inventories prevent
claiming that a family was unseen by every pretrained model.

A separate development/qualification page set should contain, per split, 24
positive pages (eight single-board, eight multiple-board, eight partial-board)
and 24 negatives. Truth comes from synthetic geometry or independent manual
annotation, never candidate predictions. Freeze exact crops, loose selections,
full pages and negative identities separately. A detector gets the whole input;
no ground-truth crop/corners at inference. Classifier-only arms have localization
marked **untested**, not credited with oracle-assisted detection success.

For each asset record immutable source/revision, exact bytes/hash, acquisition
terms, applicable training-use basis, redistribution status, notices and unresolved
questions. The existing licensed synthetic source manifest is useful provenance,
not sufficient new source diversity. Proprietary/non-redistributable sources are
not automatically excluded: acquisition and intended local use must have an
established lawful basis. Until that source-specific review is resolved, do not
acquire/use it for training. Keep non-redistributable sources, crops and derivatives
local and ignored; commit only permitted provenance/aggregate records. Training
eligibility does not itself clear resulting model distribution. Do not infer rights
from another project's training sources or bypass access controls.

## Frozen adaptation recipe to carry into the new lock

Proposed recipe: fp32 fused no-BN graph; update all Conv/FC parameters; AdamW
learning rate 1e-4, betas (0.9, 0.999), epsilon 1e-8, weight decay 1e-4; batch
512 tiles; no label smoothing; cosine decay to 1e-6 over at most 12 epochs.
Use equal family/condition board sampling, retain all 64 squares, and compute
training loss as the mean of available class means. Use no additional online
pixel augmentation: all print/ink changes belong to the verified frozen generator.
The pilot checks mechanics only and cannot tune this recipe. Verify finite,
nonzero gradients and changed learned weights; never save over shipped assets.

Select the lowest **class-balanced development cross-entropy averaged equally
over source groups**, earliest epoch on ties. Save immutable best state plus
optimizer/RNG state for recovery; reject stale or mismatched resume inputs. Run
cheap aggregate development diagnostics at every epoch and on the exported
selected model. No checkpoint selection by test data or corpus-v1 results.
A collapsed class after the first epoch is reported; reject the selected candidate
before further evaluation if any supported class has zero correct predictions or
any development family has zero exact boards. Do not hide failures behind loss.

## Mandatory offline diagnostic and advancement

For every new candidate, report denominators and counts for exact boards, occupied
squares, all squares, all 13 classes, white/black errors and cross-color confusions;
stratify by family and pristine/hatch/degradation. Report minimum/mean confidence,
confidence distributions, accepted exact, accepted wrong, abstention/coverage and
orientation correctness separately. For detectors also report board precision/
recall, alignment, duplicate/missing pieces, full/multiple/partial page outcomes
and false accepts on negatives. Confidently wrong boards are not successes.

The immediate rejection rules above are a cheap screen, not sufficient advancement.
Before fresh test access, each candidate must meet retained **95% exact boards,
99.5% square accuracy and zero reliable wrong** on development, including each
pristine/hatch stratum. Adaptation additionally needs at least **five percentage
points exact-board improvement** over shipped on degraded development and no
more than **one percentage point loss** in either pristine exact or occupied
accuracy. Both seeds must meet that rule to recommend the adaptation recipe;
report disagreement without choosing a seed after test.

FENShot's 0.7 floor remains fixed. For an alternative, predeclare the meaning and
aggregation of its native scores, then calibrate only on development using the
finite grid 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.99. Choose greatest coverage
subject to zero accepted errors/negative false accepts and unchanged qualification
targets; ties use the higher threshold. No feasible threshold means rejection.
This does not make different model scores numerically comparable. Freeze the
chosen policy and every nominated candidate before one fresh-test exposure.

Qualification retains the same accuracy/reliability targets and a post-freeze
corpus-v1 regression check. Failures remain reported; do not use exposed test to
choose another checkpoint/model/threshold. Only offline survivors receive full
browser qualification. Small compatibility smoke required for changed graphs is
separate from that expensive matrix. Reader/offline/device acceptance is still
required at integration; physical iPad remains unrun.

## Evidence reuse and handoff

The [7.22-second development diagnostic](../v2/reports/failure-diagnostic-dev.json)
and its [script](../v2/analysis/dev_color_diagnostic.py) remain untouched and were
not rerun. Both scratch models have 0/256 exact boards, 0/276 correct white rooks
and 256/256 abstentions; occupied accuracy is 72.07%/69.93%. Shipped is 1/256
exact with 63.77% occupied accuracy. These are historical Firi results, not new
candidate qualification. Reuse depends on the report's model/data/script hashes.

Historical product and three-browser evidence remains in the
[v2 report](../v2/REPORT.md). No changed product, runtime, lockfile, fixture or
frozen experiment input means no new product matrix for this preparation.
New graph/weights need their own parity and accuracy; old results cannot clear
those gates. See the [staged policy](../../../docs/evaluation.md#staged-isolated-model-experiments).

## Selected alternative provenance (read-only review)

**Fenify:** pin revision
`e9a4fd252ea4be322c560a9b78a2b9da31f49735` and
[release v2023-07-10](https://github.com/notnil/fenify/releases/tag/v2023-07-10).
Select only `models_2023-07-10-chessboard-2D-balanced-fen-cpu.pt`, reported
127,147,094 bytes. The release supplies no publisher SHA-256; independently hash
local bytes before execution. No weights have been downloaded in this preparation.
The pinned [predictor](https://github.com/notnil/fenify/blob/e9a4fd252ea4be322c560a9b78a2b9da31f49735/src/board_predictor.py)
uses an already localized board crop, grayscale replicated to three channels,
300 × 300 resize, tensor conversion and ImageNet normalization. It emits 64 × 13
class scores: empty, white P/N/B/R/Q/K, black P/N/B/R/Q/K. Its first output rank
maps to rank 1, assuming bottom-left A1. Native artifact schema still needs
inspection. Localization/orientation detection remains untested.

The pinned [README](https://github.com/notnil/fenify/blob/e9a4fd252ea4be322c560a9b78a2b9da31f49735/README.md)
describes personal scans of copyrighted books used for adaptation. Repository
MIT licensing does not establish a complete model/data provenance review; the
release has no separate weight-license statement. Research-execution status:
**pending source-specific weight-use review**, not rejected for accuracy.
Production distribution: **unresolved**. Do not acquire the scanned books/data.

**NAKSTStudio:** pin Hugging Face revision
`3b2c734aeade4646ea313da333ee670a4869c46f`, select only
[best.onnx](https://huggingface.co/NAKSTStudio/yolov8m-chess-piece-detection/blob/3b2c734aeade4646ea313da333ee670a4869c46f/best.onnx),
reported 103,737,229 bytes; publisher LFS SHA-256
`6fdef8213ab818a71c69250e61e213a7b5471ffb05c0fae485e7d96040f9642c`.
Verify downloaded bytes against that identity before execution. The
[config](https://huggingface.co/NAKSTStudio/yolov8m-chess-piece-detection/blob/3b2c734aeade4646ea313da333ee670a4869c46f/config.json)
describes 640 × 640 RGB with aspect-preserving padding. Classes are **0 board**,
1–6 white K/Q/R/B/N/P, 7–12 black K/Q/R/B/N/P. Empty is absence of a piece,
not class zero. Actual tensor schema, YOLOv8 decoding/NMS, detected-board
association and orientation need native verification; do not infer these from
FENShot's interface or use ground-truth board bounds to fill a detection gap.

The [model card](https://huggingface.co/NAKSTStudio/yolov8m-chess-piece-detection/blob/3b2c734aeade4646ea313da333ee670a4869c46f/README.md)
labels AGPL-3.0 and describes training counts without a source-level dataset
manifest. Research execution: **pending recorded AGPL/lineage compliance review**;
AGPL is not automatic exclusion from local research. Distribution: **unresolved**,
requiring separate compatibility review. Dataset claims are unaudited, not
reproduced results. Neither model's size is an accuracy or runtime exclusion.
Continue an eligible lane if the other stays unresolved. No fallback artifact was
selected or inspected; replacing a lane requires an explicit revised pre-execution
candidate lock, still with at most two alternatives.

The existing source cache pins Lila revision
`2e48c25007bc3344411811a24cd6cab666c67cbf`: chessnut (Apache-2.0),
fantasy/spatial/celtic (MIT, shared artist), Firi (CC-BY-4.0), RhosGFX (CC0).
All are exposed. Additional names in its license metadata are discovery inputs,
not approved datasets: no newly reviewed glyph bytes/hashes, independent artist
split or fresh test lock exist yet. That is a concrete **training blocker under
#24**, not permission to reuse the exposed test as fresh qualification.

## Preparation result and validation

The [reconstruction script](reconstruct_parity.py) and
[raw parity report](reconstruction-parity.json) establish pre-update feasibility:
all ten learned tensors mapped, 321,485 trainable parameters, **960/960 identical
argmax**, maximum probability difference **8.642673492431641e-7**, within the
predeclared tolerances. Train/eval outputs match exactly. The fixed 15 boards
cover five existing train/dev families × flat/hatch/halftone and all 13 classes;
they do not cover every resolution/noise combination or new pristine sources.
No original training checkpoint was found locally. The no-BN graph preserves
inference behavior but not original BatchNorm training behavior.

Command: `timeout 120s experiments/recognition-training/.venv/bin/python experiments/recognition-training/planning/reconstruct_parity.py`.
Environment: Linux ARM64, Python 3.12.3, Torch 2.10.0+cu128 on CPU,
ONNX 1.18.0, ORT 1.22.1, one intra/inter-op thread; no browser/device.
Final measured function elapsed time: **1.518 seconds**, excluding interpreter
startup. An initial 1.490-second pass preceded lead-requested validation fixes;
only the changed parity script was rerun, with unchanged vectors/tolerances.
No optimizer step, model export, saved weights or accuracy benchmark occurred.

The final script binds shipped and canonical dataset hashes before loading,
rejects external tensor data and nonfinite/wrong-shape outputs, and replaces
old success output with a failure record for handled validation errors.
In-memory negative checks rejected a missing initializer and changed Conv pads;
a CLI wrong-model identity check exited 1 and wrote a failure report in `/tmp`.
The report identifies base commit `e9370789f4c2fdc115265a1c478ac0fbaee8e234`
and the new script SHA-256; the script was uncommitted at measurement time.

Lead review verified the actual implementation, frozen-path diff, old diagnostic
script/freeze/manifest/model hashes and aggregate counts. Two subagents handled
reconstruction and read-only upstream provenance review. No old inference was
rerun. Validation includes `pnpm check`, local Markdown file-link checks and
`git diff --check`; the first formatting check flagged the new JSON and was
corrected with Prettier before rerunning. The system has `python3`, not a
`python` command; the local-link check used `python3`.

Training/native candidate benchmarks: **not started, provenance/new test lock
incomplete**. Browser compatibility/qualification: **not reached, no exported
candidate**. Product unit/E2E/recognition/license matrix: **not applicable to this
isolated preparation, product inputs unchanged**; historical results remain
linked above, not relabeled as fresh passes. Physical iPad: **deferred/unrun**.
No ADR change: the accepted staged policy already covers this work. No new
recognizer has been qualified, and neither #24 nor PR #39 is to be closed/merged
by this preparation.
