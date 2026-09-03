# Chess Reader

Chess Reader is a local-first progressive web app for studying DRM-free PDF
and EPUB chess books. It detects diagrams in the content being read, makes them
tappable, and opens a movable analysis board over the still-active reader.

The same web application is intended to run in laptop browsers, as an installed
web app on iPad, and inside a thin Capacitor wrapper for a sideloaded Android
application.

The project contains the architecture, risk analysis, evaluation gates, an
ordered implementation backlog, and the bootstrapped application shell from
issue #1: a responsive, installable start screen with a local capability
diagnostic. It does not read books yet.

## Getting started

Prerequisites: Node.js 22.12 or newer and pnpm 11 (Corepack honours the
`packageManager` field). Browser tests also need the Playwright browsers.

```sh
pnpm install --frozen-lockfile
pnpm --filter @chess-reader/web exec playwright install chromium firefox webkit
pnpm dev            # Vite dev server on http://localhost:5173 (also on the LAN)
pnpm build          # production build in apps/web/dist
pnpm preview        # serve the production build on http://127.0.0.1:4173
```

Quality gates that exist today:

```sh
pnpm check          # typecheck + Prettier + ESLint
pnpm test:unit      # Vitest unit/component tests
pnpm test:e2e       # Playwright in Chromium, Firefox, WebKit, iPad and phone profiles
pnpm check:licenses # production dependency license allowlist
```

`test:contract` and the `eval:*` commands do not exist yet. They are added by
the issue that first makes the corresponding subsystem real, never as passing
placeholders. See [docs/testing.md](docs/testing.md) for details and
[docs/deployment.md](docs/deployment.md) for HTTPS deployment and the GitHub
Pages preview.

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

- [Architecture](docs/architecture.md)
- [Browser and iPad limitations](docs/platform-limitations.md)
- [Test and evaluation strategy](docs/evaluation.md)
- [Architecture decisions](docs/decisions/)
- [Ordered GitHub issue plan](docs/issue-plan.md)
- [Testing commands and evidence](docs/testing.md)
- [Deployment and HTTPS hosting](docs/deployment.md)
- [Dependency and license policy](docs/dependency-policy.md)
- [Fixture provenance rules](docs/fixtures.md)
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
