import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/** Evaluation-only browser entry. It is appended after the normal product build. */
export default defineConfig({
  root: resolve(import.meta.dirname, 'eval'),
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: false,
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: {
      input: resolve(import.meta.dirname, 'eval/corpus.html'),
    },
    sourcemap: true,
  },
});
