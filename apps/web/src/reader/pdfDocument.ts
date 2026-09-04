/**
 * PDF.js adapter for the walking slice (issue #2). Everything that knows about
 * `pdfjs-dist` lives in this module; `reader/PdfReader.tsx`, `capture/*`, and every
 * other module in the app depend only on the plain types exported here.
 *
 * `wasmUrl` and `iccUrl` are self-hosted from the pinned `pdfjs-dist` package
 * (see `pdfAssets.ts` for the URL policy, `vite.config.ts`'s
 * `pdfjsAssetsPlugin` for how the bytes are copied out of
 * `node_modules/pdfjs-dist` at dev/build time from an explicit, hash-verified
 * allow-list — never committed to the repo, never a whole directory — and
 * `NOTICE.md` for the full per-file license review). Leaving `wasmUrl` unset
 * is not a safe "just degrades text/images" fallback: pdfjs-dist 6.3.289's
 * worker decodes JBIG2 (bitonal scans — what scanned chess books use) and
 * JPX/JPEG2000 images with WebAssembly loaded from `wasmUrl`, and with the
 * option unset the worker requests the literal URL `"nulljbig2.wasm"`, that
 * fetch fails, its `import("nulljbig2_nowasm_fallback.js")` fallback also
 * fails, and the decoder silently resolves to `null` — so the image is never
 * drawn at all and the page renders as blank white space (confirmed in
 * `pdf.worker.mjs`'s `WasmImage#instantiateWasm`/`#getJsModule`). `iccUrl`
 * covers the one CMYK ICC profile qcms reads and is self-hosted the same way.
 *
 * `cMapUrl` and `standardFontDataUrl` are deliberately still left unset: this
 * app does not self-host Adobe CMaps or standard fonts. CMaps are 1.5 MB of
 * CJK/multi-byte support not needed by either reported defect. Standard fonts
 * are GPLv2-licensed Liberation fonts whose "document embedding" exception
 * covers documents that embed the font, not an app redistributing the font
 * files themselves to browsers — that is a genuine copyleft obligation this
 * change does not take on as a side effect of a bug fix. `useSystemFonts`
 * defaults to `true` in browsers, so non-embedded standard fonts still fall
 * back to a system font rather than failing to render. See `NOTICE.md`.
 *
 * No network fetch is ever made for either self-hosted asset: every URL is
 * same-origin and base-relative, so this still holds even offline.
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

import { getPdfjsAssetUrls } from './pdfAssets';

// Configured once at module load. `getDocument` creates a `PDFWorker` lazily using
// this URL; every worker/session shares the same self-hosted, offline-safe script.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Resolved once at module load from the deployed `base` (never a hardcoded
// `/`), so this still points at the right same-origin path when the app is
// served from a sub-path such as GitHub Pages' `/chess-reader/`.
const pdfjsAssetUrls = getPdfjsAssetUrls(import.meta.env.BASE_URL);

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

/**
 * `'display'` (the default) is the reader's own on-screen page render:
 * "latest wins", so starting one cancels any other `'display'` render that is
 * running or still queued. `'capture'` is a diagram/region capture: it must
 * never be cancelled by unrelated `'display'` activity (a toolbar reflow
 * mid-selection must not silently kill an in-flight capture — see
 * `capture/capturePdfRegion.ts`), so it only queues behind whatever is
 * currently rendering and is cancelled solely by its own `signal` or by
 * `dispose()`.
 */
export type RenderPurpose = 'display' | 'capture';

