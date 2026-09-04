# Chess Reader codebase guide

Audience: project owners and contributors who are new to React

Maintenance status: living document

Current implementation baseline: issue #1, the PWA shell and capability
diagnostic

## How to use this guide

This guide explains what the repository contains today, how the running code
fits together, and where later features are intended to go. It is an
orientation guide, not a second architecture specification.

When the guide and another project document disagree, use these sources in
this order:

1. the GitHub issue being implemented;
2. accepted records in [`docs/decisions/`](decisions/);
3. [`docs/architecture.md`](architecture.md) and
   [`docs/platform-limitations.md`](platform-limitations.md);
4. the implementation and its executable tests; and
5. this guide.

The important distinction throughout this document is:

- **Implemented now** means code and tests exist in this repository.
- **Planned** means the architecture describes it, but a later GitHub issue
  must still implement and prove it.

## The codebase in one minute

Chess Reader is intended to become a local-first app for reading DRM-free PDF
and EPUB chess books, recognizing diagrams on the device, and studying the
positions on an editable chess board. The same React application will run in
laptop browsers, as an installed iPad web app, and eventually inside a thin
Android wrapper.

At present, issue #1 has implemented only the foundation:

- a responsive page shell;
- PWA name, icon, and install metadata;
- browser install guidance;
- a diagnostic that tests browser capabilities locally;
- accessibility and responsive styling; and
- build, unit-test, browser-test, license-check, CI, and preview-deployment
  plumbing.

There is no book import, PDF/EPUB renderer, diagram recognition, chess board,
study persistence, service worker, offline-ready state, or Stockfish engine
yet. The empty Library panel says this deliberately.

The current browser flow is small enough to see as one diagram:

```text
apps/web/index.html
        |
        v
src/main.tsx creates the React root
        |
        v
src/App.tsx composes the screen
        |
        +--> AppFrame (header, main area, footer, skip link)
        +--> LibraryEmptyState (honest placeholder)
        +--> InstallPanel (installed/installable state)
        +--> CapabilityDiagnostics
                  |
                  +--> probes.ts (testable browser checks)
                  +--> probe.worker.ts (real worker round trip)
```

## A React translation for non-React developers

React describes the screen as a tree of **components**. A component in this
repository is usually a TypeScript function that returns JSX:

```tsx
export function LibraryEmptyState() {
  return <section>...</section>;
}
```

JSX looks like HTML, but it is written inside TypeScript and compiled into
React element creation. A capitalized tag such as `<InstallPanel />` refers to
another React component; a lowercase tag such as `<section>` becomes a real
DOM element.

The few React concepts used today are:

- **Props** are inputs supplied by a parent. `AppFrame` receives `children`;
  the diagnostic and install components accept injectable browser interfaces
  so tests can supply controlled fakes.
- **State** is component-owned data that can change the rendered output.
  `InstallPanel` stores a deferred install event, while
  `CapabilityDiagnostics` stores its reports and whether a run is active.
- **Effects** run code that must interact with the world outside rendering.
  Here, `useEffect` subscribes to the browser install event and starts
  capability probes. Each effect cleans up its listener or cancels obsolete
  work.
- **Callbacks** are event handlers. Button clicks re-run diagnostics, request
  persistent storage, or show the browser's install prompt.
- **Strict Mode** is a development check enabled in `main.tsx`. It can exercise
  component setup and cleanup more than once to expose unsafe side effects.

The practical rule is that rendering should be a pure description of the UI.
Browser access, subscriptions, asynchronous jobs, and cleanup belong at a
boundary that can be tested and cancelled.

## Runtime walkthrough

### 1. The HTML host and React entry point

[`apps/web/index.html`](../apps/web/index.html) provides the document metadata,
PWA manifest link, icons, viewport settings, and an empty `<div id="root">`.

[`apps/web/src/main.tsx`](../apps/web/src/main.tsx) finds that element, fails
clearly if it is absent, creates the React root, imports the global CSS, and
renders `<App />` inside React Strict Mode.

### 2. Screen composition

[`apps/web/src/App.tsx`](../apps/web/src/App.tsx) is the current composition
root. It contains no business logic. It arranges the three pieces of issue #1
inside `AppFrame`:

- [`AppFrame.tsx`](../apps/web/src/app/AppFrame.tsx) owns page landmarks,
  header/footer, build version, and the keyboard skip link.
- [`LibraryEmptyState.tsx`](../apps/web/src/app/LibraryEmptyState.tsx) explains
  that book import has not been implemented.
- [`InstallPanel.tsx`](../apps/web/src/app/InstallPanel.tsx) detects standalone
  display mode and handles Chromium's optional `beforeinstallprompt` event.
- [`CapabilityDiagnostics.tsx`](../apps/web/src/capabilities/CapabilityDiagnostics.tsx)
  runs the probes and renders their progress, results, and controls.

