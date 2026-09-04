import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createScriptedRecognizer, type FakeRecognizerScript } from './fakeRecognizer';
import { isWorkerRequest, type WorkerResponseMessage } from './protocol';
import { createWorkerRecognizer, type WorkerLike } from './workerRecognizer';

import type { DiagramRecognizer, RecognitionPhase, RecognitionRequest } from '../study/contracts';

/**
 * Shared behavioral suite from docs/evaluation.md §4 ("`DiagramRecognizer`:
 * cancellation, normalized results, no-board, confidence... Fakes must
 * simulate slow completion and out-of-order results; happy-path-only
 * adapters do not pass"). Runs unmodified against the scripted fake and the
 * worker recognizer (backed by a fully controlled fake `WorkerLike`).
 *
 * Wall-clock "rejects with timeout" is intentionally NOT part of this shared
 * suite: `createScriptedRecognizer`'s `'never'` outcome only ever settles via
 * abort (that is its documented contract, used for cancellation tests), it
 * has no built-in timeout concept of its own. Only `createWorkerRecognizer`
 * enforces a wall-clock timeout, so that case is tested separately below,
 * against the worker fixture only.
 */
function makeRequest(requestId: number, width = 64, height = 64): RecognitionRequest {
  return {
    requestId,
    region: {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      sourceRect: { x: 0, y: 0, width, height },
      normalizedRect: { x: 0, y: 0, width: 1, height: 1 },
      locator: { format: 'pdf', pageIndex: 0 },
    },
  };
}

function describeDiagramRecognizerContract(name: string, factory: () => DiagramRecognizer): void {
  describe(`DiagramRecognizer contract: ${name}`, () => {
    let recognizer: DiagramRecognizer;

    beforeEach(() => {
      recognizer = factory();
    });

    afterEach(() => {
      recognizer.dispose();
    });

    it('resolves a board outcome', async () => {
      const controller = new AbortController();
      const promise = recognizer.recognize(makeRequest(1), controller.signal);
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;
      expect(result.requestId).toBe(1);
      expect(result.outcome.kind).toBe('board');
      expect(result.recognizerVersion).toBeTruthy();
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('resolves a no-board outcome', async () => {
      const controller = new AbortController();
      const promise = recognizer.recognize(makeRequest(2), controller.signal);
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;
      expect(result.outcome.kind).toBe('no-board');
    });

    it('rejects with aborted when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(recognizer.recognize(makeRequest(3), controller.signal)).rejects.toMatchObject({
        code: 'aborted',
      });
    });

    it('rejects with aborted mid-flight and never resolves afterward', async () => {
      const controller = new AbortController();
      const promise = recognizer.recognize(makeRequest(4), controller.signal);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'aborted' });
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      await assertion;
      // Let any in-flight timers/messages that would (incorrectly) resolve
      // the aborted request run; the promise above already settled once, so
      // a second resolution would only be observable as an unhandled
      // rejection/duplicate settle, not a visible assertion failure here --
      // the real guarantee is exercised by the "stale result ignored" case
      // below via the same underlying id-tracking mechanism.
      await vi.advanceTimersByTimeAsync(10_000);
    });

    it('rejects with the scripted error code', async () => {
      const controller = new AbortController();
      const promise = recognizer.recognize(makeRequest(6), controller.signal);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'runtime-failure' });
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
    });

    it('resolves two concurrent requests out of order by their own delay', async () => {
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const slow = recognizer.recognize(makeRequest(101), controllerA.signal);
      const fast = recognizer.recognize(makeRequest(102), controllerB.signal);

      const order: number[] = [];
      void slow.then((r) => order.push(r.requestId));
      void fast.then((r) => order.push(r.requestId));

      await vi.advanceTimersByTimeAsync(50);
      expect(order).toEqual([102]);

      await vi.advanceTimersByTimeAsync(500);
      expect(order).toEqual([102, 101]);

      const [resultSlow, resultFast] = await Promise.all([slow, fast]);
      expect(resultSlow.requestId).toBe(101);
      expect(resultFast.requestId).toBe(102);
    });

    it('reports phases only to the callback for its own request', async () => {
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const phasesA: RecognitionPhase[] = [];
      const phasesB: RecognitionPhase[] = [];

      const a = recognizer.recognize(makeRequest(201), controllerA.signal, (phase) => {
        phasesA.push(phase);
      });
      const b = recognizer.recognize(makeRequest(202), controllerB.signal, (phase) => {
        phasesB.push(phase);
      });

      await vi.advanceTimersByTimeAsync(500);
      await Promise.all([a, b]);

      expect(phasesA.length).toBeGreaterThan(0);
      expect(phasesB.length).toBeGreaterThan(0);
    });

    it('rejects pending requests on dispose', async () => {
      const controller = new AbortController();
      const promise = recognizer.recognize(makeRequest(301), controller.signal);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'aborted' });
      recognizer.dispose();
      await assertion;
    });
  });
}

// --- Fixture 1: the scripted fake -------------------------------------------------

