# Evaluation baselines

Status: measured results, updated only with a new measurement
Last updated: 2026-09-04

This directory retains raw JSON artifacts from `pnpm eval:*`, copied from
`apps/web/eval-results/` (which is git-ignored) into the repository so a later
change can be compared against what was actually measured, not against a
remembered number. Per `docs/evaluation.md` §2 an agent may improve a baseline;
it may not weaken a threshold or replace a measurement with an estimate.

Every record identifies the commit, the fixture and its SHA-256, the command,
the environment, the browser, the recognizer/model version, every individual
run, and the distribution summary.

## Issue #34 corpus baseline

The [per-input/confidence summary](issue-34-corpus-summary.md) links three raw
`issue-34-corpus-{browser}.json` artifacts from clean source commit `d6753bd`.
They report exact-bound classification, loose selections and full pages
separately on the 16-page v1 corpus locked at `89c224b`. Each browser completed
138 observations, with identical accuracy: 24/42 oracle exact boards and 9/42
on each recognizer path. These fail the expanded accuracy/detection targets.
See the [protocol, visual overview and handoff](../investigations/issue-34-corpus.md).

`issue-34-product-goldens.json` retains the simultaneous original product golden
results, with predicted placements omitted and other fields unchanged. All
six runs per browser remained exact and reliable. These synthetic flat-gray
results do not qualify the expanded corpus. The earlier baselines below are
preserved; performance across different machines is not a before/after claim.

## `issue-24-localization-sweep.json`

Raw Node/WASM controlled experiment copied from
`packages/test-fixtures/eval-results/localization-diagnostic-sweep.json`.
The [issue #24 diagnosis](../investigations/issue-24-localization.md) explains
its matched flat/hatch pair, oracle and bounds-rejection controls, results,
and outstanding feasibility gates. This preserves a separate diagnostic
baseline and does not replace the browser product baselines below.

## `recognition-{chromium,firefox,webkit}.json`

Written by `pnpm eval:recognition` (see `apps/web/eval/recognition.spec.ts`).
The run drives the real product path: open the fixture PDF, navigate to the
diagram page, drag a selection around the printed board, and let the real
worker recognize it with the pinned ONNX model. No recognizer fake is
installed. The suite asserts the exact expected placement, the orientation,
and that the read is reliable on every run; latency is recorded as a
distribution and is **not** asserted.

### Issue #2 baseline

Recognizer `fenshot-0.1.4/chess-tiles-v2/ort-web-1.29.0`, fixture
`pdf-synthetic-diagram-01`, six runs per engine (one cold, five warm), on one
Windows laptop. Times are the full user-visible round trip: capture, worker
message, inference, and result.

Current, commit `43ab151` (the reader render/capture fixes):

| Engine   | Exact board accuracy | Cold total | Warm total p50 | Warm total p95 |
| -------- | -------------------- | ---------- | -------------- | -------------- |
| Chromium | 6/6                  | 593 ms     | 213 ms         | 236 ms         |
| WebKit   | 6/6                  | 1437 ms    | 334 ms         | 363 ms         |
| Firefox  | 6/6                  | 1621 ms    | 1073 ms        | 1086 ms        |

Previous, commit `0b12a1b` (first measurement, issue #2 as originally merged):

| Engine   | Exact board accuracy | Cold total | Warm total p50 | Warm total p95 |
| -------- | -------------------- | ---------- | -------------- | -------------- |
| Chromium | 6/6                  | 692 ms     | 359 ms         | 571 ms         |
| WebKit   | 6/6                  | 2197 ms    | 468 ms         | 589 ms         |
| Firefox  | 6/6                  | 1720 ms    | 957 ms         | 1100 ms        |

Accuracy is unchanged at 6/6 on every engine, which is the point of re-running:
the reader fixes changed how a page is rasterised, and recognition had to be
shown not to regress.

The latency differences are **not** attributed to those fixes. Capture
resolution is chosen by `chooseCaptureScale`, which did not change, and
`warmInferenceMs` accounts for nearly all of `warmTotalMs` in both runs, so the
work being timed is the same work. Both runs are single sessions on one loaded
laptop, and the spread between them is consistent with machine state rather than
a code effect. Treat these as a re-measurement, not an improvement; a real
before/after claim would need repeated interleaved runs, which no gate requires
here.

### What this baseline does and does not establish

- It is a **laptop-browser** measurement. The provisional usability gates in
  `docs/evaluation.md` §6 (warm p50 at or below 1 s, warm p95 at or below 2 s,
  95% exact-board accuracy, 99.5% square accuracy, no false positive on the
  negative corpus) are written for the reference iPad and Android devices.
  Those gates are **not** met, waived, or claimed here; issue #2 records this
  first measurement rather than asserting a device target.
- Accuracy here is one synthetic fixture in one diagram style, not the corpus
  §6 describes. Issue #34 separately adds detection/square metrics and
  confidence evidence on its synthetic feasibility corpus. Worker memory and
  long-task qualification remain unmeasured, tracked by #24/#35 and production
  hardening in #6.
- Playwright's WebKit build is an early signal, never a substitute for Safari
  on a physical iPad (`docs/platform-limitations.md` §7). No iPad numbers
  exist yet; the real-device record for issue #2 is still owed.

### Reproducing

```sh
pnpm eval:recognition                      # all three engines
pnpm --filter @chess-reader/web exec playwright test \
  --config playwright.eval.config.ts --project=chromium
```

`CHESS_READER_EVAL_RUNS` (default 6) sets the product golden runs per engine;
the issue #34 corpus keeps its predeclared three passes per engine.
Results land in `apps/web/eval-results/`; copy them here only together with
the commit that produced them.

## Issue #35 candidate comparison

The [comparison and STOP recommendation](../investigations/issue-35-comparison.md)
retains separate `issue-35-control-*`, `issue-35-localized-*` and paired
`issue-35-comparison-*` JSON reports from clean freeze commit
`0bd66cf6a8ac2ec5966b2457bb179cb4a2ca0687`. Corpus v1 and the historical #34
baseline files are unchanged. The [per-input table](issue-35-summary.md) exposes
gains, regressions, misses and confidence limits.

The frozen measurement covers all 828 planned corpus observations, but its original overall
recognition command **fails two experimental hatch PDF tests** in Firefox and
WebKit (25 passed, 2 failed). See [product selections](issue-35-product-selection.json)
and the passing [unchanged product goldens](issue-35-product-goldens.json).
The prototype is not a production replacement. Physical-iPad evidence remains
deferred/unrun and #24 remains open.

The subsequent [research handoff policy](../evaluation.md#issue-35-research-measurement-and-qualification)
separates valid measurement from successful candidate recognition. Those original
raw reports remain unchanged. `pnpm eval:recognition:qualify` retains the failed
experimental exactness checks; passing the default measurement command does not
qualify a recognizer.

[Handoff product records](issue-35-handoff-product-selection.json) retain the
separate measurement and qualification reports from clean `17b06e9`.
[Handoff validation](issue-35-handoff-validation.json) records 42 measurement
checks passing and qualification finishing 40 passed/two failed, plus raw timing
observations and byte-identical non-timing comparisons for all 1,656 rerun
observations against their frozen corpus references. These are additional evidence files,
not replacements for the frozen reports.
