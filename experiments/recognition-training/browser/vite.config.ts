import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import type { UserConfig } from 'vite';

const webRequire = createRequire(resolve(import.meta.dirname, '../../../apps/web/package.json'));
const ortDist = dirname(webRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));

export default {
  root: import.meta.dirname,
  resolve: {
    alias: [
      {
        find: /^onnxruntime-web\/wasm$/,
        replacement: resolve(ortDist, 'ort.wasm.bundle.min.mjs'),
      },
      {
        find: 'onnxruntime-web/ort-wasm-simd-threaded.wasm',
        replacement: webRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'),
      },
    ],
  },
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: true,
    manifest: true,
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: { input: resolve(import.meta.dirname, 'index.html') },
    sourcemap: true,
  },
} satisfies UserConfig;
