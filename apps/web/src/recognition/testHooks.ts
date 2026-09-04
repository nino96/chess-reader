/**
 * The deterministic-recognition seam for browser E2E only. Playwright's
 * `addInitScript` sets `window.__chessReaderTestHooks.recognizerScript`
 * before the app's own code runs, so `recognizerFactory.ts` picks a scripted
 * fake instead of the real ONNX worker. In every normal run of the app this
 * global is `undefined`, so this seam is completely inert -- and even if
 * something set it to garbage, `isFakeRecognizerScript` rejects anything
 * that doesn't match the expected shape rather than letting a malformed
 * value reach `createScriptedRecognizer`.
 */
import type { FakeRecognizerScript, FakeRecognizerStep } from './fakeRecognizer';

declare global {
  interface Window {
    __chessReaderTestHooks?: {
      readonly recognizerScript?: FakeRecognizerScript;
    };
  }
}

const OUTCOMES = ['board', 'no-board', 'error', 'never'] as const;
const PHASES = ['loading-model', 'recognizing'] as const;
const ORIENTATIONS = ['white', 'black'] as const;
const ERROR_CODES = [
  'aborted',
  'timeout',
  'worker-unavailable',
  'asset-integrity',
  'runtime-failure',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function isFakeRecognizerStep(value: unknown): value is FakeRecognizerStep {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const step = value as Record<string, unknown>;
  if (
    typeof step['outcome'] !== 'string' ||
    !(OUTCOMES as readonly string[]).includes(step['outcome'])
  ) {
    return false;
  }
  if (step['delayMs'] !== undefined && typeof step['delayMs'] !== 'number') {
    return false;
  }
  if (step['phases'] !== undefined) {
    if (
      !isStringArray(step['phases']) ||
      !step['phases'].every((p) => (PHASES as readonly string[]).includes(p))
    ) {
      return false;
    }
  }
  if (step['placement'] !== undefined && typeof step['placement'] !== 'string') {
    return false;
  }
  if (step['confidences'] !== undefined && !isNumberArray(step['confidences'])) {
    return false;
  }
  if (step['reliable'] !== undefined && typeof step['reliable'] !== 'boolean') {
    return false;
  }
  if (
    step['proposedOrientation'] !== undefined &&
    !(ORIENTATIONS as readonly string[]).includes(step['proposedOrientation'] as string)
  ) {
    return false;
  }
  if (
    step['errorCode'] !== undefined &&
    !(ERROR_CODES as readonly string[]).includes(step['errorCode'] as string)
  ) {
    return false;
  }
  return true;
}

/** Validates an arbitrary value at the test-hook boundary before it is ever
 *  passed to `createScriptedRecognizer`. */
export function isFakeRecognizerScript(value: unknown): value is FakeRecognizerScript {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const script = value as Record<string, unknown>;
  if (script['version'] !== undefined && typeof script['version'] !== 'string') {
    return false;
  }
  if (script['defaultDelayMs'] !== undefined && typeof script['defaultDelayMs'] !== 'number') {
    return false;
  }
  if (!Array.isArray(script['steps']) || script['steps'].length === 0) {
    return false;
  }
  return script['steps'].every((step: unknown) => isFakeRecognizerStep(step));
}
