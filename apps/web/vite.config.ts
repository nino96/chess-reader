import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Explicit allow-list of pdf.js runtime assets self-hosted from the pinned
 * `pdfjs-dist` package (full per-file license review: `src/reader/NOTICE.md`;
 * why they must be self-hosted at all: `src/reader/pdfDocument.ts`'s header).
 * Copied file-by-file rather than by recursively copying `wasm/`/`iccs/`
 * specifically so a `pdfjs-dist` upgrade that adds, renames, or changes one
 * of these files cannot silently start shipping something unreviewed —
 * `readAndVerifyHashedAsset` below fails the build/dev-server startup loudly
 * instead (docs/dependency-policy.md §4).
 *
 * Deliberately NOT shipped (see NOTICE.md for the full reasoning):
 * `wasm/quickjs-eval.wasm`/`.js` (a script-execution engine pdf.js only loads
 * when `enableScripting` is true, which this app never sets -- AGENTS.md
 * treats book content as hostile, so this app carries no interpreter for it
 * and the feature fails closed rather than quietly running book-supplied
 * script), `standard_fonts/` (GPLv2 Liberation fonts whose embedding
 * exception does not cover redistributing the font files themselves), and
 * `cmaps/` (1.5 MB of CJK support not needed by any known defect).
 */
const PDFJS_HASHED_ASSETS: readonly {
  readonly relativePath: string;
  readonly sha256: string;
}[] = [
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
 * License-notice text files copied alongside the hashed assets above (their
 * text is reproduced verbatim in NOTICE.md). Unlike the files above, these
 * are never parsed or executed by pdf.js, so a byte-level hash gate adds no
 * additional safety here -- they are still named explicitly rather than
 * copied via a directory scan, for the same "no silent re-broadening" reason.
 */
const PDFJS_LICENSE_FILES: readonly string[] = [
  'wasm/LICENSE_JBIG2',
  'wasm/LICENSE_PDFJS_JBIG2',
  'wasm/LICENSE_OPENJPEG',
  'wasm/LICENSE_PDFJS_OPENJPEG',
  'wasm/LICENSE_QCMS',
  'wasm/LICENSE_PDFJS_QCMS',
  'iccs/LICENSE',
];

const PDFJS_ASSETS_DIR_NAME = 'pdfjs-assets';

export class PdfjsAssetProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfjsAssetProvenanceError';
  }
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Throws `PdfjsAssetProvenanceError` if `data`'s SHA-256 does not equal
 * `expectedSha256` (docs/dependency-policy.md §4: "no un-hashed download at
 * build time... a build or startup check must fail closed if the fetched
 * bytes do not match the recorded hash"). Exported separately from the
 * file-reading code around it so it is unit-testable without touching disk.
 */
export function assertMatchesPinnedHash(
  relativePath: string,
  data: Uint8Array,
  expectedSha256: string,
): void {
  const actual = sha256Hex(data);
  if (actual !== expectedSha256) {
    throw new PdfjsAssetProvenanceError(
      `pdf.js asset "${relativePath}" does not match its pinned SHA-256 ` +
        `(expected ${expectedSha256}, got ${actual}). This almost always means ` +
        'pdfjs-dist was upgraded: re-review this exact binary for the upgraded ' +
        'version, then update its pinned hash in PDFJS_HASHED_ASSETS in vite.config.ts.',
    );
  }
}

function readAndVerifyHashedAsset(
  pdfjsDir: string,
  entry: { readonly relativePath: string; readonly sha256: string },
): Buffer {
  let data: Buffer;
  try {
    data = readFileSync(join(pdfjsDir, entry.relativePath));
  } catch {
    throw new PdfjsAssetProvenanceError(
      `pdf.js asset "${entry.relativePath}" was not found in the installed pdfjs-dist ` +
        'package (see src/reader/NOTICE.md). If pdfjs-dist was upgraded and this file ' +
        'moved or was renamed, re-review the new package and update PDFJS_HASHED_ASSETS ' +
        'in vite.config.ts.',
    );
  }
  assertMatchesPinnedHash(entry.relativePath, data, entry.sha256);
  return data;
}

function readLicenseFile(pdfjsDir: string, relativePath: string): Buffer {
  try {
    return readFileSync(join(pdfjsDir, relativePath));
  } catch {
    throw new PdfjsAssetProvenanceError(
      `pdf.js license file "${relativePath}" was not found in the installed pdfjs-dist ` +
        'package (see src/reader/NOTICE.md).',
    );
  }
}

/**
 * Self-hosts the allow-listed pdf.js assets above by copying them straight
 * out of `node_modules/pdfjs-dist` -- never committing the bytes to the repo,
 * so their provenance stays tied to the lockfile-pinned `pdfjs-dist` version
 * (AGENTS.md forbids committing build artifacts/binaries) -- after verifying
 * every hashed file's content against its pinned SHA-256.
 *
 * Verification happens once, eagerly, in `configResolved` (called for `vite
 * dev`, `vite build`, and every `vitest` run that loads this config), so a
 * stale pinned hash -- most likely from an unreviewed `pdfjs-dist` upgrade --
 * fails fast and loudly rather than only on first request.
 *
 * Dev (`vite`): a middleware serves each verified file straight from memory.
 * Build (`vite build`): `closeBundle` writes each verified file into
 * `<outDir>/pdfjs-assets/<relativePath>`. `vite preview` then serves them like
 * any other static file under `dist/`, so no separate preview-only code path
 * is needed.
 */
function pdfjsAssetsPlugin(): Plugin {
  const require = createRequire(import.meta.url);
  const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
  let base = '/';
  let root = process.cwd();
  let outDir = 'dist';
  let verifiedAssets: Map<string, Buffer> | null = null;

  function getVerifiedAssets(): Map<string, Buffer> {
    if (!verifiedAssets) {
      const assets = new Map<string, Buffer>();
      for (const entry of PDFJS_HASHED_ASSETS) {
        assets.set(entry.relativePath, readAndVerifyHashedAsset(pdfjsDir, entry));
      }
      for (const relativePath of PDFJS_LICENSE_FILES) {
        assets.set(relativePath, readLicenseFile(pdfjsDir, relativePath));
      }
      verifiedAssets = assets;
    }
    return verifiedAssets;
  }

  return {
    name: 'chess-reader:pdfjs-assets',
    configResolved(config) {
      base = config.base;
      root = config.root;
      outDir = config.build.outDir;
      // Fail at config-resolution time (dev-server/build/test startup)
      // rather than the first time a page happens to request one of these.
      getVerifiedAssets();
    },
    configureServer(server) {
      const assets = getVerifiedAssets();
      const mountPath = `${base}${PDFJS_ASSETS_DIR_NAME}`;
      server.middlewares.use(mountPath, (req, res, next) => {
        const relativePath = (req.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        const data = assets.get(relativePath);
        if (!data) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(data);
      });
    },
    closeBundle() {
      const assets = getVerifiedAssets();
      const destRoot = resolve(root, outDir, PDFJS_ASSETS_DIR_NAME);
      for (const [relativePath, data] of assets) {
        const destPath = join(destRoot, relativePath);
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, data);
      }
    },
  };
}

/**
 * Cross-origin isolation headers. Threaded WebAssembly (Stockfish) later needs
 * `crossOriginIsolated === true`, so the dev and preview servers already send the
 * production header contract. Every asset is self-hosted, so `require-corp` is safe.
 */
export const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

/**
 * Static hosts that serve the app from a sub-path (for example GitHub Pages at
 * `/chess-reader/`) set `CHESS_READER_BASE_PATH`. The default is the origin root.
 */
const basePath = process.env['CHESS_READER_BASE_PATH'] ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [react(), pdfjsAssetsPlugin()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    sourcemap: true,
  },
});
