# Issue #34: locked printed-book corpus and unchanged baseline

Issue: [#34 — Recognition feasibility: lock printed-book corpus and stage-separated baselines](https://github.com/nino96/chess-reader/issues/34).
Foundation: `c0bff18b6060eef0c48d27be995c9690a0175351` from
`origin/issue-24-recognition-diagnosis`. The existing
[diagnostic report](issue-24-localization.md), test, paired PDFs, and raw sweep
are retained. Issue #2 implementation dependencies are merged: PRs
[#25](https://github.com/nino96/chess-reader/pull/25) and
[#30](https://github.com/nino96/chess-reader/pull/30).

## Corpus review

Start with the [contact sheet and coverage table](../../packages/test-fixtures/corpus/v1/OVERVIEW.md)
and [full-resolution pages](../../packages/test-fixtures/corpus/v1/pages/).
Version 1 contains 16 pages at 768 × 1024 pixels, 14 complete diagrams and two
partial-board challenges. Two pages have two complete diagrams; two are
no-board negatives. The manifest distinguishes visible partial regions from
complete truth, so a clipped board cannot silently become a positive example.

Coverage includes flat grayscale, hatch angles 0/45/90/135 with three densities,
halftone, low-resolution/contrast/speckle degradation, opening/middlegame/endgame
and pawnless positions, white/black and ambiguous orientation, coordinates,
borders, and varied diagram sizes/locations. A matched flat/hatch pair shares
its layout and position. This expands the diagnostic without claiming that a
synthetic set captures every printed-book style.

All page content is generated locally. Chessnut glyphs retain their Apache-2.0
attribution; the new synthetic content is CC0. No new model, font, runtime
dependency or user-book material is added. The locally verified Chessnut set
is the sole piece family in v1. Historical typefaces, actual scans/photos,
gutter warp/skew, handwriting and owner-specific layouts remain exclusions
for the [#24](https://github.com/nino96/chess-reader/issues/24) feasibility
decision. [#35](https://github.com/nino96/chess-reader/issues/35) must preserve
these cases when adding any reviewed corpus revision.

## Predeclared measurement protocol

This protocol and the corpus are committed before running the new recognition
measurements. There is no detector, classifier, confidence-threshold, or model
tuning in #34. Version 1 is a small synthetic feasibility set, not an estimate
of the distribution of all printed chess books. The owner reviews visual
representativeness; geometry, labels, provenance and measurement accounting are
executable checks. Owner-requested changes must create an explicitly recorded
corpus revision in [#35](https://github.com/nino96/chess-reader/issues/35),
retaining this baseline and its failures.

Each committed page bitmap supplies three separate conditions:

1. **Exact bounds:** crop each complete annotated board at native resolution,
   then call the unchanged tile extraction and classifier with the known crop
   corners. This isolates classification on those pixels. Detection, IoU and
   grid-alignment success are **null**, not 100%.
2. **Loose selection:** crop the same source board with 8% of board width of
   padding per side, rounding outward to integer pixels and clipping at page
   edges. Record the actual crop and transformed truth. Call unchanged
   `recognizeGray`, with no supplied corners. This is a controlled fallback
   measurement, not a byte-identical reproduction of PDF capture/upscaling.
3. **Full page:** send the complete native bitmap to unchanged `recognizeGray`.
   No annotations, corners, crop hints or expected board count reach detection.
   Include every complete-board annotation on multi-board pages. Negatives and
   partial-board pages have zero complete-board truth; every returned candidate
   on them is a false positive. They are not sent to an oracle classifier.

All conditions use pinned FENShot 0.1.4, `chess-tiles-v2`, ONNX Runtime Web
1.29.0, single-thread WASM in an evaluation-only browser worker. Three passes
use fresh worker sessions, each processing inputs sequentially. The cold
initialization distribution has three observations per browser; it does not
purge browser/disk caches. Per-condition stage timing excludes rendering,
decoding, transport, model initialization and the React editor. It is not
end-to-end product latency, an iPad estimate, or a capacity benchmark.

## Scoring rules

The [scorer](../../packages/test-fixtures/src/corpus-metrics.ts) uses greedy
one-to-one matching by decreasing rectangle IoU, breaking ties by prediction
then annotation index. A match requires IoU >= 0.9. Unmatched predictions are
false positives; unmatched annotations are misses. A second prediction
overlapping already matched truth at that threshold is also a duplicate, never
another successful board. The current unchanged recognizer emits at most one
board, so multi-board recall cannot be complete.

Detection and tile alignment are distinct. The report also records maximum
boundary error divided by the corresponding true square size, and an
additional diagnostic count at <= 0.08 squares. This is a descriptive measure,
not a new or weakened product gate. Nearest-truth comparisons for wrong boxes
retain mismatch indices and geometry for diagnosis but earn no accuracy credit.

Exact-board and square accuracy use **all expected complete boards** in the
denominator. A missed board contributes zero correct squares. Comparisons use
the rendered image-relative placement, before orientation resolution, so a
rotation heuristic cannot hide a classification error. Identifiable orientation
and ambiguous-truth handling are reported separately. A wrong orientation can
coexist with exact image-relative classification and must not be called a
correct final study position.

Reliability keeps the upstream minimum square-confidence floor of 0.7.
Reliable-but-wrong counts include reliable unmatched predictions and reliable
matched boards with any wrong square. Orientation mistakes are separate.
`reliableWrongStudyPositions` additionally includes identifiable orientation
errors/abstentions on reliable boards, so the image-relative score cannot hide
a wrong final orientation. Ambiguous-truth decisions remain a separate count.
Unreliable candidates, no-board outcomes, external corners, and all raw
failures remain in the report. Reliability is a recognizer score, not user
acceptance; a passing measurement job does not mean recognition passed.

The existing real PDF selection → production worker → editable board golden
test remains an assertion gate under `pnpm eval:recognition`. New corpus
accuracy observations do not replace it. Infrastructure failures (invalid
messages, asset hashes, missing data, worker errors/timeouts) fail the job;
legitimate no-board or wrong-recognition outcomes are recorded observations.
The provisional 95% exact-board, 99.5% square and negative-corpus gates in
[evaluation §6](../evaluation.md#6-recognition-evaluation) remain unchanged.

## Follow-up boundaries

[#35](https://github.com/nino96/chess-reader/issues/35) must first confirm #34
merged, preserve the locked corpus, then compare unchanged FENShot, a bounded
localization mitigation, and an alternative or an evidenced product-contract
disqualification. It must cover full pages and loose selections as well as the
exact-bound classifier control. No candidate comparison or final architecture
recommendation is claimed here.

Production tappable hotspots remain in
[#7](https://github.com/nino96/chess-reader/issues/7), and production recognition
hardening in [#6](https://github.com/nino96/chess-reader/issues/6).
Physical-iPad evidence is deferred/unrun by the owner's explicit scheduling
instruction; it is not a completion gate for #34. Parent
[#24](https://github.com/nino96/chess-reader/issues/24) retains its final device
criterion and remains open. Later device work must record supported hardware,
OS/browser, real PDF selection/editing, cold/warm timings, cancellation and
suspension behavior. Playwright WebKit profiles do not satisfy that evidence.