Keeping `App.tsx` mostly declarative makes the top-level product flow easy to
change without mixing it with low-level browser behavior.

### 3. Capability diagnostics

The diagnostic demonstrates an important project rule: choose behavior using
runtime capability tests, never a browser name or user-agent string.

[`probes.ts`](../apps/web/src/capabilities/probes.ts) checks eight things:

| Capability             | What the check establishes                                        |
| ---------------------- | ----------------------------------------------------------------- |
| IndexedDB              | A temporary database can be opened, written, closed, and deleted. |
| OPFS                   | The browser can open the Origin Private File System root.         |
| Module workers         | A real module worker can receive and answer a message.            |
| WebAssembly            | A minimal valid WASM module validates and instantiates.           |
| Storage estimate       | The browser reports usable origin usage/quota values.             |
| Storage persistence    | The browser reports whether storage is persistent.                |
| Touch input            | Touch points or a coarse pointer are present.                     |
| Cross-origin isolation | The page reports the isolation needed by future threaded WASM.    |

These checks return small `CapabilityReport` values with `supported`,
`unsupported`, `unknown`, or `error` status. Missing support is not the same as
a broken probe. That distinction lets future features offer a fallback or an
actionable explanation.

The module uses a `ProbeEnvironment` interface instead of reaching directly
into browser globals everywhere. Production constructs that interface with
`createBrowserProbeEnvironment()`; unit tests construct deterministic fake
environments. This is dependency injection without a framework.

Potentially hanging work is bounded by a timeout. Worker probes are terminated,
component cleanup aborts obsolete runs, and a late result from an earlier run
cannot replace the latest display. These patterns are deliberate preparation
for later reader, recognition, storage, and engine jobs.

[`probe.worker.ts`](../apps/web/src/capabilities/probe.worker.ts) is built as a
separate browser worker. It validates the incoming message at runtime, checks
WASM inside the worker, and echoes a nonce so the caller knows the reply belongs
to its request.

The persistence button deserves one nuance: reading persistence state is a
probe, but requesting persistence is a user action. The app therefore calls
`navigator.storage.persist()` only after the user presses the button.

### 4. Styling, layout, and accessibility

[`global.css`](../apps/web/src/styles/global.css) defines the shared color,
spacing, radius, touch-target, safe-area, focus, dark-mode, and reduced-motion
rules. The main content changes from one column to two at 900 pixels.

[`CapabilityDiagnostics.css`](../apps/web/src/capabilities/CapabilityDiagnostics.css)
styles the diagnostic's local layout and status badges. At very narrow widths,
each result changes from two columns to one.

Accessibility is part of the implementation rather than a later cleanup:

- semantic header, main, footer, section, heading, list, and description-list
  elements provide structure;
- the skip link moves keyboard focus to the main region, including in WebKit;
- result progress is announced through an `aria-live` summary;
- minimum controls are 44 CSS pixels;
- visible keyboard focus, safe-area insets, dark mode, reduced motion, touch,
  narrow widths, and 200% zoom are covered by design or tests.

## Repository map

```text
.
|-- AGENTS.md                 Rules every coding agent must follow
|-- README.md                 Product summary and quickest setup path
|-- CONTRIBUTING.md           Human/agent workflow mechanics
|-- package.json              Root commands and pinned tool versions
|-- pnpm-workspace.yaml       Workspace membership (apps/*, packages/*)
|-- pnpm-lock.yaml            Exact resolved dependency graph
|-- tsconfig*.json            Strict TypeScript project references
|-- eslint.config.js          TypeScript, React, hooks, and accessibility linting
|-- vitest.config.ts          Root unit-test project aggregator
|-- scripts/
|   `-- check-licenses.mjs    Production dependency license gate
|-- apps/web/
|   |-- index.html            Browser document and React mount point
|   |-- vite.config.ts        Dev/build config, base path, security headers
|   |-- playwright.config.ts  Browser and device-profile E2E matrix
|   |-- public/               PWA manifest and generated icons
|   |-- e2e/                  Whole-page browser tests and network guard
|   `-- src/
|       |-- main.tsx          Browser-to-React entry point
|       |-- App.tsx           Current screen composition
|       |-- app/              Shell, empty state, install UI
|       |-- capabilities/     Diagnostic UI, pure probes, worker
|       |-- styles/           Global responsive/accessibility CSS
|       `-- test/             Shared Vitest DOM setup
|-- docs/                     Architecture, constraints, issue plan, evidence
`-- types/                    Narrow declarations for otherwise untyped tools
```

The architecture lists future `packages/*` directories for core models,
storage, readers, recognition, chess rules, the engine, and fixtures. They do
not exist yet, intentionally. A later issue should add a package only when it
introduces a real contract or dependency; empty speculative packages are
forbidden.

## Toolchain and commands

