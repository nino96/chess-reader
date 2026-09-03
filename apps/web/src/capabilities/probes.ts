/**
 * Pure, testable capability probes. Every check runs against an injected
 * `ProbeEnvironment` rather than reading global browser state directly, so
 * probe semantics can be unit tested without a real browser and so no probe
 * ever depends on a user-agent or browser-name check.
 */

export type CapabilityId =
  | 'indexeddb'
  | 'opfs'
  | 'workers'
  | 'webassembly'
  | 'storage-estimate'
  | 'storage-persistence'
  | 'touch'
  | 'cross-origin-isolation';

export const CAPABILITY_IDS: readonly CapabilityId[] = [
  'indexeddb',
  'opfs',
  'workers',
  'webassembly',
  'storage-estimate',
  'storage-persistence',
  'touch',
  'cross-origin-isolation',
] as const;

/** Human-readable label for each capability, also shown before a probe completes. */
export const CAPABILITY_LABELS: Readonly<Record<CapabilityId, string>> = {
  indexeddb: 'IndexedDB',
  opfs: 'Origin Private File System',
  workers: 'Module workers',
  webassembly: 'WebAssembly',
  'storage-estimate': 'Storage estimate',
  'storage-persistence': 'Storage persistence',
  touch: 'Touch input',
  'cross-origin-isolation': 'Cross-origin isolation',
};

export type CapabilityStatus = 'supported' | 'unsupported' | 'unknown' | 'error';

export interface CapabilityReport {
  readonly id: CapabilityId;
  readonly label: string;
  readonly status: CapabilityStatus;
  readonly detail: string;
}

export interface StorageEstimateLike {
  readonly usage: number | undefined;
  readonly quota: number | undefined;
}

export interface ProbeStorageManager {
  readonly getDirectory: (() => Promise<unknown>) | undefined;
  readonly estimate: (() => Promise<StorageEstimateLike>) | undefined;
  readonly persisted: (() => Promise<boolean>) | undefined;
  readonly persist: (() => Promise<boolean>) | undefined;
}

export interface ProbeWebAssembly {
  readonly validate: (bytes: Uint8Array<ArrayBuffer>) => boolean;
  readonly instantiate: (bytes: Uint8Array<ArrayBuffer>) => Promise<unknown>;
}

/**
 * A minimal injectable view of the globals each probe needs. Every field is
 * required but nullable, so a fake environment must be explicit about which
 * APIs it does and does not provide rather than silently inheriting `jsdom`
 * or Node globals.
 */
export interface ProbeEnvironment {
  readonly indexedDB: IDBFactory | undefined;
  readonly storage: ProbeStorageManager | undefined;
  readonly maxTouchPoints: number | undefined;
  readonly matchMedia: ((query: string) => { readonly matches: boolean }) | undefined;
  readonly webAssembly: ProbeWebAssembly | undefined;
  readonly crossOriginIsolated: boolean | undefined;
  readonly hasSharedArrayBuffer: boolean;
  readonly createProbeWorker: (() => Worker) | undefined;
  readonly now: () => number;
}

export interface ProbePongMessage {
  readonly type: 'pong';
  readonly nonce: string;
  readonly wasm: boolean;
}

export function isProbePongMessage(data: unknown): data is ProbePongMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return (
    candidate['type'] === 'pong' &&
    typeof candidate['nonce'] === 'string' &&
    typeof candidate['wasm'] === 'boolean'
  );
}

const DEFAULT_TIMEOUT_MS = 3000;

