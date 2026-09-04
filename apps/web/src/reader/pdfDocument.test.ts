import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => {
  class PasswordException extends Error {
    readonly code: number;
    constructor(message: string, code = 1) {
      super(message);
      this.name = 'PasswordException';
      this.code = code;
    }
  }
  class InvalidPDFException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InvalidPDFException';
    }
  }
  class AbortException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AbortException';
    }
  }
  class RenderingCancelledException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RenderingCancelledException';
    }
  }
  return {
    getDocument: vi.fn(),
    GlobalWorkerOptions: { workerSrc: '' },
    PasswordException,
    InvalidPDFException,
    AbortException,
    RenderingCancelledException,
  };
});

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker-url' }));

import {
  AbortException,
  InvalidPDFException,
  PasswordException,
  RenderingCancelledException,
  getDocument,
} from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { PdfOpenError, openPdfDocument } from './pdfDocument';

const getDocumentMock = vi.mocked(getDocument);

interface ControllableRenderTask {
  readonly promise: Promise<void>;
  readonly cancel: ReturnType<typeof vi.fn>;
  resolve(): void;
  rejectWith(error: unknown): void;
}

function createControllableRenderTask(): ControllableRenderTask {
  let resolveFn: () => void = () => undefined;
  let rejectFn: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const cancel = vi.fn(() => {
    rejectFn(new RenderingCancelledException('Rendering cancelled'));
  });
  return {
    promise,
    cancel,
    resolve: () => {
      resolveFn();
    },
    rejectWith: (error: unknown) => {
      rejectFn(error);
    },
  };
}

interface FakePage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: () => ControllableRenderTask;
  cleanup: ReturnType<typeof vi.fn>;
}

interface FakePageHandle {
  readonly page: FakePage;
  readonly cleanupCalls: () => number;
  readonly renderTasks: ControllableRenderTask[];
}

function createFakePage(pageSizePt: { widthPt: number; heightPt: number }): FakePageHandle {
  const renderTasks: ControllableRenderTask[] = [];
  const cleanup = vi.fn();
  const page: FakePage = {
    getViewport: ({ scale }) => ({
      width: pageSizePt.widthPt * scale,
      height: pageSizePt.heightPt * scale,
    }),
    render: () => {
      const task = createControllableRenderTask();
      renderTasks.push(task);
      return task;
    },
    cleanup,
  };
  return { page, cleanupCalls: () => cleanup.mock.calls.length, renderTasks };
}

interface FakeDocHandle {
  readonly doc: PDFDocumentProxy;
  readonly getPageMock: ReturnType<typeof vi.fn>;
  readonly pageFor: (pageNumber: number) => FakePageHandle;
}

function createFakeDoc(
  options: { numPages?: number; pageSizePt?: { widthPt: number; heightPt: number } } = {},
): FakeDocHandle {
  const numPages = options.numPages ?? 3;
  const pageSizePt = options.pageSizePt ?? { widthPt: 612, heightPt: 792 };
  const pages = new Map<number, FakePageHandle>();

  function pageFor(pageNumber: number): FakePageHandle {
    let entry = pages.get(pageNumber);
    if (!entry) {
      entry = createFakePage(pageSizePt);
      pages.set(pageNumber, entry);
    }
    return entry;
  }

  const getPageMock = vi.fn((pageNumber: number) => Promise.resolve(pageFor(pageNumber).page));

  const doc = { numPages, getPage: getPageMock } as unknown as PDFDocumentProxy;
  return { doc, getPageMock, pageFor };
}

function createFakeLoadingTask(docPromise: Promise<PDFDocumentProxy>): {
  promise: Promise<PDFDocumentProxy>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return { promise: docPromise, destroy: vi.fn(() => Promise.resolve()) };
}

function mockSuccessfulOpen(fakeDoc: FakeDocHandle): ReturnType<typeof createFakeLoadingTask> {
  const loadingTask = createFakeLoadingTask(Promise.resolve(fakeDoc.doc));
  getDocumentMock.mockReturnValue(loadingTask as unknown as ReturnType<typeof getDocument>);
  return loadingTask;
}

