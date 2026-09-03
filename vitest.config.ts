import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest.config.ts',
      'packages/*/vitest.config.ts',
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.{ts,mjs}'],
        },
      },
    ],
  },
});
