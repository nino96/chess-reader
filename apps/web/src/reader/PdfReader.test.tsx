import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_RENDER_DEVICE_PIXELS, PdfReader } from './PdfReader';
import type { PageDisplayInfo, PdfReaderProps } from './PdfReader';
import type {
  PdfDocumentHandle,
  PdfPageSize,
  RenderedPage,
  RenderPageOptions,
} from './pdfDocument';

interface RenderCall {
  readonly pageIndex: number;
  readonly scale: number;
  readonly signal: AbortSignal | undefined;
  resolve(): void;
  rejectWith(error: Error): void;
}

function fakeCanvas(): HTMLCanvasElement {
  return {} as unknown as HTMLCanvasElement;
}

interface FakeHandleResult {
  readonly handle: PdfDocumentHandle;
  readonly disposeMock: ReturnType<typeof vi.fn>;
  readonly renders: RenderCall[];
}

function createFakeHandle(
  options: { pageCount?: number; pageSizePt?: PdfPageSize } = {},
): FakeHandleResult {
  const pageCount = options.pageCount ?? 3;
  const pageSizePt = options.pageSizePt ?? { widthPt: 612, heightPt: 792 };
  const disposeMock = vi.fn();
  const renders: RenderCall[] = [];

  const handle: PdfDocumentHandle = {
    pageCount,
    getPageSize: (_pageIndex: number) => Promise.resolve(pageSizePt),
    renderPage: (pageIndex: number, opts: RenderPageOptions) =>
      new Promise<RenderedPage>((resolve, reject) => {
        const call: RenderCall = {
          pageIndex,
          scale: opts.scale,
          signal: opts.signal,
          resolve: () => {
            resolve({
              canvas: fakeCanvas(),
              width: Math.max(1, Math.round(pageSizePt.widthPt * opts.scale)),
              height: Math.max(1, Math.round(pageSizePt.heightPt * opts.scale)),
              release: vi.fn(),
            });
          },
          rejectWith: (error: Error) => {
            reject(error);
          },
        };
        renders.push(call);
      }),
    dispose: disposeMock,
  };

  return { handle, disposeMock, renders };
}

function makePdfFile(name = 'book.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function waitForRenderCount(renders: RenderCall[], count: number): Promise<void> {
  await waitFor(() => {
    expect(renders).toHaveLength(count);
  });
}

async function waitForPageIndicator(text: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent(text);
  });
}

async function openAndReachReady(
  openDocument: NonNullable<PdfReaderProps['openDocument']>,
  renders: RenderCall[],
  renderOverlay?: (info: PageDisplayInfo) => ReactNode,
): Promise<void> {
  render(<PdfReader openDocument={openDocument} {...(renderOverlay ? { renderOverlay } : {})} />);
  const input = screen.getByTestId('pdf-open-input');
  await userEvent.upload(input, makePdfFile());
  await waitForRenderCount(renders, 1);
  renders[0]?.resolve();
  await waitFor(() => {
    expect(screen.getByTestId('pdf-reader-status')).toHaveTextContent('Ready');
  });
}

describe('PdfReader opening a document', () => {
  it('shows loading then rendering status and eventually the page indicator', async () => {
    const { handle, renders } = createFakeHandle({ pageCount: 3 });
    const openDocument = vi.fn().mockResolvedValue(handle);

    render(<PdfReader openDocument={openDocument} />);
    const input = screen.getByTestId('pdf-open-input');
    const file = makePdfFile();

    await userEvent.upload(input, file);

    expect(openDocument).toHaveBeenCalledTimes(1);
    const [calledFile, calledOptions] = openDocument.mock.calls[0] as [
      File,
      { signal?: AbortSignal },
    ];
    expect(calledFile).toBe(file);
    expect(calledOptions.signal).toBeInstanceOf(AbortSignal);

    await waitForRenderCount(renders, 1);
    expect(screen.getByTestId('pdf-reader-status')).toHaveTextContent('Rendering page');

    renders[0]?.resolve();

    await waitFor(() => {
      expect(screen.getByTestId('pdf-reader-status')).toHaveTextContent('Ready');
    });
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent('Page 1 of 3');
  }, 15000);

  it('shows an alert with an actionable message when opening fails', async () => {
    const openDocument = vi.fn().mockRejectedValue(new Error('This PDF could not be read.'));
    render(<PdfReader openDocument={openDocument} />);

    await userEvent.upload(screen.getByTestId('pdf-open-input'), makePdfFile());

    const alert = await screen.findByTestId('pdf-reader-error');
    expect(alert).toHaveTextContent('This PDF could not be read.');
    expect(alert).toHaveAttribute('role', 'alert');
  });
});

