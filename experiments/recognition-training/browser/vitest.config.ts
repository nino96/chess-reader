import { resolve } from 'node:path';

import { defineConfig } from '../../../apps/web/node_modules/vitest/dist/config.js';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      vitest: resolve(import.meta.dirname, '../../../apps/web/node_modules/vitest/dist/index.js'),
    },
  },
  test: {
    include: ['*.test.ts'],
    environment: 'node',
  },
});