/** The smallest possible valid WebAssembly module: `(module)`. */
const MINIMAL_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export function createBrowserProbeEnvironment(): ProbeEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const storageManager = nav?.storage;

  return {
    indexedDB: typeof indexedDB === 'undefined' ? undefined : indexedDB,
    storage: storageManager
      ? {
          getDirectory:
            typeof storageManager.getDirectory === 'function'
              ? () => storageManager.getDirectory()
              : undefined,
          estimate:
            typeof storageManager.estimate === 'function'
              ? async () => {
                  const result = await storageManager.estimate();
                  return { usage: result.usage, quota: result.quota };
                }
              : undefined,
          persisted:
            typeof storageManager.persisted === 'function'
              ? () => storageManager.persisted()
              : undefined,
          persist:
            typeof storageManager.persist === 'function'
              ? () => storageManager.persist()
              : undefined,
        }
      : undefined,
    maxTouchPoints: nav?.maxTouchPoints,
    matchMedia:
      typeof matchMedia === 'undefined' ? undefined : (query: string) => matchMedia(query),
    webAssembly:
      typeof WebAssembly === 'undefined'
        ? undefined
        : {
            validate: (bytes: Uint8Array<ArrayBuffer>) => WebAssembly.validate(bytes),
            instantiate: (bytes: Uint8Array<ArrayBuffer>) => WebAssembly.instantiate(bytes),
          },
    crossOriginIsolated:
      typeof crossOriginIsolated === 'undefined' ? undefined : crossOriginIsolated,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    createProbeWorker: () =>
      new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' }),
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = units[exponent] ?? 'TB';
  const precision = exponent === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = error.message || 'unknown error';
    return `${name}: ${message}`;
  }
  return 'unknown error';
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

