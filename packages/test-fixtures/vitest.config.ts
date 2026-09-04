import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'test-fixtures',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The real-model golden test loads ONNX Runtime and renders a PDF page in Node.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        // @scoriiu/fenshot's dist/*.js uses extensionless relative imports
        // (`from "./recognize"`), which plain Node ESM resolution rejects but
        // Vite's resolver (used here instead of Node's when a package is
        // "inlined") accepts.
        inline: ['@scoriiu/fenshot'],
      },
    },
  },
});
