# Real-device smoke evidence

A **real-device smoke record** is a small JSON file that proves a specific
issue's user-visible checkpoint was actually exercised on a real physical
device — not just Playwright's WebKit emulation. See
`docs/evaluation.md` §4 ("Real-device gates") and
`docs/platform-limitations.md` §7 ("Automated WebKit is not an iPad") for why
this is required: Playwright's WebKit build cannot reproduce iPadOS's real
process, storage, Home Screen, and multitasking behavior, so it is treated as
an early signal only.

## When a record is required

Per `docs/evaluation.md` §4, a record is required at release checkpoints for:

- one recent physical iPad on a supported iPadOS version;
- one Android 12+ physical device running the Capacitor wrapper; and
- one representative laptop browser.

An individual issue's acceptance criteria say which of these it needs. Issue
#1 requires exactly one real-iPad smoke result that includes the capability
diagnostic described below.

## File naming

`YYYY-MM-DD-<device-class>-issue-<n>.json`, where `<device-class>` is one of
`ipad`, `android`, `laptop`, and `<n>` is the GitHub issue number. Example:
`2026-09-10-ipad-issue-1.json`.

## What must never appear in a record

- device serial numbers or other device-identifying hardware IDs;
- personal file system paths; and
- file names of any imported book.

`schema.json` enforces the field set; keep free-text fields (`notes`,
`limitations`) to build/behavior observations only.

## Schema

`schema.json` (JSON Schema draft 2020-12) defines the required shape:
`schemaVersion`, `issue`, `commit`, `date`, `deviceClass`, `os`, `browser`,
`installed`, `url` (deployed origin only), `capabilities` (one of
`supported`/`unsupported`/`unknown`/`error` for each of `indexeddb`, `opfs`,
`workers`, `webassembly`, `storage-estimate`, `storage-persistence`, `touch`,
`cross-origin-isolation`), `crossOriginIsolated`, `widthsTried`, `result`
(`pass`/`fail`/`partial`), `notes`, `evidence` (relative links to
screenshots/video stored alongside the record), and `limitations`.

`2026-09-XX-ipad-issue-1.template.json` is a **template**, not evidence — it
is marked `"_template": true` (which the schema also rejects, since
`additionalProperties` is `false`) and its placeholder values (e.g. commit
`"REPLACE_WITH_COMMIT"`) do not pass schema validation on purpose. Copy it,
rename it per the convention above, fill in every field with a real
observation, and remove the `_template` marker.

## Steps for the issue #1 real-iPad smoke

1. On the iPad, open Safari and navigate to the deployed preview URL.
2. Open the app's capability diagnostic view and read each capability row
   (`indexeddb`, `opfs`, `workers`, `webassembly`, `storage-estimate`,
   `storage-persistence`, `touch`, `cross-origin-isolation`) plus the
   reported `crossOriginIsolated` value.
3. Use the Share Sheet's "Add to Home Screen" action to install the app.
4. Close Safari and relaunch the app from the installed Home Screen icon.
5. Re-run the capability diagnostic from the installed app and confirm the
   results match (or note any difference — installed vs. browser-tab
   behavior can legitimately differ, e.g. for storage persistence).
6. Try Split View at the widths available on the test device (for example
   full-screen, an even split, and an uneven split) and note each
   `mode`/`cssWidth` pair actually tried in `widthsTried`.
7. Copy `2026-09-XX-ipad-issue-1.template.json` to a correctly named file,
   fill in every field from the observations above, set `result`, and link
   any screenshots taken during the run under `evidence` (store the
   screenshots alongside the JSON file in this directory).
8. Reference the new file from the pull request's evidence section (see
   `docs/evaluation.md` §13 and `CONTRIBUTING.md`).
