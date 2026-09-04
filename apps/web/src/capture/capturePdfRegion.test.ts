import { describe, expect, it, vi } from 'vitest';

import type {
  PdfDocumentHandle,
  PdfPageSize,
  RenderedPage,
  RenderPageOptions,
} from '../reader/pdfDocument';
import type { NormalizedRect, PdfPageLocator } from '../study/contracts';
import { capturePdfRegion } from './capturePdfRegion';
import { chooseCaptureScale } from './geometry';

interface FakeCanvasOptions {
  readonly width: number;
  readonly height: number;
  readonly fill: number;
}

interface PixelReadCall {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A minimal canvas stub whose 2D context returns deterministic pixels. */
function createFakeCanvas({ fill }: FakeCanvasOptions): {
  canvas: { getContext: (id: string) => { getImageData: typeof getImageData } | null };
  releaseCalls: number[];
  getImageDataCalls: PixelReadCall[];
} {
  const getImageDataCalls: PixelReadCall[] = [];
  function getImageData(x: number, y: number, w: number, h: number): ImageData {
    getImageDataCalls.push({ x, y, w, h });
    const data = new Uint8ClampedArray(w * h * 4).fill(fill);
    return { data, width: w, height: h, colorSpace: 'srgb' };
  }
  const canvas = {
    getContext: (id: string) => (id === '2d' ? { getImageData } : null),
  };
  return { canvas, releaseCalls: [], getImageDataCalls };
}

function createFakeDoc(options: {
  pageSizePt: PdfPageSize;
  fill?: number;
  renderDelayMs?: number;
}): {
  doc: PdfDocumentHandle;
  getReleaseCalls: () => number;
  getImageDataCalls: PixelReadCall[];
} {
  const { pageSizePt, fill = 128, renderDelayMs = 0 } = options;
  let releaseCalls = 0;
  const getImageDataCalls: PixelReadCall[] = [];

  const doc: PdfDocumentHandle = {
    pageCount: 1,
    getPageSize: (_pageIndex: number) => Promise.resolve(pageSizePt),
    renderPage: (_pageIndex: number, renderOptions: RenderPageOptions) =>
      new Promise<RenderedPage>((resolve, reject) => {
        // A real PdfDocumentHandle renders at exactly the requested scale; mirror that here
        // so tests that assert on the resulting resolution exercise the real contract.
        const width = Math.max(1, Math.round(pageSizePt.widthPt * renderOptions.scale));
        const height = Math.max(1, Math.round(pageSizePt.heightPt * renderOptions.scale));
        function getImageData(x: number, y: number, w: number, h: number): ImageData {
          getImageDataCalls.push({ x, y, w, h });
          const data = new Uint8ClampedArray(w * h * 4).fill(fill);
          return { data, width: w, height: h, colorSpace: 'srgb' };
        }
        const canvas = { getContext: (id: string) => (id === '2d' ? { getImageData } : null) };
        const timer = setTimeout(() => {
          resolve({
            canvas: canvas as unknown as HTMLCanvasElement,
            width,
            height,
            release: () => {
              releaseCalls += 1;
            },
          });
        }, renderDelayMs);
        renderOptions.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const error = new Error('Rendering aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    dispose: vi.fn(),
  };

  return { doc, getReleaseCalls: () => releaseCalls, getImageDataCalls };
}

const locator: PdfPageLocator = { format: 'pdf', pageIndex: 0 };
const fullPageRect: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

const pageSizePt: PdfPageSize = { widthPt: 612, heightPt: 792 };

describe('capturePdfRegion', () => {
  it('captures a bounded region with the correct source/normalized rect and locator', async () => {
    const { doc, getImageDataCalls } = createFakeDoc({ pageSizePt });
    const controller = new AbortController();
    const normalizedRect: NormalizedRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

    const region = await capturePdfRegion(doc, locator, normalizedRect, {
      signal: controller.signal,
    });

    const scale = chooseCaptureScale(normalizedRect, pageSizePt);
    const renderedWidth = Math.round(pageSizePt.widthPt * scale);
    const renderedHeight = Math.round(pageSizePt.heightPt * scale);

    expect(region.locator).toEqual(locator);
    expect(region.normalizedRect).toEqual(normalizedRect);
    expect(region.width).toBeGreaterThan(0);
    expect(region.height).toBeGreaterThan(0);
    expect(region.data.length).toBe(region.width * region.height * 4);
    expect(region.sourceRect.x + region.sourceRect.width).toBeLessThanOrEqual(renderedWidth);
    expect(region.sourceRect.y + region.sourceRect.height).toBeLessThanOrEqual(renderedHeight);
    expect(getImageDataCalls).toHaveLength(1);
  });

  it('renders with purpose "capture" so an unrelated display render never cancels it', async () => {
    // The whole point of this option (see pdfDocument.ts's render queue): a
    // reader re-render triggered by a toolbar reflow mid-selection must not
    // silently kill an in-flight capture. Regression test for that defect.
    const { doc } = createFakeDoc({ pageSizePt });
    const renderPageSpy = vi.spyOn(doc, 'renderPage');
    const controller = new AbortController();

    await capturePdfRegion(doc, locator, fullPageRect, { signal: controller.signal });

    expect(renderPageSpy).toHaveBeenCalledWith(
      locator.pageIndex,
      expect.objectContaining({ purpose: 'capture' }),
    );
  });

  it('never exceeds the bounded capture ceiling', async () => {
    const { doc } = createFakeDoc({ pageSizePt });
    const controller = new AbortController();

    const region = await capturePdfRegion(doc, locator, fullPageRect, {
      signal: controller.signal,
      maxLongEdgePx: 256,
    });

    expect(Math.max(region.width, region.height)).toBeLessThanOrEqual(256);
  });

  it('copies pixel data into a fresh buffer distinct from the source', async () => {
    const { doc } = createFakeDoc({ pageSizePt, fill: 42 });
    const controller = new AbortController();

    const region = await capturePdfRegion(doc, locator, fullPageRect, {
      signal: controller.signal,
    });

    expect(region.data).toBeInstanceOf(Uint8ClampedArray);
    expect(region.data[0]).toBe(42);
    // Mutating the returned buffer must not be possible to observe through another capture.
    region.data[0] = 7;
    const secondRegion = await capturePdfRegion(doc, locator, fullPageRect, {
      signal: controller.signal,
    });
    expect(secondRegion.data[0]).toBe(42);
  });

  it('releases the rendered page even on success', async () => {
    const { doc, getReleaseCalls } = createFakeDoc({ pageSizePt });
    const controller = new AbortController();

    await capturePdfRegion(doc, locator, fullPageRect, { signal: controller.signal });

    expect(getReleaseCalls()).toBe(1);
  });

  it('rejects with an AbortError and never renders when already aborted', async () => {
    const { doc } = createFakeDoc({ pageSizePt });
    const controller = new AbortController();
    controller.abort();

    await expect(
      capturePdfRegion(doc, locator, fullPageRect, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with an AbortError and releases resources when aborted mid-render', async () => {
    const { doc, getReleaseCalls } = createFakeDoc({ pageSizePt, renderDelayMs: 50 });
    const controller = new AbortController();

    const promise = capturePdfRegion(doc, locator, fullPageRect, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // The render itself rejected, so there is no rendered page for capturePdfRegion to release.
    expect(getReleaseCalls()).toBe(0);
  });

  it('rejects and releases when the signal aborts right as render resolves', async () => {
    const { canvas } = createFakeCanvas({ width: 200, height: 200, fill: 1 });
    let releaseCalls = 0;
    const controller = new AbortController();
    const doc: PdfDocumentHandle = {
      pageCount: 1,
      getPageSize: () => Promise.resolve(pageSizePt),
      renderPage: () => {
        // Simulate the caller's controller aborting in the gap between the render
        // resolving and capturePdfRegion re-checking the signal.
        controller.abort();
        return Promise.resolve({
          canvas: canvas as unknown as HTMLCanvasElement,
          width: 200,
          height: 200,
          release: () => {
            releaseCalls += 1;
          },
        });
      },
      dispose: vi.fn(),
    };

    await expect(
      capturePdfRegion(doc, locator, fullPageRect, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(releaseCalls).toBe(1);
  });
});