export interface RenderPageOptions {
  readonly scale: number;
  readonly signal?: AbortSignal;
  /** Defaults to `'display'`. */
  readonly purpose?: RenderPurpose;
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
   * Renders `pageIndex` (zero-based) at `scale`. Renders queue rather than
   * cross-cancel: at most one pdf.js render task ever runs at a time per
   * handle (pdf.js cannot run two concurrent `render()` calls against the
   * same cached `PDFPageProxy`), but a `'capture'` render is never cancelled
   * by a later call of either purpose — only its own `signal` or `dispose()`
   * cancels it. A later `'display'` render still cancels any running or
   * queued `'display'` render (including this one), rejecting the superseded
   * call(s) with an `AbortError`-named error, so paging quickly still feels
   * instant. Multiple queued `'capture'` renders run in FIFO order. See
   * `RenderPurpose`.
   */
  renderPage(pageIndex: number, options: RenderPageOptions): Promise<RenderedPage>;
  /**
   * Cancels every running and queued render (of either purpose) and destroys
   * the underlying document/worker. Every render promise still pending at
   * that point settles — rejecting with an `AbortError`-named error — rather
   * than hanging forever, even one whose turn in the queue had not yet come.
   */
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

/**
 * One `renderPage()` call's queue entry. A handle keeps these in a single
 * FIFO array (`queue` in `createHandle`); the entry at index 0 is either
 * about to run or already running (it stays at index 0, not removed, until it
 * settles), everything behind it is still waiting its turn.
 *
 * `settled`/`task` are read fresh from this object at every checkpoint inside
 * `runJob` rather than trusted from a value captured before an `await` — a
 * concurrent `dispose()`, a sibling `renderPage()` display-sweep, or this same
 * job's own `signal` can all call `settleJob`/mutate `task` while `runJob` is
 * suspended, and TypeScript's local flow narrowing does not account for that.
 */
interface RenderJob {
  readonly purpose: RenderPurpose;
  readonly pageIndex: number;
  readonly scale: number;
  // Always explicitly assigned (possibly to `undefined`) when a job is
  // created, so this is a required field typed `AbortSignal | undefined`
  // rather than an optional `signal?: AbortSignal` -- under
  // `exactOptionalPropertyTypes`, an optional property may not be assigned a
  // value of type `T | undefined`, only omitted entirely or given a `T`.
  readonly signal: AbortSignal | undefined;
  readonly resolve: (page: RenderedPage) => void;
  readonly reject: (error: unknown) => void;
  /** Once true, this job's promise has settled; it must never settle again. */
  settled: boolean;
  /** Set once `page.render()` has actually been called for this job. */
  task: RenderTask | null;
  abortListener: (() => void) | null;
}

function createHandle(
  doc: PDFDocumentProxy,
  loadingTask: PDFDocumentLoadingTask,
  createCanvas: CanvasFactory,
): PdfDocumentHandle {
  let disposed = false;
  // FIFO queue of every render not yet settled. `queue[0]`, once `runnerActive`
  // is true, is the one job actually inside a pdf.js `render()` call; it is
  // deliberately left in the array (not shifted out) until it settles, so
  // "is this job still running or waiting its turn" is just "is it still in
  // `queue`" for every other piece of code here.
  const queue: RenderJob[] = [];
  let runnerActive = false;

  function removeFromQueue(job: RenderJob): void {
    const index = queue.indexOf(job);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  /**
   * Takes `job` and the disposed flag as fresh parameters (rather than
   * inlining `job.settled || disposed` at each call site) for the same
   * reason the original single-slot implementation's `isActiveRender`/
   * `isRenderSuperseded` helpers did: both are shared state that a
   * *different*, concurrently in-flight `cancelJob`/`dispose()` call can
   * change while `runJob` is suspended at an `await` -- TypeScript's flow
   * narrowing does not invalidate an earlier `if (!isJobSupersededOrDisposed(...))`
   * check across that `await`, so inlining the same expression again later in
   * the same function gets (incorrectly, for this concurrent case) narrowed
   * to a constant.
   */
  function isJobSupersededOrDisposed(job: RenderJob, isDisposedFlag: boolean): boolean {
    return job.settled || isDisposedFlag;
  }

  /**
   * The single place a job's promise is allowed to settle. Guarded by
   * `job.settled` so a job cancelled early (while merely queued, or while
   * still awaiting `doc.getPage()` before it has a `task`) can never be
   * settled a second time by `runJob` catching up with it later.
   */
  function settleJob(job: RenderJob, settle: () => void): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    removeFromQueue(job);
    if (job.abortListener) {
      job.signal?.removeEventListener('abort', job.abortListener);
      job.abortListener = null;
    }
    settle();
  }

  /**
   * Cancels `job` regardless of whether it is currently running, still
   * queued, or (a narrow window) already dequeued-but-not-yet-marked-settled.
   * Running jobs are cancelled through pdf.js itself (`task.cancel()`); its
   * resulting `RenderingCancelledException` is caught inside `runJob`, which
   * settles the job there. Anything without a `task` yet is settled directly
   * here — rejecting it now rather than waiting for its turn (which may never
   * come, or may be arbitrarily delayed by whatever runs first).
   */
  function cancelJob(job: RenderJob): void {
    if (job.settled) {
      return;
    }
    if (job.task) {
      job.task.cancel();
      return;
    }
    settleJob(job, () => {
      job.reject(new PdfRenderAbortError());
    });
  }

  function processQueue(): void {
    if (runnerActive) {
      return;
    }
    const next = queue[0];
    if (!next) {
      return;
    }
    runnerActive = true;
    void runJob(next);
  }

  async function runJob(job: RenderJob): Promise<void> {
    try {
      if (job.settled) {
        // Already cancelled while queued, before ever getting its turn.
        return;
      }
      if (disposed) {
        settleJob(job, () => {
          job.reject(new PdfRenderAbortError());
        });
        return;
      }

      let page: PDFPageProxy;
      try {
        page = await doc.getPage(job.pageIndex + 1);
      } catch (error) {
        settleJob(job, () => {
          job.reject(disposed ? new PdfRenderAbortError() : error);
        });
        return;
      }

      // `job.settled`/`disposed` may have changed while the `await` above was
      // suspended (a sibling display-sweep, this job's own `signal`, or
      // `dispose()`); pdf.js has no `RenderTask` to cancel yet, so check
      // explicitly (through `isJobSupersededOrDisposed`, not by inlining
      // `job.settled || disposed` again -- see that helper's comment) rather
      // than relying on a cancellation event that already fired with nothing
      // listening.
      if (isJobSupersededOrDisposed(job, disposed)) {
        page.cleanup();
        settleJob(job, () => {
          job.reject(new PdfRenderAbortError());
        });
        return;
      }

      const viewport = page.getViewport({ scale: job.scale });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));
      const canvas = createCanvas(width, height);
      const context = get2dContext(canvas);
      if (!context) {
        page.cleanup();
        settleJob(job, () => {
          job.reject(new Error('Unable to obtain a 2D rendering context to render this page.'));
        });
        return;
      }

      const task = page.render({
        canvas,
        canvasContext: context,
        viewport,
      } as unknown as RenderParams);
      job.task = task;

      try {
        await task.promise;
      } catch (error) {
        page.cleanup();
        if (isRenderCancelled(error) || isJobSupersededOrDisposed(job, disposed)) {
          settleJob(job, () => {
            job.reject(new PdfRenderAbortError());
          });
        } else {
          settleJob(job, () => {
            job.reject(error);
          });
        }
        return;
      }

      page.cleanup();

      if (isJobSupersededOrDisposed(job, disposed)) {
        releaseCanvas(canvas);
        settleJob(job, () => {
          job.reject(new PdfRenderAbortError());
        });
        return;
      }

      settleJob(job, () => {
        job.resolve({
          canvas,
          width,
          height,
          release(): void {
            releaseCanvas(canvas);
          },
        });
      });
    } catch (error) {
      // Any unexpected synchronous failure above (for example `page.render()`
      // throwing outright rather than rejecting its task) must still settle
      // this job's promise -- nothing else awaits `runJob`'s own returned
      // promise, so an unsettled job here would otherwise hang forever.
      settleJob(job, () => {
        job.reject(error);
      });
    } finally {
      runnerActive = false;
      // Keep draining even once `disposed` is true: every job still in
      // `queue` needs its turn at the `if (disposed)` check above so its
      // promise actually settles instead of hanging.
      processQueue();
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
      const { scale, signal, purpose = 'display' } = options;

      let resolveJob!: (page: RenderedPage) => void;
      let rejectJob!: (error: unknown) => void;
      const promise = new Promise<RenderedPage>((resolve, reject) => {
        resolveJob = resolve;
        rejectJob = reject;
      });

      const job: RenderJob = {
        purpose,
        pageIndex,
        scale,
        signal,
        resolve: resolveJob,
        reject: rejectJob,
        settled: false,
        task: null,
        abortListener: null,
      };

      if (signal) {
        const abortListener = (): void => {
          cancelJob(job);
        };
        job.abortListener = abortListener;
        signal.addEventListener('abort', abortListener, { once: true });
      }

      if (purpose === 'display') {
        // "Latest display wins": cancel every OTHER display render that is
        // currently running or still waiting its turn (rule: a 'display'
        // render cancels running/queued 'display' renders). `job` itself is
        // not in `queue` yet, so this can never cancel itself. Capture
        // renders are deliberately left untouched here.
        //
        // Iterates a copy because `cancelJob` can settle a not-yet-started job
        // synchronously, and `settleJob` splices it out of `queue` — mutating
        // the array mid-iteration would shift an unvisited entry into an index
        // the loop has already passed, silently skipping it. Today the push
        // below keeps at most one display job in `queue`, so no two removable
        // display jobs can be adjacent and the skip is unreachable; the copy
        // keeps it that way if that invariant is ever relaxed.
        for (const other of [...queue]) {
          if (other.purpose === 'display') {
            cancelJob(other);
          }
        }
      }
      // A 'capture' render cancels nothing: it simply queues behind whatever
      // is running, exactly like a second capture would.

      queue.push(job);

      // An already-aborted signal never fires a fresh 'abort' event (the
      // listener above only catches an abort that happens *after* this
      // call), so check explicitly too.
      if (signal?.aborted) {
        cancelJob(job);
      }

      processQueue();

      return promise;
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      // Cancelling the one running job (if any) is enough to start the
      // cascade: its settlement triggers `runJob`'s `finally`, which calls
      // `processQueue()` again, and every remaining queued job now hits the
      // `if (disposed)` check at the top of `runJob` and settles in turn.
      const running = queue[0];
      if (running?.task) {
        running.task.cancel();
      }
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

  const loadingTask = getDocument({
    data,
    disableAutoFetch: true,
    wasmUrl: pdfjsAssetUrls.wasmUrl,
    iccUrl: pdfjsAssetUrls.iccUrl,
  });

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
