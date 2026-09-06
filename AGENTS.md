# Chess Reader repository instructions

These instructions apply to every coding agent working in this repository.
Tool-specific instruction files must point here and must not create a competing
set of project rules.

## Sources of truth

Read these before changing implementation code:

1. the assigned GitHub issue, including dependencies and acceptance criteria;
2. `README.md`;
3. `docs/architecture.md`;
4. `docs/platform-limitations.md`;
5. `docs/evaluation.md`;
6. `docs/issue-plan.md`; and
7. every accepted ADR in `docs/decisions/` relevant to the change.

The issue defines delivery scope, while accepted ADRs define architectural
constraints. If they conflict, stop and make the conflict explicit. Update or
supersede the ADR in the same change after review; do not silently diverge.

Issue #1 bootstrapped the workspace, so `check`, `test:unit`, `test:e2e`,
`check:licenses`, `build`, and `preview` are real commands (see
`docs/testing.md`). Do not claim that any other command works before its script
exists, and do not add passing placeholder commands to simulate a subsystem
that is not implemented yet.

## Product contract

- Build one web-first TypeScript/React PWA for laptop browsers and installed
  iPad use. The Android 12+ application is a thin Capacitor wrapper, not a
  second product implementation.
- Support local DRM-free PDF and EPUB books. DjVu, DRM circumvention, cloud
  accounts, cloud sync, and whole-book preprocessing are out of scope.
- The defining workflow is book -> diagram tap/manual selection -> local
  recognition -> editable overlay board -> legal study -> optional Stockfish.
- After offline readiness completes, reading, recognition, saved study, and the
  configured engine must not require a network connection.
- Never upload book bytes, captured diagrams, FENs, moves, file names/paths, or
  study data. Do not add telemetry or runtime CDN dependencies.
- Treat imported EPUB content as hostile active web content. Preserve the
  sandbox, CSP, URL filtering, archive limits, and external-request blocking.
- Browser capabilities are selected with runtime probes and tested fallbacks,
  never browser-name or user-agent checks.

## Scope and delivery

- Work on one issue at a time and confirm every explicit dependency is merged.
- Do not implement attractive downstream features that the issue defers.
- For a vertical-slice issue, preserve the complete user-visible path even when
  its internals are deliberately narrow.
- For a focused infrastructure/evaluation issue, prove the result through the
  nearest existing end-to-end product path, not only isolated mocks.
- Prefer the smallest coherent change. Do not create empty packages or
  speculative abstraction layers merely to match the planned directory tree.
- Keep volatile dependencies behind the adapter boundaries in the architecture.
  Format-native PDF and EPUB locators must not be collapsed into one fake type.
- Keep domain and persistence models portable. DOM, browser, and Capacitor APIs
  belong behind platform adapters.

## Agent orchestration

The primary agent is the lead: it owns understanding the request, consequential
design decisions, task decomposition, integration, review, and final validation.
Use subagents for useful independent exploration and bounded execution when
the total-work benefit justifies delegation; no agent is required for a trivial task.
Keep trivial tasks and tightly coupled work local when delegation would add
more coordination than value.

### Roles and model selection

- Use explorers for focused read-only investigation with file/symbol evidence.
- Use workers for implementation or validation with a clear scope and agreed
  design. Keep architecture, cross-cutting reasoning, and integration with the
  lead; a separate reviewer is optional and does not replace lead review.
- Prefer an available faster or lower-cost model capable of the bounded task;
  reserve the more capable lead for difficult decisions and review. Follow the
  user's session preferences and the runtime's supported routing controls.
  Choose reasoning effort to fit the task and model, not a fixed repository rule.
- Do not pin provider names, model IDs, reasoning levels, or concurrency limits
  in shared policy or add model-named roles. Personal/session runtime settings
  select models; these instructions do not configure or enforce that selection.
- If delegation or model selection is unavailable, briefly state the limitation
  and continue with the available agent(s). Do not claim a model was used unless
  the runtime confirms it, or install/configure another tool just to delegate.

### Bounded assignments and parallel work

Before delegating implementation, resolve consequential design choices. Give
each worker the objective, relevant context and repository instructions,
decisions already made, owned files/subsystem, constraints, acceptance criteria,
checks to run, and expected report. Pass enough context to work independently
without copying unrelated conversation history.

- Parallelize independent questions and disjoint implementation tasks within
  available capacity. Avoid duplicate investigations and unnecessary agents.
- Explorers must not edit files. Use enforced read-only permissions when the
  runtime supports them; a role description alone is not a sandbox.
