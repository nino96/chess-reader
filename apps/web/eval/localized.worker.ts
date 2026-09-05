/**
 * Dedicated module worker bootstrap. All behavior lives in `workerCore.ts`
 * (unit-tested without ONNX Runtime or a real worker); this file only wires
 * the real browser/ONNX Runtime APIs into it. Runs off the main thread per
 * AGENTS.md ("keep recognition off the main thread").
 */
import { modelUrl, ortWasmUrl } from '../src/recognition/assets';
import { createWorkerCore, type InferenceSessionLike } from '../src/recognition/workerCore';

import { runLocalizedSelection } from './localizedPipeline';
import { LOCALIZATION_VERSION } from '../src/recognition/experimentalLocalization';
import { RECOGNIZER_VERSION } from '../src/recognition/assets';

import type * as OrtWasm from 'onnxruntime-web/wasm';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

// The VALUE import below stays dynamic (lazy-loaded only on first recognize)
// so a page that never scans never pays ONNX Runtime's load cost; the TYPE
// import above is static because type-only imports are erased entirely at
// compile time and carry no runtime cost of their own.
let ortImport: Promise<typeof OrtWasm> | undefined;

function loadOrt(): Promise<typeof OrtWasm> {
  ortImport ??= import('onnxruntime-web/wasm').then((ort) => {
    // Single-threaded, non-proxied: this app does not send
    // Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy support as a
    // hard requirement for recognition, so SharedArrayBuffer-based
    // multi-threading cannot be assumed (docs/platform-limitations.md §5).
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
    return ort;
  });
  return ortImport;
}

const core = createWorkerCore({
  recognize: runLocalizedSelection,
  recognizerVersion: `${RECOGNIZER_VERSION}/${LOCALIZATION_VERSION}`,
  fetchModel: async () => {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`model fetch failed: HTTP ${String(response.status)}`);
    }
    return response.arrayBuffer();
  },
  digest: (data) => crypto.subtle.digest('SHA-256', data),
  createSession: async (modelBytes): Promise<InferenceSessionLike> => {
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
    return {
      run: async (tiles) => {
        const output = await session.run({ tiles: new ort.Tensor('float32', tiles, [64, 1024]) });
        const probsTensor = output['probs'];
        if (!probsTensor) {
          throw new Error('model output missing "probs" tensor');
        }
        if (!(probsTensor.data instanceof Float32Array)) {
          throw new Error('model output has an unexpected type');
        }
        return probsTensor.data;
      },
    };
  },
  post: (message, transfer) => {
    if (transfer && transfer.length > 0) {
      workerScope.postMessage(message, transfer as Transferable[]);
    } else {
      workerScope.postMessage(message);
    }
  },
});

workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
  core.handleMessage(event.data);
});
