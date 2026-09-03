# Deployment

Status: bootstrap-issue deployment paths
Last updated: 2026-09-03

This document covers how to run a build today. It does not cover offline
readiness (service worker, issue #3) or a production host with custom headers
(issue #18); those are called out explicitly below.

## a. Local build and preview (including from an iPad on the LAN)

```sh
pnpm build
pnpm preview     # vite preview --host --strictPort --port 4173
```

`--host` binds to all interfaces, so an iPad on the same Wi-Fi/LAN can open
`http://<your-laptop-LAN-ip>:4173/` in Safari. This lets you view the app and
the capability diagnostic from a real iPad without any hosting setup.

Be honest about what that gets you: installing to the Home Screen (and
therefore `display: standalone`) requires the page to be served over HTTPS or
from `localhost`. Plain `http://` on the LAN is enough to browse and read the
diagnostic, but Safari will not treat it as installable, and
`crossOriginIsolated` guarantees still depend on the response headers below
being present, which `vite preview` already sends on every route.

## b. GitHub Pages

Pages must use the source "GitHub Actions" (Settings → Pages → Build and
deployment → Source → GitHub Actions, or
`gh api -X POST repos/nino96/chess-reader/pages -f build_type=workflow`).
`.github/workflows/deploy-pages.yml` builds on every push to `main` and on
manual dispatch, then deploys with `actions/deploy-pages@v4`. The resulting
URL is:

```text
https://nino96.github.io/chess-reader/
```

**Base path.** GitHub Pages serves this project from the `/chess-reader/`
subpath rather than the origin root, so the workflow builds with
`CHESS_READER_BASE_PATH=/chess-reader/` (see `apps/web/vite.config.ts`, which
reads this variable into Vite's `base`). It also stamps
`VITE_APP_VERSION=${{ github.sha }}` so a deployed build can report which
commit it came from.

**Known limitation: no COOP/COEP on Pages.** GitHub Pages does not let you set
custom response headers, so it cannot send
`Cross-Origin-Opener-Policy: same-origin` or
`Cross-Origin-Embedder-Policy: require-corp`. The capability diagnostic will
truthfully report `crossOriginIsolated: false` there — it is not hard-coded,
it reflects the real page state (see `apps/web/e2e/diagnostics.spec.ts`, which
asserts the row matches `crossOriginIsolated` on every host). Multi-threaded
Stockfish needs cross-origin isolation, so the engine cannot use its threaded
path on a plain Pages deployment; this is tracked for issue #18, which is
expected to introduce a header-capable host for the real deployment target.
Pages remains useful as a reviewable preview of everything that does not
require isolation.

## c. Any static host with header control

Any static host that lets you set response headers can serve a fully
cross-origin-isolated build. Send:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin` (or `cross-origin` only for
  assets that must be embeddable elsewhere — this app has none)
- correct MIME types: `application/manifest+json` for `*.webmanifest` and
  `application/wasm` for `*.wasm`

Netlify (`apps/web/dist/_headers`) or Cloudflare Pages (same `_headers`
syntax) example:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin

/*.webmanifest
  Content-Type: application/manifest+json

/*.wasm
  Content-Type: application/wasm
```

No such host is wired into CI yet; this section documents the header contract
so a future release-hosting issue can adopt it without re-deriving it.

## d. CI artifact download (attached static preview fallback)

Every `check-and-unit` CI run uploads the production build as the `web-dist`
artifact (`apps/web/dist`, 14-day retention). Download it from the workflow
run's Summary page and serve it with any static file server, or open
`index.html` directly for a quick look — note that opening `index.html` via
`file://` will not send the COOP/COEP headers described above, so use this
only as a fallback when a hosted preview isn't available.

## What this deployment does NOT yet provide

- **Offline/service-worker readiness** (#3): there is no service worker yet.
  Closing the network tab or going offline will break the app; "offline
  ready" is not implemented or claimed anywhere in this document.
- **COOP/COEP on GitHub Pages** (#18): see the limitation above. Threaded
  Stockfish and any feature that hard-requires `crossOriginIsolated` are not
  usable on the `https://nino96.github.io/chess-reader/` deployment until a
  header-capable host is adopted.
