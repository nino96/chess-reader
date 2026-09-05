/// <reference types="vite/client" />

/**
 * Evaluation-only real-model worker for issues #34/#35. Exact crops always
 * call the unchanged classifier. Manual and full-page inputs explicitly select
 * either unchanged FENShot or the bounded localization candidate.
 */
import {
  extractTiles,
  probsToPlacement,
  recognizeGray,
  resolveOrientation,
  rgbaToGray,
  type BoardCorners,
  type GrayImage,
  type RecognitionResult,
} from '@scoriiu/fenshot';
import * as ort from 'onnxruntime-web/wasm';

import { MODEL_SHA256, ORT_WASM_SHA256, modelUrl, ortWasmUrl } from '../src/recognition/assets';
import {
  isCorpusWorkerRequest,
  MAX_CORPUS_PREDICTIONS,
  type CorpusWorkerPrediction,
  type CorpusWorkerResponse,
} from './corpus.protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: CorpusWorkerResponse): void;
}

interface WorkerRuntime {
  readonly session: ort.InferenceSession;
  readonly modelSha256: string;
  readonly runtimeSha256: string;
}

class CorpusInfrastructureError extends Error {
  constructor(
    readonly code: 'asset-fetch' | 'asset-integrity',
    message: string,
  ) {
    super(message);
    this.name = 'CorpusInfrastructureError';
  }
}

const workerScope = globalThis as unknown as WorkerScope;
let runtimePromise: Promise<WorkerRuntime> | null = null;
let busy = false;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchVerified(url: string, expected: string, label: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new CorpusInfrastructureError(
      'asset-fetch',
      `${label} fetch failed with HTTP ${String(response.status)}`,
    );
  }
  const bytes = await response.arrayBuffer();
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    throw new CorpusInfrastructureError(
      'asset-integrity',
      `${label} hash mismatch: expected ${expected}, got ${actual}`,
    );
  }
  return bytes;
}

function safeFailure(error: unknown): string {
  if (error instanceof CorpusInfrastructureError) return `${error.code}: ${error.message}`;
  const name = error instanceof Error && error.name ? error.name : 'UnknownError';
  return `runtime: recognition harness failed (${name})`;
}

function toPrediction(read: RecognitionResult, corners: BoardCorners): CorpusWorkerPrediction {
  return {
    corners,
    placement: read.placement,
    confidences: read.confidences,
    minConfidence: read.minConfidence,
    meanConfidence: read.meanConfidence,
    orientation: resolveOrientation(read.placement).orientation,
    // The pinned upstream API always proposes white/black and cannot abstain.
    orientationAmbiguous: false,
  };
}

async function runClassifier(
  session: ort.InferenceSession,
  gray: GrayImage,
  corners: BoardCorners,
): Promise<RecognitionResult> {
  const output = await session.run({
    tiles: new ort.Tensor('float32', extractTiles(gray, corners), [64, 1024]),
  });
  const probabilities = output['probs']?.data;
  if (!(probabilities instanceof Float32Array)) {
    throw new Error('ClassifierOutputTypeError');
  }
  return probsToPlacement(probabilities);
}

async function initialize(): Promise<WorkerRuntime> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  const [modelBytes, runtimeBytes] = await Promise.all([
    fetchVerified(modelUrl, MODEL_SHA256, 'recognition model'),
    fetchVerified(ortWasmUrl, ORT_WASM_SHA256, 'ONNX WASM runtime'),
  ]);
  const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders: ['wasm'],
  });
  return {
    session,
    modelSha256: await sha256Hex(modelBytes),
    runtimeSha256: await sha256Hex(runtimeBytes),
  };
}

async function getRuntime(): Promise<{ runtime: WorkerRuntime; initializationMs: number | null }> {
  if (runtimePromise) return { runtime: await runtimePromise, initializationMs: null };
  const started = performance.now();
  runtimePromise = initialize().catch((error: unknown) => {
    runtimePromise = null;
    throw error;
  });
  const runtime = await runtimePromise;
  return { runtime, initializationMs: performance.now() - started };
}

async function processMessage(data: unknown): Promise<void> {
  const inputId =
    typeof data === 'object' &&
    data !== null &&
    'inputId' in data &&
    typeof data.inputId === 'string'
      ? data.inputId
      : 'invalid';
  if (!isCorpusWorkerRequest(data)) {
    workerScope.postMessage({
      type: 'infrastructure-error',
      inputId,
      message: 'invalid-message: invalid corpus worker request',
    });
    return;
  }
  if (busy) {
    workerScope.postMessage({
      type: 'infrastructure-error',
      inputId,
      message: 'concurrent-input: corpus worker accepts one input at a time',
    });
    return;
  }
  busy = true;
  try {
    if (data.type === 'dispose') {
      if (runtimePromise) await (await runtimePromise).session.release();
      runtimePromise = null;
      workerScope.postMessage({ type: 'disposed', inputId: 'dispose' });
      return;
    }

    const { runtime, initializationMs } = await getRuntime();
    const gray = rgbaToGray(data.data, data.width, data.height);
    const fullCorners: BoardCorners = { x0: 0, y0: 0, x1: data.width, y1: data.height };
    const recognitionStart = performance.now();
    const predictions: CorpusWorkerPrediction[] = [];
    if (data.mode === 'classifier') {
      const read = await runClassifier(runtime.session, gray, fullCorners);
      predictions.push(toPrediction(read, fullCorners));
    } else if (data.candidate === 'upstream') {
      const scan = await recognizeGray(gray, (corners) =>
        runClassifier(runtime.session, gray, corners),
      );
      if (scan) predictions.push(toPrediction(scan, scan.corners));
    } else {
      const { recognizeLocalized } = await import('../src/recognition/experimentalLocalization');
      const scans = await recognizeLocalized(gray, (corners) =>
        runClassifier(runtime.session, gray, corners),
      );
      if (scans.length > MAX_CORPUS_PREDICTIONS) {
        throw new Error('CandidateOutputBoundError');
      }
      predictions.push(...scans.map((scan) => toPrediction(scan, scan.corners)));
    }
    workerScope.postMessage({
      type: 'result',
      inputId: data.inputId,
      candidate: data.candidate,
      predictions,
      initializationMs,
      recognitionMs: performance.now() - recognitionStart,
      modelSha256: runtime.modelSha256,
      runtimeSha256: runtime.runtimeSha256,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'infrastructure-error',
      inputId,
      message: safeFailure(error),
    });
  } finally {
    busy = false;
  }
}

workerScope.onmessage = (event): void => {
  void processMessage(event.data);
};