class AbortedError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/**
 * Runs `run` with a bounded timeout. `onTimeout` is invoked (for cleanup,
 * such as terminating a worker) if the timeout wins the race.
 */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      onTimeout();
      reject(new TimeoutError('did not respond in time'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function probeIndexedDb(env: ProbeEnvironment): Promise<CapabilityReport> {
  const id: CapabilityId = 'indexeddb';
  const label = 'IndexedDB';
  if (!env.indexedDB) {
    return {
      id,
      label,
      status: 'unsupported',
      detail: 'IndexedDB is not available in this browser.',
    };
  }
  const dbName = `chess-reader-probe-${Math.random().toString(36).slice(2)}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = env.indexedDB?.open(dbName);
      if (!request) {
        reject(new Error('IndexedDB open unavailable'));
        return;
      }
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore('probe');
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('IndexedDB open failed'));
      });
      request.addEventListener('blocked', () => {
        reject(new Error('IndexedDB open blocked'));
      });
    });
    await new Promise<void>((resolve) => {
      const deleteRequest = env.indexedDB?.deleteDatabase(dbName);
      if (!deleteRequest) {
        resolve();
        return;
      }
      deleteRequest.addEventListener('success', () => {
        resolve();
      });
      deleteRequest.addEventListener('error', () => {
        resolve();
      });
    });
    return { id, label, status: 'supported', detail: 'IndexedDB open/write/delete succeeded.' };
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      detail: `IndexedDB probe failed: ${sanitizeError(error)}`,
    };
  }
}

async function probeOpfs(env: ProbeEnvironment): Promise<CapabilityReport> {
  const id: CapabilityId = 'opfs';
  const label = 'Origin Private File System';
  const getDirectory = env.storage?.getDirectory;
  if (!getDirectory) {
    return {
      id,
      label,
      status: 'unsupported',
      detail: 'The Origin Private File System is not available in this browser.',
    };
  }
  try {
    await getDirectory();
    return {
      id,
      label,
      status: 'supported',
      detail: 'OPFS root directory handle opened successfully.',
    };
  } catch (error) {
    return { id, label, status: 'error', detail: `OPFS probe failed: ${sanitizeError(error)}` };
  }
}

async function probeWorkers(
  env: ProbeEnvironment,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): Promise<CapabilityReport> {
  const id: CapabilityId = 'workers';
  const label = 'Module workers';
  const createWorker = env.createProbeWorker;
  if (!createWorker) {
    return {
      id,
      label,
      status: 'unsupported',
      detail: 'Web Workers are not available in this browser.',
    };
  }

  let worker: Worker;
  try {
    worker = createWorker();
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      detail: `Worker creation failed: ${sanitizeError(error)}`,
    };
  }

  const nonce = Math.random().toString(36).slice(2);
  const start = env.now();

  const run = (): Promise<CapabilityReport> =>
    new Promise<CapabilityReport>((resolve, reject) => {
      const cleanup = (): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      };
      const onMessage = (event: MessageEvent<unknown>): void => {
        if (!isProbePongMessage(event.data) || event.data.nonce !== nonce) {
          return;
        }
        cleanup();
        const elapsed = Math.round(env.now() - start);
        worker.terminate();
        resolve({
          id,
          label,
          status: 'supported',
          detail: `Module worker round-trip succeeded in ${String(elapsed)} ms.`,
        });
      };
      const onError = (): void => {
        cleanup();
        worker.terminate();
        resolve({
          id,
          label,
          status: 'error',
          detail: 'Worker reported an error before responding.',
        });
      };
      const onExternalAbort = (): void => {
        cleanup();
        worker.terminate();
        reject(new AbortedError());
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
      worker.postMessage({ type: 'ping', nonce });
    });

  try {
    return await withTimeout(
      () => run(),
      timeoutMs,
      () => {
        worker.terminate();
      },
    );
  } catch (error) {
    if (error instanceof AbortedError) {
      throw error;
    }
    return { id, label, status: 'error', detail: 'Worker did not respond in time.' };
  }
}

async function probeWebAssembly(env: ProbeEnvironment): Promise<CapabilityReport> {
  const id: CapabilityId = 'webassembly';
  const label = 'WebAssembly';
  if (!env.webAssembly) {
    return {
      id,
      label,
      status: 'unsupported',
      detail: 'WebAssembly is not available in this browser.',
    };
  }
  try {
    const isValid = env.webAssembly.validate(MINIMAL_WASM_MODULE);
    if (!isValid) {
      return {
        id,
        label,
        status: 'error',
        detail: 'WebAssembly rejected a minimal valid module during validation.',
      };
    }
    await env.webAssembly.instantiate(MINIMAL_WASM_MODULE);
    const sharedMemoryNote = env.hasSharedArrayBuffer
      ? 'SharedArrayBuffer is available for threaded builds.'
      : 'SharedArrayBuffer is unavailable, so threaded builds cannot run.';
    return {
      id,
      label,
      status: 'supported',
      detail: `WebAssembly validation and instantiation succeeded. ${sharedMemoryNote}`,
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      detail: `WebAssembly probe failed: ${sanitizeError(error)}`,
    };
  }
}

async function probeStorageEstimate(env: ProbeEnvironment): Promise<CapabilityReport> {
  const id: CapabilityId = 'storage-estimate';
  const label = 'Storage estimate';
  const estimate = env.storage?.estimate;
  if (!estimate) {
    return {
      id,
      label,
      status: 'unsupported',
      detail: 'Storage usage/quota estimation is not available in this browser.',
    };
  }
  try {
    const result = await estimate();
    if (result.usage === undefined || result.quota === undefined) {
      return {
        id,
        label,
        status: 'unknown',
        detail: 'The browser did not report a usable usage/quota estimate.',
      };
    }
    return {
      id,
      label,
      status: 'supported',
      detail: `Usage ${formatBytes(result.usage)} of ${formatBytes(result.quota)} estimated quota.`,
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      detail: `Storage estimate failed: ${sanitizeError(error)}`,
    };
  }
}

async function probeStoragePersistence(env: ProbeEnvironment): Promise<CapabilityReport> {
  const id: CapabilityId = 'storage-persistence';
  const label = 'Storage persistence';
  const persisted = env.storage?.persisted;
  if (!persisted) {
    return {
      id,
      label,
      status: 'unknown',
      detail: 'This browser does not report whether storage persistence was granted.',
    };
  }
  try {
    const isPersisted = await persisted();
    if (isPersisted) {
      return { id, label, status: 'supported', detail: 'Persistent storage granted.' };
    }
    return {
      id,
      label,
      status: 'unsupported',
      detail: 'Best-effort storage; the browser may evict data under pressure.',
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      detail: `Storage persistence probe failed: ${sanitizeError(error)}`,
    };
  }
}

function probeTouch(env: ProbeEnvironment): CapabilityReport {
  const id: CapabilityId = 'touch';
  const label = 'Touch input';
  const hasTouchPoints = (env.maxTouchPoints ?? 0) > 0;
  const hasCoarsePointer = env.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (hasTouchPoints || hasCoarsePointer) {
    return {
      id,
      label,
      status: 'supported',
      detail: 'A touch or coarse pointer input was detected.',
    };
  }
  return {
    id,
    label,
    status: 'unsupported',
    detail: 'No touch or coarse pointer input was detected; this is informational only.',
  };
}

function probeCrossOriginIsolation(env: ProbeEnvironment): CapabilityReport {
  const id: CapabilityId = 'cross-origin-isolation';
  const label = 'Cross-origin isolation';
  if (env.crossOriginIsolated === undefined) {
    return {
      id,
      label,
      status: 'unknown',
      detail: 'This browser does not report cross-origin isolation status.',
    };
  }
  if (env.crossOriginIsolated) {
    return {
      id,
      label,
      status: 'supported',
      detail: 'Cross-origin isolation is active; threaded WebAssembly can run.',
    };
  }
  return {
    id,
    label,
    status: 'unsupported',
    detail:
      'Threaded WebAssembly will not be available; the host must send COOP same-origin and COEP require-corp.',
  };
}

export interface ProbeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export async function probeCapabilities(
  env: ProbeEnvironment,
  options: ProbeOptions = {},
): Promise<readonly CapabilityReport[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal;

  if (signal?.aborted) {
    throw new AbortedError();
  }

  const runProbe = async (
    id: CapabilityId,
    label: string,
    run: () => Promise<CapabilityReport>,
  ): Promise<CapabilityReport> => {
    try {
      return await withTimeout(
        () => run(),
        timeoutMs,
        () => undefined,
      );
    } catch {
      return {
        id,
        label,
        status: 'error',
        detail: 'The probe did not respond in time.',
      };
    }
  };

  const runSync = (
    id: CapabilityId,
    label: string,
    run: () => CapabilityReport,
  ): Promise<CapabilityReport> => {
    try {
      return Promise.resolve(run());
    } catch (error) {
      return Promise.resolve({
        id,
        label,
        status: 'error',
        detail: `Probe failed: ${sanitizeError(error)}`,
      });
    }
  };

  return await Promise.all([
    runProbe('indexeddb', 'IndexedDB', () => probeIndexedDb(env)),
    runProbe('opfs', 'Origin Private File System', () => probeOpfs(env)),
    probeWorkers(env, timeoutMs, signal),
    runProbe('webassembly', 'WebAssembly', () => probeWebAssembly(env)),
    runProbe('storage-estimate', 'Storage estimate', () => probeStorageEstimate(env)),
    runProbe('storage-persistence', 'Storage persistence', () => probeStoragePersistence(env)),
    runSync('touch', 'Touch input', () => probeTouch(env)),
    runSync('cross-origin-isolation', 'Cross-origin isolation', () =>
      probeCrossOriginIsolation(env),
    ),
  ]);
}

export async function requestPersistentStorage(env: ProbeEnvironment): Promise<CapabilityReport> {
  const id: CapabilityId = 'storage-persistence';
  const label = 'Storage persistence';
  const persist = env.storage?.persist;
  if (!persist) {
    return {
      id,
      label,
      status: 'unknown',
      detail: 'This browser does not support requesting storage persistence.',
    };
  }
  try {
    await persist();
    return await probeStoragePersistence(env);
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      detail: `Persistence request failed: ${sanitizeError(error)}`,
    };
  }
}
