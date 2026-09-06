import * as ort from 'onnxruntime-web/wasm';

import {
  isWorkerRequest,
  OUTPUT_VALUES_PER_BOARD,
  TILE_VALUES_PER_BOARD,
  type InitializeRequest,
  type WorkerResponse,
} from './protocol';
import { ORT_WASM_SHA256 } from './constants';
import { ortWasmUrl } from './runtime-assets';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

interface Runtime {
  readonly session: ort.InferenceSession;
  readonly vectors: Float32Array;
  readonly boardCount: number;
  readonly modelSha256: string;
  readonly runtimeSha256: string;
}

class HarnessError extends Error {
  constructor(
    readonly code: 'asset-fetch' | 'asset-integrity' | 'schema' | 'runtime',
    message: string,
  ) {
    super(message);
    this.name = 'HarnessError';
  }
}

const scope = globalThis as unknown as WorkerScope;
let runtime: Runtime | null = null;
let busyRequestId: number | null = null;
const cancelled = new Set<number>();

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchVerified(
  url: string,
  expectedSha256: string,
  label: string,
): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new HarnessError('asset-fetch', `${label} fetch failed`);
  }
  if (!response.ok) {
    throw new HarnessError('asset-fetch', `${label} fetch failed with HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const actual = await sha256(bytes);
  if (actual !== expectedSha256) {
    throw new HarnessError('asset-integrity', `${label} SHA-256 mismatch`);
  }
  return bytes;
}

function verifyLittleEndian(): void {
  const bytes = new Uint8Array(new Uint16Array([0x0102]).buffer);
  if (bytes[0] !== 0x02)
    throw new HarnessError('schema', 'float32-le vectors need a little-endian host');
}

async function initialize(request: InitializeRequest): Promise<void> {
  if (runtime !== null || busyRequestId !== null) {
    throw new HarnessError('runtime', 'worker is already initialized or busy');
  }
  busyRequestId = request.requestId;
  const started = performance.now();
  verifyLittleEndian();
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  const [modelBytes, vectorBytes, runtimeBytes] = await Promise.all([
    fetchVerified(request.modelUrl, request.modelSha256, 'model'),
    fetchVerified(request.vectorsUrl, request.vectorsSha256, 'vectors'),
    fetchVerified(ortWasmUrl, ORT_WASM_SHA256, 'ORT WASM'),
  ]);
  if (vectorBytes.byteLength !== request.boardCount * TILE_VALUES_PER_BOARD * 4) {
    throw new HarnessError('schema', 'vector byte length does not match [boards,64,1024] fp32');
  }
  const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders: ['wasm'],
  });
  if (
    session.inputNames.length !== 1 ||
    session.inputNames[0] !== 'tiles' ||
    session.outputNames.length !== 1 ||
    session.outputNames[0] !== 'probs'
  ) {
    await session.release();
    throw new HarnessError('schema', 'model must expose only tiles input and probs output');
  }
  runtime = {
    session,
    vectors: new Float32Array(vectorBytes),
    boardCount: request.boardCount,
    modelSha256: await sha256(modelBytes),
    runtimeSha256: await sha256(runtimeBytes),
  };
  busyRequestId = null;
  scope.postMessage({
    type: 'ready',
    requestId: request.requestId,
    initializationMs: performance.now() - started,
    modelSha256: runtime.modelSha256,
    runtimeSha256: runtime.runtimeSha256,
  });
}

function classify(probabilities: Float32Array): { classes: number[]; confidences: number[] } {
  if (probabilities.length !== OUTPUT_VALUES_PER_BOARD) {
    throw new HarnessError('schema', 'probs output must have shape [64,13]');
  }
  const classes: number[] = [];
  const confidences: number[] = [];
  for (let square = 0; square < 64; square += 1) {
    let bestClass = 0;
    let best = -Infinity;
    let sum = 0;
    for (let label = 0; label < 13; label += 1) {
      const value = probabilities[square * 13 + label];
      if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new HarnessError('schema', 'probs output contains an invalid probability');
      }
      sum += value;
      if (value > best) {
        best = value;
        bestClass = label;
      }
    }
    if (Math.abs(sum - 1) > 1e-3) {
      throw new HarnessError('schema', 'probs output is not a probability distribution');
    }
    classes.push(bestClass);
    confidences.push(best);
  }
  return { classes, confidences };
}

function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function run(requestId: number, boardIndexes: readonly number[]): Promise<void> {
  const active = runtime;
  if (!active || busyRequestId !== null) throw new HarnessError('runtime', 'worker is not ready');
  if (boardIndexes.some((index) => index < 0 || index >= active.boardCount)) {
    throw new HarnessError('schema', 'board index is outside the frozen vector set');
  }
  busyRequestId = requestId;
  const classes: number[] = [];
  const confidences: number[] = [];
  const inferenceMs: number[] = [];
  for (let completed = 0; completed < boardIndexes.length; completed += 1) {
    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      busyRequestId = null;
      scope.postMessage({ type: 'cancelled', requestId, completedBoards: completed });
      return;
    }
    const boardIndex = boardIndexes[completed];
    if (boardIndex === undefined) throw new HarnessError('schema', 'missing board index');
    const offset = boardIndex * TILE_VALUES_PER_BOARD;
    const inputs = active.vectors.subarray(offset, offset + TILE_VALUES_PER_BOARD);
    const started = performance.now();
    const output = await active.session.run({
      tiles: new ort.Tensor('float32', inputs, [64, 1024]),
    });
    inferenceMs.push(performance.now() - started);
    const probs = output.probs;
    if (
      !probs ||
      !(probs.data instanceof Float32Array) ||
      probs.dims.length !== 2 ||
      probs.dims[0] !== 64 ||
      probs.dims[1] !== 13
    ) {
      throw new HarnessError('schema', 'probs output must be fp32 [64,13]');
    }
    const prediction = classify(probs.data);
    classes.push(...prediction.classes);
    confidences.push(...prediction.confidences);
    scope.postMessage({ type: 'progress', requestId, completedBoards: completed + 1 });
    await yieldToMessages();
  }
  busyRequestId = null;
  scope.postMessage({ type: 'result', requestId, boardIndexes, classes, confidences, inferenceMs });
}

function safeError(requestId: number, error: unknown): void {
  busyRequestId = null;
  const code = error instanceof HarnessError ? error.code : 'runtime';
  const detail =
    error instanceof HarnessError
      ? error.message
      : error instanceof Error
        ? `${error.name || 'Error'}: ${error.message.replaceAll(/https?:\/\/\S+/g, '<url>').slice(0, 300)}`
        : 'UnknownError';
  scope.postMessage({ type: 'error', requestId, code, message: `${code}: ${detail}` });
}

scope.onmessage = (event): void => {
  const data = event.data;
  if (!isWorkerRequest(data)) {
    scope.postMessage({
      type: 'error',
      requestId: 0,
      code: 'invalid-message',
      message: 'invalid-message',
    });
    return;
  }
  if (data.type === 'cancel') {
    cancelled.add(data.requestId);
    return;
  }
  if (data.type === 'test-hang') return;
  if (data.type === 'dispose') {
    const active = runtime;
    runtime = null;
    busyRequestId = null;
    void active?.session.release().finally(() => {
      scope.postMessage({ type: 'disposed', requestId: data.requestId });
    });
    return;
  }
  const work =
    data.type === 'initialize' ? initialize(data) : run(data.requestId, data.boardIndexes);
  void work.catch((error: unknown) => {
    safeError(data.requestId, error);
  });
};
