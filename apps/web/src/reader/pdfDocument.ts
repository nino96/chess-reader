/**
 * PDF.js adapter for the walking slice (issue #2). Everything that knows about
 * `pdfjs-dist` lives in this module; `reader/PdfReader.tsx`, `capture/*`, and every
 * other module in the app depend only on the plain types exported here.
 *
 * Deferred to issue #5 (per docs/architecture.md §6): CMap, standard-font, and
 * WASM (JBIG2/JPX) self-hosting. `cMapUrl`, `standardFontDataUrl`, and `wasmUrl`
 * are intentionally left unset so pdf.js never attempts a network request; PDFs
 * that need embedded CMaps/standard fonts or wasm-accelerated image codecs may
 * render with degraded text/images until issue #5 self-hosts those assets.
 *
 * `isEvalSupported` is deliberately not passed to `getDocument`: pdfjs-dist
 * 6.3.289 removed that option (its `DocumentInitParameters` type no longer
 * declares it) because the library no longer evaluates font glyph expressions
 * with `eval`, so there is nothing left for the flag to disable.
 *
 * A real-PDF integration test is not possible here: jsdom has no canvas 2D
 * context and no WebAssembly-backed PDF worker, so pdf.js cannot actually parse
 * or render a document in this test environment. This file's tests mock
 * `pdfjs-dist` entirely and only verify this adapter's own validation,
 * cancellation, and mapping logic. Real rendering is exercised by the browser
 * E2E suite (`docs/evaluation.md` §3/§7) once a reader flow consumes it.
 */
import {
  AbortException,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  RenderingCancelledException,
  getDocument,
} from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configured once at module load. `getDocument` creates a `PDFWorker` lazily using
// this URL; every worker/session shares the same self-hosted, offline-safe script.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The five leading bytes of every valid PDF file: `"%PDF-"`. */
const PDF_HEADER_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

/** Default size ceiling for `openPdfDocument`, matching docs/architecture.md's bounded-work rule. */
export const DEFAULT_MAX_PDF_BYTES = 256 * 1024 * 1024;

export type PdfOpenErrorCode =
  'too-large' | 'not-a-pdf' | 'password' | 'corrupt' | 'aborted' | 'unsupported';

/**
 * Thrown by `openPdfDocument`. `message` is always safe to show to the user and
 * never includes the source file's name or path.
 */
export class PdfOpenError extends Error {
  readonly code: PdfOpenErrorCode;

  constructor(code: PdfOpenErrorCode, message: string) {
    super(message);
    this.name = 'PdfOpenError';
    this.code = code;
  }
}

/** Thrown by `PdfDocumentHandle.renderPage` when a render is cancelled or superseded. */
class PdfRenderAbortError extends Error {
  constructor(message = 'Rendering this page was cancelled.') {
    super(message);
    this.name = 'AbortError';
  }
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;

export interface OpenPdfDocumentOptions {
  readonly signal?: AbortSignal;
  /** Size ceiling in bytes. Defaults to `DEFAULT_MAX_PDF_BYTES` (256 MiB). */
  readonly maxBytes?: number;
  /** Injectable canvas factory, defaulting to `OffscreenCanvas` when available. */
  readonly createCanvas?: CanvasFactory;
}

export interface PdfPageSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

export interface RenderPageOptions {
  readonly scale: number;
  readonly signal?: AbortSignal;
}

export interface RenderedPage {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
  /** Releases the canvas backing store immediately; safe to call more than once. */
  release(): void;
}

export interface PdfDocumentHandle {
  readonly pageCount: number;
  getPageSize(pageIndex: number): Promise<PdfPageSize>;
  /**
   * Renders `pageIndex` (zero-based) at `scale`. Only one render may be in
   * flight per handle: starting a new render cancels whatever render was
   * previously in flight, and that previous call's promise rejects with an
   * `AbortError`-named error. Cancelling via `signal` behaves the same way.
   */
  renderPage(pageIndex: number, options: RenderPageOptions): Promise<RenderedPage>;
  /** Cancels any in-flight render and destroys the underlying document/worker. */
  dispose(): void;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PdfOpenError('aborted', 'Opening this PDF was cancelled.');
  }
}

function hasPdfHeader(header: Uint8Array): boolean {
  if (header.length < PDF_HEADER_BYTES.length) {
    return false;
  }
  return PDF_HEADER_BYTES.every((byte, index) => header[index] === byte);
}

