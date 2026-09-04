/// <reference types="node" />
// The triple-slash directive above pulls in @types/node's ambient module
// declarations (node:crypto, node:fs/promises, node:path, node:url) for this
// file only. tsconfig.app.json deliberately restricts automatic @types
// inclusion to browser-only packages, since this project targets the
// browser; this is the standard per-file escape hatch for a test that
// legitimately needs Node's fs/crypto to inspect installed build inputs (see
// `src/recognition/assets.test.ts`'s identical precedent).
//
// This file cannot `import` from `../../vite.config.ts`: that file is part of
// `tsconfig.node.json`'s TypeScript project, this file is part of
// `tsconfig.app.json`'s, and `tsc -b`'s composite-project mode rejects any
// cross-project import that is not declared as an explicit project
// reference (verified directly: doing so fails with TS6307, "File ... is not
// listed within the file list of project ..."). Neither tsconfig is owned by
// this change, so instead of importing `vite.config.ts`'s exports, the tests
// below read its source text as plain data (`node:fs`, not a TS import) and
// check it structurally. `vite.config.ts`'s own `pdfjsAssetsPlugin` still
// verifies every real asset byte-for-byte against its pinned hash on every
// `vite dev`/`vite build`/`vitest` config resolution -- that is the primary,
// always-on "fail closed" gate; the tests here exist to additionally catch a
// silent re-broadening of the allow-list itself in a code review.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PDFJS_ASSETS_DIR_NAME, getPdfjsAssetUrls } from './pdfAssets';

function assertSameOriginBaseRelative(url: string): void {
  // No scheme, no `//` (protocol-relative), and no leading `..` segment: every
  // returned URL must resolve against the current origin, never off it.
  expect(url).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
  expect(url.startsWith('//')).toBe(false);
  expect(url).not.toContain('..');
}

