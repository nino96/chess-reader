# Real-document feasibility increment — issue #41

## Actual collection

The owner-authorized [amendment](EXECUTION.md) replaces preparation-only scope
for this new increment. It does not reopen or rewrite earlier experiments.

| Role        |                Boards | Source/document component                 | Important limitation                                                      |
| ----------- | --------------------: | ----------------------------------------- | ------------------------------------------------------------------------- |
| Train       |                    84 | Wikibooks Chess                           | One modern visual lineage, low native glyph resolution                    |
| Train       |                    12 | Previously reviewed public historic pilot | Two works conservatively grouped as unresolved historic artwork           |
| Development |                    22 | CTAN chessboard documentation             | One document group, several provisional font/rendering variants           |
| Reserved    | 17 occupied + 5 empty | MPchess documentation                     | Annotation variants are correlated; empty backgrounds reported separately |

Total: 140 reviewed diagram images / 8,960 square labels; 116
orientation-normalized placements. This is not 140 independent positions or
publishers. Nine repeated Wikibooks glyph grids and three MPchess near-duplicates
were excluded. Starting-position repetition across sources is audited, not a
split edge; eleven dev boards form the position-disjoint sensitivity subset.
The five empty reserved diagrams add green, hatch, patterned pink, wood and dot
backgrounds, not extra evidence of piece recognition.

Train and dev contain all twelve colored piece classes. Training contains 1,730
occupied squares, including 98 white knights; dev contains 577 occupied squares.
The 12 historical boards are no longer the proposed learning corpus. Modern
real-document diagrams are actually allocated to training.

| Coverage cell                                  | Train | Development | Reserved |
| ---------------------------------------------- | ----: | ----------: | -------: |
| Sparse (1–8 occupied)                          |    42 |           4 |        1 |
| Medium (9–24 occupied)                         |     7 |           2 |        3 |
| Dense (>24 occupied)                           |    47 |          16 |       13 |
| Empty background                               |     0 |           0 |        5 |
| Real historic scans                            |    12 |           0 |        0 |
| Modern flat/color, low native glyph resolution |    84 |           0 |        0 |
| Clean hatched print                            |     0 |          12 |        0 |
| Colored/overlaid print                         |     0 |           9 |        0 |
| Low-opacity flat                               |     0 |           1 |        0 |

Reserved occupied examples are 17 documentation diagrams with default MPchess
artwork. These categories describe the selected slice, not all possible style
combinations. Heavy scan blur/bleed-through, diverse contemporary publishers and
physical camera capture remain unfilled or unmeasured cells; artificial variants
do not turn those into real-document coverage.

Five modern PDFs were acquired with byte/rights hashes in
[modern-sources.json](modern-sources.json); 163 selected pages were rasterized
under [modern-pages.json](modern-pages.json). Originals, pages, crops, tensor
previews, proposals, corrections, review decisions and model artifacts remain
local/ignored. No data or model publication is authorized by this increment.

## Rights and distribution

Training uses the public historical inputs under their existing reviewed basis
and Wikibooks diagram pages under the PDF's GFDL grant/image credits. Retain the
original notices and attribution. Application licensing is not a replacement
for these source terms. Crop redistribution and model publication still require
the recorded artifact-specific review.

The CTAN sources are development/reserved inputs, not training sources in this
slice; package-level grants do not establish every incorporated font's scope.
The Commons puzzle document remains excluded pending third-party screenshot
credit review. PLOS figure examples remain quarantined: tiny overlaid diagrams
and third-party reproduction credits prevent defensible admission. Contemporary
commercial-publisher coverage remains unresolved, not implicitly licensed by
public sample access.

## Annotation evidence and remaining limits

Labels describe visible image-relative squares, not assumed legal positions.
Wikibooks PDF placements supplied proposals; two visual glyph reviews agreed
on 58 source sprites, followed by lead review of all 84 assembled boards.
Documentation notation supplied proposals, but lead crop review found and
corrected shifted/clipped geometry, flipped orientations, wrong ranks and
incorrect piece identities. Rejected proposals remain preserved in the local
version history. Source notation and agent agreement were not treated as truth.

All accepted records bind source/page/crop/proposal/review hashes. Actual
FENShot preprocessing is bottom-rank-first; labels reverse ranks accordingly.
Reference crops, red-grid overlays and actual 32×32 tile previews are retained.
This is agent-assisted visual verification, not human-certified qualification.
Three inherited historical `ambiguous-piece-color` tags denote the original
difficulty, not unresolved acceptance: the retained final decisions document
resolution against the printed piece key, and imported placements/crops match
those accepted records unchanged.

Document, related-edition and declared artwork relations are checked before
training. Historical lineage and upstream pretrained-data overlap remain
unknown. MPchess themes have appeared in public chess software; no claim of
pretrained-disjoint qualification is made. Annotation variants, common positions
and source imbalance limit statistical independence.

