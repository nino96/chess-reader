# Testing

Status: current command surface
Last updated: 2026-09-04

See `docs/evaluation.md` for the full test strategy and gates. This document
covers the commands that exist today and how to work with them locally.

## Commands that exist now

```sh
pnpm check             # typecheck (tsc -b) + Prettier check + ESLint
pnpm test:unit         # Vitest: unit/component tests (web app and fixtures)
pnpm test:e2e          # Playwright: chromium, firefox, webkit, ipad-webkit,
                       # ipad-split-webkit, phone-chromium projects
pnpm eval:recognition  # real-model recognition accuracy/latency report
pnpm build             # production build (apps/web/dist)
pnpm preview           # serve the production build on 127.0.0.1:4173
pnpm dev               # Vite dev server
```

`pnpm eval:recognition` arrived with issue #2, the first issue in which
recognition became real. It runs the production build through the actual
product path (open the fixture PDF, drag a selection, recognize in the worker
with the pinned ONNX model), asserts the fixture's ground-truth placement and
orientation, and writes a JSON report per engine under
`apps/web/eval-results/`. Latency is reported as a distribution and is not
asserted; see [docs/eval-baselines/](eval-baselines/README.md) for the
recorded issue #2 baseline and for what it does and does not establish.

`pnpm test:contract` and the remaining `pnpm eval:*` commands from
`docs/evaluation.md` section 3 (`eval:reader`, `eval:storage`, `eval:engine`,
`eval:offline`, `eval:all`) do not exist yet. Per AGENTS.md, a subsystem eval
is only introduced by the issue that first makes that subsystem real, so no
placeholder command is added to fake green CI.

Issue #24's classifier/localizer diagnostic runs in the existing fixture
Vitest project. The default is a four-case regression; the explicit sweep
records 96 controlled captures. It is separate from the browser product eval:

```sh
pnpm test:unit --project test-fixtures localization-diagnostic
CHESS_READER_DIAGNOSTIC_SWEEP=1 pnpm test:unit --project test-fixtures localization-diagnostic
```

The environment-variable prefix above uses POSIX shell syntax. In PowerShell,
set `$env:CHESS_READER_DIAGNOSTIC_SWEEP = '1'` before the command and remove it
afterward with `Remove-Item Env:CHESS_READER_DIAGNOSTIC_SWEEP`.
Reports land in `packages/test-fixtures/eval-results/`. See the
[diagnosis](investigations/issue-24-localization.md) for evidence and limits;
a passing diagnostic does not mean the full #24 recognition gate passed.

Issue #34 also extends `pnpm eval:recognition` with a separate, observational
printed-page corpus run in Chromium, Firefox and WebKit. It builds an
evaluation-only page/worker with `vite.corpus.config.ts` alongside the normal
application build; ordinary `pnpm build` does not include that harness.
The original real-worker PDF golden assertions still run unchanged.
Exact-bound classifier controls, loose selections and full pages are reported
separately. Recognition failures are measurements; infrastructure failures
still fail the command. See the
[protocol, locked corpus and evidence](investigations/issue-34-corpus.md).

The corpus generator and hash/geometry checks are under
`packages/test-fixtures`; measurement accounting has its own minimized tests:

```sh
pnpm test:unit --project test-fixtures corpus
```

Do not regenerate version 1 to improve a candidate's score. Preserve the
original inputs/results and record any corpus revision explicitly in
[#35](https://github.com/nino96/chess-reader/issues/35).

## Running a single Playwright project

```sh
cd apps/web
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=ipad-webkit
pnpm exec playwright test e2e/diagnostics.spec.ts --project=firefox
```

Project names: `chromium`, `firefox`, `webkit` (desktop), `ipad-webkit`
(iPad Pro 11 viewport/touch), `ipad-split-webkit` (320×1024 split-view
approximation), `phone-chromium` (narrow touch phone). See
`apps/web/playwright.config.ts` for exact device settings.

Playwright worker concurrency is capped in `apps/web/playwright.config.ts`
(4 locally, 2 on CI). Each study test loads the self-hosted ONNX runtime
(~14 MB of WebAssembly) plus the model and renders real PDF pages, so one
worker per core starved the machine and made unrelated capability probes time
out. The cap is the fix for that, rather than loosening those tests' timeouts.

Every spec imports `test`/`expect` from `apps/web/e2e/fixtures.ts`, not
`@playwright/test` directly. That fixture aborts and fails the test on any
request leaving the app's own origin, which is how the suite proves the app
stays offline-safe end to end.

## Where reports and screenshots land

- HTML report: `apps/web/playwright-report/` (CI also uploads this as an
  artifact per browser).
- Traces/screenshots on failure and layout-review screenshots: attached to
  the test in the HTML report and `apps/web/test-results/`.
- On CI, a machine-readable run summary is also written to
  `apps/web/test-results/e2e-results.json`.

## Screenshots are reviewed evidence, not pixel baselines

`apps/web/e2e/layout.spec.ts` attaches full-page screenshots at a matrix of
widths, plus dark-mode and reduced-motion passes. These are **not**
`toHaveScreenshot()` pixel-diff baselines — nothing here auto-fails on a
rendering change. They exist so a human reviewer can look at the attached
images in the HTML report and confirm the layout is actually acceptable at
that width/mode, in line with AGENTS.md's "reviewed visual evidence" standard.
Do not add pixel-baseline screenshot assertions without an ADR describing how
flakiness and cross-platform font rendering are handled.

## Deterministic recognition in browser tests

`apps/web/e2e/study.spec.ts` drives the diagram-to-board journey twice over:

- Most cases install a **scripted recognizer** through the
  `window.__chessReaderTestHooks.recognizerScript` seam (see
  `apps/web/src/recognition/testHooks.ts`) with Playwright's `addInitScript`.
  The script is plain JSON describing per-request delays, progress phases, and
  outcomes, which makes cancellation, staleness, and out-of-order completion
  testable without depending on real inference timing. The seam is inert in a
  normal run and rejects a malformed value at runtime.
- Two cases install nothing and exercise the **real worker and model**, so
  every engine proves the true integration, not only the fake.

## Real-iPad smoke expectation

Playwright WebKit (including the `ipad-webkit`/`ipad-split-webkit` projects)
is an early signal, not a substitute for a real device (`docs/evaluation.md`
section 4, `docs/platform-limitations.md` section 7). Physical-iPad results
for release checkpoints are recorded under `docs/device-evidence/` as
versioned JSON plus screenshots; do not claim a real-device gate passed based
on Playwright WebKit alone.
