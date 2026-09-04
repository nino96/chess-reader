import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Component journeys in jsdom + Testing Library routinely take several seconds
      // when the whole workspace runs in parallel on CI; this is a budget for that
      // environment, not a cover for a race (tests still fail fast on wrong state).
      testTimeout: 20_000,
      server: {
        deps: {
          // @scoriiu/fenshot's published files use extensionless relative imports,
          // which only bundlers resolve. Inlining lets Vitest process them like Vite does.
          inline: ['@scoriiu/fenshot'],
        },
      },
    },
  }),
);
