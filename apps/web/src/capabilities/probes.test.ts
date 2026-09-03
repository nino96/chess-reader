import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatBytes,
  probeCapabilities,
  requestPersistentStorage,
  type CapabilityReport,
  type ProbeEnvironment,
} from './probes';

class FakeIDBRequest extends EventTarget {
  result: { createObjectStore: (name: string) => void; close: () => void } = {
    createObjectStore: () => undefined,
    close: () => undefined,
  };
  error: Error | null = null;
}

function createSucceedingIndexedDb(): IDBFactory {
  const open = (): FakeIDBRequest => {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      request.dispatchEvent(new Event('upgradeneeded'));
      request.dispatchEvent(new Event('success'));
    });
    return request;
  };
  const deleteDatabase = (): FakeIDBRequest => {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      request.dispatchEvent(new Event('success'));
    });
    return request;
  };
  return { open, deleteDatabase } as unknown as IDBFactory;
}

function createFailingIndexedDb(): IDBFactory {
  const open = (): FakeIDBRequest => {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      request.error = new Error('InvalidStateError');
      request.dispatchEvent(new Event('error'));
    });
    return request;
  };
  const deleteDatabase = (): FakeIDBRequest => {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      request.dispatchEvent(new Event('success'));
    });
    return request;
  };
  return { open, deleteDatabase } as unknown as IDBFactory;
}

class FakeWorker extends EventTarget {
  terminated = false;
  posted: unknown[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** A `ProbeEnvironment` with every capability missing; tests layer overrides on top. */
function baseEnvironment(): ProbeEnvironment {
  return {
    indexedDB: undefined,
    storage: undefined,
    maxTouchPoints: undefined,
    matchMedia: undefined,
    webAssembly: undefined,
    crossOriginIsolated: undefined,
    hasSharedArrayBuffer: false,
    createProbeWorker: undefined,
    now: () => 0,
  };
}

function findReport(
  reports: readonly CapabilityReport[],
  id: CapabilityReport['id'],
): CapabilityReport {
  const report = reports.find((candidate) => candidate.id === id);
  if (!report) {
    throw new Error(`missing report for ${id}`);
  }
  return report;
}

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats whole bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('formats gigabytes with one decimal', () => {
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });

  it('reports unknown for negative or non-finite input', () => {
    expect(formatBytes(-5)).toBe('unknown');
    expect(formatBytes(Number.NaN)).toBe('unknown');
  });
});

describe('probeCapabilities: indexeddb', () => {
  it('reports unsupported when indexedDB is missing', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'indexeddb').status).toBe('unsupported');
  });

  it('reports supported when open/delete succeed', async () => {
    const env = { ...baseEnvironment(), indexedDB: createSucceedingIndexedDb() };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'indexeddb').status).toBe('supported');
  });

  it('reports error when open fails (e.g. private mode)', async () => {
    const env = { ...baseEnvironment(), indexedDB: createFailingIndexedDb() };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    const report = findReport(reports, 'indexeddb');
    expect(report.status).toBe('error');
    expect(report.detail).toContain('InvalidStateError');
  });
});

describe('probeCapabilities: opfs', () => {
  it('reports unsupported when getDirectory is missing', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'opfs').status).toBe('unsupported');
  });

  it('reports supported when getDirectory resolves', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: () => Promise.resolve({}),
        estimate: undefined,
        persisted: undefined,
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'opfs').status).toBe('supported');
  });

  it('reports error when getDirectory rejects', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: () => Promise.reject(new Error('SecurityError')),
        estimate: undefined,
        persisted: undefined,
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    const report = findReport(reports, 'opfs');
    expect(report.status).toBe('error');
    expect(report.detail).toContain('SecurityError');
  });
});

describe('probeCapabilities: webassembly', () => {
  it('reports unsupported when WebAssembly is missing', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'webassembly').status).toBe('unsupported');
  });

  it('reports supported when validate/instantiate succeed', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      webAssembly: { validate: () => true, instantiate: () => Promise.resolve({}) },
      hasSharedArrayBuffer: true,
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    const report = findReport(reports, 'webassembly');
    expect(report.status).toBe('supported');
    expect(report.detail).toContain('SharedArrayBuffer is available');
  });

  it('reports error when instantiate throws', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      webAssembly: {
        validate: () => true,
        instantiate: () => Promise.reject(new Error('CompileError')),
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    const report = findReport(reports, 'webassembly');
    expect(report.status).toBe('error');
    expect(report.detail).toContain('CompileError');
  });
});

describe('probeCapabilities: storage-estimate', () => {
  it('reports unsupported when estimate is missing', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'storage-estimate').status).toBe('unsupported');
  });

  it('reports supported with formatted usage/quota', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: () => Promise.resolve({ usage: 1258291, quota: 5 * 1024 ** 3 }),
        persisted: undefined,
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    const report = findReport(reports, 'storage-estimate');
    expect(report.status).toBe('supported');
    expect(report.detail).toContain('5.0 GB');
  });

  it('reports error when estimate throws', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: () => Promise.reject(new Error('boom')),
        persisted: undefined,
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'storage-estimate').status).toBe('error');
  });
});

describe('probeCapabilities: storage-persistence', () => {
  it('reports unknown when persisted is missing', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'storage-persistence').status).toBe('unknown');
  });

  it('reports supported when persisted() is true', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: undefined,
        persisted: () => Promise.resolve(true),
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'storage-persistence').status).toBe('supported');
  });

  it('reports unsupported when persisted() is false', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: undefined,
        persisted: () => Promise.resolve(false),
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'storage-persistence').status).toBe('unsupported');
  });

  it('reports error when persisted() throws', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: undefined,
        persisted: () => Promise.reject(new Error('boom')),
        persist: undefined,
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'storage-persistence').status).toBe('error');
  });
});