/** Flushes several microtask turns so an in-flight `renderPage` call can progress
 * past its internal `await`s (getPage, then render()) before the test inspects
 * captured render-task state. */
async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function createFakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: (id: string) => (id === '2d' ? {} : null),
  } as unknown as HTMLCanvasElement;
}

const VALID_PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%mock-body\n');
const INVALID_HEADER_BYTES = new TextEncoder().encode('NOT-A-PDF-BODY');

function makeFile(bytes: Uint8Array<ArrayBuffer>, name = 'input.pdf'): File {
  return new File([bytes], name, { type: 'application/pdf' });
}

beforeEach(() => {
  getDocumentMock.mockReset();
});

/** Polls (across real macrotasks, not just microtasks) until `predicate()` is true. */
async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

describe('openPdfDocument header/size validation', () => {
  it('rejects a file whose header is not "%PDF-" with code not-a-pdf', async () => {
    await expect(openPdfDocument(makeFile(INVALID_HEADER_BYTES))).rejects.toMatchObject({
      code: 'not-a-pdf',
    });
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects a source larger than maxBytes with code too-large, without reading its header', async () => {
    const bytes = VALID_PDF_BYTES;
    await expect(
      openPdfDocument(makeFile(bytes), { maxBytes: bytes.length - 1 }),
    ).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('never includes a file name in a validation error message', async () => {
    try {
      await openPdfDocument(makeFile(INVALID_HEADER_BYTES, 'my-secret-book-title.pdf'));
      expect.unreachable('expected openPdfDocument to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(PdfOpenError);
      expect((error as PdfOpenError).message).not.toContain('my-secret-book-title');
    }
  });

  it('accepts an ArrayBuffer source directly', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const buffer = VALID_PDF_BYTES.buffer.slice(
      VALID_PDF_BYTES.byteOffset,
      VALID_PDF_BYTES.byteOffset + VALID_PDF_BYTES.byteLength,
    );

    const handle = await openPdfDocument(buffer);
    expect(handle.pageCount).toBe(fakeDoc.doc.numPages);
  });

  it('is aborted before doing any work when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      openPdfDocument(makeFile(VALID_PDF_BYTES), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(getDocumentMock).not.toHaveBeenCalled();
  });
});

describe('openPdfDocument error mapping', () => {
  it('maps PasswordException to code password', async () => {
    const loadingTask = createFakeLoadingTask(
      // pdfjs-dist's exception classes extend an untyped (`any`) base, so TypeScript
      // cannot verify they extend `Error` even though they do at runtime.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject(new PasswordException('needs password', 1)),
    );
    getDocumentMock.mockReturnValue(loadingTask as unknown as ReturnType<typeof getDocument>);

    await expect(openPdfDocument(makeFile(VALID_PDF_BYTES))).rejects.toMatchObject({
      code: 'password',
    });
    expect(loadingTask.destroy).toHaveBeenCalled();
  });

  it('maps InvalidPDFException to code corrupt', async () => {
    const loadingTask = createFakeLoadingTask(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above.
      Promise.reject(new InvalidPDFException('bad structure')),
    );
    getDocumentMock.mockReturnValue(loadingTask as unknown as ReturnType<typeof getDocument>);

    await expect(openPdfDocument(makeFile(VALID_PDF_BYTES))).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('maps AbortException to code aborted', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above.
    const loadingTask = createFakeLoadingTask(Promise.reject(new AbortException('cancelled')));
    getDocumentMock.mockReturnValue(loadingTask as unknown as ReturnType<typeof getDocument>);

    await expect(openPdfDocument(makeFile(VALID_PDF_BYTES))).rejects.toMatchObject({
      code: 'aborted',
    });
  });

  it('maps an unrecognized error to code unsupported', async () => {
    const loadingTask = createFakeLoadingTask(Promise.reject(new Error('totally unexpected')));
    getDocumentMock.mockReturnValue(loadingTask as unknown as ReturnType<typeof getDocument>);

    await expect(openPdfDocument(makeFile(VALID_PDF_BYTES))).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('destroys the loading task and rejects as aborted when the signal aborts while loading', async () => {
    let rejectPromise: (error: unknown) => void = () => undefined;
    const pending = new Promise<PDFDocumentProxy>((_resolve, reject) => {
      rejectPromise = reject;
    });
    const loadingTask = createFakeLoadingTask(pending);
    getDocumentMock.mockReturnValue(loadingTask as unknown as ReturnType<typeof getDocument>);
    const controller = new AbortController();

    const openPromise = openPdfDocument(makeFile(VALID_PDF_BYTES), { signal: controller.signal });
    await waitUntil(() => getDocumentMock.mock.calls.length > 0);
    controller.abort();

    await expect(openPromise).rejects.toMatchObject({ code: 'aborted' });
    expect(loadingTask.destroy).toHaveBeenCalled();
    rejectPromise(new Error('never observed'));
  });
});

describe('PdfDocumentHandle.getPageSize', () => {
  it('returns the rotation-aware page size from getViewport at scale 1', async () => {
    const fakeDoc = createFakeDoc({ pageSizePt: { widthPt: 420, heightPt: 594 } });
    mockSuccessfulOpen(fakeDoc);

    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES));
    const size = await handle.getPageSize(0);

    expect(size).toEqual({ widthPt: 420, heightPt: 594 });
    expect(fakeDoc.getPageMock).toHaveBeenCalledWith(1);
  });
});

describe('PdfDocumentHandle.renderPage', () => {
  it('resolves with a RenderedPage whose canvas comes from the injectable factory', async () => {
    const fakeDoc = createFakeDoc({ pageSizePt: { widthPt: 612, heightPt: 792 } });
    mockSuccessfulOpen(fakeDoc);
    const canvas = createFakeCanvas();
    const createCanvas = vi.fn(() => canvas);

    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), { createCanvas });
    const renderPromise = handle.renderPage(0, { scale: 1 });
    await flushMicrotasks();

    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    const rendered = await renderPromise;

    expect(rendered.canvas).toBe(canvas);
    expect(rendered.width).toBe(612);
    expect(rendered.height).toBe(792);
    expect(fakeDoc.pageFor(1).cleanupCalls()).toBe(1);
  });

  it('rejects with an AbortError when the signal aborts before the render task is created', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });
    const controller = new AbortController();

    const renderPromise = handle.renderPage(0, { scale: 1, signal: controller.signal });
    controller.abort();

    await expect(renderPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(0);
  });

  it('rejects with an AbortError and cancels the task when the signal aborts once rendering has started', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });
    const controller = new AbortController();

    const renderPromise = handle.renderPage(0, { scale: 1, signal: controller.signal });
    await flushMicrotasks();
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);

    controller.abort();

    await expect(renderPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakeDoc.pageFor(1).renderTasks[0]?.cancel).toHaveBeenCalled();
  });

  it('rejects immediately with an AbortError when the signal is already aborted', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      handle.renderPage(0, { scale: 1, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('cancels a previous in-flight render when a new render starts, and only the new one resolves', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const firstRenderPromise = handle.renderPage(0, { scale: 1 });
    // Let the first render's `doc.getPage` microtask resolve so its render task exists.
    await flushMicrotasks();

    const secondRenderPromise = handle.renderPage(0, { scale: 2 });
    await flushMicrotasks();

    const tasks = fakeDoc.pageFor(1).renderTasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.cancel).toHaveBeenCalled();

    await expect(firstRenderPromise).rejects.toMatchObject({ name: 'AbortError' });

    tasks[1]?.resolve();
    const second = await secondRenderPromise;
    expect(second.width).toBe(1224);
  });

  it('releases the canvas backing store when release() is called', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const canvas = createFakeCanvas();
    canvas.width = 999;
    canvas.height = 999;
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), { createCanvas: () => canvas });

    const renderPromise = handle.renderPage(0, { scale: 1 });
    await flushMicrotasks();
    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    const rendered = await renderPromise;

    rendered.release();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});