describe('getPdfjsAssetUrls', () => {
  it('derives the wasm and icc asset URLs under the deployment base URL, each trailing-slashed', () => {
    const urls = getPdfjsAssetUrls('/chess-reader/');

    expect(urls).toEqual({
      wasmUrl: `/chess-reader/${PDFJS_ASSETS_DIR_NAME}/wasm/`,
      iccUrl: `/chess-reader/${PDFJS_ASSETS_DIR_NAME}/iccs/`,
    });
    // `Object.values` on a plain (non-index-signature) interface type resolves to
    // its untyped `any[]` overload, so the fields are named explicitly instead.
    for (const url of [urls.wasmUrl, urls.iccUrl]) {
      expect(url.endsWith('/')).toBe(true);
      assertSameOriginBaseRelative(url);
    }
  });

  it('derives the root-relative form when the app is deployed at the origin root', () => {
    const urls = getPdfjsAssetUrls('/');

    expect(urls.wasmUrl).toBe(`/${PDFJS_ASSETS_DIR_NAME}/wasm/`);
    expect(urls.iccUrl).toBe(`/${PDFJS_ASSETS_DIR_NAME}/iccs/`);
  });

  it('tolerates a base URL missing its trailing slash rather than merging path segments', () => {
    const urls = getPdfjsAssetUrls('/chess-reader');

    expect(urls.wasmUrl).toBe(`/chess-reader/${PDFJS_ASSETS_DIR_NAME}/wasm/`);
  });

  it('never points off-origin regardless of the base URL shape', () => {
    for (const baseUrl of ['/', '/chess-reader/', '/deeply/nested/base/']) {
      const urls = getPdfjsAssetUrls(baseUrl);
      for (const url of [urls.wasmUrl, urls.iccUrl]) {
        assertSameOriginBaseRelative(url);
      }
    }
  });

  it('does not derive cMapUrl or standardFontDataUrl (deliberately not self-hosted)', () => {
    const urls = getPdfjsAssetUrls('/') as unknown as Record<string, unknown>;

    expect(urls['cMapUrl']).toBeUndefined();
    expect(urls['standardFontDataUrl']).toBeUndefined();
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');

/** Slices the source text of one `const <name> = [ ... ];` array literal out of `source`. */
function extractArrayLiteral(source: string, constName: string): string {
  const declarationIndex = source.indexOf(`const ${constName}`);
  if (declarationIndex === -1) {
    throw new Error(`Could not find "const ${constName}" in vite.config.ts.`);
  }
  const openBracket = source.indexOf('[', declarationIndex);
  const closeBracket = source.indexOf('];', openBracket);
  if (openBracket === -1 || closeBracket === -1) {
    throw new Error(`Could not find the bounds of the "${constName}" array in vite.config.ts.`);
  }
  return source.slice(openBracket, closeBracket);
}

function extractQuoted(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

async function loadViteConfigSource(): Promise<string> {
  return readFile(path.join(webRoot, 'vite.config.ts'), 'utf8');
}

/**
 * The point of `vite.config.ts`'s allow-list is that a `pdfjs-dist` upgrade
 * cannot silently start shipping something unreviewed. These tests parse its
 * source text structurally (see the file header for why not a TS import) so
 * a future accidental re-broadening -- adding `quickjs-eval.*` back, or
 * switching to a whole-directory copy that pulls in
 * `standard_fonts/`/`cmaps/` -- fails a test loudly.
 */
describe('pdf.js self-hosted asset allow-list (vite.config.ts source)', () => {
  it('never includes the quickjs-eval scripting engine, standard fonts, or CMaps', async () => {
    const source = await loadViteConfigSource();
    const hashedBlock = extractArrayLiteral(source, 'PDFJS_HASHED_ASSETS');
    const licenseBlock = extractArrayLiteral(source, 'PDFJS_LICENSE_FILES');

    const relativePaths = [
      ...extractQuoted(hashedBlock, /relativePath:\s*'([^']+)'/g),
      ...extractQuoted(licenseBlock, /'([^']+)'/g),
    ];

    expect(relativePaths.length).toBeGreaterThan(0);
    for (const relativePath of relativePaths) {
      expect(relativePath.toLowerCase()).not.toContain('quickjs');
      expect(relativePath.startsWith('standard_fonts/')).toBe(false);
      expect(relativePath.startsWith('cmaps/')).toBe(false);
      expect(relativePath.endsWith('.pfb')).toBe(false);
      expect(relativePath.endsWith('.bcmap')).toBe(false);
      expect(relativePath.startsWith('wasm/') || relativePath.startsWith('iccs/')).toBe(true);
    }
  });

  it('hashes every PDFJS_HASHED_ASSETS entry as a 64-character lowercase hex SHA-256', async () => {
    const source = await loadViteConfigSource();
    const hashedBlock = extractArrayLiteral(source, 'PDFJS_HASHED_ASSETS');
    const hashes = extractQuoted(hashedBlock, /sha256:\s*'([^']+)'/g);

    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('pins a distinct hash for every hashed asset (no accidental copy-paste)', async () => {
    const source = await loadViteConfigSource();
    const hashedBlock = extractArrayLiteral(source, 'PDFJS_HASHED_ASSETS');
    const hashes = extractQuoted(hashedBlock, /sha256:\s*'([^']+)'/g);

    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

/**
 * Exercises the same hash-comparison the plugin uses (SHA-256 hex equality,
 * throwing a descriptive, file-naming error on mismatch) against a
 * deliberately wrong hash, so this gate itself cannot silently rot into a
 * no-op. Duplicated in miniature rather than imported from `vite.config.ts`
 * for the project-boundary reason explained in this file's header; the real
 * gate (`assertMatchesPinnedHash` in `vite.config.ts`) runs for real on every
 * `vite dev`/`vite build`/`vitest` config resolution via `configResolved`.
 */
function assertMatchesPinnedHashForTest(
  relativePath: string,
  data: Uint8Array,
  expectedSha256: string,
): void {
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(
      `pdf.js asset "${relativePath}" does not match its pinned SHA-256 ` +
        `(expected ${expectedSha256}, got ${actual}).`,
    );
  }
}

describe('pinned-hash gate (mirrors vite.config.ts assertMatchesPinnedHash)', () => {
  it('does not throw when the data matches the pinned hash', () => {
    const data = new TextEncoder().encode('pinned content');
    const hash = createHash('sha256').update(data).digest('hex');

    expect(() => {
      assertMatchesPinnedHashForTest('some/file', data, hash);
    }).not.toThrow();
  });

  it('throws, naming the file and both hashes, when the data does not match the pinned hash', () => {
    const data = new TextEncoder().encode('actual content');
    const wrongHash = createHash('sha256').update('different content').digest('hex');

    expect(() => {
      assertMatchesPinnedHashForTest('wasm/jbig2.wasm', data, wrongHash);
    }).toThrow(/wasm\/jbig2\.wasm/);
    try {
      assertMatchesPinnedHashForTest('wasm/jbig2.wasm', data, wrongHash);
      expect.unreachable('expected assertMatchesPinnedHashForTest to throw');
    } catch (error) {
      expect((error as Error).message).toContain(wrongHash);
    }
  });
});

/**
 * Pinned hashes (independently re-verified with `sha256sum` against the
 * installed package before being written here -- see the PR description) for
 * exactly the six binary/script assets `vite.config.ts`'s
 * `PDFJS_HASHED_ASSETS` self-hosts. Kept here, separately from
 * `vite.config.ts`, for the same project-boundary reason as above; the two
 * lists are cross-checked structurally by the "allow-list" describe block
 * above (same relative paths) and this one exists to catch the installed
 * `pdfjs-dist` package itself drifting (for example an unreviewed upgrade)
 * even if `vite.config.ts`'s own hashes were (incorrectly) updated to match.
 */
const PINNED_HASHES: readonly { readonly relativePath: string; readonly sha256: string }[] = [
  {
    relativePath: 'wasm/jbig2.wasm',
    sha256: 'e6bee67724a7b5436fe8162638e3708cfc8d52b6342db69a49715e30ff27cfdc',
  },
  {
    relativePath: 'wasm/jbig2_nowasm_fallback.js',
    sha256: '04c795a6657a4553a64b781ea3e85256203d913c3b71b72b85fa3ce00622f458',
  },
  {
    relativePath: 'wasm/openjpeg.wasm',
    sha256: '004a0e62db930ba9ff2a22212f4554d0bb57a0635a8287caf70f98117cee14ba',
  },
  {
    relativePath: 'wasm/openjpeg_nowasm_fallback.js',
    sha256: '0f998419819da4491d8302222aa9e2ff2494685641aa2a6c21c3760c29f3e319',
  },
  {
    relativePath: 'wasm/qcms_bg.wasm',
    sha256: '663d86126d5f5fcb1c61490f94353e2a8375660b8c5498ab3ebab5a34b08800e',
  },
  {
    relativePath: 'iccs/CGATS001Compat-v2-micro.icc',
    sha256: '73e1ba37d2bad5bab2a964f40a9eed96209666efc067c3322626214bbef234a0',
  },
];

/**
 * Build-time fail-closed provenance check: reads the exact files installed
 * under `node_modules/pdfjs-dist` and verifies their content hashes match
 * `PINNED_HASHES` above (which must equal `vite.config.ts`'s
 * `PDFJS_HASHED_ASSETS`). A `pdfjs-dist` version bump must deliberately
 * re-review and update both. Mirrors `src/recognition/assets.test.ts`'s
 * pattern.
 */
describe('pdf.js self-hosted asset provenance', () => {
  async function sha256HexOfFile(filePath: string): Promise<string> {
    const bytes = await readFile(filePath);
    return createHash('sha256').update(bytes).digest('hex');
  }

  it('every pinned asset in the installed pdfjs-dist package matches its pinned hash', async () => {
    for (const entry of PINNED_HASHES) {
      const filePath = path.join(
        webRoot,
        'node_modules',
        'pdfjs-dist',
        ...entry.relativePath.split('/'),
      );
      const hash = await sha256HexOfFile(filePath);
      expect(hash, `mismatch for ${entry.relativePath}`).toBe(entry.sha256);
    }
  });

  it('vite.config.ts pins the exact same hashes as PINNED_HASHES above', async () => {
    const source = await loadViteConfigSource();
    const hashedBlock = extractArrayLiteral(source, 'PDFJS_HASHED_ASSETS');
    const pathsInSource = extractQuoted(hashedBlock, /relativePath:\s*'([^']+)'/g);
    const hashesInSource = extractQuoted(hashedBlock, /sha256:\s*'([^']+)'/g);

    expect(pathsInSource).toEqual(PINNED_HASHES.map((entry) => entry.relativePath));
    expect(hashesInSource).toEqual(PINNED_HASHES.map((entry) => entry.sha256));
  });
});
