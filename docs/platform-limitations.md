# Browser and iPad limitations

Status: design constraints and required mitigations
Last updated: 2026-09-03

This document separates facts we can rely on from capabilities that must be
probed. Browser behavior changes, so every release records probe output from its
actual target devices.

## 1. Storage is durable only by degree

Modern WebKit provides much more storage than older Safari guidance suggests.
Starting with Safari/iPadOS 17, WebKit documents an origin quota of up to 60% of
disk for browser apps. A Home Screen web app receives the same browser-class
quota. OPFS is available from iOS/iPadOS 15.2, and Safari 17 implements
`navigator.storage.estimate()`, `persisted()`, and `persist()`.

Those facts do not make storage permanent:

- quota values are estimates and upper bounds;
- writes can still fail with `QuotaExceededError`;
- best-effort origins can be evicted under storage pressure or inactivity;
- persistence is granted according to browser heuristics, not guaranteed;
- users can clear an origin's IndexedDB, Cache Storage, service worker, and
  OPFS together; and
- private browsing is ephemeral and OPFS may be unavailable.

### Product solution

The application uses four independent protections:

1. **Managed copy:** copy selected books into OPFS after checking headroom.
2. **Persistence request:** request persistent mode from a user gesture and show
   the actual result rather than assuming success.
3. **Content-hash re-link:** if bytes are absent, the user reselects the original
   and its hash reconnects all retained study records.
4. **Portable backup:** export and restore metadata, corrections, positions,
   sessions, and move trees in a versioned checksummed file.

Book bytes are excluded from normal backup because they can be large and the
original remains the user's responsibility. An optional future full backup must
estimate output size and never be the only recovery path.

### Storage modes

| Mode | Book bytes | Best use | Recovery |
| --- | --- | --- | --- |
| Managed | OPFS | Recommended on iPad and shared computers | Re-link original if missing; restore study backup if origin was cleared |
| Referenced | External file/temporary `File` | Avoid duplicate large files | Reselect on a later session; reconnect by SHA-256 |
| Retained handle | Browser file handle where supported | Chromium convenience | Re-authorize or fall back to re-link |

The standard `<input type="file">` path is authoritative because
`showOpenFilePicker()` is not universally available. Persisted Chromium handles
are a convenience adapter, never a schema requirement.

### Import consistency

IndexedDB and OPFS cannot participate in one atomic transaction. Import uses a
journaled two-phase flow:

1. Create an IndexedDB `STAGING` record with expected size.
2. Stream bytes to an OPFS temporary name while computing incremental SHA-256.
3. Flush/close and verify size/hash.
4. Move/publish to a content-addressed OPFS name.
5. Commit the book row as `READY` in one IndexedDB transaction.
6. On startup, finish or remove abandoned staging operations.

Deleting a book removes app-owned bytes only after confirmation. It never
deletes the user's external source file.

### Backup contract

The backup is a ZIP or similarly streamable container with:

- schema version and application version;
- manifest with entry size and SHA-256;
- JSON/portable records for books (without bytes), diagrams, corrections,
  sessions, move nodes, and settings;
- optional recognition caches, disabled by default; and
- no executable EPUB content or logs.

Restore parses and validates into staging, checks referential/tree integrity and
supported schema, then commits. Failed restore leaves existing data unchanged.
The UI records the last successful export but does not claim the downloaded file
still exists.

## 2. Offline application assets can update badly

A service worker can cache the app shell, PDF/EPUB runtime, workers, ONNX
runtime/model, Stockfish variants, and NNUE. A partially cached update can leave
an app unable to start or analyze offline if cache replacement is naive.

### Product solution

- Generate an immutable asset manifest with content hashes.
- Populate a new versioned cache and verify every required entry before
  activating it.
- Keep the active cache until the new cache is complete.
- Prompt before activating while study state is unsaved.
- Keep the immediately previous compatible asset set when quota allows.
- Provide an “Offline ready” diagnostic that opens workers and verifies model
  and engine bytes without network.
- Never load runtime assets from a CDN.

An application is not labelled offline-ready merely because a service worker is
registered.

## 3. iPad backgrounding is suspension, not a lifecycle callback guarantee

Safari or a Home Screen web app can suspend/freeze/terminate a page when it goes
to the background or under memory pressure. Final writes scheduled only during
`unload` are unreliable, and workers may disappear.

### Product solution

- Persist each meaningful edit/move with short debouncing during active use.
- Flush cheap pending state on `visibilitychange` and `pagehide`, but do not
  depend on those events for correctness.
- Reconstruct reader/session/engine state from durable locators, full FEN, and
  UCI paths.
- Treat recognition and engine workers as disposable; use request ids to reject
  late output after restart.
- Stop Stockfish promptly when hidden to avoid wasted battery and thermal load.

## 4. Stockfish capabilities vary

WebAssembly works broadly. Multi-threaded WebAssembly uses shared memory, which
requires a cross-origin-isolated page and working `SharedArrayBuffer`/thread
support. WebKit has supported COOP/COEP, shared buffers, and WASM threading since
Safari/iPadOS 15.2, but production configuration and embedded-resource policy
can still make `crossOriginIsolated` false.