- Assign one writer per file or tightly coupled subsystem. Coordinate shared
  files, generated outputs, Git operations, and test resources through the lead.
  Workers must not revert others' changes or switch the shared checkout's branch.
- Workers inherit the user's task scope and repository rules. Delegation does
  not grant additional permission or relax privacy, security, or test gates.
- Workers surface consequential ambiguity or unexpected scope to the lead.
  The lead resolves it, narrows the assignment, or handles the difficult work;
  do not repeatedly retry the same poorly understood task with lightweight workers.

### Review and completion

Workers return status (complete, partial, or blocked), findings or changed files,
commands run and results (including unrun checks), decisions, and remaining risks.
The lead inspects the actual diffs and supporting evidence, resolves conflicts,
and validates the integrated result against the original request and applicable
repository gates. Worker completion alone is not task completion. In the final
handoff, briefly identify delegated work and any material validation limitations.

## Token-efficient execution

- The user selects the primary model. The lead retains consequential design,
  integration, review and final validation; do not lower acceptance criteria to
  save tokens. Put exact model/effort routing in personal runtime configuration,
  not shared repository policy.
- Delegate only when a bounded independent task is likely to save total work or
  provide necessary independent evidence. Keep small edits and tightly coupled
  reasoning local. Use a capable inexpensive worker for clear lookup/check tasks,
  a stronger coding worker for bounded implementation, and the lead or a stronger
  reviewer for ambiguity, experimental design and consequential correctness.
- State the chosen model/effort and reason briefly when delegating, using supported
  runtime controls. Supply only the objective, relevant files/instructions,
  decisions, owned paths, acceptance checks and a concise return format. Prefer
  a fresh bounded context over forking the full conversation. Do not reread or
  investigate the same material in both lead and worker without a review need.
- Workers do not spawn other agents. Reuse a suitable existing worker for a
  related follow-up; do not create a roster of speculative agents. Respect the
  personal concurrency cap. Escalate a concrete reasoning gap to the lead after
  one unsuccessful bounded attempt instead of cycling through cheap retries.
- Read required governing documents once per task/context and reuse a compact
  evidence summary; reread changed or missing sections when necessary. Use targeted
  searches and bounded tool output. Return findings, file references, checks and
  blockers rather than transcripts or repeated plans.
- Before an experiment, record the hypothesis, changed inputs, reusable hashed
  evidence, command, resource ceiling, completion/stop condition and next decision
  in the owning issue or ignored local status artifact as privacy permits. One
  failed comparison triggers one bounded diagnosis, not automatic new seeds,
  model families or sweeps. Additional runs need a new evidence-based reason and
  must fit the authorized budget. Preserve complete meaningful schedules.
- Run long acquisition/training/evaluation as resumable local jobs with persisted
  status and start/status/stop commands. Do not keep an AI turn or subagent alive
  merely to poll logs, sleep or narrate progress; hand off the running job when
  no independent work remains and inspect results on completion/resumption.
- Run narrow checks while editing and the required integration gates once at
  handoff. Reuse unchanged valid evidence with its hashes and original command;
  rerun for relevant changes or unresolved failures. Never weaken tests, omit
  required gates or label incomplete recognition successful to reduce usage.
- Keep reports concise and evidence-bearing. At handoff record the next action,
  changed hashes and unresolved blockers so work resumes without reconstructing
  the session. Report measured token/quota usage only when available; neither a
  model choice nor a concurrency cap guarantees a weekly allowance or savings.

## Implementation standards

- Use strict TypeScript. Validate untrusted data at runtime and keep `unknown`
  at boundaries until validated; do not spread `any` through domain code.
- Pin production dependencies and binary/model inputs. Commit the lockfile.
- Keep rendering, hashing, recognition, archive work, and Stockfish off the main
  thread where practical. Heavy work must be bounded, cancellable, and reject
  stale results by request/generation identity.
- Never let recognition or engine output overwrite a user-confirmed edit or
  variation implicitly.
- Treat IndexedDB/OPFS writes, imports, migrations, restore, and service-worker
  activation as failure-prone transactions with explicit recovery behavior.
- Build keyboard, touch, screen-reader, focus, contrast, safe-area, reflow, and
  reduced-motion support with the feature rather than as release-only cleanup.
- Errors must be actionable and must not leave state looking successfully
  committed when work failed.
- Preserve user-owned/unrelated work in the tree. Avoid broad rewrites when a
  focused change is sufficient.

## Tests and evaluations are non-negotiable

Behavior is not complete until it has executable evidence. Follow
`docs/evaluation.md` and the assigned issue's gates.

