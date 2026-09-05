# Held-out source-family mismatch analysis

This analysis was performed after the candidate freeze using the immutable
held-out Rhosgfx inputs. It does not change the corpus, recipe, candidates, or
models. The raw CPU reports are [shipped](reports/cpu-shipped.json),
[seed 3801](reports/cpu-tilenet-full-3801.json), and
[seed 3802](reports/cpu-tilenet-full-3802.json).

## Measured result

The full test set contains 256 boards and 16,384 squares: 11,756 empty and
4,628 non-empty. The empty-heavy square metric masks the scale of the piece
recognition failure, so both measures are reported below.

| Candidate         |    Exact boards | Raw square accuracy | Non-empty square accuracy | Reliable exact boards | Low-confidence boards |
| ----------------- | --------------: | ------------------: | ------------------------: | --------------------: | --------------------: |
| Shipped           | 2 / 256 (0.78%) |              87.72% |                    57.30% |               0 / 256 |             255 / 256 |
| TileNet seed 3801 | 0 / 256 (0.00%) |              79.72% |                    28.22% |               0 / 256 |             256 / 256 |
| TileNet seed 3802 | 0 / 256 (0.00%) |              80.12% |                    29.62% |               0 / 256 |             256 / 256 |

The promoted-candidate confidence floor is 0.7. Seed 3801's largest
per-board minimum confidence was 0.679 and seed 3802's was 0.468, so neither
candidate had a confidence-qualified board. Both also had errors on every
board: the wrong-square median was 12 for seed 3801 and 13 for seed 3802; the
95th percentiles were 24 and 23.

## Per-class accuracy

Counts are test-square counts. The class order is `1KQRBNPkqrbnp`; `1` means
an empty square. Percentages are raw, before the confidence floor.

| Actual class |  Count | Shipped | Seed 3801 | Seed 3802 |
| ------------ | -----: | ------: | --------: | --------: |
| `1`          | 11,756 |   99.7% |    100.0% |    100.0% |
| `K`          |    256 |   11.3% |    100.0% |    100.0% |
| `Q`          |    286 |    0.0% |      0.0% |      0.0% |
| `R`          |    299 |   98.7% |    100.0% |    100.0% |
| `B`          |    296 |    0.0% |     41.9% |     59.1% |
| `N`          |    294 |   98.3% |    100.0% |    100.0% |
| `P`          |    908 |    0.0% |      0.0% |      0.4% |
| `k`          |    256 |   96.5% |      0.0% |      0.0% |
| `q`          |    305 |   25.6% |      0.0% |      0.0% |
| `r`          |    266 |  100.0% |      0.0% |      0.0% |
| `b`          |    275 |   97.8% |     69.8% |     18.5% |
| `n`          |    281 |   97.5% |     28.1% |     48.0% |
| `p`          |    906 |   99.9% |      6.8% |     17.3% |

The candidate errors are concentrated in repeatable class collapses rather
than spread across all classes. The largest off-diagonal counts are:

| Candidate | Actual → prediction | Squares |
| --------- | ------------------- | ------: |
| Shipped   | `P` → `p`           |     906 |
| Shipped   | `B` → `b`           |     268 |
| Shipped   | `q` → `k`           |     221 |
| Seed 3801 | `P` → `r`           |     907 |
| Seed 3801 | `p` → `r`           |     844 |
| Seed 3801 | `q` → `k`           |     305 |
| Seed 3801 | `r` → `R`           |     266 |
| Seed 3801 | `k` → `K`           |     256 |
| Seed 3802 | `P` → `r`           |     826 |
| Seed 3802 | `p` → `r`           |     749 |
| Seed 3802 | `q` → `k`           |     305 |
| Seed 3802 | `Q` → `k`           |     286 |
| Seed 3802 | `r` → `R`           |     266 |
| Seed 3802 | `k` → `K`           |     249 |

## Coverage interpretation and limits

The controlled role distinction is glyph family: training uses Chessnut plus
the Maurizio Monge Fantasy, Spatial, and Celtic families; development uses
Firi; held-out test uses Rhosgfx. All roles include flat, hatch, and halftone
boards, each of the 1.0, 0.82, and 0.64 reduction levels, and optional speckle.
For the test role, the measured counts are 78/103/75 boards for
flat/hatch/halftone, 87/80/89 for 1.0/0.82/0.64 reduction, and 133 speckled
boards. The failure therefore cannot be explained by a render regime that is
exclusive to test.

The class-specific, cross-seed collapses initially suggested missing glyph or
print-family coverage. Subsequent post-freeze visual review exposed a stronger
confound: [the SVG fidelity diagnostic](reports/svg-fidelity.json) proves that
the pinned native decoder ignores embedded CSS class fills. That mechanism is
used by 36/48 training glyphs and 9/12 held-out glyphs, but no development glyphs.
The source-family distinction is therefore confounded by a renderer capability
difference. It cannot support a clean conclusion about family generalization.

A local contact sheet extracted seven existing frozen 32×32 square vectors,
without inference or regeneration. Selected Q/q/P/p silhouettes were visible,
but nominally white shapes looked unexpectedly dark. The diagnostic then
compared identical source bytes in native canvas and Chromium, with synthetic
class-fill and explicit-fill controls. The controlled fill failure, not the
qualitative contact sheet alone, establishes the defect. Generated images stay
ignored; raw diagnostic counts and hashes are retained.

The models still fail the declared numeric gate on the exact frozen rasters.
These measurements neither establish an architectural limitation nor justify a
whole-board/context model. The generated positions are not constrained to legal
games, and the available evidence does not show context can restore the lost
source appearance. First correct and verify rendering in a separately declared
data-quality experiment under #24, with a new untouched test lock; do not revise
this experiment's data or rerun training after seeing its outcomes.