## Reproduction

Run from repository root, using the already pinned training environment for
NumPy/Torch/ORT and system Python for Pillow/Poppler work:

```sh
python3 experiments/recognition-dataset/modern_intake.py --verify
python3 experiments/recognition-dataset/assemble_feasibility.py assemble
node experiments/recognition-dataset/modern-preprocess.mjs
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/assemble_feasibility.py pack
# Reviewed transform generation/approval precedes this packing step.
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/pack_augmentation.py pack
python3 experiments/recognition-dataset/preflight_feasibility.py verify
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/feasibility_train.py --protocol experiments/recognition-dataset/feasibility-protocol.json --run pilot --device cuda
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/feasibility_train.py --protocol experiments/recognition-dataset/feasibility-protocol.json --run real-only --device cuda
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/feasibility_train.py --protocol experiments/recognition-dataset/feasibility-protocol.json --run degraded --device cuda
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/compare_feasibility.py
```

Completed training commands are not replay commands: the ledger deliberately
rejects another attempt. Acquisition and assembly require the retained local
review decisions; the repository does not fabricate approval when they are absent.
`freeze` is used once, after review, before the first training command.

## Training and verification outcome

Both full runs completed 40 epochs / 840 optimizer updates on NVIDIA GB10,
Linux ARM64, Torch 2.10.0+cu128. Both use seed 4101 and the same recovered
FENShot base; this is a paired recipe exploration, not seed replication.
Training was **not cut at epoch 2**. The predeclared lowest development-loss
rule selects epoch 2 after observing the entire trajectory.

| Identical 22 dev boards     | Exact boards | Reliable exact at 0.7 | Confidently wrong boards | Occupied squares correct |
| --------------------------- | -----------: | --------------------: | -----------------------: | -----------------------: |
| Unchanged FENShot           |           15 |                    14 |                        1 |                555 / 577 |
| Real-only, selected epoch 2 |           15 |                    14 |                        1 |                553 / 577 |
| Degraded, selected epoch 2  |           15 |                    14 |                        1 |                552 / 577 |

Neither candidate gains or loses an exact board against baseline. All eleven
baseline-correct clean boards remain exact, but black-pawn accuracy regresses.
The saved confusion matrices separate foreground/color/shape errors: baseline
misreads six black pawns as white pawns; both adaptations misread seven, and
add black-pawn-to-rook errors. Empty-square false pieces also persist. These
are classification failures on reviewed exact crops, not evidence of a new
localization failure. Export parity rules out an ONNX conversion mismatch for
these inputs; it does not prove that 32×32 grayscale preprocessing retains all
source distinctions.
Position-disjoint development remains 9/11 exact for all three models. The one
low-opacity development case remains incorrect; one example cannot support a
general conclusion about robustness to degradation. Both recommendation gates
fail: **retain unchanged production FENShot**.

Real-only training loss falls from 0.09946 to 0.00237 while development loss
rises from its epoch-2 minimum 0.21080 to 0.26508. The degraded trajectory falls
from 0.12010 to 0.00600 training loss, with development loss rising from 0.21287
at epoch 2 to 0.26729. Later real-only epochs reach **16/22 exact**, starting at
epoch 12, despite worse class-balanced development loss. This useful secondary
observation is retained, not silently substituted for the declared checkpoint
rule. It does not meet the required five-percentage-point degraded improvement
or justify post-hoc promotion. The small, source-concentrated collection and
selection metric remain limitations; this is not evidence that adaptation is
impossible or that more training time cannot ever help.