This is a pnpm workspace. Root commands delegate to `@chess-reader/web` where
appropriate, which gives contributors one command surface even as more
packages are added later.

Prerequisites are Node.js 22.12 or newer and the exact pnpm version named in
the root `packageManager` field.

```sh
pnpm install --frozen-lockfile
pnpm --filter @chess-reader/web exec playwright install chromium firefox webkit
pnpm dev
```

The commands that actually exist now are:

| Command               | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `pnpm dev`            | Start Vite's development server on port 5173.                |
| `pnpm build`          | Bundle the production web application into `apps/web/dist`.  |
| `pnpm preview`        | Serve that bundle on port 4173, including isolation headers. |
| `pnpm check`          | Run TypeScript, Prettier check, and ESLint.                  |
| `pnpm format`         | Apply Prettier formatting.                                   |
| `pnpm test:unit`      | Run Vitest unit and component tests.                         |
| `pnpm test:e2e`       | Build/serve the app and run the Playwright matrix.           |
| `pnpm check:licenses` | Check shipped dependency licenses against policy.            |

`test:contract` and all `eval:*` commands described in the evaluation strategy
do **not** exist yet. Each will be added only when there is a real subsystem to
evaluate. A green placeholder command would violate project policy.

### What Vite, TypeScript, pnpm, Vitest, and Playwright each do

- **Vite** runs the development server and turns TypeScript, JSX, CSS, workers,
  and public assets into a browser-ready production bundle.
- **TypeScript** checks data shapes before code runs. This repository enables
  strict options, so browser and untrusted-data boundaries must be explicit.
- **pnpm workspaces** install one locked dependency graph and run commands
  across applications/packages without copying dependency trees into each one.
- **Vitest** runs fast logic/component tests in Node. Web component tests use
  jsdom, a lightweight DOM simulation, plus Testing Library queries based on
  what a user or assistive technology sees.
- **Playwright** opens real browser engines and tests the assembled application
  at desktop, tablet, split-view, and phone sizes.

## Testing strategy in the current repository

Tests live beside the source they protect (`*.test.ts` or `*.test.tsx`) and in
`apps/web/e2e` for browser-level behavior.

The current layers are:

1. Pure probe tests exercise missing APIs, success, failures, timeouts,
   cancellation, malformed worker messages, and formatting.
2. Component tests render UI with fake dependencies and exercise state,
   effects, cleanup, stale results, clicks, focus, and accessible output.
3. E2E tests run the production build in Chromium, Firefox, desktop WebKit,
   iPad-like WebKit profiles, split view, and a narrow touch phone profile.
4. The shared Playwright fixture intercepts every request and fails the test if
   the page tries to contact an origin other than itself. This is executable
   privacy/offline-safety evidence.
5. CI also checks formatting/types/lint, licenses, and the production build.

Layout screenshots attached by `layout.spec.ts` are evidence for human review,
not auto-approved pixel snapshots. Playwright's WebKit engine is useful early
evidence, but it is not Safari on a physical iPad. Real-device results use the
schema under [`docs/device-evidence/`](device-evidence/).

For exact commands and artifact locations, use [`docs/testing.md`](testing.md).
For the gates later subsystems must add, use
[`docs/evaluation.md`](evaluation.md).

## Build and deployment behavior

[`vite.config.ts`](../apps/web/vite.config.ts) has two details that matter
beyond ordinary React compilation:

- dev and preview responses include COOP and COEP headers so future threaded
  WebAssembly can be tested under cross-origin isolation;
- `CHESS_READER_BASE_PATH` lets the build emit URLs for a subpath such as
  `/chess-reader/` on GitHub Pages.

CI builds and tests on every push to `main` and every pull request. A separate
workflow publishes `main` to GitHub Pages and stamps `VITE_APP_VERSION` with the
commit SHA shown in the footer.

GitHub Pages is a preview host, not the final hosting architecture: it cannot
set the required COOP/COEP headers, so `crossOriginIsolated` is correctly false
there. There is also no service worker yet, so the issue #1 build must not be
described as offline-ready. See [`docs/deployment.md`](deployment.md).

## Planned architecture: where the project is going

The full path is planned as:

```text
local PDF/EPUB
  -> format-specific reader
  -> bounded capture of visible content
  -> local recognition worker
  -> tappable diagram rectangle
  -> editable overlay board
  -> legal move tree
  -> optional local Stockfish worker
```

The product remains local: book bytes, captured images, FENs, moves, names,
paths, and study data must not be uploaded or logged in release artifacts.

Some planned boundaries are especially important:

- There is one web UI. Android will wrap the same build with Capacitor rather
  than becoming a second application.
- PDF and EPUB share a reader contract but keep their own native locator types.
- Only current/visible content is recognized; whole-book preprocessing is out
  of scope.
