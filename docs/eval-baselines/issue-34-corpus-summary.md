# Issue #34 per-input and confidence baseline

Source commit: `d6753bdd1d997af352a8cdaf52e022cefec97032`; clean working tree in all three browser reports.

All three repetitions in Chromium, Firefox and WebKit produced identical accuracy counts.
The table below reports **one pass**, retaining all 14 complete-board annotations.
Repeated runs measure timing variation; they are not 42 independent board designs.
`E/R` means exact image-relative boards / reliable exact boards. A dash means no
complete-board annotation, never successful recognition. Full-page counts repeat for
both entries on a multi-board page; do not add those rows together.

| Page / board                              | Exact bounds E/R | Loose selection E/R | Full page E/R | Full page outputs / expected |
| ----------------------------------------- | ---------------: | ------------------: | ------------: | ---------------------------: |
| flat-gray-middlegame-white/board-1        |              1/0 |                 1/0 |           1/0 |                          1/1 |
| flat-dark-endgame-black/board-1           |              1/1 |                 1/1 |           1/1 |                          1/1 |
| hatch-0-dense-opening-white/board-1       |              0/0 |                 0/0 |           0/0 |                          1/1 |
| hatch-45-sparse-middlegame-black/board-1  |              1/1 |                 0/0 |           0/0 |                          0/1 |
| hatch-90-medium-endgame-white/board-1     |              1/0 |                 0/0 |           0/0 |                          0/1 |
| hatch-135-dense-pawnless-black/board-1    |              0/0 |                 0/0 |           0/0 |                          1/1 |
| halftone-middlegame-white/board-1         |              1/1 |                 0/0 |           0/0 |                          1/1 |
| scan-low-resolution-flat-black/board-1    |              0/0 |                 0/0 |           0/0 |                          1/1 |
| scan-hatch-45-white/board-1               |              0/0 |                 0/0 |           0/0 |                          1/1 |
| two-boards-flat-hatch/board-1             |              1/1 |                 1/1 |           1/0 |                          1/2 |
| two-boards-flat-hatch/board-2             |              1/0 |                 0/0 |           1/0 |                          1/2 |
| two-boards-halftone-ambiguous/board-1     |              0/0 |                 0/0 |           0/0 |                          1/2 |
| two-boards-halftone-ambiguous/board-2     |              0/0 |                 0/0 |           0/0 |                          1/2 |
| negative-text-only                        |                — |                   — |           0/0 |                          1/0 |
| negative-table-grid                       |                — |                   — |           0/0 |                          1/0 |
| partial-board-crop/partial-1              |                — |                   — |           0/0 |                          1/0 |
| matched-hatch-45-middlegame-white/board-1 |              1/0 |                 0/0 |           0/0 |                          0/1 |
| partial-board-bottom-ranks/partial-1      |                — |                   — |           0/0 |                          1/0 |

## Confidence buckets

Calibration below uses per-square confidence against rendered truth only for oracle
or IoU-matched boards. Unmatched boxes have no valid square correspondence and are
excluded from these buckets, while remaining false positives in the detection report.
A bucket includes its lower bound and excludes its upper bound, except 1 is included
in the final bucket. Counts below include all three repetitions in one browser;
the other browsers have the same counts.

| Input      | Confidence bucket | Correct / classified squares | Accuracy |
| ---------- | ----------------- | ---------------------------: | -------: |
| classifier | 0–0.5             |                        87/90 |   96.67% |
| classifier | 0.5–0.7           |                      195/195 |  100.00% |
| classifier | 0.7–0.9           |                      672/684 |   98.25% |
| classifier | 0.9–1             |                    1689/1719 |   98.25% |
| manual     | 0–0.5             |                       96/102 |   94.12% |
| manual     | 0.5–0.7           |                        90/99 |   90.91% |
| manual     | 0.7–0.9           |                      411/423 |   97.16% |
| manual     | 0.9–1             |                      882/912 |   96.71% |
| full-page  | 0–0.5             |                        45/45 |  100.00% |
| full-page  | 0.5–0.7           |                        39/39 |  100.00% |
| full-page  | 0.7–0.9           |                      336/345 |   97.39% |
| full-page  | 0.9–1             |                      900/915 |   98.36% |

The raw reports also retain minimum/mean confidence, all 64 square confidences,
mismatch indices, nearest-truth diagnostics, out-of-image boxes and orientation.
These buckets do not make low detection recall or invalid geometry acceptable.

## Raw reports

- [Chromium](issue-34-corpus-chromium.json)
- [Firefox](issue-34-corpus-firefox.json)
- [WebKit](issue-34-corpus-webkit.json)
- [Preserved product golden results, placements omitted](issue-34-product-goldens.json)

Protocol and interpretation: [issue #34 investigation](../investigations/issue-34-corpus.md).
