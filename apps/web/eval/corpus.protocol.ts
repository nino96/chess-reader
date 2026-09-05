import type { BoardCorners } from '@scoriiu/fenshot';

export type CorpusStage = 'classifier' | 'manual' | 'full-page';

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CorpusWorkerRequest {
  readonly type: 'run';
  readonly inputId: string;
  readonly mode: 'classifier' | 'recognizer';
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface CorpusWorkerDisposeRequest {
  readonly type: 'dispose';
  readonly inputId: 'dispose';
}

export type CorpusWorkerMessage = CorpusWorkerRequest | CorpusWorkerDisposeRequest;

export interface CorpusWorkerPrediction {
  readonly corners: BoardCorners;
  /** Raw, image-relative FENShot read. Never persist this in an eval report. */
  readonly placement: string;
  readonly confidences: readonly number[];
  readonly minConfidence: number;
  readonly meanConfidence: number;
  readonly orientation: 'white' | 'black';
  /** Pinned FENShot has no abstention signal, so this is always false. */
  readonly orientationAmbiguous: false;
}

export interface CorpusWorkerSuccess {
  readonly type: 'result';
  readonly inputId: string;
  readonly predictions: readonly CorpusWorkerPrediction[];
  /** Non-null only for the first input in this fresh worker session. */
  readonly initializationMs: number | null;
  readonly recognitionMs: number;
  readonly modelSha256: string;
  readonly runtimeSha256: string;
}

export interface CorpusWorkerFailure {
  readonly type: 'infrastructure-error';
  readonly inputId: string;
  readonly message: string;
}

export interface CorpusWorkerDisposed {
  readonly type: 'disposed';
  readonly inputId: 'dispose';
}

export type CorpusWorkerResponse = CorpusWorkerSuccess | CorpusWorkerFailure | CorpusWorkerDisposed;

export interface CorpusBrowserRun {
  readonly inputId: string;
  readonly cropRect: PixelRect;
  readonly width: number;
  readonly height: number;
  readonly workerTotalMs: number;
  readonly result: CorpusWorkerSuccess;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCorners(value: unknown): value is BoardCorners {
  return (
    isRecord(value) &&
    isFiniteNumber(value['x0']) &&
    isFiniteNumber(value['y0']) &&
    isFiniteNumber(value['x1']) &&
    isFiniteNumber(value['y1']) &&
    value['x1'] > value['x0'] &&
    value['y1'] > value['y0']
  );
}

function isPrediction(value: unknown): value is CorpusWorkerPrediction {
  if (!isRecord(value)) return false;
  const confidences = value['confidences'];
  return (
    isCorners(value['corners']) &&
    typeof value['placement'] === 'string' &&
    Array.isArray(confidences) &&
    confidences.length === 64 &&
    confidences.every(isFiniteNumber) &&
    isFiniteNumber(value['minConfidence']) &&
    isFiniteNumber(value['meanConfidence']) &&
    (value['orientation'] === 'white' || value['orientation'] === 'black') &&
    value['orientationAmbiguous'] === false
  );
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CORPUS_DIMENSION_PX = 1024;

export function isCorpusWorkerResponse(value: unknown): value is CorpusWorkerResponse {
  if (!isRecord(value) || typeof value['inputId'] !== 'string') return false;
  if (value['type'] === 'disposed') return value['inputId'] === 'dispose';
  if (value['type'] === 'infrastructure-error') {
    return typeof value['message'] === 'string';
  }
  if (value['type'] !== 'result') return false;
  const predictions = value['predictions'];
  return (
    Array.isArray(predictions) &&
    predictions.length <= 1 &&
    predictions.every(isPrediction) &&
    (value['initializationMs'] === null ||
      (isFiniteNumber(value['initializationMs']) && value['initializationMs'] >= 0)) &&
    isFiniteNumber(value['recognitionMs']) &&
    value['recognitionMs'] >= 0 &&
    typeof value['modelSha256'] === 'string' &&
    SHA256_PATTERN.test(value['modelSha256']) &&
    typeof value['runtimeSha256'] === 'string' &&
    SHA256_PATTERN.test(value['runtimeSha256'])
  );
}

export function isCorpusWorkerRequest(value: unknown): value is CorpusWorkerMessage {
  if (!isRecord(value)) return false;
  if (value['type'] === 'dispose') return value['inputId'] === 'dispose';
  const width = value['width'];
  const height = value['height'];
  const data = value['data'];
  return (
    value['type'] === 'run' &&
    typeof value['inputId'] === 'string' &&
    (value['mode'] === 'classifier' || value['mode'] === 'recognizer') &&
    typeof width === 'number' &&
    Number.isInteger(width) &&
    width > 0 &&
    width <= MAX_CORPUS_DIMENSION_PX &&
    typeof height === 'number' &&
    Number.isInteger(height) &&
    height > 0 &&
    height <= MAX_CORPUS_DIMENSION_PX &&
    data instanceof Uint8ClampedArray &&
    data.length === width * height * 4
  );
}
