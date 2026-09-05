import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration for `pnpm eval:recognition`: the real-model recognition
 * evaluation (docs/evaluation.md §6). It runs the production build through the
 * actual product path (open fixture PDF -> select the diagram -> worker
 * recognition) with NO fake recognizer, repeats the recognition to collect a
 * latency distribution, and writes a JSON report under `eval-results/`.
 *
 * It is deliberately separate from `playwright.config.ts` so the ordinary E2E
 * suite stays fast and deterministic (it uses the scripted fake recognizer).
 */
const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
const isCI = !!process.env['CI'];

export default defineConfig({
  metadata: { candidateEvaluationMode: 'measurement' },
  testDir: './eval',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  outputDir: 'eval-results/playwright',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm exec vite build --config vite.corpus.config.ts && pnpm preview',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
