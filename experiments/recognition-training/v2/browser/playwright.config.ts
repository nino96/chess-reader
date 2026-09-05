import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type * as Playwright from '@playwright/test';

const browserRoot = import.meta.dirname;
const webRoot = resolve(browserRoot, '../../../../apps/web');
const viteConfig = resolve(browserRoot, '../../browser/vite.config.ts');
const port = 4188;
const webRequire = createRequire(resolve(webRoot, 'package.json'));
const { defineConfig, devices } = webRequire('@playwright/test') as typeof Playwright;

export default defineConfig({
  testDir: browserRoot,
  testMatch: 'evaluation.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  expect: { timeout: 60_000 },
  outputDir: resolve(browserRoot, 'test-results'),
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      `pnpm --dir ${webRoot} exec vite build --config ${viteConfig} && ` +
      `pnpm --dir ${webRoot} exec vite preview --config ${viteConfig} --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
