/**
 * Deterministic `DiagramRecognizer` fake driven by a plain, JSON-serializable
 * script. Used by unit tests directly, and injected into the page for
 * deterministic browser E2E via `testHooks.ts`/`recognizerFactory.ts` (see
 * those files for the Playwright seam).
 */
import type {
  BoardOrientation,
  DiagramRecognizer,
  RecognitionErrorCode,
  RecognitionOutcome,
  RecognitionPhase,
  RecognitionSuccess,
} from '../study/contracts';

import { RecognitionError } from '../study/contracts';

export interface FakeRecognizerStep {
  /** Milliseconds before this step settles. Falls back to `defaultDelayMs`, then 0. */
  readonly delayMs?: number;
  /** Phases reported via `onPhase`, spread evenly across `delayMs`. Default `['recognizing']`. */
  readonly phases?: readonly RecognitionPhase[];
  /** `'never'` never settles (unless aborted) -- for cancellation tests. */
  readonly outcome: 'board' | 'no-board' | 'error' | 'never';
  readonly placement?: string;
  readonly confidences?: readonly number[];
  readonly reliable?: boolean;
  readonly proposedOrientation?: BoardOrientation;
  readonly errorCode?: RecognitionErrorCode;
}

/** Plain-data script: safe to `JSON.stringify` and inject via Playwright's
 *  `addInitScript` before the page's own code runs. */
export interface FakeRecognizerScript {
  readonly version?: string;
  readonly defaultDelayMs?: number;
  /** Consumed in call order; the last step repeats for every call beyond the list. */
  readonly steps: readonly FakeRecognizerStep[];
}

export interface CreateScriptedRecognizerOptions {
  readonly now?: () => number;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

const DEFAULT_VERSION = 'fake-recognizer';
const DEFAULT_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

function defaultConfidences(): number[] {
  return new Array(64).fill(0.95) as number[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function createScriptedRecognizer(
  script: FakeRecognizerScript,
  options: CreateScriptedRecognizerOptions = {},
): DiagramRecognizer {
  if (script.steps.length === 0) {
    throw new Error('FakeRecognizerScript.steps must contain at least one step');
  }
  const now = options.now ?? (() => Date.now());
  const scheduleTimeout = options.setTimeoutFn ?? setTimeout;
  const cancelTimeout = options.clearTimeoutFn ?? clearTimeout;
  const version = script.version ?? DEFAULT_VERSION;

  let callIndex = 0;
  let disposed = false;
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  /** One entry per currently-pending `recognize()` call; `dispose()` invokes
   *  each to reject it with 'aborted', matching the study contract's
   *  "dispose() ... rejects pending requests" guarantee. */
  const activeAborts = new Set<() => void>();

  function stepFor(index: number): FakeRecognizerStep {
    const steps = script.steps;
    const clampedIndex = Math.min(index, steps.length - 1);
    const step = steps[clampedIndex];
    if (!step) {
      // Unreachable: clampedIndex is always within [0, steps.length - 1] and
      // steps.length > 0 is checked above; guards noUncheckedIndexedAccess.
      throw new Error('FakeRecognizerScript step lookup failed unexpectedly');
    }
    return step;
  }

  return {
    version,

    recognize(request, signal, onPhase) {
      if (disposed) {
        return Promise.reject(
          new RecognitionError('aborted', request.requestId, 'Recognizer disposed.'),
        );
      }
      const step = stepFor(callIndex);
      callIndex += 1;

      return new Promise<RecognitionSuccess>((resolve, reject) => {
        if (signal.aborted) {
          reject(new RecognitionError('aborted', request.requestId, 'Aborted before starting.'));
          return;
        }

        let settled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const startedAt = now();
        const delayMs = step.delayMs ?? script.defaultDelayMs ?? 0;
        const phases = step.phases ?? (['recognizing'] as const);

        const cleanup = (): void => {
          for (const timer of timers) {
            cancelTimeout(timer);
            activeTimers.delete(timer);
          }
          signal.removeEventListener('abort', onAbort);
          activeAborts.delete(onAbort);
        };

        const onAbort = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(new RecognitionError('aborted', request.requestId, 'Aborted.'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        activeAborts.add(onAbort);

        if (step.outcome === 'never') {
          // Never settles on its own; only `onAbort` above can resolve this.
          return;
        }

        phases.forEach((phase, index) => {
          const phaseDelay = phases.length > 1 ? Math.round((delayMs * index) / phases.length) : 0;
          const timer = scheduleTimeout(() => {
            if (!settled) {
              onPhase?.(phase);
            }
          }, phaseDelay);
          timers.push(timer);
          activeTimers.add(timer);
        });

        const finalTimer = scheduleTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();

          if (step.outcome === 'error') {
            const code = step.errorCode ?? 'runtime-failure';
            reject(
              new RecognitionError(code, request.requestId, `Scripted recognition error: ${code}`),
            );
            return;
          }

          const outcome: RecognitionOutcome =
            step.outcome === 'no-board'
              ? { kind: 'no-board' }
              : {
                  kind: 'board',
                  board: {
                    placement: step.placement ?? DEFAULT_PLACEMENT,
                    confidences: step.confidences ?? defaultConfidences(),
                    minConfidence: Math.min(...(step.confidences ?? defaultConfidences())),
                    meanConfidence: mean(step.confidences ?? defaultConfidences()),
                    reliable: step.reliable ?? true,
                    corners: { x0: 0, y0: 0, x1: request.region.width, y1: request.region.height },
                    proposedOrientation: step.proposedOrientation ?? 'white',
                  },
                };

          resolve({
            requestId: request.requestId,
            outcome,
            timing: {
              totalMs: now() - startedAt,
              inferenceMs: delayMs,
              coldStart: callIndex === 1,
            },
            recognizerVersion: version,
          });
        }, delayMs);
        timers.push(finalTimer);
        activeTimers.add(finalTimer);
      });
    },

    dispose(): void {
      disposed = true;
      for (const abort of Array.from(activeAborts)) {
        abort();
      }
      for (const timer of activeTimers) {
        cancelTimeout(timer);
      }
      activeTimers.clear();
    },
  };
}
