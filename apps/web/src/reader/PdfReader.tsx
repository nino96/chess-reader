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

/** Render resolution ceiling in device pixels, per docs/architecture.md §6. */
const MAX_RENDER_DEVICE_LONG_EDGE_PX = 2000;

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

function drawRenderedPage(
  canvas: HTMLCanvasElement | null,
  rendered: RenderedPage,
  deviceWidth: number,
  deviceHeight: number,
): void {
  if (!canvas) {
    return;
  }
  canvas.width = deviceWidth;
  canvas.height = deviceHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, deviceWidth, deviceHeight);
  context.drawImage(rendered.canvas, 0, 0, deviceWidth, deviceHeight);
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
        const displayWidth = Math.max(1, Math.min(containerWidth, widthFittingHeight));
        const displayHeight = displayWidth * aspect;

        const dpr = getDevicePixelRatio();
        const rawDeviceWidth = displayWidth * dpr;
        const rawDeviceHeight = displayHeight * dpr;
        const longEdge = Math.max(rawDeviceWidth, rawDeviceHeight);
        const capFactor =
          longEdge > MAX_RENDER_DEVICE_LONG_EDGE_PX ? MAX_RENDER_DEVICE_LONG_EDGE_PX / longEdge : 1;
        const deviceWidth = Math.max(1, Math.round(rawDeviceWidth * capFactor));
        const deviceHeight = Math.max(1, Math.round(rawDeviceHeight * capFactor));
        const scale = pageSizePt.widthPt > 0 ? deviceWidth / pageSizePt.widthPt : 1;

        const rendered = await documentHandle.renderPage(targetPageIndex, {
          scale,
          signal: controller.signal,
        });

        if (isStaleRender(cancelledBox.current, generationRef.current, myGeneration)) {
          rendered.release();
          return;
        }

        drawRenderedPage(canvasRef.current, rendered, deviceWidth, deviceHeight);
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
          <canvas ref={canvasRef} className="pdf-page-canvas" data-testid="pdf-page-canvas" />
          {documentHandle && pageDisplayInfo ? renderOverlay?.(pageDisplayInfo) : null}
        </div>
      </div>
    </section>
  );
}
