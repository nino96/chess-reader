# Dependency and license policy

Status: required delivery policy
Last updated: 2026-09-03

This document implements the AGENTS.md rules "pin production dependencies and
binary/model inputs" and "a bundled model, engine, NNUE, font, binary, or
fixture needs exact provenance, license compatibility, hashes, and any
required notices". It is normative for every issue that adds a dependency or
a binary/model/font asset.

## 1. Pinning

- Every dependency, production or development, is pinned to an exact version.
  `.npmrc` sets `save-exact=true` so `pnpm add` never writes a caret/tilde
  range; do not hand-edit a `package.json` range back in.
- `pnpm-lock.yaml` is committed and is the source of truth for the resolved
  dependency graph, including transitive packages.
- CI installs with `pnpm install --frozen-lockfile`. A lockfile that would
  change on install fails CI rather than silently drifting.
- The `packageManager` field in the root `package.json` pins the exact pnpm
  version; do not run a different major/minor pnpm locally for anything that
  touches the lockfile.
- No floating tags (`latest`, `next`, a bare major/minor) anywhere in a
  `package.json`.
- Upgrading a dependency is a deliberate, reviewed pull request: bump one
  dependency (or a clearly related group) at a time, read its changelog for
  breaking changes and license changes, and run the full relevant test/eval
  set before merging. Do not bundle dependency upgrades into unrelated
  feature PRs.

### pnpm minimum release age

pnpm can delay resolving a package version until it has been published for a
minimum amount of time, which gives the ecosystem a window to catch and
unpublish a compromised release before this repository installs it.
`pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` lists the exact packages
that are allowed to bypass that delay (for example a package this repo
already depends on where the newest version is needed immediately and has
been manually reviewed). Every addition to `minimumReleaseAgeExclude` needs a
one-line justification in the pull request description explaining why the
delay was bypassed for that package; do not add an entry only to make an
install succeed faster.

## 2. Runtime vs. development dependencies

- `dependencies` are anything whose code ships to the browser (or into the
  Capacitor app) at runtime: application code, UI libraries, the PDF/EPUB
  readers, the recognition runtime/model, the chess-rules library, and
  Stockfish.
- `devDependencies` are build tooling, type packages, linters, formatters,
  and test/eval runners that never reach a shipped bundle.
- Anything in `dependencies` is held to the stricter rules in
  `AGENTS.md`'s product contract, restated here for dependency review:
  - self-hosted only; no runtime CDN, no remote font/script/style loads;
  - no telemetry, analytics, or "phone home" behavior of any kind;
  - no required network access after the app has completed offline-readiness
    (see `docs/architecture.md` §13 and `docs/platform-limitations.md` §2);
  - compatible with the CSP/COOP/COEP posture in `docs/architecture.md` §15
    (no inline eval, no cross-origin subresources that break
    `crossOriginIsolated`).
- A `devDependency` that generates or touches a shipped asset (for example a
  build plugin that inlines a font or model) is reviewed as if it were a
  runtime dependency for license and provenance purposes.

## 3. License allowlist for shipped code

`pnpm check:licenses` (see §5) automatically allows only:

MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, CC0-1.0,
BlueOak-1.0.0, MPL-2.0, Python-2.0, and CC-BY-4.0.

Notes:

- MPL-2.0 is allowed only when the dependency is used **unmodified and
  self-contained** (no forking/patching its source inside this repository).
  If a change is ever needed, treat it as a review-required license instead.
- CC-BY-4.0 is expected for data/fonts/model assets, not application code,
  and requires the attribution to actually be carried in the shipped
  NOTICE/credits, not just the manifest.

**Review-required (not allowed by the automated check):** LGPL-\*, GPL-\*,
AGPL-\*, CC-BY-SA (any version), SSPL, BUSL, the literal string
`UNLICENSED`, and any unknown/custom license. A dependency in this category
needs an explicit reviewed exception (§5) or, for a whole-subsystem decision,
an ADR under `docs/decisions/`.

### Known open item: Stockfish

Stockfish is **GPL-3.0-only**. Bundling its WebAssembly build (issue #16)
requires a licensing decision before that issue merges: what license this
repository's own code is released under, whether a source offer is required,
and what GPL notices ship with the app. That decision must be recorded in an
ADR in `docs/decisions/` before Stockfish is added as a dependency. The
repository currently has **no `LICENSE` file**, and the root `package.json`
intentionally has no `license` field, until the owner makes that decision.
Do not add a `LICENSE` file or a `license` field as a side effect of an
unrelated change.

### Expected inputs to review at their own issues

The following are named in `docs/architecture.md` as the intended
dependencies for later issues. Naming them here is not a pre-clearance; each
is reviewed for license, provenance, and maintenance risk when its issue
actually adds it:

- `fenshot` (MIT) and its bundled ONNX tile-classifier model;
- ONNX Runtime Web (MIT);
- PDF.js (Apache-2.0);
- EPUB.js (BSD-2-Clause);
- Readium Web / Thorium Web (BSD-3-Clause), evaluated per the EPUB spike in
  `docs/architecture.md` §6.

## 4. Binary, model, engine, and font provenance

Any committed or fetched-at-build binary/model/engine/font asset (ONNX
model, Stockfish WASM/NNUE, a bundled font, etc.) needs, recorded next to the
asset or in its manifest:

- the exact upstream URL and the tag/commit/release it came from;
- a SHA-256 recorded alongside the asset (see `docs/fixtures.md` for the
  fixture-specific version of this same rule);
- the upstream license text and any required NOTICE content, copied into the
  repository rather than linked;
- a reproducible fetch script (checked in) that downloads and verifies the
  hash, rather than a manually-placed file with no provenance trail; and
- no un-hashed download at build time or at runtime — a build or startup
  check must fail closed if the fetched bytes do not match the recorded
  hash.

## 5. Automated check: `pnpm check:licenses`

`scripts/check-licenses.mjs` runs `pnpm licenses list --json --prod`,
validates the shape of that output, and compares every production package's
license expression against the allowlist in §3. Simple SPDX `OR` expressions
(e.g. `(MIT OR Apache-2.0)`) pass when at least one alternative is allowed;
`AND` expressions pass only when every part is allowed.

- **Exit code 0:** every production dependency's license is allowed (or
  covered by a reviewed exception). Prints a one-line summary.
- **Exit code 1:** at least one production dependency's license is not
  allowed. Prints a table of the offending package name(s), version(s), and
  license expression, and does not modify anything.

### Recording a reviewed exception

Exceptions are not self-service. To add one:

1. Get the license/provenance risk reviewed (in the PR, or in an ADR for a
   subsystem-level decision like Stockfish).
2. Add an entry to the `EXCEPTIONS` array at the top of
   `scripts/check-licenses.mjs`: `{ name, license, issue }`, where `issue` is
   a link to the GitHub issue/PR that recorded the review.
3. Explain the exception in the pull request description.

Do not delete a failing row, loosen the allowlist, or silently widen an `OR`
match to make the check pass; that is the same "do not weaken a gate without
review" rule the rest of this repository's evaluation gates follow.
