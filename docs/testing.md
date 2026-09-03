# Testing

Status: bootstrap-issue command surface
Last updated: 2026-09-03

See `docs/evaluation.md` for the full test strategy and gates. This document
covers the commands that exist today and how to work with them locally.

## Commands that exist now

```sh
pnpm check      # typecheck (tsc -b) + Prettier check + ESLint
pnpm test:unit  # Vitest: unit/component tests
pnpm test:e2e   # Playwright: chromium, firefox, webkit, ipad-webkit,
                # ipad-split-webkit, phone-chromium projects
pnpm build      # production build (apps/web/dist)
pnpm preview    # serve the production build on 127.0.0.1:4173
pnpm dev        # Vite dev server
```

`pnpm test:contract` and every `pnpm eval:*` command from
`docs/evaluation.md` section 3 (`eval:recognition`, `eval:reader`,
`eval:storage`, `eval:engine`, `eval:offline`, `eval:all`) do not exist yet.
Per AGENTS.md, a subsystem eval is only introduced by the issue that first
makes that subsystem real — there is nothing to evaluate yet for recognition,
the book reader, durable storage, or the engine, so no placeholder command is
added to fake green CI.

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

## Real-iPad smoke expectation

Playwright WebKit (including the `ipad-webkit`/`ipad-split-webkit` projects)
is an early signal, not a substitute for a real device (`docs/evaluation.md`
section 4, `docs/platform-limitations.md` section 7). Physical-iPad results
for release checkpoints are recorded under `docs/device-evidence/` as
versioned JSON plus screenshots; do not claim a real-device gate passed based
on Playwright WebKit alone.
