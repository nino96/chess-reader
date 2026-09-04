/**
 * Main-thread `DiagramRecognizer` backed by `recognition.worker.ts`. Owns
 * the worker's lifecycle (lazy creation, termination on fatal error/timeout,
 * lazy recreation on the next call) and the per-request bookkeeping the
 * study contract requires: reject-by-signal, reject-stale-results,
 * timeout, and worker-crash handling.
 */
import { RECOGNIZER_VERSION } from './assets';
import {
  isWorkerResponse,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
} from './protocol';

import type {
  DiagramRecognizer,
  RecognitionPhase,
  RecognitionRequest,
  RecognitionSuccess,
} from '../study/contracts';

import { RecognitionError } from '../study/contracts';

/**
 * The minimal surface `workerRecognizer` needs from a `Worker`. A real
 * `Worker` satisfies this structurally, and tests inject a fully controlled
 * fake that dispatches `MessageEvent`s by hand.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(type: string, listener: (event: MessageEvent<unknown> | Event) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent<unknown> | Event) => void): void;
  terminate(): void;
}

export interface CreateWorkerRecognizerOptions {
  readonly createWorker?: () => WorkerLike;
  /** Timeout for a request once the model is already warm. Default 20s. */
  readonly timeoutMs?: number;
  /** Timeout for a request that may still be paying model load cost. Default 60s. */
  readonly coldTimeoutMs?: number;
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_COLD_TIMEOUT_MS = 60_000;

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('./recognition.worker.ts', import.meta.url), { type: 'module' });
}

interface PendingRequest {
  readonly requestId: number;
  readonly postedAt: number;
  readonly onPhase: ((phase: RecognitionPhase) => void) | undefined;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  resolve(success: RecognitionSuccess): void;
  reject(error: RecognitionError): void;
}

