/**
 * URL policy for the pdf.js runtime assets this app self-hosts: WASM image
 * codecs (JBIG2 + JPEG 2000 + qcms colour management) and the one ICC colour
 * profile qcms reads. `pdfDocument.ts` passes these URLs to `getDocument()` so
 * pdf.js never attempts a network request for them (see that module's header
 * comment for why leaving `wasmUrl` unset silently breaks JBIG2/JPX image
 * decoding, and `NOTICE.md` for exactly which files are shipped, which are
 * deliberately not, and why).
 *
 * The bytes themselves are copied out of the pinned `pdfjs-dist` package —
 * from an explicit, hash-verified allow-list, never a whole directory — by
 * the `chess-reader:pdfjs-assets` Vite plugin in `vite.config.ts` (never
 * committed to the repo). This module only knows the resulting URL *shape*,
 * which is why it is separately testable without touching `pdfjs-dist`,
 * `node:fs`, or a dev server at all: given a base URL, it must derive
 * same-origin, trailing-slash-terminated directory URLs under that base, and
 * nothing else.
 *
 * `cMapUrl`/`standardFontDataUrl` are deliberately not part of this module:
 * this app does not self-host Adobe CMaps or standard fonts (see `NOTICE.md`
 * — the standard fonts are GPLv2-licensed Liberation fonts whose "document
 * embedding" exception does not cover redistributing the font files
 * themselves, so it needs its own reviewed decision rather than arriving as a
 * side effect of this bug fix), so `pdfDocument.ts` leaves those two
 * `getDocument()` options unset.
 */

/** Must match the directory name `vite.config.ts`'s plugin copies assets into. */
export const PDFJS_ASSETS_DIR_NAME = 'pdfjs-assets';

export interface PdfjsAssetUrls {
  readonly wasmUrl: string;
  readonly iccUrl: string;
}

function withTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

/**
 * Derives the pdf.js WASM and ICC-profile asset directory URLs from
 * `baseUrl`. In application code `baseUrl` must be `import.meta.env.BASE_URL`
 * (never a hardcoded `/`): Vite normalizes it to always end with a trailing
 * slash and to already reflect the deployed `base` path (for example
 * `/chess-reader/` on GitHub Pages), which is exactly what pdf.js's own
 * `wasmUrl`/`iccUrl` options require ("include the trailing slash").
 *
 * Every returned URL is base-relative (no scheme/host), so it always
 * resolves same-origin regardless of deployment host, which keeps the COEP
 * `require-corp` header contract in `vite.config.ts` satisfied without any
 * extra `Cross-Origin-Resource-Policy` header.
 */
export function getPdfjsAssetUrls(baseUrl: string): PdfjsAssetUrls {
  const assetsRoot = withTrailingSlash(`${withTrailingSlash(baseUrl)}${PDFJS_ASSETS_DIR_NAME}`);
  return {
    wasmUrl: `${assetsRoot}wasm/`,
    iccUrl: `${assetsRoot}iccs/`,
  };
}
