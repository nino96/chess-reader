import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
  plugins: [react()],
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