// Checked as `instanceof Blob` (true for `File` too, since `File extends Blob`) rather
// than `instanceof ArrayBuffer`: a test/runtime environment can host more than one
// realm's `ArrayBuffer` constructor (e.g. Node's built-in vs. jsdom's window), which
// makes `instanceof ArrayBuffer` unreliable, while `Blob`/`File` detection is not
// affected the same way here.
function isBlobLike(source: File | Blob | ArrayBuffer): source is File | Blob {
  return source instanceof Blob;
}

async function readHeaderBytes(source: File | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (isBlobLike(source)) {
    const buffer = await source.slice(0, PDF_HEADER_BYTES.length).arrayBuffer();
    return new Uint8Array(buffer);
  }
  return new Uint8Array(source.slice(0, PDF_HEADER_BYTES.length));
}

async function readAllBytes(source: File | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (isBlobLike(source)) {
    const buffer = await source.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return new Uint8Array(source);
}

function sourceByteLength(source: File | Blob | ArrayBuffer): number {
  return isBlobLike(source) ? source.size : source.byteLength;
}

function formatMebibytes(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MiB`;
}

function mapOpenError(error: unknown): PdfOpenError {
  if (error instanceof PdfOpenError) {
    return error;
  }
  if (error instanceof PasswordException) {
    return new PdfOpenError(
      'password',
      'This PDF is password protected. Open an unprotected copy of this file.',
    );
  }
  // `UnknownErrorException` exists in pdf.js but is not part of its public `pdfjs-dist`
  // export surface, so it cannot be checked here by `instanceof`; it falls through to
  // the generic 'unsupported' mapping below along with any other unrecognized error.
  if (error instanceof InvalidPDFException) {
    return new PdfOpenError(
      'corrupt',
      'This PDF could not be read. It may be corrupted or incomplete.',
    );
  }
  if (error instanceof AbortException) {
    return new PdfOpenError('aborted', 'Opening this PDF was cancelled.');
  }
  return new PdfOpenError(
    'unsupported',
    'This PDF could not be opened. It may use a feature this reader does not support yet.',
  );
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Narrow structural view of the 2D context surface both canvas kinds share. */
interface Canvas2DLike {
  getContext(contextId: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

function get2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return (canvas as unknown as Canvas2DLike).getContext('2d');
}

/**
 * Takes the disposed flag and render counter as fresh parameters (rather than reading
 * the `disposed`/`renderCounter` closure variables directly in an `if`) for the same
 * reason as `isActiveRender` above: both are shared handle-level state that a
 * concurrent `dispose()` or a newer `renderPage()` call can change while this call is
 * suspended at `await`, which TypeScript's local flow narrowing does not account for.
 */
function isRenderSuperseded(
  isDisposedFlag: boolean,
  currentRenderCounter: number,
  expectedRenderId: number,
): boolean {
  return isDisposedFlag || currentRenderCounter !== expectedRenderId;
}

function releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  // Shrinking the backing store releases GPU/CPU memory immediately rather than
  // waiting for garbage collection (docs/architecture.md §6: "release canvases promptly").
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * pdfjs-dist's published types still declare `render()`'s `canvas` field as
 * `HTMLCanvasElement | null`, but pdf.js itself accepts `OffscreenCanvas` (it
 * uses one internally in the worker). This app intentionally renders through
 * either kind via the injectable `createCanvas` factory, so the call is made
 * through `unknown` rather than importing `RenderParameters` and lying about it.
 */
type RenderParams = Parameters<PDFPageProxy['render']>[0];

function isRenderCancelled(error: unknown): boolean {
  return error instanceof RenderingCancelledException;
}

function assertNotDisposed(disposed: boolean): void {
  if (disposed) {
    throw new Error('This PDF document has already been disposed.');
  }
}

function assertValidPageIndex(pageIndex: number, pageCount: number): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new RangeError(
      `Page index ${String(pageIndex)} is out of range for a ${String(pageCount)}-page document.`,
    );
  }
}

interface ActiveRender {
  readonly id: number;
  readonly task: RenderTask;
  readonly page: PDFPageProxy;
}

/**
 * Takes `candidate` as a fresh parameter (rather than inlining `activeRender?.id`) so
 * TypeScript re-checks its declared `ActiveRender | null` type instead of narrowing it to
 * non-null from an assignment earlier in `renderPage` — that narrowing would be unsound
 * here, since `activeRender` is shared closure state that a *different*, concurrently
 * in-flight call to `renderPage` can null out (via `cancelActiveRender`) while this call
 * is suspended at `await`.
 */
function isActiveRender(candidate: ActiveRender | null, id: number): boolean {
  return candidate !== null && candidate.id === id;
}

function createHandle(
  doc: PDFDocumentProxy,
  loadingTask: PDFDocumentLoadingTask,
  createCanvas: CanvasFactory,
): PdfDocumentHandle {
  let disposed = false;
  let renderCounter = 0;
  let activeRender: ActiveRender | null = null;

  function cancelActiveRender(): void {
    if (activeRender) {
      activeRender.task.cancel();
      activeRender.page.cleanup();
      activeRender = null;
    }
  }

  return {
    pageCount: doc.numPages,

    async getPageSize(pageIndex: number): Promise<PdfPageSize> {
      assertNotDisposed(disposed);
      assertValidPageIndex(pageIndex, doc.numPages);
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      return { widthPt: viewport.width, heightPt: viewport.height };
    },

    async renderPage(pageIndex: number, options: RenderPageOptions): Promise<RenderedPage> {
      assertNotDisposed(disposed);
      assertValidPageIndex(pageIndex, doc.numPages);
      const { scale, signal } = options;

      // Only one render may be in flight per handle; starting a new one cancels the
      // previous one (its `renderPage` promise rejects with an AbortError below).
      cancelActiveRender();

      if (signal?.aborted) {
        throw new PdfRenderAbortError();
      }

      const renderId = ++renderCounter;
      const page = await doc.getPage(pageIndex + 1);

      // The abort listener is only attached below (pdf.js needs a `RenderTask` to
      // cancel), so a signal that fires during this `await` would otherwise go
      // unnoticed: the 'abort' event does not replay for a listener added after it
      // fires. Re-check explicitly to close that gap.
      if (isRenderSuperseded(disposed, renderCounter, renderId) || signal?.aborted) {
        page.cleanup();
        throw new PdfRenderAbortError();
      }

      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));
      const canvas = createCanvas(width, height);
      const context = get2dContext(canvas);
      if (!context) {
        page.cleanup();
        throw new Error('Unable to obtain a 2D rendering context to render this page.');
      }

      const task = page.render({
        canvas,
        canvasContext: context,
        viewport,
      } as unknown as RenderParams);
      activeRender = { id: renderId, task, page };

      const abortListener = (): void => {
        task.cancel();
      };
      signal?.addEventListener('abort', abortListener, { once: true });

      try {
        await task.promise;
      } catch (error) {
        if (isRenderCancelled(error) || signal?.aborted === true) {
          throw new PdfRenderAbortError();
        }
        throw error;
      } finally {
        signal?.removeEventListener('abort', abortListener);
        page.cleanup();
        if (isActiveRender(activeRender, renderId)) {
          activeRender = null;
        }
      }

      if (isRenderSuperseded(disposed, renderCounter, renderId)) {
        releaseCanvas(canvas);
        throw new PdfRenderAbortError();
      }

      return {
        canvas,
        width,
        height,
        release(): void {
          releaseCanvas(canvas);
        },
      };
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelActiveRender();
      void loadingTask.destroy();
    },
  };
}

/**
 * Opens a local PDF for reading. Validates size and header before ever handing
 * bytes to pdf.js, and never reads more of the source than necessary to do so.
 */
export async function openPdfDocument(
  source: File | Blob | ArrayBuffer,
  options: OpenPdfDocumentOptions = {},
): Promise<PdfDocumentHandle> {
  const { signal, maxBytes = DEFAULT_MAX_PDF_BYTES, createCanvas = defaultCreateCanvas } = options;

  throwIfAborted(signal);

  const size = sourceByteLength(source);
  if (size > maxBytes) {
    throw new PdfOpenError(
      'too-large',
      `This PDF is larger than the ${formatMebibytes(maxBytes)} limit for this reader. Choose a smaller file.`,
    );
  }

  const header = await readHeaderBytes(source);
  throwIfAborted(signal);
  if (!hasPdfHeader(header)) {
    throw new PdfOpenError('not-a-pdf', 'This file does not look like a PDF document.');
  }

  const data = await readAllBytes(source);
  throwIfAborted(signal);

  const loadingTask = getDocument({ data, disableAutoFetch: true });

  if (signal?.aborted) {
    void loadingTask.destroy();
    throw new PdfOpenError('aborted', 'Opening this PDF was cancelled.');
  }

  let doc: PDFDocumentProxy;
  try {
    doc = await raceAbort(loadingTask.promise, signal, () => {
      void loadingTask.destroy();
    });
  } catch (error) {
    void loadingTask.destroy();
    throw mapOpenError(error);
  }

  return createHandle(doc, loadingTask, createCanvas);
}

function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => {
      onAbort();
      reject(new PdfOpenError('aborted', 'Opening this PDF was cancelled.'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort);
        // Forward the original rejection reason unchanged (not necessarily an `Error`
        // instance) so the caller's `mapOpenError` can still `instanceof`-check it.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      },
    );
  });
}
