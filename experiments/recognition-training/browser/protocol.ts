export const TILE_VALUES_PER_BOARD = 64 * 1024;
export const OUTPUT_VALUES_PER_BOARD = 64 * 13;

export interface InitializeRequest {
  readonly type: 'initialize';
  readonly requestId: number;
  readonly modelUrl: string;
  readonly modelSha256: string;
  readonly vectorsUrl: string;
  readonly vectorsSha256: string;
  readonly boardCount: number;
}

export interface RunRequest {
  readonly type: 'run';
  readonly requestId: number;
  readonly boardIndexes: readonly number[];
}

export interface CancelRequest {
  readonly type: 'cancel';
  readonly requestId: number;
}

export interface HangRequest {
  readonly type: 'test-hang';
  readonly requestId: number;
}

export interface DisposeRequest {
  readonly type: 'dispose';
  readonly requestId: number;
}

export type WorkerRequest =
  InitializeRequest | RunRequest | CancelRequest | HangRequest | DisposeRequest;

export type WorkerResponse =
  | {
      readonly type: 'ready';
      readonly requestId: number;
      readonly initializationMs: number;
      readonly modelSha256: string;
      readonly runtimeSha256: string;
    }
  | {
      readonly type: 'progress';
      readonly requestId: number;
      readonly completedBoards: number;
    }
  | {
      readonly type: 'result';
      readonly requestId: number;
      readonly boardIndexes: readonly number[];
      readonly classes: readonly number[];
      readonly confidences: readonly number[];
      readonly inferenceMs: readonly number[];
    }
  | {
      readonly type: 'cancelled';
      readonly requestId: number;
      readonly completedBoards: number;
    }
  | {
      readonly type: 'disposed';
      readonly requestId: number;
    }
  | {
      readonly type: 'error';
      readonly requestId: number;
      readonly code: 'invalid-message' | 'asset-fetch' | 'asset-integrity' | 'schema' | 'runtime';
      readonly message: string;
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function requestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!record(value) || !requestId(value.requestId) || typeof value.type !== 'string') return false;
  if (value.type === 'cancel' || value.type === 'test-hang' || value.type === 'dispose') {
    return exact(value, ['type', 'requestId']);
  }
  if (value.type === 'initialize') {
    return (
      exact(value, [
        'type',
        'requestId',
        'modelUrl',
        'modelSha256',
        'vectorsUrl',
        'vectorsSha256',
        'boardCount',
      ]) &&
      typeof value.modelUrl === 'string' &&
      typeof value.modelSha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(value.modelSha256) &&
      typeof value.vectorsUrl === 'string' &&
      typeof value.vectorsSha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(value.vectorsSha256) &&
      requestId(value.boardCount) &&
      value.boardCount > 0
    );
  }
  return (
    value.type === 'run' &&
    exact(value, ['type', 'requestId', 'boardIndexes']) &&
    Array.isArray(value.boardIndexes) &&
    value.boardIndexes.length > 0 &&
    value.boardIndexes.every(requestId)
  );
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!record(value) || !requestId(value.requestId) || typeof value.type !== 'string') return false;
  if (value.type === 'ready') {
    return (
      exact(value, ['type', 'requestId', 'initializationMs', 'modelSha256', 'runtimeSha256']) &&
      typeof value.initializationMs === 'number' &&
      Number.isFinite(value.initializationMs) &&
      value.initializationMs >= 0 &&
      typeof value.modelSha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(value.modelSha256) &&
      typeof value.runtimeSha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(value.runtimeSha256)
    );
  }
  if (value.type === 'progress' || value.type === 'cancelled') {
    return (
      exact(value, ['type', 'requestId', 'completedBoards']) && requestId(value.completedBoards)
    );
  }
  if (value.type === 'result') {
    return (
      exact(value, [
        'type',
        'requestId',
        'boardIndexes',
        'classes',
        'confidences',
        'inferenceMs',
      ]) &&
      Array.isArray(value.boardIndexes) &&
      Array.isArray(value.classes) &&
      Array.isArray(value.confidences) &&
      Array.isArray(value.inferenceMs) &&
      value.boardIndexes.every(requestId) &&
      value.classes.length === value.boardIndexes.length * 64 &&
      value.classes.every((item) => requestId(item) && item < 13) &&
      value.confidences.length === value.classes.length &&
      value.confidences.every(
        (item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1,
      ) &&
      value.inferenceMs.length === value.boardIndexes.length &&
      value.inferenceMs.every(
        (item) => typeof item === 'number' && Number.isFinite(item) && item >= 0,
      )
    );
  }
  if (value.type === 'disposed') return exact(value, ['type', 'requestId']);
  return (
    value.type === 'error' &&
    exact(value, ['type', 'requestId', 'code', 'message']) &&
    ['invalid-message', 'asset-fetch', 'asset-integrity', 'schema', 'runtime'].includes(
      String(value.code),
    ) &&
    typeof value.message === 'string' &&
    value.message.length <= 300
  );
}
