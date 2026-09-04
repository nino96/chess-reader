/**
 * Messages exchanged between the main thread and the recognition worker
 * (`recognition.worker.ts`), plus runtime type guards.
 *
 * The worker boundary is untrusted in both directions: a malformed message
 * from either side must be ignored rather than crash the worker or the page,
 * per AGENTS.md ("validate every worker message at runtime"). Every guard
 * below checks every field explicitly rather than trusting a `type` tag
 * alone.
 */
import type {
  BoardCornersPx,
  BoardOrientation,
  RecognitionErrorCode,
  RecognitionOutcome,
  RecognitionPhase,
  RecognizedBoard,
} from '../study/contracts';

/** Posted to start a recognition run. `data`'s underlying buffer is transferred. */
export interface RecognizeRequestMessage {
  readonly type: 'recognize';
  readonly requestId: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Posted to abandon an in-flight request. The worker must never post a
 *  `result`/`error` for a cancelled `requestId` afterward. */
export interface CancelRequestMessage {
  readonly type: 'cancel';
  readonly requestId: number;
}

export type WorkerRequestMessage = RecognizeRequestMessage | CancelRequestMessage;

/** Progress update while a request is in flight. */
export interface PhaseResponseMessage {
  readonly type: 'phase';
  readonly requestId: number;
  readonly phase: RecognitionPhase;
}

/** Successful completion of a `recognize` request. */
export interface ResultResponseMessage {
  readonly type: 'result';
  readonly requestId: number;
  readonly outcome: RecognitionOutcome;
  readonly inferenceMs: number;
  readonly coldStart: boolean;
  readonly recognizerVersion: string;
}

/** Failed completion of a `recognize` request. */
export interface ErrorResponseMessage {
  readonly type: 'error';
  readonly requestId: number;
  readonly code: RecognitionErrorCode;
  readonly message: string;
}

export type WorkerResponseMessage =
  PhaseResponseMessage | ResultResponseMessage | ErrorResponseMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecognitionPhase(value: unknown): value is RecognitionPhase {
  return value === 'loading-model' || value === 'recognizing';
}

function isRecognitionErrorCode(value: unknown): value is RecognitionErrorCode {
  return (
    value === 'aborted' ||
    value === 'timeout' ||
    value === 'worker-unavailable' ||
    value === 'asset-integrity' ||
    value === 'runtime-failure'
  );
}

function isBoardOrientation(value: unknown): value is BoardOrientation {
  return value === 'white' || value === 'black';
}

function isBoardCornersPx(value: unknown): value is BoardCornersPx {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumber(value['x0']) &&
    isFiniteNumber(value['y0']) &&
    isFiniteNumber(value['x1']) &&
    isFiniteNumber(value['y1'])
  );
}

/** Per-square confidences: exactly 64 finite numbers, A1..H8 rank-major. */
function isConfidenceList(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) && value.length === 64 && value.every((entry) => isFiniteNumber(entry))
  );
}

function isRecognizedBoard(value: unknown): value is RecognizedBoard {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value['placement'] === 'string' &&
    isConfidenceList(value['confidences']) &&
    isFiniteNumber(value['minConfidence']) &&
    isFiniteNumber(value['meanConfidence']) &&
    typeof value['reliable'] === 'boolean' &&
    isBoardCornersPx(value['corners']) &&
    isBoardOrientation(value['proposedOrientation'])
  );
}

function isRecognitionOutcome(value: unknown): value is RecognitionOutcome {
  if (!isRecord(value)) {
    return false;
  }
  if (value['kind'] === 'no-board') {
    return true;
  }
  if (value['kind'] === 'board') {
    return isRecognizedBoard(value['board']);
  }
  return false;
}

export function isWorkerRequest(data: unknown): data is WorkerRequestMessage {
  if (!isRecord(data)) {
    return false;
  }
  if (data['type'] === 'cancel') {
    return isFiniteNumber(data['requestId']);
  }
  if (data['type'] === 'recognize') {
    return (
      isFiniteNumber(data['requestId']) &&
      isFiniteNumber(data['width']) &&
      isFiniteNumber(data['height']) &&
      data['data'] instanceof Uint8ClampedArray
    );
  }
  return false;
}

export function isWorkerResponse(data: unknown): data is WorkerResponseMessage {
  if (!isRecord(data)) {
    return false;
  }
  if (data['type'] === 'phase') {
    return isFiniteNumber(data['requestId']) && isRecognitionPhase(data['phase']);
  }
  if (data['type'] === 'result') {
    return (
      isFiniteNumber(data['requestId']) &&
      isRecognitionOutcome(data['outcome']) &&
      isFiniteNumber(data['inferenceMs']) &&
      typeof data['coldStart'] === 'boolean' &&
      typeof data['recognizerVersion'] === 'string'
    );
  }
  if (data['type'] === 'error') {
    return (
      isFiniteNumber(data['requestId']) &&
      isRecognitionErrorCode(data['code']) &&
      typeof data['message'] === 'string'
    );
  }
  return false;
}
