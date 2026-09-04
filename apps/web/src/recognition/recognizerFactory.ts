/**
 * The single place the rest of the app asks for a `DiagramRecognizer`.
 * Returns the deterministic scripted fake only when a validated Playwright
 * test hook is present (see `testHooks.ts`); otherwise the real worker
 * recognizer. This indirection is what lets browser E2E runs be
 * deterministic without any conditional logic in production UI code.
 */
import { isFakeRecognizerScript } from './testHooks';
import { createScriptedRecognizer } from './fakeRecognizer';
import { createWorkerRecognizer } from './workerRecognizer';

import type { DiagramRecognizer } from '../study/contracts';

export function createRecognizer(): DiagramRecognizer {
  const hooks = typeof window === 'undefined' ? undefined : window.__chessReaderTestHooks;
  const script = hooks?.recognizerScript;
  if (isFakeRecognizerScript(script)) {
    return createScriptedRecognizer(script);
  }
  return createWorkerRecognizer();
}
