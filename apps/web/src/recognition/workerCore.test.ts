import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MODEL_SHA256 } from './assets';
import { type InferenceSessionLike, type WorkerCoreDeps, createWorkerCore } from './workerCore';
import { type WorkerResponseMessage } from './protocol';

function textToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Fake SHA-256: returns a fixed digest for a fixed input, distinguishing
 *  "the pinned model bytes" (hash matches MODEL_SHA256) from anything else. */
function fakeDigestMatching(expectedHex: string): (data: ArrayBuffer) => Promise<ArrayBuffer> {
  return (data: ArrayBuffer) => {
    const marker = new TextDecoder().decode(data);
    const hex = marker === 'pinned-model-bytes' ? expectedHex : '0'.repeat(64);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return Promise.resolve(bytes.buffer);
  };
}

function createFlatRegionBytes(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(128);
}

/** A trivial session whose `run` never gets called because a flat region
 *  never reaches classification (no board is detected). */
function createUnusedSession(): InferenceSessionLike {
  return {
    run: () => Promise.reject(new Error('session.run should not be called for a flat region')),
  };
}

describe('workerCore', () => {
  let posted: WorkerResponseMessage[];
  let deps: WorkerCoreDeps;
  let createSessionCalls: number;
  let now: number;

  beforeEach(() => {
    posted = [];
    createSessionCalls = 0;
    now = 0;
    deps = {
      fetchModel: () => Promise.resolve(textToArrayBuffer('pinned-model-bytes')),
      digest: fakeDigestMatching(MODEL_SHA256),
      createSession: () => {
        createSessionCalls += 1;
        return Promise.resolve(createUnusedSession());
      },
      post: (message) => {
        posted.push(message);
      },
      now: () => now,
    };
  });

  it('fails closed on a model hash mismatch and never creates a session', async () => {
    deps = { ...deps, digest: () => Promise.resolve(new Uint8Array(32).buffer) };
    const core = createWorkerCore(deps);

    core.handleMessage({
      type: 'recognize',
      requestId: 1,
      width: 8,
      height: 8,
      data: createFlatRegionBytes(8, 8),
    });
    await vi.waitFor(() => {
      expect(posted).toHaveLength(2); // loading-model phase + error
    });

    expect(createSessionCalls).toBe(0);
    const errorMessage = posted[1];
    expect(errorMessage?.type).toBe('error');
    if (errorMessage?.type === 'error') {
      expect(errorMessage.code).toBe('asset-integrity');
    }
  });

  it('reports coldStart true on the first request and false on a later one', async () => {
    const core = createWorkerCore(deps);

    core.handleMessage({
      type: 'recognize',
      requestId: 1,
      width: 8,
      height: 8,
      data: createFlatRegionBytes(8, 8),
    });
    await vi.waitFor(() => {
      expect(posted.some((m) => m.type === 'result')).toBe(true);
    });
    const first = posted.find((m) => m.type === 'result');
    expect(first?.type).toBe('result');
    if (first?.type === 'result') {
      expect(first.coldStart).toBe(true);
      expect(first.outcome).toEqual({ kind: 'no-board' });
    }

    posted = [];
    core.handleMessage({
      type: 'recognize',
      requestId: 2,
      width: 8,
      height: 8,
      data: createFlatRegionBytes(8, 8),
    });
    await vi.waitFor(() => {
      expect(posted.some((m) => m.type === 'result')).toBe(true);
    });
    const second = posted.find((m) => m.type === 'result');
    expect(second?.type).toBe('result');
    if (second?.type === 'result') {
      expect(second.coldStart).toBe(false);
    }
    expect(createSessionCalls).toBe(1); // session is cached, only built once
  });

  it('drops the result for a cancelled request instead of posting it', async () => {
    const core = createWorkerCore(deps);

    core.handleMessage({
      type: 'recognize',
      requestId: 7,
      width: 8,
      height: 8,
      data: createFlatRegionBytes(8, 8),
    });
    core.handleMessage({ type: 'cancel', requestId: 7 });

    // Give any pending microtasks/timers a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      posted.some((m) => m.requestId === 7 && (m.type === 'result' || m.type === 'error')),
    ).toBe(false);
  });

  it('maps an unexpected exception to a sanitized runtime-failure error', async () => {
    deps = {
      ...deps,
      createSession: () => Promise.reject(new Error('boom: secret detail')),
    };
    const core = createWorkerCore(deps);

    core.handleMessage({
      type: 'recognize',
      requestId: 3,
      width: 8,
      height: 8,
      data: createFlatRegionBytes(8, 8),
    });
    await vi.waitFor(() => {
      expect(posted.some((m) => m.type === 'error')).toBe(true);
    });
    const errorMessage = posted.find((m) => m.type === 'error');
    expect(errorMessage?.type).toBe('error');
    if (errorMessage?.type === 'error') {
      expect(errorMessage.code).toBe('runtime-failure');
      expect(errorMessage.message).toContain('boom: secret detail');
    }
  });

  it('ignores a malformed message instead of throwing', () => {
    const core = createWorkerCore(deps);
    expect(() => {
      core.handleMessage({ nonsense: true });
    }).not.toThrow();
    expect(posted).toHaveLength(0);
  });
});