The local `work/modern/feasibility-runs/` directory contains every run report,
selected ONNX export, full optimizer/checkpoint state, saved probabilities,
comparison and budget ledger. Baseline inference was reused by hash; the
reserved set was not scored and is absent from the trainer's input interface.
The reusable recovered base and its verification manifest are documented in
[the README](README.md#saved-fenshot-recovery-base).
Reviewable aggregate evidence is also available in
[results-public.json](results-public.json) and all 82 recorded epoch rows in
[learning-curves.csv](learning-curves.csv). These contain metrics and hashes,
not document pixels or placement labels.

The mechanics pilot executed uninterrupted and interrupted/resumed trajectories
with identical selected weights, histories and selection. All three exported
candidates passed Torch/ONNX parity on 1,408 development tiles, identical argmax
and maximum absolute error at most 1.26e-6 (tolerance 1e-5). Torch emitted its
GB10 compute-capability support warning; measured execution and parity passed.

### Degradation actually used

The 96 reviewed training parents have 288 deterministic derived views:
print-scan, alignment and combined. Sampling uses 50% canonical boards and 50%
variants, with the same parent/view decisions reproducible for each seed/epoch.
All development inputs remain unchanged.

- Print-scan: downsample to 60–80%, resize back, Gaussian blur sigma 0.35–0.65
  source pixels, contrast 0.94–1.00.
- Alignment: rotation up to ±0.35°, x/y translation up to ±2 pixels, bounded
  projective perturbation; recorded displacement bound at most 0.12 tile.
- Combined: alignment plus blur, JPEG quality 75–88, contrast 0.93–0.99 and
  deterministic grain up to ±3 intensity levels.

Eight stratified parents and their 24 variants received lead and independent
visual fidelity review. All derivative labels inherit accepted parent labels;
288 derivatives were not individually human-certified. The mild recipes are
visually plausible, not a validated model of heavy scans or arbitrary camera
conditions. No arbitrary textures, color inversion or label-changing large
warps were introduced. Increasing augmentation diversity alone is not shown
sufficient by this comparison.

### Resource accounting and freeze

Five originals and rights snapshots total 10,280,727 bytes; 163 selected page
PNGs total 61,244,351 bytes. Intake has a timestamp but no recorded duration,
so elapsed acquisition time is not claimed. Original crops total 9,729,695
bytes; current augmentation images total 58,315,632 bytes. Local research
storage remains below the 2 GiB ceiling, including retained staging artifacts.

GPU-run wall times including export/parity: pilot 4.203s, real-only 23.560s,
degraded 23.756s; total **51.520s**. The ledger conservatively charges the full
60 + 420 + 420 = **900s** reservations, including failed-attempt protection.
Together with the prior 354.078s charge this reserves 1254.078 / 1260s.
Unused wall time does not authorize extra seeds or sweeps.

The pretraining lock binds 44 data/code/model/protocol inputs at base commit
`c613aed15dfe4ec9e85b7557b01805c4fb3be187`, with the research working tree
explicitly dirty. Lock SHA-256:
`b24b5143e599ed0d1cb1cbd322e9052348de200da47fc110b529498a7c02c814`.
It verified again after both runs. No frozen training inputs were rewritten.

Final provenance audit found an intermediate `pages.json` metadata defect:
163 source-hash fields were null because the renderer read `sha256` instead of
the validated catalog's `expectedSha256`; its catalog hash also predates the
current catalog revision. The accepted training manifest separately binds
the current original, page and crop hashes. A **post-training**, bounded replay
verified all 163 pages and all 128 modern crops byte-for-byte against the
rights-reviewed originals in 76.535 seconds. The separate
`work/modern/page-provenance-audit.json` preserves the discrepancy and the
source-to-page-to-crop evidence; it does not rewrite or retroactively improve
the pretraining lock. Future extraction should use the additional provenance
audit before freezing. The original renderer and experiment remain preserved.

### Verification scope

`pnpm check` passed. Twenty-five focused Python tests cover intake, extraction,
assembly, deterministic degradation, training/recovery and saved-base identity.
The Node preprocessing test module passed its label-order, tile-pixel and JSON
canonicalization assertions. A stale recovery fixture initially failed after
identity checks were strengthened; updating its evidence and adding rejection
checks resolved the failure without altering frozen training code.
Five additional post-run provenance/export tests passed. Recheck saved evidence
without model inference or page rendering:

```sh
python3 experiments/recognition-dataset/verification/verify_page_provenance.py --verify experiments/recognition-dataset/work/modern/page-provenance-audit.json
python3 -m unittest discover -s experiments/recognition-dataset/verification -v
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/verification/export_results.py
pnpm exec prettier --write experiments/recognition-dataset/results-public.json
```

Offline intake verification, source-group/all-class/count gates, original tensor
replay, train-only augmentation bindings and the 44-file post-run freeze check
passed. Physical iPad, full browser/product suites and fresh qualification were
not run: these candidates stop at isolated offline evaluation under the staged
policy. The prior production/frozen-experiment evidence was not rerun unchanged.
Subagents handled source acquisition/audit, extraction, augmentation and narrow
tooling/tests; the lead corrected labels/geometry, reviewed images, froze inputs,
executed the GPU runs and made the comparison decision.

### Next acquisition decision

The next useful batch is additional independently authored, rights-cleared
modern diagrams with distinct piece designs, dark-square backgrounds and
low-contrast black pawns. More pages of the same Wikibooks artwork or many
variants of the same starting position have lower marginal benefit. Modern
publisher/coach permission lanes remain unresolved; no requests were sent.
The 300-board feasibility target and larger qualification corpus remain open
under #41. A future experiment needs a reviewed broader source pool and a new
explicit allocation within owner-approved budgets, not an automatic rerun.

This experiment isolates piece recognition using reviewed board bounds. It does
not establish page localization, PDF.js capture, production confidence policy,
browser performance or physical-device readiness. Production and corpus v1
remain unchanged; #24 stays open, PR #39 unmerged, physical iPad testing deferred.
