import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Evaluation-only browser entry. It is appended after the normal product build. */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^(?:\.\.\/recognition\/recognizerFactory)$/,
        replacement: resolve(import.meta.dirname, 'eval/localizedFactory.ts'),
      },
    ],
  },
  root: resolve(import.meta.dirname, 'eval'),
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: false,
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: {
      input: [
        resolve(import.meta.dirname, 'eval/corpus.html'),
        resolve(import.meta.dirname, 'eval/localized.html'),
      ],
    },
    sourcemap: true,
  },
});
