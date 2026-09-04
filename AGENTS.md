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