export function createWorkerRecognizer(
  options: CreateWorkerRecognizerOptions = {},
): DiagramRecognizer {
  const createWorker = options.createWorker ?? defaultCreateWorker;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const coldTimeoutMs = options.coldTimeoutMs ?? DEFAULT_COLD_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());

  let worker: WorkerLike | null = null;
  let workerCreationFailed = false;
  let everCompletedOnce = false;
  let disposed = false;
  const pending = new Map<number, PendingRequest>();

  function settle(entry: PendingRequest, run: () => void): void {
    if (entry.settled) {
      return;
    }
    entry.settled = true;
    clearTimeout(entry.timer);
    entry.signal.removeEventListener('abort', entry.onAbort);
    pending.delete(entry.requestId);
    run();
  }

  function teardownWorker(): void {
    if (worker) {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onWorkerError);
      try {
        worker.terminate();
      } catch {
        // Already gone; nothing to do.
      }
    }
    worker = null;
  }

  function onMessage(event: MessageEvent<unknown> | Event): void {
    if (!('data' in event)) {
      return;
    }
    if (!isWorkerResponse(event.data)) {
      return;
    }
    const responseData: WorkerResponseMessage = event.data;
    const entry = pending.get(responseData.requestId);
    if (!entry) {
      // Unknown or already-settled (aborted/timed out) request: ignore.
      return;
    }
    if (responseData.type === 'phase') {
      entry.onPhase?.(responseData.phase);
      return;
    }
    everCompletedOnce = true;
    if (responseData.type === 'result') {
      settle(entry, () => {
        entry.resolve({
          requestId: responseData.requestId,
          outcome: responseData.outcome,
          timing: {
            totalMs: now() - entry.postedAt,
            inferenceMs: responseData.inferenceMs,
            coldStart: responseData.coldStart,
          },
          recognizerVersion: responseData.recognizerVersion,
        });
      });
      return;
    }
    settle(entry, () => {
      entry.reject(
        new RecognitionError(responseData.code, responseData.requestId, responseData.message),
      );
    });
  }

  function onWorkerError(): void {
    for (const entry of Array.from(pending.values())) {
      settle(entry, () => {
        entry.reject(
          new RecognitionError(
            'worker-unavailable',
            entry.requestId,
            'The recognition worker failed unexpectedly.',
          ),
        );
      });
    }
    teardownWorker();
  }

  function handleTimeout(requestId: number): void {
    const timedOutEntry = pending.get(requestId);
    if (!timedOutEntry || timedOutEntry.settled) {
      return;
    }
    // Inference cannot be interrupted mid-run; a timed-out worker is
    // presumed stuck, so it is terminated and every other in-flight request
    // shares its fate (a terminated worker will never answer them either).
    teardownWorker();
    for (const entry of Array.from(pending.values())) {
      if (entry.requestId === requestId) {
        settle(entry, () => {
          entry.reject(new RecognitionError('timeout', requestId, 'Recognition timed out.'));
        });
      } else {
        settle(entry, () => {
          entry.reject(
            new RecognitionError(
              'worker-unavailable',
              entry.requestId,
              'The recognition worker was terminated after another request timed out.',
            ),
          );
        });
      }
    }
  }

  function ensureWorker(): WorkerLike | null {
    if (worker) {
      return worker;
    }
    if (workerCreationFailed) {
      return null;
    }
    try {
      worker = createWorker();
    } catch {
      workerCreationFailed = true;
      return null;
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onWorkerError);
    workerCreationFailed = false;
    return worker;
  }

  return {
    version: RECOGNIZER_VERSION,

    recognize(
      request: RecognitionRequest,
      signal: AbortSignal,
      onPhase?: (phase: RecognitionPhase) => void,
    ): Promise<RecognitionSuccess> {
      if (disposed) {
        return Promise.reject(
          new RecognitionError('aborted', request.requestId, 'Recognizer disposed.'),
        );
      }
      if (signal.aborted) {
        return Promise.reject(
          new RecognitionError('aborted', request.requestId, 'Aborted before starting.'),
        );
      }
      const activeWorker = ensureWorker();
      if (!activeWorker) {
        return Promise.reject(
          new RecognitionError(
            'worker-unavailable',
            request.requestId,
            'The recognition worker could not be created.',
          ),
        );
      }

      const isCold = !everCompletedOnce;
      const timeout = isCold ? coldTimeoutMs : timeoutMs;

      return new Promise<RecognitionSuccess>((resolve, reject) => {
        const onAbort = (): void => {
          settle(entry, () => {
            reject(new RecognitionError('aborted', request.requestId, 'Aborted.'));
          });
          const cancelMessage: WorkerRequestMessage = {
            type: 'cancel',
            requestId: request.requestId,
          };
          try {
            activeWorker.postMessage(cancelMessage);
          } catch {
            // Worker is already gone; nothing more to cancel.
          }
        };

        const entry: PendingRequest = {
          requestId: request.requestId,
          postedAt: now(),
          onPhase,
          signal,
          onAbort,
          settled: false,
          resolve,
          reject,
          timer: setTimeout(() => {
            handleTimeout(request.requestId);
          }, timeout),
        };
        pending.set(request.requestId, entry);
        signal.addEventListener('abort', onAbort, { once: true });

        const recognizeMessage: WorkerRequestMessage = {
          type: 'recognize',
          requestId: request.requestId,
          width: request.region.width,
          height: request.region.height,
          data: request.region.data,
        };
        try {
          activeWorker.postMessage(recognizeMessage, [request.region.data.buffer]);
        } catch {
          settle(entry, () => {
            reject(
              new RecognitionError(
                'worker-unavailable',
                request.requestId,
                'Failed to post the request to the worker.',
              ),
            );
          });
        }
      });
    },

    dispose(): void {
      disposed = true;
      for (const entry of Array.from(pending.values())) {
        settle(entry, () => {
          entry.reject(new RecognitionError('aborted', entry.requestId, 'Recognizer disposed.'));
        });
      }
      teardownWorker();
    },
  };
}