### Product solution

- Ship portable single-thread and threaded/SIMD engine variants.
- Select only after a real worker self-test; do not infer from browser name.
- Serve the app with COOP `same-origin` and COEP `require-corp`.
- Self-host every worker, WASM, model, NNUE, font, and icon with compatible
  policies.
- Test the selected EPUB iframe sandbox under cross-origin isolation.
- Default to one thread and conservative hash/MultiPV on iPad.
- Hide/disable thread settings in the portable path.
- Cap requested threads and memory; catch allocation failure and retry with a
  smaller profile.
- Use a worker watchdog and make crash/restart recoverable.
- Verify the pinned engine with its bench signature and deterministic tactical
  fixtures rather than comparing exact evaluations across versions.

Cross-origin isolation may change popup/opener behavior. This application has
no login/payment popup dependency, and external links open with `noopener`.

## 5. Recognition acceleration varies

ONNX Runtime Web supports WebAssembly across target browsers, including Safari
on iOS. WebGPU is not a portable Safari/iPad requirement and WebGL is not the
preferred future path.

### Product solution

- WASM is the acceptance baseline for the small fenshot model.
- Recognition runs in a worker where available and has a tested fallback for
  missing worker canvas/image APIs.
- WebGPU is enabled only after correctness parity and measured benefit.
- The UI exposes progress/cancel and never runs repeated inference while the
  viewport is moving.
- Recognition accuracy and latency are measured separately; a fast wrong model
  does not pass.

## 6. EPUB content conflicts with normal web-app trust

An EPUB can contain HTML, scripts, forms, external resources, hostile links, and
CSS intended to escape reader assumptions. Readium Web has an open hardening
discussion, and EPUB.js also requires application-level isolation. Cross-origin
isolation adds stricter requirements for subresources and iframes.

### Product solution

- Use only the renderer that passes the scored security/compatibility spike.
- Disable publication JavaScript and active form/navigation features.
- Rewrite publication resources to controlled URLs and block external fetches.
- Sanitize markup and URL schemes before presentation.
- Use a restrictive sandbox/CSP and validate every bridge message.
- Keep book content unable to access the parent origin's IndexedDB/OPFS.
- Test exfiltration, top navigation, popups, oversized resources, zip bombs,
  path traversal, and cross-origin-isolation compatibility.

## 7. Automated WebKit is not an iPad

Playwright's WebKit build is derived from WebKit sources and its mobile profiles
emulate viewport/input. It is not the branded Safari binary and cannot reproduce
all iPadOS process, Files picker, storage, memory, Home Screen, and multitasking
behavior.

### Product solution

- Run Playwright on Chromium, Firefox, WebKit desktop, and tablet viewport in CI.
- Run stable Safari automation on macOS when a runner is available.
- Require a real iPad checkpoint for storage, install/offline, import/re-link,
  reader gestures, recognition, Stockfish, suspension/relaunch, and split view.
- Save a signed device-evidence JSON record plus screenshots/video where useful.
- Do not waive a real-device gate based solely on Playwright WebKit success.

## 8. Platform failure matrix

| Failure | User-visible response | Required regression gate |
| --- | --- | --- |
| Persistence denied | Explain best-effort mode; recommend managed copy and backup | Capability/storage contract test |
| Quota exhausted mid-import | Cancel cleanly, remove staging bytes, keep existing library | Quota fault injection |
| Managed book missing | Offer re-link; reconnect by hash | OPFS deletion/re-link E2E |
| Site data cleared | Empty-state restore/reimport guidance | Fresh-profile recovery drill |
| Private mode | Session-only warning; no durability promise | Browser-mode smoke test |
| Service-worker partial update | Continue last complete version | Interrupted-cache update test |
| `crossOriginIsolated` false | Select portable Stockfish and hide threads | Header/capability E2E |
| Engine allocation failure | Retry conservative profile and report limitation | Worker fault injection |
| iPad suspends worker | Restore state and recreate worker | Real-device background drill |
| EPUB attempts network/script | Block and report unsupported active content | Malicious EPUB corpus |
| Recognition worker unavailable | Tested degraded path or actionable unsupported message | Capability test |

## 9. Sources

- [WebKit storage quota, eviction, and persistence](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WebKit OPFS support](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)
- [Safari 15.2 WASM threading and COOP/COEP](https://webkit.org/blog/12140/new-webkit-features-in-safari-15-2/)
- [Cross-origin isolation deployment](https://web.dev/articles/coop-coep)
- [MDN IndexedDB durability limitations](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology)
- [MDN file-picker availability](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
- [ONNX Runtime Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
- [Lichess Stockfish Web builds](https://github.com/lichess-org/stockfish-web)
- [Readium Web architecture](https://github.com/readium/web)
- [Readium iframe-hardening issue](https://github.com/readium/ts-toolkit/issues/120)
- [EPUB.js local ArrayBuffer API](https://github.com/futurepress/epub.js/blob/master/documentation/md/API.md)
- [Thorium Web, including documented iPad limitations](https://github.com/edrlab/thorium-web)
- [Playwright browser scope](https://playwright.dev/docs/browsers)