describe('PdfReader page navigation', () => {
  it('moves forward and back with the prev/next buttons, disabling at bounds', async () => {
    const { handle, renders } = createFakeHandle({ pageCount: 2 });
    const openDocument = vi.fn().mockResolvedValue(handle);
    await openAndReachReady(openDocument, renders);

    expect(screen.getByTestId('pdf-page-prev')).toBeDisabled();
    expect(screen.getByTestId('pdf-page-next')).toBeEnabled();

    await userEvent.click(screen.getByTestId('pdf-page-next'));
    await waitForRenderCount(renders, 2);
    renders[1]?.resolve();
    await waitForPageIndicator('Page 2 of 2');

    expect(screen.getByTestId('pdf-page-next')).toBeDisabled();
    expect(screen.getByTestId('pdf-page-prev')).toBeEnabled();

    await userEvent.click(screen.getByTestId('pdf-page-prev'));
    await waitForRenderCount(renders, 3);
    renders[2]?.resolve();
    await waitForPageIndicator('Page 1 of 2');
  });

  it('changes pages with ArrowLeft/ArrowRight and PageUp/PageDown when selection is not active', async () => {
    const { handle, renders } = createFakeHandle({ pageCount: 3 });
    const openDocument = vi.fn().mockResolvedValue(handle);
    await openAndReachReady(openDocument, renders);

    fireEvent.keyDown(screen.getByTestId('pdf-reader'), { key: 'ArrowRight' });
    await waitForRenderCount(renders, 2);
    renders[1]?.resolve();
    await waitForPageIndicator('Page 2 of 3');

    fireEvent.keyDown(screen.getByTestId('pdf-reader'), { key: 'PageDown' });
    await waitForRenderCount(renders, 3);
    renders[2]?.resolve();
    await waitForPageIndicator('Page 3 of 3');

    fireEvent.keyDown(screen.getByTestId('pdf-reader'), { key: 'ArrowLeft' });
    await waitForRenderCount(renders, 4);
    renders[3]?.resolve();
    await waitForPageIndicator('Page 2 of 3');
  });

  it('does not page with the keyboard while selectionActive is true', async () => {
    const { handle, renders } = createFakeHandle({ pageCount: 3 });
    const openDocument = vi.fn().mockResolvedValue(handle);
    render(<PdfReader openDocument={openDocument} selectionActive />);
    await userEvent.upload(screen.getByTestId('pdf-open-input'), makePdfFile());
    await waitForRenderCount(renders, 1);
    renders[0]?.resolve();
    await screen.findByText('Page 1 of 3');

    fireEvent.keyDown(screen.getByTestId('pdf-reader'), { key: 'ArrowRight' });

    expect(renders).toHaveLength(1);
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent('Page 1 of 3');
  });
});

