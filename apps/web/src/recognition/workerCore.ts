/**
 * Testable core of `recognition.worker.ts`. Every ONNX-Runtime-specific or
 * global (`self`, `fetch`, `crypto`) detail is injected through
 * `WorkerCoreDeps`, so this module can run its own logic (message
 * validation, session caching/cold-vs-warm bookkeeping, fail-closed model
 * hash verification, cancellation, error mapping) under plain Node/Vitest
 * without ONNX Runtime, WebAssembly, or a real worker. `recognition.worker.ts`
 * itself is a thin bootstrap that wires the real browser APIs into this.
 */
import { extractTiles, probsToPlacement, rgbaToGray, type TileClassifier } from '@scoriiu/fenshot';

import { MODEL_SHA256, RECOGNIZER_VERSION } from './assets';
import { runRecognition } from './pipeline';
import {
  isWorkerRequest,
  type RecognizeRequestMessage,
  type WorkerResponseMessage,
} from './protocol';

/** A ready-to-use ONNX Runtime session, reduced to exactly the shape this
 *  module needs. Building the `ort.Tensor` / calling `session.run` / reading
 *  `out['probs'].data` are all ONNX-Runtime-specific concerns that stay
 *  inside the real `createSession` implementation in `recognition.worker.ts`. */
export interface InferenceSessionLike {
  /** Runs the model on one [64, 1024] tile batch and returns the raw
   *  13-class-per-tile probabilities the classifier needs. */
  run(tiles: Float32Array): Promise<Float32Array>;
}

export interface WorkerCoreDeps {
  /** Fetches the raw model bytes (from `assets.ts`'s `modelUrl`). */
  readonly fetchModel: () => Promise<ArrayBuffer>;
  /** Computes a SHA-256 digest, e.g. `crypto.subtle.digest.bind(crypto.subtle, 'SHA-256')`. */
  readonly digest: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  /** Builds an inference session from verified model bytes. */
  readonly createSession: (modelBytes: Uint8Array) => Promise<InferenceSessionLike>;
  /** Sends a response message back to the main thread. */
  readonly post: (message: WorkerResponseMessage, transfer?: readonly Transferable[]) => void;
  /** Injectable clock for measuring `inferenceMs`; defaults to `performance.now`. */
  readonly now?: () => number;
  /** Overrides `RECOGNIZER_VERSION` for tests; defaults to the pinned constant. */
  readonly recognizerVersion?: string;
  /** Evaluation injection; normal workers always use the unchanged pipeline. */
  readonly recognize?: typeof runRecognition;
}

export interface WorkerCore {
  /** Feed one incoming message. Anything that fails `isWorkerRequest` is
   *  silently ignored, per AGENTS.md's "validate every worker message". */
  handleMessage(data: unknown): void;
}

class AssetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetIntegrityError';
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = error.message || 'unknown error';
    return `${name}: ${message}`;
  }
  return 'unknown error';
}

export function createWorkerCore(deps: WorkerCoreDeps): WorkerCore {
  const now = deps.now ?? (() => performance.now());
  const recognizerVersion = deps.recognizerVersion ?? RECOGNIZER_VERSION;

  /** Cached across requests so only the first pays fetch+verify+compile cost. */
  let sessionPromise: Promise<InferenceSessionLike> | null = null;
  /** Flips to true once a session has ever been created successfully. Every
   *  request that starts while this is still false shares the same cold
   *  start (concurrent requests before the first session is ready all pay
   *  it; nothing after does). */
  let modelReady = false;
  /** Request ids whose result must never be posted, per AGENTS.md
   *  ("reject stale results by request/generation identity"). Cleared once
   *  consumed so this cannot grow unbounded. */
  const cancelledIds = new Set<number>();

  function isCancelled(requestId: number): boolean {
    return cancelledIds.has(requestId);
  }

  function finalize(requestId: number): void {
    cancelledIds.delete(requestId);
  }

  function getSession(): Promise<InferenceSessionLike> {
    sessionPromise ??= (async () => {
      const modelBytes = await deps.fetchModel();
      const digestBuffer = await deps.digest(modelBytes);
      const hex = toHex(digestBuffer);
      if (hex !== MODEL_SHA256) {
        throw new AssetIntegrityError(
          `recognition model hash mismatch (fetched asset does not match the pinned build): expected ${MODEL_SHA256}, got ${hex}`,
        );
      }
      const session = await deps.createSession(new Uint8Array(modelBytes));
      modelReady = true;
      return session;
    })().catch((error: unknown) => {
      // Do not cache a broken session: fail closed for this attempt, but
      // let a later request try again (e.g. after a deploy fixes the asset).
      sessionPromise = null;
      throw error;
    });
    return sessionPromise;
  }

  async function processRecognize(request: RecognizeRequestMessage): Promise<void> {
    const { requestId, width, height, data } = request;
    try {
      const wasReadyBefore = modelReady;
      if (!wasReadyBefore && !isCancelled(requestId)) {
        deps.post({ type: 'phase', requestId, phase: 'loading-model' });
      }
      const session = await getSession();
      if (isCancelled(requestId)) {
        finalize(requestId);
        return;
      }
      deps.post({ type: 'phase', requestId, phase: 'recognizing' });

      // Computed independently from the `rgbaToGray` call inside
      // `runRecognition` (pipeline.ts keeps that internal to stay a pure,
      // self-contained core). Both calls are pure and deterministic given
      // the same bytes, so this costs one extra linear pass over the region
      // -- negligible next to model inference -- in exchange for keeping
      // pipeline.ts free of any tile-extraction/session concerns.
      const gray = rgbaToGray(data, width, height);
      const classify: TileClassifier = async (corners) => {
        // A candidate search may classify several boxes. Cancellation must
        // prevent subsequent inference as well as suppress the final result.
        if (isCancelled(requestId)) throw new Error('Recognition cancelled.');
        const tiles = extractTiles(gray, corners);
        const probs = await session.run(tiles);
        if (isCancelled(requestId)) throw new Error('Recognition cancelled.');
        return probsToPlacement(probs);
      };

      const start = now();
      const outcome = await (deps.recognize ?? runRecognition)({ width, height, data }, classify);
      const inferenceMs = now() - start;

      if (isCancelled(requestId)) {
        finalize(requestId);
        return;
      }
      deps.post({
        type: 'result',
        requestId,
        outcome,
        inferenceMs,
        coldStart: !wasReadyBefore,
        recognizerVersion,
      });
      finalize(requestId);
    } catch (error) {
      if (isCancelled(requestId)) {
        finalize(requestId);
        return;
      }
      if (error instanceof AssetIntegrityError) {
        deps.post({ type: 'error', requestId, code: 'asset-integrity', message: error.message });
      } else {
        deps.post({
          type: 'error',
          requestId,
          code: 'runtime-failure',
          message: sanitizeError(error),
        });
      }
      finalize(requestId);
    }
  }

  return {
    handleMessage(data: unknown): void {
      if (!isWorkerRequest(data)) {
        return;
      }
      if (data.type === 'cancel') {
        cancelledIds.add(data.requestId);
        return;
      }
      void processRecognize(data);
    },
  };
}
