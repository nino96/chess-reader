# Post-freeze failure analysis and proposed next experiment

This is diagnostic analysis of completed [#38](https://github.com/nino96/chess-reader/issues/38)
results, not another training run or a revision of the frozen protocol. The
[v2 report](REPORT.md), models, data, selection and promotion decision remain
unchanged. The owner requested this analysis after the completed browser matrix.
Production recognition and corpus v1 remain unchanged; #24 remains open.

## Initialization: scratch training, not fine-tuning

Both seeds instantiated `TileNet()` with random initialization in `trainer.py`;
neither loaded the shipped weights. This follows #38's explicit from-scratch
scope. The shipped model was only a frozen evaluation control. Therefore the
experiment asked a small new corpus to relearn recognition, not adapt an
existing recognizer. It provides no measurement of fine-tuning or catastrophic
forgetting. The shipped package documentation describes substantially broader visual
coverage (about 72 piece sets and 55 board themes, plus JPEG/blur/dimming/corner
jitter). That is an upstream description, not an independently reproduced
training manifest or proof of test-family novelty. Our four-family recipe is
not a reproduction of the shipped training corpus.

## What failed, and what the evidence separates

Both retrained models failed catastrophically on the RhosGFX test family:
0/256 exact boards, versus 134/256 for shipped weights on identical tensors.
Overall square accuracy masks the extent of failure: 71.44% of test squares
are empty, and our models get all of them right. Nonempty accuracy is only
43.42% / 46.30%, versus 95.92% shipped. Black-piece accuracy is 6.22% / 9.63%.
Both seeds misread all 867 black pawns as white pawns, all 256 black kings as
white kings and all 332 black queens as white kings. All 295 white queens also
become white kings. See [aggregate mismatch evidence](reports/mismatch-analysis.json).

This is both color and glyph-shape transfer failure. It appears on flat, hatch
and halftone boards; flat-square accuracy is actually slightly worse for both
retrained candidates. Hatching is an essential target but is not the primary
explanation for this particular collapse. The same inputs are substantially
readable by another weight set of the same architecture. That proves neither
that architecture is sufficient for our final gate nor that it is the cause
of the retraining deficit. Shipped weights are a useful control, not a
controlled experiment with matched training data or known test-family novelty.

### Most strongly supported explanation: narrow visual coverage

4,096 boards contain many placements, but only four training glyph families
(48 source glyphs); three families share one artist. Repeating those glyphs
against varied textures increases examples without creating independent shape
or color conventions. Development contains one other family, and test one
family. This is a valid disjoint split with weak coverage and weak ability to
predict transfer to another family; it is not multi-family generalization proof.

The verified 72-glyph contact sheet shows a clear appearance shift. Training
black pieces are black/dark gray, including three related gradient styles.
Development Firi uses yellow black pieces; test RhosGFX uses orange/brown fills,
chunky rounded outlines and substantially different king/queen shapes. The
actual classifier input is grayscale, so nominal piece color becomes a
luminance/shape problem. Label balance does not imply balance in those cues.
The consistent color confusions support a learned shortcut; they do not by
themselves identify the feature used inside the network.

The [fixed augmentation](trainer.py) scales the entire tile by 0.85–1.15,
adds bias within ±0.06 and Gaussian noise with standard deviation 0.015.
It does not independently vary piece ink, internal highlights, outline and
paper/background. The [generator](scripts/render-board.mjs) fixes source fill
appearance and adds a dark contour only to white pieces. That contour can be
an artificial label-correlated cue, though it is applied in every split and
is not a proven cause. Global brightness jitter is not equivalent to learning
many print conventions. Source-faithful SVG rendering fixes corrupt inputs;
it does not make the training distribution representative.

### Training and validation limitations

Both runs converged quickly under the declared recipe: smoothed training
cross-entropy fell from about 0.48–0.49 to 0.308–0.309. Development minimum
unsmoothed cross-entropy was 0.2734 / 0.3024 at epochs 9 / 7. These losses are
not directly comparable because training uses smoothing and augmentation;
training loss alone does not prove memorization or perfect classification.
There is no measured basis for simply extending epochs.

Checkpoint selection uses mean loss across all squares, including the roughly
72% empty-square majority, on a single development family. It does not expose
worst-family or worst-piece behavior. Per-class development metrics should
have been inspected before treating successful optimization as a promising
candidate. A disjoint split prevents leakage; it does not guarantee that its
aggregate metric is informative about the next source family.

A new [development-only diagnostic](reports/failure-diagnostic-dev.json)
ran all three existing models on the already-used Firi split in **7.22 seconds**
on single-thread CPU. It loaded no held-out or corpus-v1 samples and changed
no selection. Its [reproduction script](analysis/dev_color_diagnostic.py) binds
model/data/script hashes. Results:

| Model        | Raw square accuracy | Occupied-square accuracy | Exact boards | White rooks correct |
| ------------ | ------------------: | -----------------------: | -----------: | ------------------: |
| shipped      |              89.54% |                   63.77% |        1/256 |             165/276 |
| scratch 3811 |              92.20% |                   72.07% |        0/256 |               0/276 |
| scratch 3812 |              91.60% |                   69.93% |        0/256 |               0/276 |

Both scratch candidates abstain on all 256 development boards at the retained
confidence floor. Their exported-model development losses reproduce the
recorded selected checkpoint losses within 1.13e-8 / 3.93e-9. The model was
already failing whole-family recognition during development; this should have
been surfaced before interpreting the held-out collapse or spending more on
browser measurement. Scratch models beat shipped occupied accuracy on Firi
but lose dramatically on RhosGFX: model ranking is strongly family-dependent.
Shipped weights are therefore not a universal solution either.

Scratch black-piece accuracy on development is 66.92% / 69.75%, versus
6.22% / 9.63% on test. That argues against a global swapped-label or inability
to emit black classes; the collapse depends on the source appearance. It is
stronger evidence for a coverage/cue problem than the test confusion matrix
alone, while still not a causal intervention.

The implementation review checks training/eval mode, label ordering, optimizer
updates, frozen best-state copies and export behavior. Existing parity and
identical CPU/three-browser confusion matrices make a browser/export defect
an implausible explanation for the deficit. Renderer/tensor fidelity checks
rule out the previously demonstrated CSS failure. They cannot prove absence
of every bug. No causal ablation has yet separated data coverage, augmentation,
selection and architecture effects.

## Proposed next experiments, in priority order

First check whether a licensed training checkpoint corresponding to the shipped
ONNX is available, or whether its inference graph can be mapped to a trainable
model with strict pre-update numeric equivalence. A published inference ONNX
is not automatically a resumable optimizer/BatchNorm checkpoint. Do not call
random initialization or partial weight transfer “fine-tuning the shipped model.”
The local package contains no shipped training checkpoint. Its ONNX has
matching Conv/FC dimensions but no BatchNormalization nodes: the 320 trainable
BN affine parameters have been fused into convolution weights/biases. An
inference-equivalent trainable graph is plausible, but the original training
state/decomposition is not recoverable from that fact. If no original checkpoint
can be obtained, explicitly lock a no-BN or frozen-BN graph for **both** matched
arms, prove pre-update parity against shipped ONNX, and document the training
behavior difference. This is not an unchanged continuation of v2.
This feasibility check requires no GPU training or product/browser matrix.

If that prerequisite passes, the most direct practical experiment is **matched
fine-tuning versus scratch training** on the same expanded, verified print
development corpus, with the shipped model as a third unchanged control. Use
two seeds per trained arm, the same declared graph, optimizer/learning-rate
recipe, equal compute ceilings and frozen multi-family evaluation. If practical
fine-tuning requires a different learning-rate recipe, label that explicitly as
an adaptation-recipe comparison rather than an initialization-only ablation. Include
licensed pristine-style examples to measure retention without using corpus v1
for tuning. This tests whether adaptation preserves useful recognition better
than relearning it; it cannot uniquely explain every v2 error. Freeze those details before
execution. No fine-tuning has been performed or checkpoint availability assumed.

### Diagnostic alternative: coverage and color-cue ablation

Do not rerun v2 with more epochs or add a localizer to these failed classifiers.
First run a bounded development experiment designed to distinguish the likely
causes, using the same TileNet and optimizer so the comparison is interpretable.
A different classifier comparison is justified as a next question, but changing
architecture and data together would leave the current cause unresolved.

Proposed design, to freeze in a separate experiment before execution:

1. Build a licensed development pool with multiple unrelated print-like glyph
   families and ink conventions. Partition by artist/source family. Reserve
   at least three independent, previously unexposed test families before any
   model comparison; exact sources and hashes are prerequisites, not acquired
   or approved by this proposal. RhosGFX and Firi are now diagnostic/development
   evidence, never fresh test claims. Corpus v1 stays excluded from tuning.
2. Compare a 2 × 2 design: current narrow versus expanded glyph coverage, each
   with current versus piece-aware grayscale/ink augmentation. Hold board count,
   placement seeds, texture/degradation balance, optimizer, epochs and paired
   model seeds fixed. Wider coverage redistributes the same number of boards.
   Keep a shipped-weight control on identical development inputs.
3. Include a small, fixed counterfactual diagnostic grid with the same geometry
   and background but varied legal ink/fill conventions, with and without the
   added white contour. Generate from labeled source masks and visually verify
   identity/readability before inference. An input made ambiguous by the
   intervention is not evidence of model failure. Use this to test the color
   shortcut, not to redefine the promotion corpus after seeing results.
4. Use two predeclared seeds per arm, 12 epochs, at most 600 seconds per run
   and 4,800 seconds total GPU training, including failed attempts; one fixed
   pilot included in that total. These are proposed ceilings, not measured
   durations or permission to extend. Keep all runs. Report actual wall time.
5. Select checkpoints using a predeclared class-balanced development loss
   aggregated equally across held-out development families; also report the
   original square-weighted loss, exact/reliable boards, occupied-square and
   per-class/color/texture metrics. Apply the same selection rule to every arm.
   That differs from v2, so this experiment estimates differences between its
   new matched arms, not a clean effect versus the old v2 run.
6. Inspect development results first. If no arm materially beats its matched
   narrow/current control across both seeds and multiple development families,
   stop before fresh test exposure and expensive browser evaluation. Predeclare
   the minimum meaningful improvement before running. Freeze all nominated
   candidates before opening the fresh test once; retain the original 0.7
   confidence floor and promotion gates. Do not choose a new model after test.

This can distinguish a coverage effect, an ink-augmentation effect, their
interaction, and failure of both. If coverage/ink fixes reliably recover
occupied-piece/color accuracy but the retained exact-board gate still fails,
a later matched-data architecture comparison becomes much more informative.
If neither helps despite correct in-family learning and verified interventions,
prioritize that comparison instead of another unstructured data expansion.
No result here would establish a heuristic localizer as adequate: localization
needs its own precision/recall, alignment, negative/partial and multi-board page
experiment under #24. Board-context models are a separate hypothesis, not an
automatic remedy for simple exact-crop color mistakes.

## Evaluation cost and scope

Follow the [staged research policy](../../../docs/evaluation.md#staged-isolated-model-experiments).
This analysis reuses frozen test/browser/product evidence. It requires no new
GPU training, full browser matrix or unchanged product recognition run. A
future changed export/architecture receives a small compatibility smoke; only
qualifying frozen candidates advance to full browser qualification. Production
integration and physical-device gates remain deferred until their proper stage.

## Analysis provenance and checks

The upstream corpus description is from installed `@scoriiu/fenshot@0.1.4`
`README.md`, “How it works” item 2; SHA-256
`f2cab5563752f70d5cd5cee7801df1bde9b1229cb70d6f001bccf88ba32a41cd`.
It is a package-author claim, not an audit of upstream training inputs/licenses.
Read-only ONNX inspection of shipped SHA-256
`883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d`
finds three Conv, two Gemm, zero BatchNormalization nodes and ten floating-point
initializers totaling 321,485 values. No weights were modified or reconstructed.

Sol performed the implementation audit and development diagnostic; the lead
reviewed its code, independently recounted per-class totals against summaries,
verified script SHA-256 and selected-loss agreement, inspected the source sheet
and ONNX metadata, and integrated the conclusions. `pnpm check`, local Markdown
link checks and `git diff --check` passed for this change. The diagnostic's exact
command/environment and 7.22-second elapsed time are retained in its JSON.
GPU training, full browser matrices, product recognition and product E2E were
not rerun: this is analysis of frozen models with production inputs unchanged.
Prior evidence is cited, not relabeled as a fresh pass. No fresh test inference,
new model selection, fine-tuning, or architecture training occurred in this turn.
