# Contributing

This file covers workflow mechanics only. Project policy — scope, product
contract, implementation standards, testing requirements, security/privacy
rules, and definition of done — lives in [`AGENTS.md`](AGENTS.md). Read that
first; this file does not repeat it.

## Prerequisites

- Node.js 24 LTS is recommended; Node.js >= 22.12 is required (see
  `engines.node` in the root `package.json`).
- pnpm, via Corepack, pinned by the root `packageManager` field. Run
  `corepack enable` once, then `corepack install` in the repository root to
  install the pinned version — do not install a different pnpm globally for
  this repo.
- Follow the platform-specific first-time setup in
  [`README.md`](README.md#getting-started). In particular, supported Linux
  systems need Playwright's operating-system dependencies as well as its
  browser binaries; Windows and macOS only need the browser download.

## Command set

These are the commands that exist today, run from the repository root:

```text
pnpm dev             start the web app in dev mode
pnpm build            production build
pnpm preview          preview the production build locally
pnpm check             typecheck + formatting + lint
pnpm format            apply formatting fixes
pnpm test:unit         unit/component tests (vitest)
pnpm test:e2e          Chromium + Firefox + WebKit browser tests (playwright)
pnpm eval:recognition  real-model recognition accuracy/latency report
pnpm check:licenses    verify production dependency licenses (see docs/dependency-policy.md)
```

`pnpm test:contract` and the remaining `pnpm eval:*` commands listed in
`docs/evaluation.md` §3 do not exist yet. Per `AGENTS.md`, a later issue adds
each one only when the subsystem it evaluates first becomes real; do not add
a placeholder or no-op version ahead of that.

## Branches and pull requests

- Branch name: `issue-<n>-<slug>`, where `<n>` is the GitHub issue number.
- One issue per pull request. Confirm the issue's explicit dependencies are
  already merged before starting.
- Fill in the PR evidence template at
  [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md),
  which mirrors `docs/evaluation.md` §13, with the actual commands you ran
  and their actual results — not a restatement of the checklist.

## Recording real-device evidence

When an issue's gates require a real iPad, Android, or laptop-browser smoke
result (see `docs/evaluation.md` §4 and `docs/platform-limitations.md` §7),
record it as a JSON file under `docs/device-evidence/`. Read
[`docs/device-evidence/README.md`](docs/device-evidence/README.md) for the
schema, naming convention, and the exact steps to follow on the device.

## When a gate cannot run

Some gates need a dependency or physical device that is not available in
every environment (a real iPad, for instance). When that happens:

- run every other safe/available check;
- record the exact blocker (missing device, missing dependency, sandboxed
  network, etc.) in the PR's "Known limitations" section; and
- never report an unrun gate as passing, and never fake a green result to
  make the PR look more complete than it is.

An issue with a documented, justified blocker is acceptable. An issue that
silently skips a required gate is not.
