# Corrected-renderer TileNet experiment (issue #38)

The owner authorized this new bounded experiment after the [first run](../REPORT.md)
exposed a native SVG CSS-rendering defect. All original scripts, source locks,
corpora, candidates and reports remain intact. This directory owns a new protocol,
dataset seed, test lock, pilot (381), and full seeds (3811/3812). Production
recognition is unchanged; [#24](https://github.com/nino96/chess-reader/issues/24)
stays open and physical-iPad testing remains deferred/unrun.

## Data correctness before training

The [protocol](protocol.json) retains the original TileNet, optimizer, twelve
epochs, 4,096/256/256 whole-board split sizes, 0.7 confidence floor, parity
limits, promotion thresholds and 600/2,700/2,700-second training ceilings.
The total training ceiling is 6,000 seconds. No model inference on test or
corpus v1 is permitted until both full candidates are frozen. No post-test
training extension or recipe adjustment is permitted.

Six original licensed source families remain in their original roles, with
newly seeded board placements and degradation. The RhosGFX test **source family
was previously exposed**. This is a corrected-renderer replication with new
held-out boards, not blind independent source-family validation. No old tensor
or exact synthetic placement may occur in the new splits. Corpus v1 is excluded
from all training/tuning and used only for post-freeze regression.

Pinned Chromium decodes every original SVG, including embedded CSS, into a
72-pixel transparent PNG. Native canvas receives PNGs only. Each source is
checked against its original SHA and compatible license in the shared
[notices](../NOTICES.md). The existing 0.75-pixel white-piece contour remains a
declared print derivative applied after source rasterization. Source fidelity
is checked before that derivative. No new source asset or dependency is added.

Required checks cover all 72 glyphs, exact fresh-context rendering, exact visible
native PNG roundtrip, independent Firefox rendering within predeclared limits,
class-versus-explicit-fill controls, and zero external requests. Source and
raster hashes bind generation to those checks. Deterministic manifest key order
is explicit. A preview must include speckles and exactly match the pixels
consumed by preprocessing.

The dataset contains flat, hatched and halftone squares, reductions 1/0.82/0.64,
and speckle densities 0/0.0015. Every family must include all 18 combinations
and every class. This tests raster degradation, not every scanner artifact;
real-book transfer remains unproven. Saved tensors retain the pinned upstream
32×32 grayscale preprocessing, A1-through-H8 order and 13 class indexes.

Pretraining evidence requires full artifact validation, exact independent
regeneration, class/degradation recounts, split/family/identity exclusion,
all-class ordering tests, and visual inspection of all 72 source glyphs,
all-class condition grids, and 18 actual serialized tensor boards. Both the
trainer and candidate freeze verify the exact automated report and reviewed
image hashes, not just an unchecked status field.

## Reproduce

Use the existing pinned Node/pnpm dependencies and the isolated Python 3.12.3
[environment](../environment.md). The unchanged model, data loader and
requirements lock are shared with the original experiment. Versioned boundary
scripts have their own locks and outputs so historical reproduction is preserved.
Large corpora, source caches, PNGs, checkpoints, ONNX and browser outputs remain
ignored. Run these commands from the repository root:

```sh
node experiments/recognition-training/scripts/fetch-sources.mjs
node experiments/recognition-training/v2/scripts/verify-svg.mjs
node --test experiments/recognition-training/v2/tests/*.test.mjs
node experiments/recognition-training/v2/scripts/generate-dataset.mjs --output data/full --preset full --preview
node experiments/recognition-training/v2/scripts/generate-dataset.mjs --output data/replay --preset full --preview
experiments/recognition-training/.venv/bin/python experiments/recognition-training/v2/verify_quality.py
node experiments/recognition-training/v2/scripts/visual-review.mjs
node experiments/recognition-training/v2/scripts/inspect-vectors.mjs
```

The generator requires the committed passing `reports/svg-fidelity.json`; a
rerun must agree with its source/raster hashes. Existing output manifests are
never overwritten. On reproduction use fresh ignored output locations and
compare with the canonical `manifests/dataset-v2.json`. The reviewed
`manifests/data-quality.json` binds exact automated and visual evidence.
Do not manufacture a replacement visual approval when artifact hashes differ.
The test lock is created by `lock-test.ts` before any training.

From this directory, execute the predeclared pilot, then (only if it passes)
the full runs, each once:

```sh
../.venv/bin/python trainer.py --protocol protocol.json --data-dir data/full --run-dir runs/pilot --mode pilot --seed 381 --device cuda --verify-resume
../.venv/bin/python trainer.py --protocol protocol.json --data-dir data/full --run-dir runs/full-3811 --mode full --seed 3811 --device cuda
../.venv/bin/python trainer.py --protocol protocol.json --data-dir data/full --run-dir runs/full-3812 --mode full --seed 3812 --device cuda
node freeze.ts
node regression.ts
node prepare-browser.ts full
```

The pilot also requires `prepare-browser.ts pilot` and the shared browser suite
with the pilot configuration before full training. From repository root, run
the unchanged browser harness with the new full configuration:

```sh
CHESS_READER_TRAINING_BROWSER_CONFIG=../../experiments/recognition-training/v2/runs/browser-full.config.json pnpm --dir apps/web exec playwright test --config ../../experiments/recognition-training/browser/playwright.config.ts
```

CPU evaluation uses `evaluate_onnx.py` and each exact frozen model path. The
summary reports all models, all three browsers, raw and confidence-aware
metrics, and separate texture/resolution/speckle results. The unchanged browser
harness does not retain per-board confident-square counts, so those stratified
square counts are raw accuracy; aggregate promotion still uses the strict
confidence-aware gate. Frozen failures cannot be tuned away.

## Scope of the decision

Correctly aligned crop classification does not establish board localization,
multiple-board detection, orientation, PDF capture quality or physical-device
performance. The heuristic localizer still fails its retained gates. If TileNet
clears the classifier gate, #38 calls for a separate learned-localizer experiment
including multiple-board pages. If it fails, mismatch evidence determines whether
more licensed style coverage or whole-board context is the appropriate next
experiment. Neither alternative is trained here, and no weights are published.