/**
 * Regression coverage for the defect where a reader re-render (always
 * `purpose: 'display'`, the default) silently killed an in-flight diagram
 * capture (`purpose: 'capture'`): starting recognition swapped toolbar text,
 * which could change the measured page width and re-trigger the reader's
 * display render, cancelling the capture's render out from under it and
 * showing "Recognition cancelled." on a perfectly good diagram. Each `it`
 * below is named after the numbered rule it exists to pin down.
 */
describe('PdfDocumentHandle.renderPage queue (purpose semantics)', () => {
  it('rule 1: at most one pdf.js render task runs at a time, even across purposes', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const displayPromise = handle.renderPage(0, { scale: 1, purpose: 'display' });
    await flushMicrotasks();
    const capturePromise = handle.renderPage(0, { scale: 2, purpose: 'capture' });
    await flushMicrotasks();

    // The capture is queued, not started: only the display render's task exists.
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);

    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    await displayPromise;
    await flushMicrotasks();

    // Only now, with the display render finished, does the capture's task start.
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(2);

    fakeDoc.pageFor(1).renderTasks[1]?.resolve();
    const capture = await capturePromise;
    expect(capture.width).toBe(1224); // scale 2 * 612pt
  });

  it('rule 3/4: a capture render is never cancelled by a later display render', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const capturePromise = handle.renderPage(0, { scale: 1, purpose: 'capture' });
    await flushMicrotasks();
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);

    // A display render arrives while the capture is actually running. It must
    // queue behind the capture, not cancel it.
    const displayPromise = handle.renderPage(0, { scale: 2, purpose: 'display' });
    await flushMicrotasks();

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);
    expect(fakeDoc.pageFor(1).renderTasks[0]?.cancel).not.toHaveBeenCalled();

    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    const capture = await capturePromise;
    expect(capture.width).toBe(612); // scale 1

    await flushMicrotasks();
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(2);
    fakeDoc.pageFor(1).renderTasks[1]?.resolve();
    const display = await displayPromise;
    expect(display.width).toBe(1224); // scale 2
  });

  it('rule 2: a later display render still cancels a running or queued display render', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    // Occupy the runner with a capture so both display renders below start out queued.
    const capturePromise = handle.renderPage(0, { scale: 1, purpose: 'capture' });
    await flushMicrotasks();

    const firstDisplayPromise = handle.renderPage(0, { scale: 2, purpose: 'display' });
    const secondDisplayPromise = handle.renderPage(0, { scale: 3, purpose: 'display' });
    await flushMicrotasks();

    // The first (queued, not yet started) display render is cancelled immediately,
    // without ever creating a pdf.js render task for it.
    await expect(firstDisplayPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);

    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    await capturePromise;
    await flushMicrotasks();

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(2);
    fakeDoc.pageFor(1).renderTasks[1]?.resolve();
    const secondDisplay = await secondDisplayPromise;
    expect(secondDisplay.width).toBe(1836); // scale 3
  });

  it('rule 5: multiple queued captures run in FIFO order', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const occupantPromise = handle.renderPage(0, { scale: 1, purpose: 'display' });
    await flushMicrotasks();

    const firstCapturePromise = handle.renderPage(0, { scale: 2, purpose: 'capture' });
    const secondCapturePromise = handle.renderPage(0, { scale: 3, purpose: 'capture' });
    await flushMicrotasks();

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);
    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    await occupantPromise;
    await flushMicrotasks();

    // The first-queued capture (scale 2), not the second (scale 3), starts next.
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(2);

    fakeDoc.pageFor(1).renderTasks[1]?.resolve();
    const firstCapture = await firstCapturePromise;
    expect(firstCapture.width).toBe(1224); // scale 2
    await flushMicrotasks();

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(3);
    fakeDoc.pageFor(1).renderTasks[2]?.resolve();
    const secondCapture = await secondCapturePromise;
    expect(secondCapture.width).toBe(1836); // scale 3
  });

  it("rule 7: a queued capture's own signal cancels only that capture, not a sibling", async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const occupantPromise = handle.renderPage(0, { scale: 1, purpose: 'display' });
    await flushMicrotasks();

    const controllerA = new AbortController();
    const capturePromiseA = handle.renderPage(0, {
      scale: 2,
      purpose: 'capture',
      signal: controllerA.signal,
    });
    const capturePromiseB = handle.renderPage(0, { scale: 3, purpose: 'capture' });

    // Cancel A while it is still queued (not yet started): it must reject
    // right away, without waiting for its turn, and without touching B or the
    // still-running occupant.
    controllerA.abort();
    await expect(capturePromiseA).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);
    expect(fakeDoc.pageFor(1).renderTasks[0]?.cancel).not.toHaveBeenCalled();

    fakeDoc.pageFor(1).renderTasks[0]?.resolve();
    await occupantPromise;
    await flushMicrotasks();

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(2);
    fakeDoc.pageFor(1).renderTasks[1]?.resolve();
    const captureB = await capturePromiseB;
    expect(captureB.width).toBe(1836); // scale 3, unaffected by A's cancellation
  });

  it('rule 7 (running): a signal still cancels only its own render once it is running', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const controllerA = new AbortController();
    const capturePromiseA = handle.renderPage(0, {
      scale: 1,
      purpose: 'capture',
      signal: controllerA.signal,
    });
    await flushMicrotasks();
    const capturePromiseB = handle.renderPage(0, { scale: 2, purpose: 'capture' });
    await flushMicrotasks();

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);
    controllerA.abort();

    await expect(capturePromiseA).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakeDoc.pageFor(1).renderTasks[0]?.cancel).toHaveBeenCalled();

    await flushMicrotasks();
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(2);
    fakeDoc.pageFor(1).renderTasks[1]?.resolve();
    const captureB = await capturePromiseB;
    expect(captureB.width).toBe(1224); // scale 2, unaffected by A's cancellation
  });
});

