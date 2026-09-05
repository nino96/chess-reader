import { createWorkerRecognizer } from '../src/recognition/workerRecognizer';
import { LOCALIZATION_VERSION } from '../src/recognition/experimentalLocalization';
import { RECOGNIZER_VERSION } from '../src/recognition/assets';
import type { DiagramRecognizer } from '../src/study/contracts';

/** Selected by the evaluation build only; no runtime flag in the shipped app. */
export function createRecognizer(): DiagramRecognizer {
  const recognizer = createWorkerRecognizer({
    createWorker: () =>
      new Worker(new URL('./localized.worker.ts', import.meta.url), { type: 'module' }),
  });
  return { ...recognizer, version: `${RECOGNIZER_VERSION}/${LOCALIZATION_VERSION}` };
}
