# Issue #34: locked printed-book corpus and unchanged baseline

**Measurement completed; unchanged FENShot fails the expanded accuracy and
negative-detection targets.** Exact-bound controls expose residual classification
errors as well as the substantial localization loss. This is the #34 baseline,
not a fix or the final #24 keep/patch/replace decision.

Issue: [#34 — Recognition feasibility: lock printed-book corpus and stage-separated baselines](https://github.com/nino96/chess-reader/issues/34).
Foundation: `c0bff18b6060eef0c48d27be995c9690a0175351` from
`origin/issue-24-recognition-diagnosis`. The existing
[diagnostic report](issue-24-localization.md), test, paired PDFs, and raw sweep
are retained. Issue #2 implementation dependencies are merged: PRs
[#25](https://github.com/nino96/chess-reader/pull/25) and
[#30](https://github.com/nino96/chess-reader/pull/30).

## Corpus review

Corpus lock commit: `89c224b52cf2dfb2fa260faf8f36085659b8a011`.
Corpus manifest SHA-256:
`767c0e91c7c685495a8d1be37fc8605208ca9e2dc6b672c39ea2d47567189b7a`.
This commit precedes the first new-corpus inference run.

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
The pinned upstream orientation resolver always chooses white or black; it
has no ambiguity/abstention output. The baseline records that limitation rather
than adding a new orientation heuristic.
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

## Measured results

`pnpm eval:recognition` ran on clean commit
`d6753bdd1d997af352a8cdaf52e022cefec97032`, using the locked corpus above.
Each browser completed 138 observations: 46 inputs × three passes. The counts
below are the same in Chromium 151.0.7922.34, Firefox 153.0 and Playwright
WebKit 26.5. They represent 14 board designs repeated three times, not 42
independent designs.

| Input                  |   Exact boards | Reliable exact boards |     Square accuracy | Detection matches / expected | Grid-aligned boards | Reliable wrong |
| ---------------------- | -------------: | --------------------: | ------------------: | ---------------------------: | ------------------: | -------------: |
| Exact bounds (oracle)  | 24/42 (57.14%) |                 12/42 | 2643/2688 (98.326%) |       N/A: supplied geometry |                 N/A |              0 |
| Loose manual selection |  9/42 (21.43%) |                  6/42 | 1479/2688 (55.022%) |                        24/42 |               15/42 |              0 |
| Full page              |  9/42 (21.43%) |                  3/42 | 1320/2688 (49.107%) |                        21/42 |               21/42 |              0 |

Manual detection precision is 24/45 (53.33%); full-page precision is 21/39
(53.85%). The manual inputs produce 21 unmatched predictions, 18 missed
boards and 12 external boxes across the three passes. Full pages produce 18
unmatched predictions, 21 missed boards and nine external boxes. All remain in
the raw reports. Duplicates are zero because this upstream API emits at most
one candidate per input; the scorer's duplicate behavior has executable tests.

Both text/grid negatives and both partial-board full pages produce false
positives: 12 outputs across 12 negative/challenge page observations, all
unreliable. For the two loose partial selections, one abstains and one returns
an unreliable false board on each pass. **Zero reliable wrong results is not a
usable recognizer:** reliable correct coverage is only 6/42 on loose selections
and 3/42 on full pages. It also does not erase the four reliable wrong outputs
in the preserved #24 diagnostic sweep, which has different captures.

Identifiable orientation is correct for 36/39 oracle boards and 18/39 expected
boards on each recognizer path (misses count against coverage). The black
pawnless case is wrong even with true corners. Upstream does not acknowledge
the ambiguous pawnless truth in any of its three oracle runs.

The [per-input table and confidence buckets](../eval-baselines/issue-34-corpus-summary.md)
show which styles fail. The matched flat/hatch pair has exact oracle placement
in both styles but loses the hatch board through manual/full-page localization;
neither oracle read clears reliability on this native-resolution pair.
Six of the 14 board designs also have oracle classification errors, including
dense hatch, dense halftone and degraded inputs. Therefore localization work
alone is not established as sufficient for the expanded corpus. Preserve those
residual classification cases when comparing candidates in #35.

Raw schema-1 reports retain each condition, candidate box, mismatch indices,
confidence vector, orientation, timing, failure, source hash and environment:
[Chromium](../eval-baselines/issue-34-corpus-chromium.json),
[Firefox](../eval-baselines/issue-34-corpus-firefox.json), and
[WebKit](../eval-baselines/issue-34-corpus-webkit.json).
Per-stage/style groups separate actual board styles; page feature tags are
overlapping groups, and multi-style full pages are explicitly marked mixed.

## Timing and execution environment

Node 24.19.0; Linux 6.17.0-1021-nvidia ARM64; Playwright 1.62.1; FENShot 0.1.4;
ONNX Runtime Web 1.29.0 WASM, one thread. The pinned ONNX is 1,289,483 bytes;
the WASM binary is 13,961,845 bytes. These are binary sizes, not the total
application/download footprint. Both hashes are verified in the browser and
retained in every raw report. Peak worker memory and UI long-task behavior for
the expanded corpus were not measured; those qualification limits remain on
[#24](https://github.com/nino96/chess-reader/issues/24) and
[#35](https://github.com/nino96/chess-reader/issues/35).

| Browser  | Worker initialization p50/p95, n=3 | Warm classifier p50/p95, n=39 | Warm manual p50/p95, n=48 | Warm full page p50/p95, n=48 |
| -------- | ---------------------------------: | ----------------------------: | ------------------------: | ---------------------------: |
| Chromium |                     491.5/523.7 ms |                  19.0/19.3 ms |              42.0/49.0 ms |                 51.9/80.9 ms |
| Firefox  |                     630.9/640.4 ms |                444.6/461.3 ms |            893.9/904.8 ms |               901.1/940.3 ms |
| WebKit   |                     512.5/536.8 ms |                  18.1/18.6 ms |              39.9/51.1 ms |                 46.4/82.9 ms |

The first classifier call of each fresh worker is excluded from the warm
column and retained separately. Detection timing includes abstentions as well
as outputs. These stage intervals exclude RGBA-to-gray conversion and are not
PDF-to-editor latency. The unchanged product golden reports separately retain
that round trip: warm p50/p95 66/73 ms Chromium, 914/928 ms Firefox, and
62/65 ms WebKit, with five warm observations per browser. Each also has one
cold observation, not a cold-start distribution. See the
[product reports](../eval-baselines/issue-34-product-goldens.json); predicted
placements are omitted in the retained copy, with other fields unchanged.

## Canonical regeneration environment

The original v1 corpus was generated on Linux ARM64 GNU with Node 24.19.0,
pnpm 11.11.0 and lock-pinned `@napi-rs/canvas` 1.0.8. Its native Skia renderer
is architecture-sensitive. The initial x64 Ubuntu CI
[run 33971033248](https://github.com/nino96/chess-reader/actions/runs/33971033248)
failed only the exact regeneration test (374 other unit tests passed).
A [diagnostic rerun at `86e225f`](https://github.com/nino96/chess-reader/actions/runs/33971403486)
compared decoded pixels as well as file hashes: 12/16 pages differed, with
39–42,746 changed channels per affected page, each by exactly one intensity
level. The contact sheet differed in 1,781 channels. Four page PNGs and the
overview Markdown were byte-identical; embedded PNG hashes accounted for
the manifest difference. Both failures are retained in the linked logs.
The minimized test now reports every differing file and decoded-pixel counts,
while retaining its original strict byte-equality assertion.

The required check/unit/license/build CI job therefore uses
`ubuntu-24.04-arm` and Node 24.19.0 as the canonical native producer. It runs
the same complete suite and checks: no assertion, fixture, test or step is
skipped, and no pixel tolerance is introduced. The original v1 bytes, manifest
hash and recorded baseline inputs remain unchanged. Existing Chromium,
Firefox, WebKit E2E and Chromium real-model evaluation CI jobs remain on x64
and consume the committed, hash-validated corpus. Native x64 regeneration is
not a valid replacement for the canonical producer; this does not exclude
x64 product/runtime support. Host-image updates still need to pass exact
regeneration; a future mismatch must be investigated, not rebaselined without
an explicitly reviewed corpus revision in
[#35](https://github.com/nino96/chess-reader/issues/35).

## Verification and handoff

| Command/check                                   | Result                                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                    | Passed: TypeScript, Prettier and ESLint. Initial format/lint errors in new files were corrected without changing fixture bytes or recognition behavior.                                                                      |
| `pnpm test:unit`                                | 375/375 passed, 28 files; includes existing adapter contracts and the retained diagnostic.                                                                                                                                   |
| `pnpm test:unit --project test-fixtures corpus` | 17/17 passed; hashes, deterministic regeneration, geometry/orientation and minimized scoring regressions. Rerun after lint cleanup.                                                                                          |
| `pnpm test:e2e`                                 | 219 passed; 15 existing conditional skips across all six configured projects. Includes real-model PDF selection/editable-board paths.                                                                                        |
| `pnpm eval:recognition`                         | 12/12 tests passed; all 414 corpus observations recorded with zero infrastructure failures or non-origin requests. Product golden: 6/6 exact, reliable reads per browser. Corpus recognition targets fail as reported above. |
| `pnpm check:licenses`                           | Passed: 25 production packages; no new binary, model, dependency or glyph family. New fixtures retain CC0/Apache-2.0 provenance.                                                                                             |
| Build                                           | Production build passed in E2E/eval; dedicated eval bundle also passed. Ordinary production output has no corpus harness.                                                                                                    |
| Local links, formatting and `git diff --check`  | Passed for changed documentation; final evidence formatting checked separately.                                                                                                                                              |
| Physical supported iPad                         | **Deferred/unrun** by explicit owner instruction; no device result claimed.                                                                                                                                                  |
| Separate contract/other subsystem eval commands | Not present. Existing contracts run under `test:unit`; no placeholder commands introduced.                                                                                                                                   |
| New product layout evidence                     | N/A: production code/layout unchanged. Corpus contact sheet visually reviewed by lead and read-only reviewer.                                                                                                                |

The corpus worker implemented fixtures/validation/overview, the browser worker
implemented the evaluation harness, and a read-only explorer reviewed the
preserved diagnosis and scoring/corpus correctness. The lead reviewed and
integrated the actual changes, implemented scoring regressions, corrected
protocol/documentation mismatches before the lock, ran the integrated gates,
and retained the evidence. Git metadata/child processes and browser servers
required execution outside the filesystem sandbox; the corresponding checks
passed there. No acceptance gate or existing assertion was weakened.

Reproduce with the commands above from the repository root. Raw output goes
to `apps/web/eval-results/corpus-{browser}.json`; the corpus generator is
`pnpm --filter @chess-reader/test-fixtures generate:corpus`. Regeneration must
preserve the locked hashes. The retained #24 diagnostic's fixtures, test,
report and raw sweep are unchanged from `c0bff18`.

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