describe('probeCapabilities: touch', () => {
  it('reports unsupported when there is no touch/coarse pointer signal', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'touch').status).toBe('unsupported');
  });

  it('reports supported via maxTouchPoints', async () => {
    const env: ProbeEnvironment = { ...baseEnvironment(), maxTouchPoints: 5 };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'touch').status).toBe('supported');
  });

  it('reports supported via a coarse pointer media query', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      matchMedia: () => ({ matches: true }),
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'touch').status).toBe('supported');
  });

  it('reports error when matchMedia throws', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      matchMedia: () => {
        throw new Error('boom');
      },
    };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'touch').status).toBe('error');
  });
});

describe('probeCapabilities: cross-origin-isolation', () => {
  it('reports unknown when crossOriginIsolated is undefined', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'cross-origin-isolation').status).toBe('unknown');
  });

  it('reports supported when crossOriginIsolated is true', async () => {
    const env: ProbeEnvironment = { ...baseEnvironment(), crossOriginIsolated: true };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    expect(findReport(reports, 'cross-origin-isolation').status).toBe('supported');
  });

  it('reports unsupported when crossOriginIsolated is false', async () => {
    const env: ProbeEnvironment = { ...baseEnvironment(), crossOriginIsolated: false };
    const reports = await probeCapabilities(env, { timeoutMs: 50 });
    const report = findReport(reports, 'cross-origin-isolation');
    expect(report.status).toBe('unsupported');
    expect(report.detail).toContain('COOP');
  });
});

describe('probeCapabilities: workers', () => {
  it('reports unsupported when no worker factory is provided', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(findReport(reports, 'workers').status).toBe('unsupported');
  });

  it('reports supported on a real echo round trip', async () => {
    let worker: FakeWorker | undefined;
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      createProbeWorker: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };

    const promise = probeCapabilities(env, { timeoutMs: 1000 });
    await vi.waitFor(() => {
      expect(worker?.posted.length).toBe(1);
    });
    const nonce = (worker?.posted[0] as { nonce: string }).nonce;
    worker?.dispatchEvent(
      new MessageEvent('message', { data: { type: 'pong', nonce, wasm: true } }),
    );

    const reports = await promise;
    expect(findReport(reports, 'workers').status).toBe('supported');
  });

  it('ignores a wrong-shape reply and resolves on the matching one', async () => {
    let worker: FakeWorker | undefined;
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      createProbeWorker: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };

    const promise = probeCapabilities(env, { timeoutMs: 1000 });
    await vi.waitFor(() => {
      expect(worker?.posted.length).toBe(1);
    });
    const nonce = (worker?.posted[0] as { nonce: string }).nonce;

    worker?.dispatchEvent(new MessageEvent('message', { data: { type: 'pong' } }));
    worker?.dispatchEvent(
      new MessageEvent('message', { data: { type: 'pong', nonce: 'wrong', wasm: true } }),
    );
    worker?.dispatchEvent(
      new MessageEvent('message', { data: { type: 'pong', nonce, wasm: true } }),
    );

    const reports = await promise;
    expect(findReport(reports, 'workers').status).toBe('supported');
  });

  it('reports error with "did not respond" when the worker never replies', async () => {
    vi.useFakeTimers();
    try {
      const env: ProbeEnvironment = {
        ...baseEnvironment(),
        createProbeWorker: () => new FakeWorker() as unknown as Worker,
      };

      const promise = probeCapabilities(env, { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(150);
      const reports = await promise;
      const report = findReport(reports, 'workers');
      expect(report.status).toBe('error');
      expect(report.detail).toContain('did not respond');
    } finally {
      vi.useRealTimers();
    }
  });

  it('terminates the worker and rejects the whole run on abort', async () => {
    let worker: FakeWorker | undefined;
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      createProbeWorker: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };
    const controller = new AbortController();

    const promise = probeCapabilities(env, { timeoutMs: 5000, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker?.terminated).toBe(true);
  });

  it('rejects immediately when called with an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      probeCapabilities(baseEnvironment(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('requestPersistentStorage', () => {
  it('reports unknown when persist() is unavailable', async () => {
    const report = await requestPersistentStorage(baseEnvironment());
    expect(report.status).toBe('unknown');
  });

  it('re-probes persistence after a successful persist() call', async () => {
    let persistedValue = false;
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: undefined,
        persisted: () => Promise.resolve(persistedValue),
        persist: () => {
          persistedValue = true;
          return Promise.resolve(true);
        },
      },
    };
    const report = await requestPersistentStorage(env);
    expect(report.status).toBe('supported');
  });

  it('reports error when persist() rejects', async () => {
    const env: ProbeEnvironment = {
      ...baseEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: undefined,
        persisted: () => Promise.resolve(false),
        persist: () => Promise.reject(new Error('denied')),
      },
    };
    const report = await requestPersistentStorage(env);
    expect(report.status).toBe('error');
  });
});

describe('probeCapabilities: full run', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves all 8 capability reports', async () => {
    const reports = await probeCapabilities(baseEnvironment(), { timeoutMs: 50 });
    expect(reports).toHaveLength(8);
    const ids = new Set(reports.map((report) => report.id));
    expect(ids.size).toBe(8);
  });
});
