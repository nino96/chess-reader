import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import './PdfReader.css';
import { openPdfDocument as defaultOpenPdfDocument } from './pdfDocument';
import type { PdfDocumentHandle, PdfPageSize, RenderedPage } from './pdfDocument';
import type { PdfPageLocator } from '../study/contracts';

/** Fallback measured width used before the container has ever been measured (e.g. in jsdom). */
const DEFAULT_DISPLAY_WIDTH_PX = 800;
/**
 * A page is scaled down so that it also fits the viewport height, minus room for the
 * app header and reader controls, so a laptop user sees a whole page (and its diagrams)
 * without scrolling. The floor keeps very short viewports from producing an unusably
 * small page; those simply scroll.
 */
const VIEWPORT_HEIGHT_RESERVE_PX = 220;
const MIN_FIT_HEIGHT_PX = 320;

function measureAvailableHeight(): number {
  if (typeof window === 'undefined' || !Number.isFinite(window.innerHeight)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(MIN_FIT_HEIGHT_PX, window.innerHeight - VIEWPORT_HEIGHT_RESERVE_PX);
}

/**
 * Render resolution ceiling, per docs/architecture.md §6 ("release canvases promptly";
 * an unbounded rendered-page allocation is forbidden). Expressed as a total device-pixel
 * budget (`width * height`) rather than a long-edge limit: a long-edge cap only bounds
 * one axis, so a page whose other axis is not proportionally reduced can still allocate
 * far more memory than the long-edge number suggests, while a pixel-count budget bounds
 * the actual canvas allocation directly.
 *
 * Budget: 8,000,000 device pixels (8 MP). The binding constraint is iPad Safari, a named
 * target platform (`docs/platform-limitations.md` §7), which enforces an undocumented
 * ceiling on canvas area and total canvas memory and *silently yields a blank canvas*
 * when a page crosses it. A blank page is precisely the failure mode this reader was
 * just fixed for, so the budget deliberately sits well below any plausible ceiling
 * rather than as close to it as a desktop could tolerate. Two canvases of this size
 * exist simultaneously during a render (pdf.js's own render target and this on-screen
 * one), so the budget must be read as half of the real peak.
 *
 * The budget is chosen so a *normal* page on a real target device is never capped. This
 * app's shell caps displayed content to 72rem (~1120 CSS px after padding; see
 * `styles/global.css` `.app-main`), so the largest realistic page is bounded:
 *   - dpr 2 (Retina laptop, iPad), a ~1120x1584 CSS page (A4 aspect at the shell's
 *     width cap) -> 2240x3168 device px -> ~7.1M px: under budget, no cap.
 *     Reaching that width at all needs a window over ~1800 CSS px tall, since the page
 *     is fitted to viewport height first; an ordinary laptop lands far below it.
 *   - dpr 3 only exceeds the budget when the window is simultaneously as wide as the
 *     shell cap and unusually tall. Capping there costs a little sharpness on hardware
 *     we do not target, which is the right trade against a blank page on hardware we do.
 * A pathological page (an extreme aspect ratio in a very tall window) is scaled back
 * down by `capFactor` below to fit the budget.
 *
 * Worst-case allocation at the budget: 8,000,000 px * 4 bytes/px (RGBA8) = 32,000,000
 * bytes (~30.5 MiB) for the on-screen canvas, plus an equal-sized transient allocation
 * for pdf.js's own render target (released immediately after the 1:1 blit in
 * `drawRenderedPage` below), for a transient peak of ~61 MiB for that one page.
 *
 * The exact iPad ceiling is not verified here; it is an unrun gate until the physical
 * iPad smoke record for issue #2 exists. Raising this number needs that measurement.
 *
 * Exported so tests assert against this budget rather than a copy of the number that
 * could silently drift away from it.
 */
export const MAX_RENDER_DEVICE_PIXELS = 8_000_000;

type ReaderPhase = 'idle' | 'loading' | 'rendering' | 'ready' | 'error';

export interface PageDisplaySize {
  readonly width: number;
  readonly height: number;
}

export interface PageDisplayInfo {
  readonly locator: PdfPageLocator;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly pageSizePt: PdfPageSize;
  /** Monotonic id for this exact render pass; overlays should discard stale generations. */
  readonly generation: number;
}

export interface PdfReaderProps {
  /** Injectable in tests; defaults to the real pdf.js-backed `openPdfDocument`. */
  readonly openDocument?: typeof defaultOpenPdfDocument;
  readonly onPageDisplayed?: (info: PageDisplayInfo) => void;
  readonly onDocumentChange?: (doc: PdfDocumentHandle | null) => void;
  /** Rendered inside the page container, absolutely positioned over the current page. */
  readonly renderOverlay?: (info: PageDisplayInfo) => ReactNode;
  /** When true, the reader's own keyboard page-turning is suppressed. */
  readonly selectionActive?: boolean;
  readonly initialPageIndex?: number;
}

function clampInt(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Takes `cancelled`/`currentGeneration` as fresh parameters (rather than reading the
 * `cancelledBox.current`/`generationRef.current` closure state directly in an `if`)
 * so TypeScript re-checks their plain declared types instead of narrowing them from
 * an earlier assignment in the same render effect — that narrowing would be unsound,
 * since both can change (from this effect's own cleanup, or a newer effect run) while
 * this call is suspended at `await`.
 */
function isStaleRender(
  cancelled: boolean,
  currentGeneration: number,
  expectedGeneration: number,
): boolean {
  return cancelled || currentGeneration !== expectedGeneration;
}

function getDevicePixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Blits the pdf.js bitmap onto the on-screen canvas with no resampling. `rendered.width`
 * / `rendered.height` are the exact backing-store size pdf.js rasterised at (see
 * `pdfDocument.ts`: it rounds each axis once via `Math.round(viewport.width/height)` and
 * creates its own canvas at that same size), so setting this canvas's backing store to
 * that identical size and calling `drawImage` with no destination width/height performs
 * a plain 1:1 pixel copy instead of a second, independently-rounded resample.
 */
function drawRenderedPage(canvas: HTMLCanvasElement | null, rendered: RenderedPage): void {
  if (!canvas) {
    return;
  }
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, rendered.width, rendered.height);
  context.drawImage(rendered.canvas, 0, 0);
}

export function PdfReader({
  openDocument,
  onPageDisplayed,
  onDocumentChange,
  renderOverlay,
  selectionActive = false,
  initialPageIndex,
}: PdfReaderProps) {
  const resolvedOpenDocument = openDocument ?? defaultOpenPdfDocument;

  const [documentHandle, setDocumentHandle] = useState<PdfDocumentHandle | null>(null);
  const [pageIndex, setPageIndex] = useState<number>(() => Math.max(0, initialPageIndex ?? 0));
  const [phase, setPhase] = useState<ReaderPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displaySize, setDisplaySize] = useState<PageDisplaySize | null>(null);
  const [pageDisplayInfo, setPageDisplayInfo] = useState<PageDisplayInfo | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(DEFAULT_DISPLAY_WIDTH_PX);
  const [availableHeight, setAvailableHeight] = useState<number>(() => measureAvailableHeight());

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const generationRef = useRef(0);
  const renderAbortRef = useRef<AbortController | null>(null);
  const openAbortRef = useRef<AbortController | null>(null);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onPageDisplayedRef = useRef(onPageDisplayed);

  const headingId = useId();
  const openInputId = useId();

  useEffect(() => {
    onDocumentChangeRef.current = onDocumentChange;
  });
  useEffect(() => {
    onPageDisplayedRef.current = onPageDisplayed;
  });

  // Track the viewport height so a page can be fitted to it (see VIEWPORT_HEIGHT_RESERVE_PX).
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleResize = (): void => {
      setAvailableHeight(measureAvailableHeight());
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Measure the available width once, and again whenever the container resizes.
  // jsdom (unit tests) has no ResizeObserver, so this degrades to a one-time measurement.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      return;
    }
    const measure = (): void => {
      const width = node.clientWidth;
      if (width > 0) {
        setContainerWidth(width);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Dispose the previous document whenever it is replaced, and on unmount.
  useEffect(() => {
    onDocumentChangeRef.current?.(documentHandle);
    return () => {
      documentHandle?.dispose();
    };
  }, [documentHandle]);

  // Render the current page. A page/document/resize change bumps `generationRef` and
  // cancels the in-flight render via `renderAbortRef`; a late-arriving stale render is
  // additionally rejected by generation identity, so an old render can never overwrite
  // a newer page even if pdf.js resolves it after cancellation.
  useEffect(() => {
    if (!documentHandle) {
      // Nothing to render yet; `phase`/`displaySize`/`pageDisplayInfo` already start at
      // their idle/null defaults, so there is no state to reset here.
      return;
    }

    // A plain mutable box, not a bare `let`, so a stale closure over this effect run can
    // still observe a later `cancelledBox.current = true` from its cleanup below.
    const cancelledBox = { current: false };
    const myGeneration = ++generationRef.current;
    renderAbortRef.current?.abort();
    const controller = new AbortController();
    renderAbortRef.current = controller;
    const targetPageIndex = pageIndex;

    // This effect's job is exactly to start the async getPageSize/renderPage pipeline
    // below in response to a document/page/size change (a canonical "synchronize with
    // an external system" effect, not a prop-derived value); setting the loading phase
    // that pipeline is now in is part of that synchronization, not a state duplication.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('rendering');
    setErrorMessage(null);

    void (async () => {
      try {
        const pageSizePt = await documentHandle.getPageSize(targetPageIndex);
        if (isStaleRender(cancelledBox.current, generationRef.current, myGeneration)) {
          return;
        }

        const aspect = pageSizePt.widthPt > 0 ? pageSizePt.heightPt / pageSizePt.widthPt : 1;
        const widthFittingHeight =
          aspect > 0 && Number.isFinite(availableHeight)
            ? availableHeight / aspect
            : containerWidth;
        // Geometric fit only: the CSS size actually shown is derived after rendering,
        // below, from what pdf.js actually rasterised.
        const fittedWidth = Math.max(1, Math.min(containerWidth, widthFittingHeight));
        const fittedHeight = fittedWidth * aspect;

        const dpr = getDevicePixelRatio();
        const rawDeviceWidth = fittedWidth * dpr;
        const rawDeviceHeight = fittedHeight * dpr;
        const rawDevicePixels = rawDeviceWidth * rawDeviceHeight;
        const capFactor =
          rawDevicePixels > MAX_RENDER_DEVICE_PIXELS
            ? Math.sqrt(MAX_RENDER_DEVICE_PIXELS / rawDevicePixels)
            : 1;
        // Only the width needs to be handed to pdf.js as a target: `renderPage`'s scale
        // is uniform, so pdf.js derives its own height from the page's own aspect ratio.
        const targetDeviceWidth = Math.max(1, Math.round(rawDeviceWidth * capFactor));
        const scale = pageSizePt.widthPt > 0 ? targetDeviceWidth / pageSizePt.widthPt : 1;

        const rendered = await documentHandle.renderPage(targetPageIndex, {
          scale,
          signal: controller.signal,
        });

        if (isStaleRender(cancelledBox.current, generationRef.current, myGeneration)) {
          rendered.release();
          return;
        }

        drawRenderedPage(canvasRef.current, rendered);

        // Derived from `rendered.width`/`rendered.height` (what pdf.js actually
        // rasterised), not from `fittedWidth`/`fittedHeight` above: this guarantees the
        // canvas's CSS size is always exactly `rendered.width / dpr` x
        // `rendered.height / dpr`, an exact backing-store-to-CSS ratio of `dpr` with no
        // independent rounding of the two sizes to disagree. The difference from the
        // pre-render geometric fit is at most one device pixel per axis (i.e. well under
        // one CSS pixel), and this is the single source of truth for both the canvas's
        // own displayed size and `PageDisplayInfo.displayWidth`/`displayHeight`, which
        // `capture/geometry.ts` and `SelectionLayer` rely on as the page's true CSS size.
        const displayWidth = rendered.width / dpr;
        const displayHeight = rendered.height / dpr;
        rendered.release();

        const info: PageDisplayInfo = {
          locator: { format: 'pdf', pageIndex: targetPageIndex },
          displayWidth,
          displayHeight,
          pageSizePt,
          generation: myGeneration,
        };

        setDisplaySize({ width: displayWidth, height: displayHeight });
        setPageDisplayInfo(info);
        setPhase('ready');
        onPageDisplayedRef.current?.(info);
      } catch (error) {
        if (
          isStaleRender(cancelledBox.current, generationRef.current, myGeneration) ||
          isAbortError(error)
        ) {
          return;
        }
        setPhase('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not render this page.');
      }
    })();

    return () => {
      cancelledBox.current = true;
    };
  }, [documentHandle, pageIndex, containerWidth, availableHeight]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const controller = new AbortController();
    openAbortRef.current?.abort();
    openAbortRef.current = controller;

    setPhase('loading');
    setErrorMessage(null);

    try {
      const doc = await resolvedOpenDocument(file, { signal: controller.signal });
      if (openAbortRef.current !== controller) {
        doc.dispose();
        return;
      }
      const startPage = clampInt(initialPageIndex ?? 0, 0, Math.max(0, doc.pageCount - 1));
      setPageIndex(startPage);
      setDocumentHandle(doc);
    } catch (error) {
      if (openAbortRef.current !== controller || isAbortError(error)) {
        return;
      }
      setPhase('idle');
      setErrorMessage(error instanceof Error ? error.message : 'Could not open this PDF.');
    }
  }

  function goToPage(next: number): void {
    if (!documentHandle) {
      return;
    }
    const clamped = clampInt(next, 0, documentHandle.pageCount - 1);
    if (clamped !== pageIndex) {
      setPageIndex(clamped);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (selectionActive || !documentHandle) {
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        goToPage(pageIndex - 1);
        break;
      case 'ArrowRight':
      case 'PageDown':
        event.preventDefault();
        goToPage(pageIndex + 1);
        break;
      default:
        break;
    }
  }

  const pageCount = documentHandle?.pageCount ?? 0;
  const canGoPrev = documentHandle !== null && pageIndex > 0;
  const canGoNext = documentHandle !== null && pageIndex < pageCount - 1;

  const statusText: string =
    phase === 'loading'
      ? 'Loading PDF…'
      : phase === 'rendering'
        ? 'Rendering page…'
        : phase === 'ready'
          ? 'Ready'
          : phase === 'error'
            ? 'Something went wrong.'
            : '';

  return (
    // The keydown handler only adds a supplemental ArrowLeft/Right/PageUp/PageDown
    // shortcut for the Previous/Next buttons already inside this landmark; it never
    // intercepts input outside the reader and every action it takes is also reachable
    // by clicking those (fully accessible, native) buttons.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className="pdf-reader"
      data-testid="pdf-reader"
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
    >
      <h2 id={headingId}>Book</h2>
      <div className="pdf-reader-controls">
        {/*
          The native file input is visually hidden and its label is styled as the
          visible control. A rendered `input[type=file]` has an intrinsic width that
          each engine and font stack decides for itself (measured: ~100 px wider on
          WebKit/Linux than Chromium/Windows), which overflowed a 320 px viewport.
          The input keeps its real semantics, stays in the tab order, and shows a
          focus ring through `:focus-visible + .pdf-open-label`.
        */}
        <input
          className="pdf-open-input"
          id={openInputId}
          type="file"
          accept="application/pdf,.pdf"
          data-testid="pdf-open-input"
          onChange={(event) => {
            void handleFileChange(event);
          }}
        />
        <label className="pdf-open-label" htmlFor={openInputId}>
          Open PDF
        </label>
        <div className="pdf-reader-pager">
          <button
            type="button"
            data-testid="pdf-page-prev"
            onClick={() => {
              goToPage(pageIndex - 1);
            }}
            disabled={!canGoPrev}
          >
            Previous
          </button>
          <span data-testid="pdf-page-indicator">
            {documentHandle
              ? `Page ${String(pageIndex + 1)} of ${String(pageCount)}`
              : 'No PDF open'}
          </span>
          <button
            type="button"
            data-testid="pdf-page-next"
            onClick={() => {
              goToPage(pageIndex + 1);
            }}
            disabled={!canGoNext}
          >
            Next
          </button>
        </div>
      </div>
      <p
        className="pdf-reader-status"
        role="status"
        data-testid="pdf-reader-status"
        data-state={phase}
      >
        {statusText}
      </p>
      {errorMessage && (
        <p className="pdf-reader-error" role="alert" data-testid="pdf-reader-error">
          {errorMessage}
        </p>
      )}
      <div className="pdf-reader-viewport" ref={viewportRef} data-testid="pdf-reader-viewport">
        <div
          className="pdf-page-container"
          data-testid="pdf-page-container"
          style={displaySize ? { width: displaySize.width, height: displaySize.height } : undefined}
        >
          {/*
            The canvas's CSS width/height are set explicitly in device-independent
            pixels from `displaySize` (in turn derived from the canvas's own backing
            store divided by devicePixelRatio; see the render effect above), rather than
            `width:100%/height:100%` of the container: that would stretch an
            integer-pixel backing store to whatever fractional size the parent happens
            to have, resampling the whole page on every paint. Setting both from the same
            numbers keeps the backing-store-to-CSS ratio exactly `devicePixelRatio`.
          */}
          <canvas
            ref={canvasRef}
            className="pdf-page-canvas"
            data-testid="pdf-page-canvas"
            style={
              displaySize ? { width: displaySize.width, height: displaySize.height } : undefined
            }
          />
          {documentHandle && pageDisplayInfo ? renderOverlay?.(pageDisplayInfo) : null}
        </div>
      </div>
    </section>
  );
}