- Add or update tests with every behavior change. A bug fix requires a minimized
  regression test and, when legally possible, a synthetic/licensed fixture.
- Test failure, cancellation, timeout, stale/out-of-order completion, reload,
  and recovery paths where relevant; a happy-path-only adapter does not pass.
- During implementation, run the narrowest relevant tests frequently. Before
  completion, run `pnpm check` and every relevant test/eval command that exists:
  `test:unit`, `test:contract`, `test:e2e`, `eval:reader`,
  `eval:recognition`, `eval:storage`, `eval:engine`, and `eval:offline`.
- Only issue #1 may introduce the initial command surface. Later issues add a
  subsystem eval when that subsystem first becomes real. Never create a green
  no-op, empty suite, unconditional skip, or placeholder result.
- Do not delete a failing fixture, weaken an assertion/threshold, approve a new
  screenshot blindly, increase a timeout to hide a race, or mark a target
  unsupported merely to make CI pass.
- A required gate may change only with measured evidence and an explicit
  reviewed ADR/evaluation update in the same pull request.
- Playwright WebKit is an early signal, not a substitute for required physical
  iPad evidence. Do not claim a real-device gate passed unless it was run on the
  named device.
- Tests must be deterministic and isolated from the public internet. Fake time,
  randomness, workers, and network boundaries when needed, but keep at least the
  real integration/eval coverage required by the issue.
- Store only synthetic, public-domain, or otherwise redistributable fixtures.
  Record source/license, SHA-256, expected result, and tolerance in the fixture
  manifest. Never commit a user's copyrighted chess book.
- Evaluation output must identify the commit, fixture/eval schema, command,
  environment, browser/device, and raw result artifact. Report distributions
  for performance metrics, not a hand-picked run.

If a required command cannot run because the environment lacks a dependency or
physical device, run every safe available check, record the exact blocker and
unrun gate, and do not describe the issue as fully verified.

## Change-specific minimum verification

- Documentation-only: local link check, formatting/diff check, and consistency
  with live issue titles/ADRs.
- Domain/storage logic: unit tests plus relevant property, migration, and
  contract tests.
- Reader/recognition/engine adapter: unit and contract tests plus its subsystem
  eval and browser integration path.
- User interaction: component/accessibility tests plus Chromium, Firefox,
  WebKit E2E and reviewed visual evidence where layout changes.
- Offline, security, storage-recovery, or release work: fault-injection suite
  and the exact real-browser/device gates named in the issue.

## Security, privacy, and licensing

- Treat books, backups, database contents, worker messages, and imported archive
  entries as untrusted input. Validate type, size, path, schema, and checksums.
- Do not weaken CSP, COOP/COEP/CORP, iframe sandboxing, or archive protections
  without security tests and an ADR.
- Do not log book text/images, FENs, moves, URIs, full paths, or file names in
  release builds or test artifacts.
- Do not commit secrets, signing keys, personal paths, downloaded user books,
  or generated build artifacts.
- Respect Git ignore rules; do not force-add ignored files. Keep GitHub issues,
  pull requests, comments, and attachments limited to repository-relevant
  information. Omit private local workspace details and review text and
  artifacts for accidental disclosure before publishing.
- A bundled model, engine, NNUE, font, binary, or fixture needs exact provenance,
  license compatibility, hashes, and any required notices/source offer.

## Git and pull-request handoff

- Keep the diff scoped to the issue and retain unrelated user changes.
- Update `docs/codebase-guide.md` when a change alters the current repository
  map, command surface, runtime flow, implemented subsystem list, testing
  layers, or build/deployment behavior. Keep planned behavior clearly labeled.
- Use descriptive commits; never rewrite shared history or bypass checks to make
  a branch appear green.
- Update architecture, platform limitations, evaluation baselines, fixture
  manifests, and ADRs when the implementation changes their facts.
- Use the pull-request evidence template in `docs/evaluation.md` with actual
  commands and results. Use `N/A` only with a reason; never report an unrun gate
  as passing.
- Link every known limitation or follow-up to an issue rather than leaving a
  context-free TODO.

## Definition of done

An issue is complete only when:

1. all acceptance criteria and the user-visible checkpoint are satisfied;
2. the complete previously working slice still functions;
3. required automated and real-device evidence is recorded;
4. no test/eval gate was silently weakened or skipped;
5. recovery, accessibility, security, privacy, and licensing implications were
   handled in proportion to the change;
6. documentation and ADRs match the implementation; and
7. the handoff names commands run, results, unrun gates, and known limitations.
