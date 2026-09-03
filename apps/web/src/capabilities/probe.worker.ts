/**
 * Minimal module worker used only to prove that a real worker round trip
 * works (creation, message post, and reply) and whether WebAssembly is
 * usable from inside a worker. It never touches book content or user data.
 */

interface ProbePingMessage {
  readonly type: 'ping';
  readonly nonce: string;
}

function isProbePingMessage(data: unknown): data is ProbePingMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return candidate['type'] === 'ping' && typeof candidate['nonce'] === 'string';
}

/** The smallest possible valid WebAssembly module: `(module)`. */
const MINIMAL_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function detectWasm(): boolean {
  try {
    if (typeof WebAssembly === 'undefined') {
      return false;
    }
    return WebAssembly.validate(MINIMAL_WASM_MODULE);
  } catch {
    return false;
  }
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isProbePingMessage(data)) {
    return;
  }
  workerScope.postMessage({ type: 'pong', nonce: data.nonce, wasm: detectWasm() });
});