- EPUB files are hostile active web content and require sandboxing, CSP,
  sanitization, URL filtering, archive limits, and external-request blocking.
- IndexedDB will hold structured state; OPFS can hold managed book copies;
  hashes, re-linking, journaling, and backup provide recovery.
- Expensive reader, hash, import, recognition, and engine work belongs in
  bounded, cancellable workers where practical. Request/generation identity
  prevents stale results from winning.
- Recognition and engine output may never overwrite a user-confirmed edit.
- Stockfish begins with portable single-thread WASM. A threaded path is selected
  only after actual capability and worker self-tests.

These are summaries. Use [`docs/architecture.md`](architecture.md),
[`docs/platform-limitations.md`](platform-limitations.md), and the accepted ADRs
for design decisions.

### Issue roadmap at a glance

- **#1 (implemented):** runnable PWA shell, diagnostics, CI, tests, preview.
- **#2-#3:** first manual PDF-diagram-to-board path, then install/offline/restore.
- **#4-#10:** durable storage and the usable automatic PDF study workflow.
- **#11-#14:** select an EPUB renderer through evidence, then add EPUB to the
  proven workflow and harden cross-format interaction.
- **#15-#17:** branching variations and local Stockfish analysis.
- **#18-#22:** production offline/update security, recovery, Android packaging,
  cross-platform hardening, and release qualification.

Always use the live assigned issue and [`docs/issue-plan.md`](issue-plan.md) for
scope and dependencies; this summary is not a substitute for either.

## How to trace or change behavior

When investigating the current app, follow this order:

1. Find the visible section in `App.tsx`.
2. Open its component under `src/app` or `src/capabilities`.
3. Follow imported pure functions or browser adapters.
4. Read the adjacent unit/component test to see the promised behavior.
5. Read the matching E2E spec for cross-browser and interaction expectations.
6. Check CSS for responsive, touch, focus, color, and motion behavior.
7. Before changing an architectural boundary, read the assigned issue and the
   relevant accepted ADR.

For a new feature, preserve the same separation:

- components render state and accept user actions;
- domain functions remain independent of the DOM when possible;
- browser APIs and volatile libraries stay behind narrow adapters;
- asynchronous operations expose cancellation and reject stale results;
- tests prove failure and recovery as well as success;
- the closest user-visible E2E path proves that the pieces work together.

Do not create the entire planned package tree in advance. Add the smallest
coherent package or component structure that the current issue genuinely uses.

## Keeping this guide current

This file is designed to be cheap to maintain. It explains stable concepts and
links to detailed sources instead of copying their full policies, thresholds,
or API proposals.

Every coding agent whose change affects one of the following must update the
corresponding part of this guide in the same pull request:

| Change                                                     | Section to review                          |
| ---------------------------------------------------------- | ------------------------------------------ |
| New app/package/top-level directory                        | Repository map                             |
| New or removed root command                                | Toolchain and commands                     |
| New runtime entry point or user flow                       | One-minute diagram and Runtime walkthrough |
| First implementation of a planned subsystem                | Current baseline and Planned architecture  |
| Major React/state/data-flow pattern                        | React translation and Runtime walkthrough  |
| Test project, gate, or evidence behavior                   | Testing strategy                           |
| Build, headers, service worker, host, or deployment change | Build and deployment                       |
| Issue checkpoint completed                                 | Baseline and roadmap summary               |

Maintenance checklist for agents:

1. Describe only behavior that is present and tested; label future behavior as
   planned.
2. Prefer a link to the authoritative document over duplicating its detail.
3. Keep paths clickable and remove entries for deleted or renamed files.
4. Compare the command table with the root `package.json`.
5. Compare the repository map with `pnpm-workspace.yaml` and the actual tree.
6. Run the documentation verification appropriate to the change: Prettier,
   local-link checks, and a scoped diff review.

## Glossary

- **PWA:** a web application with install metadata and, once later implemented,
  service-worker-managed offline assets.
- **Component:** a React function that describes part of the UI.
- **JSX/TSX:** HTML-like syntax embedded in JavaScript/TypeScript; `.tsx` files
  allow it.
- **Hook:** a React function such as `useState` or `useEffect` that connects a
  component to state or external lifecycle behavior.
- **DOM:** the browser's live document tree.
- **Adapter:** a narrow interface hiding a browser API or replaceable library.
- **Worker:** a background JavaScript context used to keep heavy work away from
  the UI thread.
- **IndexedDB:** browser database storage for structured records.
- **OPFS:** origin-private browser file storage, planned for managed book bytes.
- **WASM:** WebAssembly, used by planned recognition and chess-engine runtimes.
- **COOP/COEP:** response headers that enable cross-origin isolation and future
  threaded WASM under the required security posture.
- **ADR:** an architecture decision record under `docs/decisions`.
- **Fixture:** controlled test input with recorded provenance and expected
  behavior.
