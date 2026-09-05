/** Browser canvas/worker boundary for the issue #34 observation harness. */
import {
  isCorpusWorkerResponse,
  type CorpusBrowserRun,
  type CorpusCandidate,
  type CorpusWorkerMessage,
  type CorpusWorkerRequest,
  type CorpusWorkerResponse,
  type PixelRect,
} from './corpus.protocol';

const WORKER_TIMEOUT_MS = 60_000;

interface CorpusPageSource {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

interface CorpusRunRequest {
  readonly inputId: string;
  readonly candidate: CorpusCandidate;
  readonly mode: 'classifier' | 'recognizer';
  readonly cropRect: PixelRect;
}

export interface CorpusHarness {
  loadPage(source: CorpusPageSource): Promise<void>;
  startPass(): void;
  run(request: CorpusRunRequest): Promise<CorpusBrowserRun>;
  endPass(): Promise<void>;
}

let sourceCanvas: HTMLCanvasElement | null = null;
let corpusWorker: Worker | null = null;
let workerFailed = false;
let requestPending = false;

function validCrop(rect: PixelRect, canvas: HTMLCanvasElement): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= canvas.width &&
    rect.y + rect.height <= canvas.height
  );
}

async function loadPage(source: CorpusPageSource): Promise<void> {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Corpus page request failed with HTTP ${String(response.status)}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (bitmap.width !== source.width || bitmap.height !== source.height) {
      throw new Error(
        `Decoded corpus page dimensions ${String(bitmap.width)}x${String(bitmap.height)} do not match manifest`,
      );
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Browser canvas 2D context unavailable');
    context.drawImage(bitmap, 0, 0);
    sourceCanvas = canvas;
  } finally {
    bitmap.close();
  }
}

function startPass(): void {
  if (corpusWorker) throw new Error('A corpus worker pass is already active');
  corpusWorker = new Worker(new URL('./corpus.worker.ts', import.meta.url), { type: 'module' });
  workerFailed = false;
}

async function sendToWorker(
  message: CorpusWorkerMessage,
  transfer: Transferable[] = [],
): Promise<CorpusWorkerResponse> {
  const worker = corpusWorker;
  if (!worker) throw new Error('Start a corpus worker pass before sending an input');
  if (workerFailed) throw new Error('The active corpus worker has already failed');
  if (requestPending) throw new Error('Corpus worker inputs must be processed sequentially');
  requestPending = true;
  try {
    return await new Promise<CorpusWorkerResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        workerFailed = true;
        reject(new Error(`Corpus worker timed out after ${String(WORKER_TIMEOUT_MS)}ms`));
      }, WORKER_TIMEOUT_MS);
      worker.onerror = (event): void => {
        window.clearTimeout(timeout);
        workerFailed = true;
        reject(new Error(`Corpus worker crashed: ${event.message || 'unknown error'}`));
      };
      worker.onmessage = (event: MessageEvent<unknown>): void => {
        window.clearTimeout(timeout);
        if (!isCorpusWorkerResponse(event.data)) {
          workerFailed = true;
          reject(new Error('Corpus worker returned a malformed response'));
          return;
        }
        if (event.data.inputId !== message.inputId) {
          workerFailed = true;
          reject(new Error('Corpus worker returned a response for the wrong input'));
          return;
        }
        if (
          event.data.type === 'result' &&
          (message.type !== 'run' || event.data.candidate !== message.candidate)
        ) {
          workerFailed = true;
          reject(new Error('Corpus worker returned a result for the wrong candidate'));
          return;
        }
        if (event.data.type === 'infrastructure-error') {
          workerFailed = true;
          reject(new Error(event.data.message));
          return;
        }
        resolve(event.data);
      };
      worker.postMessage(message, transfer);
    });
  } finally {
    requestPending = false;
  }
}

async function run(request: CorpusRunRequest): Promise<CorpusBrowserRun> {
  const canvas = sourceCanvas;
  if (!canvas) throw new Error('Load a corpus page before running recognition');
  if (!validCrop(request.cropRect, canvas)) throw new Error('Invalid corpus crop rectangle');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Browser canvas 2D context unavailable');
  const pixels = context.getImageData(
    request.cropRect.x,
    request.cropRect.y,
    request.cropRect.width,
    request.cropRect.height,
  );
  const started = performance.now();
  const message: CorpusWorkerRequest = {
    type: 'run',
    inputId: request.inputId,
    candidate: request.candidate,
    mode: request.mode,
    width: pixels.width,
    height: pixels.height,
    data: pixels.data,
  };
  const response = await sendToWorker(message, [pixels.data.buffer]);
  if (response.type !== 'result') {
    workerFailed = true;
    throw new Error('Corpus worker returned a non-result for a recognition input');
  }
  return {
    inputId: request.inputId,
    cropRect: request.cropRect,
    width: pixels.width,
    height: pixels.height,
    workerTotalMs: performance.now() - started,
    result: response,
  };
}

async function endPass(): Promise<void> {
  const worker = corpusWorker;
  if (!worker) throw new Error('No corpus worker pass is active');
  try {
    if (!workerFailed) {
      const response = await sendToWorker({ type: 'dispose', inputId: 'dispose' });
      if (response.type !== 'disposed') {
        throw new Error('Corpus worker did not acknowledge disposal');
      }
    }
  } finally {
    worker.terminate();
    corpusWorker = null;
    workerFailed = false;
    requestPending = false;
  }
}

globalThis.__chessReaderCorpus = { loadPage, startPass, run, endPass } satisfies CorpusHarness;

declare global {
  // The Playwright driver talks only through this narrow, structured boundary.
  var __chessReaderCorpus: CorpusHarness;
}
