# Issue #35 per-input comparison

All three host browsers have identical count/accuracy results. Each row is three
repetitions. `U` is unchanged upstream; `L` is the frozen localizer. Exact-bound
classification is diagnostic and has no detection score. Misses stay in the
denominator; unreliable correct reads are not reliable successes. Full raw
per-square confidence, IoU, mismatch, orientation and timing records remain in
the linked JSON reports.

| Input                                                                         | Expected | Exact U → L | Detection matches U → L | Reliable exact U → L |
| ----------------------------------------------------------------------------- | -------: | ----------: | ----------------------: | -------------------: |
| flat-gray-middlegame-white/classifier:board-1                                 |        3 |       3 → 3 |               N/A → N/A |                0 → 0 |
| flat-gray-middlegame-white/manual:board-1                                     |        3 |       3 → 3 |                   3 → 3 |                0 → 0 |
| flat-gray-middlegame-white/full-page:flat-gray-middlegame-white               |        3 |       3 → 3 |                   3 → 3 |                0 → 0 |
| flat-dark-endgame-black/classifier:board-1                                    |        3 |       3 → 3 |               N/A → N/A |                3 → 3 |
| flat-dark-endgame-black/manual:board-1                                        |        3 |       3 → 3 |                   3 → 3 |                3 → 3 |
| flat-dark-endgame-black/full-page:flat-dark-endgame-black                     |        3 |       3 → 3 |                   3 → 3 |                3 → 3 |
| hatch-0-dense-opening-white/classifier:board-1                                |        3 |       0 → 0 |               N/A → N/A |                0 → 0 |
| hatch-0-dense-opening-white/manual:board-1                                    |        3 |       0 → 0 |                   3 → 3 |                0 → 0 |
| hatch-0-dense-opening-white/full-page:hatch-0-dense-opening-white             |        3 |       0 → 0 |                   3 → 0 |                0 → 0 |
| hatch-45-sparse-middlegame-black/classifier:board-1                           |        3 |       3 → 3 |               N/A → N/A |                3 → 3 |
| hatch-45-sparse-middlegame-black/manual:board-1                               |        3 |       0 → 3 |                   0 → 3 |                0 → 3 |
| hatch-45-sparse-middlegame-black/full-page:hatch-45-sparse-middlegame-black   |        3 |       0 → 3 |                   0 → 3 |                0 → 3 |
| hatch-90-medium-endgame-white/classifier:board-1                              |        3 |       3 → 3 |               N/A → N/A |                0 → 0 |
| hatch-90-medium-endgame-white/manual:board-1                                  |        3 |       0 → 0 |                   0 → 3 |                0 → 0 |
| hatch-90-medium-endgame-white/full-page:hatch-90-medium-endgame-white         |        3 |       0 → 0 |                   0 → 3 |                0 → 0 |
| hatch-135-dense-pawnless-black/classifier:board-1                             |        3 |       0 → 0 |               N/A → N/A |                0 → 0 |
| hatch-135-dense-pawnless-black/manual:board-1                                 |        3 |       0 → 0 |                   3 → 3 |                0 → 0 |
| hatch-135-dense-pawnless-black/full-page:hatch-135-dense-pawnless-black       |        3 |       0 → 0 |                   3 → 3 |                0 → 0 |
| halftone-middlegame-white/classifier:board-1                                  |        3 |       3 → 3 |               N/A → N/A |                3 → 3 |
| halftone-middlegame-white/manual:board-1                                      |        3 |       0 → 3 |                   0 → 3 |                0 → 0 |
| halftone-middlegame-white/full-page:halftone-middlegame-white                 |        3 |       0 → 0 |                   0 → 0 |                0 → 0 |
| scan-low-resolution-flat-black/classifier:board-1                             |        3 |       0 → 0 |               N/A → N/A |                0 → 0 |
| scan-low-resolution-flat-black/manual:board-1                                 |        3 |       0 → 0 |                   3 → 3 |                0 → 0 |
| scan-low-resolution-flat-black/full-page:scan-low-resolution-flat-black       |        3 |       0 → 0 |                   3 → 3 |                0 → 0 |
| scan-hatch-45-white/classifier:board-1                                        |        3 |       0 → 0 |               N/A → N/A |                0 → 0 |
| scan-hatch-45-white/manual:board-1                                            |        3 |       0 → 0 |                   0 → 3 |                0 → 0 |
| scan-hatch-45-white/full-page:scan-hatch-45-white                             |        3 |       0 → 0 |                   0 → 3 |                0 → 0 |
| two-boards-flat-hatch/classifier:board-1                                      |        3 |       3 → 3 |               N/A → N/A |                3 → 3 |
| two-boards-flat-hatch/manual:board-1                                          |        3 |       3 → 0 |                   3 → 0 |                3 → 0 |
| two-boards-flat-hatch/classifier:board-2                                      |        3 |       3 → 3 |               N/A → N/A |                0 → 0 |
| two-boards-flat-hatch/manual:board-2                                          |        3 |       0 → 0 |                   0 → 0 |                0 → 0 |
| two-boards-flat-hatch/full-page:two-boards-flat-hatch                         |        6 |       3 → 3 |                   3 → 3 |                0 → 3 |
| two-boards-halftone-ambiguous/classifier:board-1                              |        3 |       0 → 0 |               N/A → N/A |                0 → 0 |
| two-boards-halftone-ambiguous/manual:board-1                                  |        3 |       0 → 0 |                   3 → 3 |                0 → 0 |
| two-boards-halftone-ambiguous/classifier:board-2                              |        3 |       0 → 0 |               N/A → N/A |                0 → 0 |
| two-boards-halftone-ambiguous/manual:board-2                                  |        3 |       0 → 0 |                   3 → 0 |                0 → 0 |
| two-boards-halftone-ambiguous/full-page:two-boards-halftone-ambiguous         |        6 |       0 → 0 |                   3 → 3 |                0 → 0 |
| negative-text-only/full-page:negative-text-only                               |        0 |       0 → 0 |                   0 → 0 |                0 → 0 |
| negative-table-grid/full-page:negative-table-grid                             |        0 |       0 → 0 |                   0 → 0 |                0 → 0 |
| partial-board-crop/manual:partial-1                                           |        0 |       0 → 0 |                   0 → 0 |                0 → 0 |
| partial-board-crop/full-page:partial-board-crop                               |        0 |       0 → 0 |                   0 → 0 |                0 → 0 |
| matched-hatch-45-middlegame-white/classifier:board-1                          |        3 |       3 → 3 |               N/A → N/A |                0 → 0 |
| matched-hatch-45-middlegame-white/manual:board-1                              |        3 |       0 → 3 |                   0 → 3 |                0 → 0 |
| matched-hatch-45-middlegame-white/full-page:matched-hatch-45-middlegame-white |        3 |       0 → 3 |                   0 → 3 |                0 → 0 |
| partial-board-bottom-ranks/manual:partial-1                                   |        0 |       0 → 0 |                   0 → 0 |                0 → 0 |
| partial-board-bottom-ranks/full-page:partial-board-bottom-ranks               |        0 |       0 → 0 |                   0 → 0 |                0 → 0 |

Both candidates preserve zero reliable wrong boards/study positions on this
corpus. This does not erase upstream’s four reliable wrong shifted hatch reads
in the preserved #24 diagnostic. Both proposed orientations and all unreliable
outputs remain in the raw records. Both multi-board pages return only one
prototype candidate in every pass; the other complete board remains a miss.

Raw reports: [Chromium](issue-35-localized-chromium.json),
[Firefox](issue-35-localized-firefox.json), [WebKit](issue-35-localized-webkit.json).
Paired summaries: [Chromium](issue-35-comparison-chromium.json),
[Firefox](issue-35-comparison-firefox.json), [WebKit](issue-35-comparison-webkit.json).
See the [recommendation and limits](../investigations/issue-35-comparison.md).