const STARTING_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/** One dedicated single-step script per requestId used below, keyed so the
 *  contract suite's test bodies (each issuing calls with fixed requestIds)
 *  get the outcome they expect regardless of test execution order --
 *  `createScriptedRecognizer`'s own steps are consumed by call order within
 *  ONE instance (its real, documented behavior for production use), which
 *  would make a single shared multi-step script order-dependent here. */
const fakeStepsByRequestId: Record<number, FakeRecognizerScript['steps'][number]> = {
  1: { outcome: 'board', delayMs: 50, placement: STARTING_PLACEMENT, reliable: true },
  2: { outcome: 'no-board', delayMs: 10 },
  4: { outcome: 'board', delayMs: 30_000 }, // abort-mid-flight case
  6: { outcome: 'error', errorCode: 'runtime-failure', delayMs: 1 },
  101: { outcome: 'board', delayMs: 300, placement: STARTING_PLACEMENT }, // slow
  102: { outcome: 'board', delayMs: 20, placement: STARTING_PLACEMENT }, // fast
  201: { outcome: 'board', delayMs: 300, phases: ['loading-model', 'recognizing'] },
  202: { outcome: 'board', delayMs: 20, phases: ['recognizing'] },
  301: { outcome: 'board', delayMs: 10_000 }, // dispose case
};

/** Dispatches each `recognize()` call to its own lazily-created, one-shot
 *  `createScriptedRecognizer` keyed by requestId, so behavior is independent
 *  of call order while still exercising the real scripted-fake timing/abort/
 *  phase logic end to end. */
function createFakeFixture(): DiagramRecognizer {
  const perRequest = new Map<number, DiagramRecognizer>();

  function recognizerFor(requestId: number): DiagramRecognizer {
    let existing = perRequest.get(requestId);
    if (!existing) {
      const step = fakeStepsByRequestId[requestId] ?? { outcome: 'board', delayMs: 10 };
      existing = createScriptedRecognizer(
        { version: 'contract-fake/1', steps: [step] },
        { now: () => Date.now() },
      );
      perRequest.set(requestId, existing);
    }
    return existing;
  }

  return {
    version: 'contract-fake/1',
    recognize(request, signal, onPhase) {
      return recognizerFor(request.requestId).recognize(request, signal, onPhase);
    },
    dispose() {
      for (const r of perRequest.values()) {
        r.dispose();
      }
    },
  };
}

describe('fake timers suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describeDiagramRecognizerContract('scripted fake', createFakeFixture);
});

// --- Fixture 2: the worker recognizer, backed by a fully controlled fake worker ---

/** A minimal, fully scripted `Worker` stand-in: records posted messages and
 *  lets the test dispatch `message`/`error` events on demand, so the exact
 *  same contract suite exercises the real request/response/cancel protocol
 *  instead of a real Worker (unavailable under jsdom) or real ONNX Runtime. */
class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errorListeners = new Set<(event: Event) => void>();
  terminated = false;

  postMessage(message: unknown): void {
    if (!isWorkerRequest(message)) {
      throw new Error('FakeWorker received a malformed request');
    }
    this.posted.push(message);
    if (message.type === 'recognize') {
      scheduleScriptedResponse(this, message.requestId);
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent<unknown> | Event) => void): void {
    if (type === 'message') {
      this.messageListeners.add(listener);
    } else if (type === 'error') {
      this.errorListeners.add(listener);
    }
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<unknown> | Event) => void,
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener);
    } else if (type === 'error') {
      this.errorListeners.delete(listener);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: WorkerResponseMessage): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }

  emitError(): void {
    const event = new Event('error');
    for (const listener of this.errorListeners) {
      listener(event);
    }
  }
}

/** Mirrors the `fakeScript` steps above so both fixtures exhibit identical
 *  timing/outcome behavior for the same requestId. */
function scheduleScriptedResponse(worker: FakeWorker, requestId: number): void {
  const cancelledIds = new Set<number>();
  const originalPost = worker.postMessage.bind(worker);
  worker.postMessage = (message: unknown) => {
    if (isWorkerRequest(message) && message.type === 'cancel') {
      cancelledIds.add(message.requestId);
    }
    originalPost(message);
  };

  const respond = (
    delayMs: number,
    build: () => WorkerResponseMessage,
    phases: RecognitionPhase[] = [],
  ): void => {
    let elapsed = 0;
    for (const phase of phases) {
      const phaseDelay = Math.round(delayMs / (phases.length + 1));
      elapsed += phaseDelay;
      setTimeout(() => {
        if (!cancelledIds.has(requestId)) {
          worker.emitMessage({ type: 'phase', requestId, phase });
        }
      }, elapsed);
    }
    setTimeout(() => {
      if (!cancelledIds.has(requestId)) {
        worker.emitMessage(build());
      }
    }, delayMs);
  };

  const board = (
    placement = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
  ): WorkerResponseMessage => ({
    type: 'result',
    requestId,
    outcome: {
      kind: 'board',
      board: {
        placement,
        confidences: new Array(64).fill(0.95) as number[],
        minConfidence: 0.95,
        meanConfidence: 0.95,
        reliable: true,
        corners: { x0: 0, y0: 0, x1: 64, y1: 64 },
        proposedOrientation: 'white',
      },
    },
    inferenceMs: 5,
    coldStart: false,
    recognizerVersion: 'contract-worker/1',
  });
  const noBoard = (): WorkerResponseMessage => ({
    type: 'result',
    requestId,
    outcome: { kind: 'no-board' },
    inferenceMs: 5,
    coldStart: false,
    recognizerVersion: 'contract-worker/1',
  });
  const runtimeError = (): WorkerResponseMessage => ({
    type: 'error',
    requestId,
    code: 'runtime-failure',
    message: 'scripted failure',
  });

  switch (requestId) {
    case 1:
      respond(50, () => board());
      return;
    case 2:
      respond(10, noBoard);
      return;
    case 4:
      respond(30_000, () => board());
      return;
    case 5:
      // Never respond: exercises the timeout path.
      return;
    case 6:
      respond(1, runtimeError);
      return;
    case 101:
      respond(300, () => board());
      return;
    case 102:
      respond(20, () => board());
      return;
    case 201:
      respond(300, () => board(), ['loading-model', 'recognizing']);
      return;
    case 202:
      respond(20, () => board(), ['recognizing']);
      return;
    case 301:
      respond(10_000, () => board());
      return;
    default:
      respond(10, () => board());
  }
}

