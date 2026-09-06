// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    'experiments/recognition-training/.venv/**',
    'experiments/recognition-training/.bootstrap/**',
    'experiments/recognition-training/cache/**',
    'experiments/recognition-training/data/**',
    'experiments/recognition-training/runs/**',
    'experiments/recognition-training/v2/data/**',
    'experiments/recognition-training/v2/runs/**',
    'experiments/recognition-training/v3/cache/**',
    'experiments/recognition-training/v3/data/**',
    'experiments/recognition-training/v3/runs/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ['apps/**/src/**/*.{ts,tsx}'],
    extends: [
      jsxA11y.flatConfigs.strict,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: [
      '**/*.js',
      '**/*.mjs',
      '**/*.config.ts',
      '**/scripts/**/*.{ts,mjs}',
      'apps/**/e2e/**/*.ts',
      'apps/**/eval/**/*.ts',
      'packages/*/generators/**/*.mjs',
      'packages/*/tests/**/*.ts',
      'packages/*/src/**/*.ts',
      'experiments/recognition-training/**/*.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
