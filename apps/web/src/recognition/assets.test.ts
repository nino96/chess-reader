/// <reference types="node" />
// The triple-slash directive above pulls in @types/node's ambient module
// declarations (node:crypto, node:fs/promises, node:path, node:url) for this
// file only. tsconfig.app.json deliberately restricts automatic @types
// inclusion to browser-only packages (see its `types` field and the existing
// `src/app/icons.test.ts` precedent, which is excluded from tsconfig.app.json
// and included in tsconfig.node.json instead) since this project targets the
// browser; this is the standard per-file escape hatch for the rare test that
// legitimately needs Node's fs/crypto to inspect installed build inputs,
// without loosening every browser source file's ambient types.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MODEL_SHA256, ORT_WASM_SHA256 } from './assets';

/**
 * Build-time fail-closed provenance check: this test reads the exact files
 * installed under `node_modules` (not the `assets.ts` re-export) and
 * verifies their content hashes match the pinned constants. A version bump
 * of `@scoriiu/fenshot` or `onnxruntime-web` must update `MODEL_SHA256` /
 * `ORT_WASM_SHA256` (and `RECOGNIZER_VERSION`) in `assets.ts` deliberately --
 * this test fails loudly rather than silently accepting a different binary.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');

async function sha256Hex(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

describe('recognition asset provenance', () => {
  it('the installed fenshot tile classifier model matches the pinned hash', async () => {
    const modelPath = path.join(
      webRoot,
      'node_modules',
      '@scoriiu',
      'fenshot',
      'model',
      'chess-tiles-v2.onnx',
    );
    const hash = await sha256Hex(modelPath);
    expect(hash).toBe(MODEL_SHA256);
  });

  it('the installed onnxruntime-web wasm binary matches the pinned hash', async () => {
    const wasmPath = path.join(
      webRoot,
      'node_modules',
      'onnxruntime-web',
      'dist',
      'ort-wasm-simd-threaded.wasm',
    );
    const hash = await sha256Hex(wasmPath);
    expect(hash).toBe(ORT_WASM_SHA256);
  });
});