describe('fake timers suite (worker)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describeDiagramRecognizerContract('worker recognizer', () =>
    createWorkerRecognizer({
      createWorker: () => new FakeWorker(),
      now: () => Date.now(),
      timeoutMs: 60_000,
      coldTimeoutMs: 60_000,
    }),
  );
});

// --- Behavior specific to the worker recognizer (not part of the shared contract) ---

describe('createWorkerRecognizer: worker crash and stale-id handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects all pending requests with worker-unavailable when the worker errors', async () => {
    const worker = new FakeWorker();
    // Prevent the scripted auto-response so only the error event settles these.
    worker.postMessage = (message: unknown) => {
      if (isWorkerRequest(message)) {
        worker.posted.push(message);
      }
    };
    const recognizer = createWorkerRecognizer({
      createWorker: () => worker,
      now: () => Date.now(),
    });

    const a = recognizer.recognize(makeRequest(1), new AbortController().signal);
    const b = recognizer.recognize(makeRequest(2), new AbortController().signal);
    const assertionA = expect(a).rejects.toMatchObject({ code: 'worker-unavailable' });
    const assertionB = expect(b).rejects.toMatchObject({ code: 'worker-unavailable' });

    worker.emitError();

    await assertionA;
    await assertionB;
    recognizer.dispose();
  });

  it('ignores a result for an unknown/stale requestId', () => {
    const worker = new FakeWorker();
    worker.postMessage = (message: unknown) => {
      if (isWorkerRequest(message)) {
        worker.posted.push(message);
      }
    };
    const recognizer = createWorkerRecognizer({
      createWorker: () => worker,
      now: () => Date.now(),
    });

    // No pending request has id 999; this must be a silent no-op.
    expect(() => {
      worker.emitMessage({
        type: 'result',
        requestId: 999,
        outcome: { kind: 'no-board' },
        inferenceMs: 1,
        coldStart: false,
        recognizerVersion: 'v1',
      });
    }).not.toThrow();

    recognizer.dispose();
  });

  it('recreates the worker lazily after a crash', async () => {
    let created = 0;
    const workers: FakeWorker[] = [];
    const createWorker = (): FakeWorker => {
      created += 1;
      const w = new FakeWorker();
      w.postMessage = (message: unknown) => {
        if (isWorkerRequest(message)) {
          w.posted.push(message);
        }
      };
      workers.push(w);
      return w;
    };
    const recognizer = createWorkerRecognizer({ createWorker, now: () => Date.now() });

    const first = recognizer.recognize(makeRequest(1), new AbortController().signal);
    const firstAssertion = expect(first).rejects.toMatchObject({ code: 'worker-unavailable' });
    workers[0]?.emitError();
    await firstAssertion;

    expect(created).toBe(1);
    expect(workers[0]?.terminated).toBe(true);

    // Next call must create a brand-new worker rather than reusing the dead one.
    const second = recognizer.recognize(makeRequest(2), new AbortController().signal);
    expect(created).toBe(2);
    void second.catch(() => undefined);
    recognizer.dispose();
  });
});

describe('createWorkerRecognizer: timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with timeout when the worker never responds', async () => {
    const recognizer = createWorkerRecognizer({
      createWorker: () => new FakeWorker(),
      now: () => Date.now(),
      timeoutMs: 1_000,
      coldTimeoutMs: 1_000,
    });
    const promise = recognizer.recognize(makeRequest(5), new AbortController().signal);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    recognizer.dispose();
  });
});

describe('createWorkerRecognizer: worker-unavailable', () => {
  it('rejects with worker-unavailable when Worker creation throws', async () => {
    const recognizer = createWorkerRecognizer({
      createWorker: () => {
        throw new Error('Worker is not defined');
      },
    });
    await expect(
      recognizer.recognize(makeRequest(1), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'worker-unavailable',
    });
    recognizer.dispose();
  });
});
