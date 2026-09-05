# Contributing

This file covers workflow mechanics only. Project policy — scope, product
contract, implementation standards, testing requirements, security/privacy
rules, and definition of done — lives in [`AGENTS.md`](AGENTS.md). Read that
first; this file does not repeat it.

## Coding agent setup

The shared [orchestration policy](AGENTS.md#agent-orchestration) applies to all
coding agents. Existing entry points are sufficient; no project model config
or custom agent definitions are required to read the policy.

| Tool               | Repository instruction entry point | Personal routing setup                                                                           |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Codex              | `AGENTS.md`                        | Select the lead in your session; set worker defaults in personal Codex configuration if desired. |
| Claude Code        | `CLAUDE.md` imports `AGENTS.md`    | Select the lead and configure personal subagents using Claude Code's supported controls.         |
| GitHub Copilot CLI | `AGENTS.md`                        | Use available session/model and agent controls for your installed CLI version.                   |
| OpenCode CLI       | `AGENTS.md`                        | Use personal OpenCode configuration for primary/subagent model choices.                          |

Keep model IDs, reasoning preferences, and concurrency budgets in personal or
session settings so changing providers or models does not require a repository
edit. If you create personal custom roles, name them by responsibility (such as
explorer or worker), and have them follow this repository's `AGENTS.md`.
Instruction discovery does not guarantee that a client supports subagents,
per-agent model selection, or enforced read-only permissions.

For Codex, the documented `agents.default_subagent_model` and
`agents.default_subagent_reasoning_effort` settings provide personal worker
defaults. Explicit spawn settings override those defaults, and custom agent
files can override the resolved model/effort. Its
`agents.max_concurrent_threads_per_session` cap counts spawned agents, excluding
the primary. Check the installed version's supported settings before configuring
them; this repository intentionally supplies no fixed values.

Start a fresh session from the repository root after instruction changes. Check
the client's loaded instructions (Claude Code: `/context`; Copilot CLI:
`/instructions`) and confirm actual worker routing in its session/activity
details. A bounded exploration request is a useful smoke check; reading policy
or receiving an agent's claim is not proof of model routing or sandbox enforcement.

Official references (checked 2026-09-05):

- [Codex subagents and custom agent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Claude Code instruction imports](https://code.claude.com/docs/en/memory#agentsmd)
- [Copilot CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
- [OpenCode rules](https://opencode.ai/docs/rules/)

## Prerequisites

- Node.js >= 22.12 (see `engines.node` in the root `package.json`).
- pnpm, via Corepack, pinned by the root `packageManager` field. Run
  `corepack enable` once, then `pnpm install` picks up the pinned version
  automatically — do not install a different pnpm globally for this repo.
- After `pnpm install`, run
  `pnpm --filter @chess-reader/web exec playwright install chromium firefox webkit`
  once per machine to fetch the browser binaries used by `test:e2e`
  (Playwright is a dependency of `apps/web`, not of the workspace root).

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
