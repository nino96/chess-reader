import {
  isWorkerResponse,
  type InitializeRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

export interface HarnessSession {
  readonly id: number;
  readonly ready: Extract<WorkerResponse, { type: 'ready' }>;
}

export interface BrowserHarness {
  open(
    request: Omit<InitializeRequest, 'type' | 'requestId'>,
    timeoutMs: number,
  ): Promise<HarnessSession>;
  run(
    sessionId: number,
    boardIndexes: readonly number[],
    timeoutMs: number,
  ): Promise<WorkerResponse>;
  runAndCancel(
    sessionId: number,
    boardIndexes: readonly number[],
    timeoutMs: number,
  ): Promise<WorkerResponse>;
  hang(sessionId: number, timeoutMs: number): Promise<void>;
  close(sessionId: number, timeoutMs: number): Promise<void>;
}

interface ActiveSession {
  readonly worker: Worker;
  nextRequestId: number;
}

const sessions = new Map<number, ActiveSession>();
let nextSessionId = 1;

function activeSession(id: number): ActiveSession {
  const session = sessions.get(id);
  if (!session) throw new Error('Unknown or terminated browser harness session');
  return session;
}

function request(
  sessionId: number,
  message: WorkerRequest,
  timeoutMs: number,
  cancelAfterProgress = false,
): Promise<WorkerResponse> {
  const session = activeSession(sessionId);
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      session.worker.terminate();
      sessions.delete(sessionId);
      reject(new Error(`worker-timeout:${timeoutMs}`));
    }, timeoutMs);
    const onError = (): void => {
      window.clearTimeout(timeout);
      session.worker.terminate();
      sessions.delete(sessionId);
      reject(new Error('worker-crash'));
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isWorkerResponse(event.data) || event.data.requestId !== message.requestId) return;
      if (event.data.type === 'progress') {
        if (cancelAfterProgress && !cancelled) {
          cancelled = true;
          session.worker.postMessage({
            type: 'cancel',
            requestId: message.requestId,
          } satisfies WorkerRequest);
        }
        return;
      }
      window.clearTimeout(timeout);
      session.worker.removeEventListener('message', onMessage);
      session.worker.removeEventListener('error', onError);
      resolve(event.data);
    };
    session.worker.addEventListener('message', onMessage);
    session.worker.addEventListener('error', onError);
    session.worker.postMessage(message);
  });
}

async function open(
  init: Omit<InitializeRequest, 'type' | 'requestId'>,
  timeoutMs: number,
): Promise<HarnessSession> {
  const id = nextSessionId;
  nextSessionId += 1;
  const worker = new Worker(new URL('./classifier.worker.ts', import.meta.url), { type: 'module' });
  const session: ActiveSession = { worker, nextRequestId: 2 };
  sessions.set(id, session);
  const response = await request(id, { type: 'initialize', requestId: 1, ...init }, timeoutMs);
  if (response.type !== 'ready') {
    worker.terminate();
    sessions.delete(id);
    throw new Error(
      `worker-initialize:${response.type === 'error' ? response.message : response.type}`,
    );
  }
  return { id, ready: response };
}

async function run(
  sessionId: number,
  boardIndexes: readonly number[],
  timeoutMs: number,
): Promise<WorkerResponse> {
  const session = activeSession(sessionId);
  const requestId = session.nextRequestId;
  session.nextRequestId += 1;
  return request(sessionId, { type: 'run', requestId, boardIndexes }, timeoutMs);
}

async function runAndCancel(
  sessionId: number,
  boardIndexes: readonly number[],
  timeoutMs: number,
): Promise<WorkerResponse> {
  const session = activeSession(sessionId);
  const requestId = session.nextRequestId;
  session.nextRequestId += 1;
  return request(sessionId, { type: 'run', requestId, boardIndexes }, timeoutMs, true);
}

async function hang(sessionId: number, timeoutMs: number): Promise<void> {
  const session = activeSession(sessionId);
  const requestId = session.nextRequestId;
  session.nextRequestId += 1;
  await request(sessionId, { type: 'test-hang', requestId }, timeoutMs);
}

async function close(sessionId: number, timeoutMs: number): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  const requestId = session.nextRequestId;
  session.nextRequestId += 1;
  try {
    await request(sessionId, { type: 'dispose', requestId }, timeoutMs);
  } finally {
    session.worker.terminate();
    sessions.delete(sessionId);
  }
}

globalThis.__recognitionTrainingBrowser = {
  open,
  run,
  runAndCancel,
  hang,
  close,
} satisfies BrowserHarness;

declare global {
  var __recognitionTrainingBrowser: BrowserHarness;
}