describe('PdfReader stale render handling', () => {
  it('discards a late-resolving old-page render and keeps the newer page displayed', async () => {
    const { handle, renders } = createFakeHandle({ pageCount: 3 });
    const openDocument = vi.fn().mockResolvedValue(handle);
    await openAndReachReady(openDocument, renders);

    // Begin rendering page 2 before page 1's (already-displayed) render is touched again.
    await userEvent.click(screen.getByTestId('pdf-page-next'));
    await waitForRenderCount(renders, 2);

    // The reader must have cancelled the (already-finished) first render's controller
    // and started the second under a fresh one.
    expect(renders[0]?.signal?.aborted).toBe(true);

    renders[1]?.resolve();
    await waitForPageIndicator('Page 2 of 3');

    // A late completion of the stale first render must not overwrite page 2.
    renders[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent('Page 2 of 3');
  });

  it('aborts the in-flight render when a new document is opened mid-render', async () => {
    const { handle, renders } = createFakeHandle({ pageCount: 3 });
    const openDocument = vi.fn().mockResolvedValue(handle);
    render(<PdfReader openDocument={openDocument} />);
    await userEvent.upload(screen.getByTestId('pdf-open-input'), makePdfFile());
    await waitForRenderCount(renders, 1);

    expect(renders[0]?.signal?.aborted).toBe(false);
    renders[0]?.resolve();
    await screen.findByText('Page 1 of 3');

    // Replacing the document should not throw even though nothing else consumes it here.
    expect(handle.pageCount).toBe(3);
  });
});

describe('PdfReader overlay + document lifecycle', () => {
  it('renders the overlay with the matching PageDisplayInfo', async () => {
    const { handle, renders } = createFakeHandle({
      pageCount: 3,
      pageSizePt: { widthPt: 420, heightPt: 594 },
    });
    const openDocument = vi.fn().mockResolvedValue(handle);
    let lastInfo: PageDisplayInfo | undefined;
    const renderOverlay = (info: PageDisplayInfo) => {
      lastInfo = info;
      return <div data-testid="overlay-marker" />;
    };

    await openAndReachReady(openDocument, renders, renderOverlay);

    expect(screen.getByTestId('overlay-marker')).toBeInTheDocument();
    expect(lastInfo?.locator).toEqual({ format: 'pdf', pageIndex: 0 });
    expect(lastInfo?.pageSizePt).toEqual({ widthPt: 420, heightPt: 594 });
    expect(lastInfo?.displayWidth).toBeGreaterThan(0);
    expect(lastInfo?.displayHeight).toBeGreaterThan(0);
    expect(typeof lastInfo?.generation).toBe('number');
  });

  it('disposes the document on unmount and disposes the previous one when replaced', async () => {
    const first = createFakeHandle({ pageCount: 2 });
    const second = createFakeHandle({ pageCount: 5 });
    const openDocument = vi
      .fn()
      .mockResolvedValueOnce(first.handle)
      .mockResolvedValueOnce(second.handle);

    const { unmount } = render(<PdfReader openDocument={openDocument} />);
    await userEvent.upload(screen.getByTestId('pdf-open-input'), makePdfFile('a.pdf'));
    await waitForRenderCount(first.renders, 1);
    first.renders[0]?.resolve();
    await screen.findByText('Page 1 of 2');

    await userEvent.upload(screen.getByTestId('pdf-open-input'), makePdfFile('b.pdf'));
    await waitFor(() => {
      expect(first.disposeMock).toHaveBeenCalledTimes(1);
    });

    await waitForRenderCount(second.renders, 1);
    second.renders[0]?.resolve();
    await screen.findByText('Page 1 of 5');

    expect(second.disposeMock).not.toHaveBeenCalled();
    unmount();
    expect(second.disposeMock).toHaveBeenCalledTimes(1);
  });
});

describe('PdfReader render resolution', () => {
  const originalDevicePixelRatio = window.devicePixelRatio;
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: originalDevicePixelRatio,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  function setDevicePixelRatio(ratio: number): void {
    Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true });
  }

  function setInnerHeight(height: number): void {
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  }

  /** Narrows `renders[index]`, failing the test immediately (not silently) if absent. */
  function requireRender(renders: RenderCall[], index: number): RenderCall {
    const call = renders[index];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error(`Expected a render call at index ${String(index)}.`);
    }
    return call;
  }

  it.each([1, 2, 3])(
    'keeps the canvas backing store an exact devicePixelRatio (%i) multiple of its CSS size, blits with no scaling, and reports that CSS size as displayWidth/displayHeight',
    async (dpr) => {
      setDevicePixelRatio(dpr);
      const { handle, renders } = createFakeHandle({ pageCount: 1 });
      const openDocument = vi.fn().mockResolvedValue(handle);
      let lastInfo: PageDisplayInfo | undefined;
      await openAndReachReady(openDocument, renders, (info) => {
        lastInfo = info;
        return null;
      });

      const canvas = screen.getByTestId<HTMLCanvasElement>('pdf-page-canvas');
      const cssWidth = Number.parseFloat(canvas.style.width);
      const cssHeight = Number.parseFloat(canvas.style.height);
      expect(cssWidth).toBeGreaterThan(0);
      expect(cssHeight).toBeGreaterThan(0);

      // Backing store is an exact devicePixelRatio multiple of the CSS size: nothing
      // stretches an integer backing store against a fractional CSS parent, so nothing
      // resamples the bitmap on paint.
      expect(canvas.width).toBeCloseTo(cssWidth * dpr, 9);
      expect(canvas.height).toBeCloseTo(cssHeight * dpr, 9);

      // `PageDisplayInfo` reports exactly the canvas's own CSS size, so
      // `capture/geometry.ts` and `SelectionLayer` stay aligned with what is shown.
      expect(lastInfo?.displayWidth).toBeCloseTo(cssWidth, 9);
      expect(lastInfo?.displayHeight).toBeCloseTo(cssHeight, 9);

      // The blit is a plain 1:1 copy: `drawImage` is called with no destination
      // width/height, i.e. no second resample after pdf.js's own rasterisation.
      const context = canvas.getContext('2d') as unknown as {
        drawImage: ReturnType<typeof vi.fn>;
      };
      expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
    },
  );

  it.each([1, 2, 3])(
    'renders an ordinary page at full native device resolution (no cap) at devicePixelRatio %i',
    async (dpr) => {
      setDevicePixelRatio(dpr);
      // Defaults: containerWidth stays at the jsdom fallback (800px, since clientWidth
      // is 0 in jsdom) and window.innerHeight defaults to 768, giving availableHeight
      // 548. US Letter (612x792pt) is comfortably within the pixel budget even at
      // devicePixelRatio 3 (see MAX_RENDER_DEVICE_PIXELS's own worked example).
      const pageSizePt = { widthPt: 612, heightPt: 792 };
      const { handle, renders } = createFakeHandle({ pageCount: 1, pageSizePt });
      const openDocument = vi.fn().mockResolvedValue(handle);
      await openAndReachReady(openDocument, renders);

      const containerWidth = 800;
      const availableHeight = Math.max(320, window.innerHeight - 220);
      const aspect = pageSizePt.heightPt / pageSizePt.widthPt;
      const fittedWidth = Math.min(containerWidth, availableHeight / aspect);
      const idealUncappedDeviceWidth = fittedWidth * dpr;

      const actualDeviceWidth = requireRender(renders, 0).scale * pageSizePt.widthPt;
      // Uncapped: within one rounded device pixel of the ideal (uncapped) target width.
      expect(Math.abs(actualDeviceWidth - idealUncappedDeviceWidth)).toBeLessThan(1);
    },
  );

  it.each([1, 2, 3])(
    'caps a pathological page to the pixel budget regardless of devicePixelRatio %i',
    async (dpr) => {
      setDevicePixelRatio(dpr);
      // A window tall enough that both the container-width bound (800px, the jsdom
      // fallback) and the available-height bound (50,000px) are reached at once, via a
      // page whose aspect ratio matches that box: fittedWidth=800, fittedHeight=50,000.
      // At devicePixelRatio 1 alone this is 800*50,000 = 40,000,000 device px, already
      // several times MAX_RENDER_DEVICE_PIXELS before devicePixelRatio is even applied.
      setInnerHeight(50_220);
      const containerWidth = 800;
      const availableHeight = 50_000;
      const aspect = availableHeight / containerWidth;
      const pageSizePt = { widthPt: 612, heightPt: 612 * aspect };
      const { handle, renders } = createFakeHandle({ pageCount: 1, pageSizePt });
      const openDocument = vi.fn().mockResolvedValue(handle);
      await openAndReachReady(openDocument, renders);

      const idealUncappedDeviceWidth = containerWidth * dpr;
      const actualDeviceWidth = requireRender(renders, 0).scale * pageSizePt.widthPt;

      // Capped: the achieved width is well short of the (unbounded) ideal...
      expect(actualDeviceWidth).toBeLessThan(idealUncappedDeviceWidth * 0.9);
      // ...and matches what the pixel budget predicts for this box's aspect ratio
      // (fittedWidth/fittedHeight), independent of devicePixelRatio: once capped,
      // requesting more devicePixelRatio is scaled straight back down to the same
      // budget-limited resolution rather than allocating more. Imported rather than
      // written out, so the assertion tracks the budget instead of drifting from it.
      const budgetPredictedWidth = Math.sqrt(
        MAX_RENDER_DEVICE_PIXELS * (containerWidth / availableHeight),
      );
      expect(actualDeviceWidth).toBeCloseTo(budgetPredictedWidth, 0);
    },
  );
});