describe('PdfDocumentHandle.dispose', () => {
  it('destroys the loading task and cancels an in-flight render', async () => {
    const fakeDoc = createFakeDoc();
    const loadingTask = mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const renderPromise = handle.renderPage(0, { scale: 1 });
    await flushMicrotasks();

    handle.dispose();

    expect(loadingTask.destroy).toHaveBeenCalled();
    expect(fakeDoc.pageFor(1).renderTasks[0]?.cancel).toHaveBeenCalled();
    await expect(renderPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is idempotent', async () => {
    const fakeDoc = createFakeDoc();
    const loadingTask = mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES));

    handle.dispose();
    handle.dispose();

    expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects further use with a plain (non-PdfOpenError) Error', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES));

    handle.dispose();

    await expect(handle.getPageSize(0)).rejects.toThrow(/disposed/);
  });

  it('rule 6/8: cancels a running render and rejects every queued render (of either purpose) rather than hanging', async () => {
    const fakeDoc = createFakeDoc();
    mockSuccessfulOpen(fakeDoc);
    const handle = await openPdfDocument(makeFile(VALID_PDF_BYTES), {
      createCanvas: createFakeCanvas,
    });

    const runningPromise = handle.renderPage(0, { scale: 1, purpose: 'capture' });
    await flushMicrotasks();
    // These two never even get a pdf.js render task created before dispose():
    // their "turn" in the queue never comes.
    const queuedDisplayPromise = handle.renderPage(0, { scale: 2, purpose: 'display' });
    const queuedCapturePromise = handle.renderPage(0, { scale: 3, purpose: 'capture' });

    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);

    handle.dispose();

    await expect(runningPromise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queuedDisplayPromise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queuedCapturePromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakeDoc.pageFor(1).renderTasks[0]?.cancel).toHaveBeenCalled();
    // The queued renders were rejected outright; pdf.js never rendered them.
    expect(fakeDoc.pageFor(1).renderTasks).toHaveLength(1);
  });
});
