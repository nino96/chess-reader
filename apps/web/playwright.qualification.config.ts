import { defineConfig } from '@playwright/test';
import evaluationConfig from './playwright.eval.config';

export default defineConfig(evaluationConfig, {
  metadata: { candidateEvaluationMode: 'qualification' },
  outputDir: 'eval-results/playwright-qualification',
});
