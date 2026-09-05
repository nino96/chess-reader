# Chess Reader

Chess Reader is a local-first progressive web app for studying DRM-free PDF
and EPUB chess books. It detects diagrams in the content being read, makes them
tappable, and opens a movable analysis board over the still-active reader.

The same web application is intended to run in laptop browsers, as an installed
web app on iPad, and inside a thin Capacitor wrapper for a sideloaded Android
application.

The project contains the architecture, risk analysis, evaluation gates, an
ordered implementation backlog, the installable application shell with its
local capability diagnostic (issue #1), and the first working study path
(issue #2): open a local PDF, drag a rectangle around a printed diagram,
recognize it on this device, and correct the position on a board floating
over the page. That state is held in memory only; durability, offline
relaunch, automatic diagram hotspots, legal moves, and EPUB are later issues.

## Getting started

### Prerequisites

- Git.
- Node.js 24 LTS (recommended), or Node.js 22.12 or newer. The standard Node.js
  24 distribution includes Corepack; confirm both tools are available with
  `node --version` and `corepack --version`.

The repository pins pnpm in the root `packageManager` field. Enable Corepack
and let it install that exact pnpm version instead of installing pnpm globally:

```sh
corepack enable
corepack install
pnpm --version # must match the packageManager version in package.json
```

If `corepack` is unavailable, install a Node.js distribution that includes it
before continuing. Run all remaining commands from the repository root.

### Install project dependencies

```sh
pnpm install --frozen-lockfile
```

This is enough to run the development server, build, and unit checks. Browser
and end-to-end tests additionally require Playwright's browser binaries.

### Install browser-test dependencies

On Windows and macOS, download the browsers:

```sh
pnpm --filter @chess-reader/web exec playwright install chromium firefox webkit
```

On supported Debian/Ubuntu systems, including ARM64 machines, also install the
required operating-system libraries (the command may request `sudo` access):

```sh
pnpm --filter @chess-reader/web exec playwright install --with-deps chromium firefox webkit
```

Playwright publishes its current supported operating systems in its
[system requirements](https://playwright.dev/docs/intro#system-requirements).
Re-run the appropriate browser-install command after the pinned Playwright
version changes.

### Run the application

```sh
pnpm dev            # Vite dev server on http://localhost:5173 (also on the LAN)
pnpm build          # production build in apps/web/dist
pnpm preview        # serve the production build on http://127.0.0.1:4173
```

Quality gates that exist today:

```sh
pnpm check          # typecheck + Prettier + ESLint
pnpm test:unit      # Vitest unit/component tests
pnpm test:e2e       # Playwright in Chromium, Firefox, WebKit, iPad and phone profiles
pnpm eval:recognition # real-model recognition accuracy and latency report
pnpm eval:recognition:qualify # experimental candidate exactness; currently fails hatch in Firefox/WebKit
pnpm check:licenses # production dependency license allowlist
```

`test:contract` and the remaining `eval:*` commands do not exist yet. They are
added by the issue that first makes the corresponding subsystem real, never as
passing placeholders. Measured results live in
[docs/eval-baselines/](docs/eval-baselines/README.md). See [docs/testing.md](docs/testing.md) for details and
[docs/deployment.md](docs/deployment.md) for HTTPS deployment and the GitHub
Pages preview.

The recognition eval also records unchanged FENShot observations on the
versioned printed-page feasibility corpus: exact-bound classifier controls,
loose manual selections and full pages. See the
[corpus overview and baseline](docs/investigations/issue-34-corpus.md).
A passing measurement run does not mean those recognition results pass the
product accuracy gates.
Issue #35 adds a separately identified localization candidate and an evaluation-only
PDF selection path. See the [comparison protocol and recommendation](docs/investigations/issue-35-comparison.md);
ordinary production recognition remains the pinned upstream implementation.

## Product boundaries

- Modern Chromium, Firefox, and Safari, including iPadOS 17+
- Android 12+ through a thin web-native wrapper
- PDF and EPUB; no DjVu
- Local-first and usable offline after installation
- No account, telemetry, cloud library, or required recognition server
- Current-content recognition rather than whole-book pre-processing
- Automatic diagram hotspots with manual region selection as a fallback
- Editable positions, legal move exploration, variations, and Stockfish

## Project documents

- [Codebase guide for non-React developers](docs/codebase-guide.md)
- [Architecture](docs/architecture.md)
- [Browser and iPad limitations](docs/platform-limitations.md)
- [Test and evaluation strategy](docs/evaluation.md)
- [Architecture decisions](docs/decisions/)
- [Ordered GitHub issue plan](docs/issue-plan.md)
- [Testing commands and evidence](docs/testing.md)
- [Deployment and HTTPS hosting](docs/deployment.md)
- [Dependency and license policy](docs/dependency-policy.md)
- [Fixture provenance rules](docs/fixtures.md)
- [Measured evaluation baselines](docs/eval-baselines/README.md)
- [Real-device evidence records](docs/device-evidence/README.md)
- [Contributing workflow](CONTRIBUTING.md)

## Working agreement for coding agents

Implementation issues are intentionally ordered. An agent taking an issue
should read the architecture, platform limitations, evaluation strategy, and
all accepted decision records; confirm its explicit dependencies are complete;
keep the change scoped to one issue; and attach the required automated and
device evidence to its pull request. Product-slice issues preserve an
end-to-end user workflow; focused infrastructure issues prove their behavior
through the nearest working slice.

An implementation change that weakens an evaluation gate requires an explicit
architecture-decision update. A bug fix must add a minimized regression fixture
whenever the input can be legally committed.

## AI agent entry points

- `AGENTS.md` is the only maintained project policy. Codex, OpenCode, and
  GitHub Copilot coding agents discover it directly.
- `CLAUDE.md` contains only Claude Code's supported `@AGENTS.md` import because
  Claude Code does not discover `AGENTS.md` directly.

Update only `AGENTS.md`; never duplicate its rules into a harness-specific
instruction file.

The [orchestration policy](AGENTS.md#agent-orchestration) makes bounded delegation
and lead review persistent across tools without pinning models or reasoning
levels. See [coding agent setup](CONTRIBUTING.md#coding-agent-setup) for instruction
discovery and personal runtime routing.
