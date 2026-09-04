/**
 * Turns a manually selected normalized rectangle into a bounded `CapturedRegion`
 * ready for the recognition worker. This module knows about `PdfDocumentHandle`
 * (the reader's adapter contract) but nothing about `pdfjs-dist` itself, and
 * nothing about React.
 */
import type { PdfDocumentHandle } from '../reader/pdfDocument';
import type { CapturedRegion, NormalizedRect, PdfPageLocator, PixelRect } from '../study/contracts';
import { MAX_CAPTURE_LONG_EDGE_PX } from '../study/contracts';
import { chooseCaptureScale, normalizedRectToPixelRect } from './geometry';

export interface CapturePdfRegionOptions {
  readonly signal: AbortSignal;
  readonly maxLongEdgePx?: number;
}

class CaptureAbortError extends Error {
  constructor(message = 'Capturing this region was cancelled.') {
    super(message);
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CaptureAbortError();
  }
}

/** Narrow structural view of the 2D context surface both canvas kinds share. */
interface Canvas2DImageDataSource {
  getContext(
    contextId: '2d',
  ): { getImageData(x: number, y: number, w: number, h: number): ImageData } | null;
}

function readImageData(canvas: HTMLCanvasElement | OffscreenCanvas, rect: PixelRect): ImageData {
  const context = (canvas as unknown as Canvas2DImageDataSource).getContext('2d');
  if (!context) {
    throw new Error('Unable to obtain a 2D rendering context to capture this region.');
  }
  return context.getImageData(rect.x, rect.y, rect.width, rect.height);
}

/**
 * Renders `locator`'s page at a bounded scale, crops `normalizedRect` out of
 * it, and returns a standalone `CapturedRegion` whose pixel buffer is a fresh
 * copy (so the source canvas can be released immediately). Aborting `signal`
 * at any point rejects with an `AbortError`-named error and always releases
 * the rendered page.
 */
export async function capturePdfRegion(
  doc: PdfDocumentHandle,
  locator: PdfPageLocator,
  normalizedRect: NormalizedRect,
  options: CapturePdfRegionOptions,
): Promise<CapturedRegion> {
  const { signal, maxLongEdgePx = MAX_CAPTURE_LONG_EDGE_PX } = options;

  throwIfAborted(signal);
  const pageSizePt = await doc.getPageSize(locator.pageIndex);
  throwIfAborted(signal);

  const scale = chooseCaptureScale(normalizedRect, pageSizePt, maxLongEdgePx);
  const rendered = await doc.renderPage(locator.pageIndex, { scale, signal });

  try {
    throwIfAborted(signal);

    const sourceRect = normalizedRectToPixelRect(normalizedRect, {
      width: rendered.width,
      height: rendered.height,
    });

    const imageData = readImageData(rendered.canvas, sourceRect);
    const data = new Uint8ClampedArray(imageData.data);

    return {
      width: sourceRect.width,
      height: sourceRect.height,
      data,
      sourceRect,
      normalizedRect,
      locator,
    };
  } finally {
    rendered.release();
  }
}
