# Evaluation baselines

Status: measured results, updated only with a new measurement
Last updated: 2026-09-04

Each file here is the raw JSON artifact a `pnpm eval:*` run wrote, copied from
`apps/web/eval-results/` (which is git-ignored) into the repository so a later
change can be compared against what was actually measured, not against a
remembered number. Per `docs/evaluation.md` §2 an agent may improve a baseline;
it may not weaken a threshold or replace a measurement with an estimate.

Every record identifies the commit, the fixture and its SHA-256, the command,
the environment, the browser, the recognizer/model version, every individual
run, and the distribution summary.

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

| Engine   | Exact board accuracy | Cold total | Warm total p50 | Warm total p95 |
| -------- | -------------------- | ---------- | -------------- | -------------- |
| Chromium | 6/6                  | 692 ms     | 359 ms         | 571 ms         |
| WebKit   | 6/6                  | 2197 ms    | 468 ms         | 589 ms         |
| Firefox  | 6/6                  | 1720 ms    | 957 ms         | 1100 ms        |

### What this baseline does and does not establish

- It is a **laptop-browser** measurement. The provisional usability gates in
  `docs/evaluation.md` §6 (warm p50 at or below 1 s, warm p95 at or below 2 s,
  95% exact-board accuracy, 99.5% square accuracy, no false positive on the
  negative corpus) are written for the reference iPad and Android devices.
  Those gates are **not** met, waived, or claimed here; issue #2 records this
  first measurement rather than asserting a device target.
- Accuracy here is one synthetic fixture in one diagram style, not the corpus
  §6 describes. Board-detection precision/recall, square accuracy, confidence
  calibration, worker memory, and long-task measurements are not yet
  implemented; they belong to the recognition hardening issue (#6).
- Playwright's WebKit build is an early signal, never a substitute for Safari
  on a physical iPad (`docs/platform-limitations.md` §7). No iPad numbers
  exist yet; the real-device record for issue #2 is still owed.

### Reproducing

```sh
pnpm eval:recognition                      # all three engines
pnpm --filter @chess-reader/web exec playwright test \
  --config playwright.eval.config.ts --project=chromium
```

`CHESS_READER_EVAL_RUNS` (default 6) sets the number of runs per engine.
Results land in `apps/web/eval-results/`; copy them here only together with
the commit that produced them.
