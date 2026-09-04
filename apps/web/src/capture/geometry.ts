/**
 * Pure coordinate math for manual diagram capture. No DOM, no PDF.js: every
 * function here is a plain transform between the rectangle spaces defined in
 * `apps/web/src/study/contracts.ts` (display CSS px, normalized page
 * coordinates, and integer source-bitmap pixels), so it can be unit tested
 * exhaustively and reused by both the reader UI and the capture pipeline.
 */
import type { DisplayRect, NormalizedRect, PixelRect } from '../study/contracts';
import {
  MAX_CAPTURE_LONG_EDGE_PX,
  RECT_TOLERANCE_CSS_PX,
  RECT_TOLERANCE_FRACTION,
} from '../study/contracts';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The render scale is never pushed past this multiple of a tiny selection's native size. */
export const MAX_CAPTURE_UPSCALE = 4;

/** Builds a normalized (non-negative width/height) `DisplayRect` from a drag in any direction. */
export function normalizeDragRect(start: Point, end: Point): DisplayRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Clamps a display rectangle so it lies entirely within `[0, bounds.width] x [0, bounds.height]`. */
export function clampDisplayRect(rect: DisplayRect, bounds: Size): DisplayRect {
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const x0 = clamp(rect.x, 0, width);
  const y0 = clamp(rect.y, 0, height);
  const x1 = clamp(rect.x + rect.width, 0, width);
  const y1 = clamp(rect.y + rect.height, 0, height);
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

/** Converts a display-space rectangle to normalized `[0, 1]` page coordinates. */
export function displayRectToNormalized(rect: DisplayRect, displaySize: Size): NormalizedRect {
  if (displaySize.width <= 0 || displaySize.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: rect.x / displaySize.width,
    y: rect.y / displaySize.height,
    width: rect.width / displaySize.width,
    height: rect.height / displaySize.height,
  };
}

/** Converts a normalized `[0, 1]` rectangle back to display-space CSS pixels. */
export function normalizedRectToDisplay(norm: NormalizedRect, displaySize: Size): DisplayRect {
  return {
    x: norm.x * displaySize.width,
    y: norm.y * displaySize.height,
    width: norm.width * displaySize.width,
    height: norm.height * displaySize.height,
  };
}

/**
 * Converts a normalized rectangle to integer pixels of a source bitmap of
 * `sourceSize`. The result is always clamped inside the bitmap and always has
 * a positive width/height, even for a degenerate or edge-touching input.
 */
export function normalizedRectToPixelRect(norm: NormalizedRect, sourceSize: Size): PixelRect {
  const sw = Math.max(1, Math.round(sourceSize.width));
  const sh = Math.max(1, Math.round(sourceSize.height));

  let x0 = clamp(Math.round(norm.x * sw), 0, sw);
  let y0 = clamp(Math.round(norm.y * sh), 0, sh);
  let x1 = clamp(Math.round((norm.x + norm.width) * sw), 0, sw);
  let y1 = clamp(Math.round((norm.y + norm.height) * sh), 0, sh);

  if (x1 < x0) {
    x1 = x0;
  }
  if (y1 < y0) {
    y1 = y0;
  }

  let width = x1 - x0;
  let height = y1 - y0;

  if (width <= 0) {
    width = 1;
    if (x0 + width > sw) {
      x0 = sw - 1;
    }
  }
  if (height <= 0) {
    height = 1;
    if (y0 + height > sh) {
      y0 = sh - 1;
    }
  }

  return { x: x0, y: y0, width, height };
}

/**
 * Chooses the pdf.js render scale so the selected normalized region's long
 * edge lands at `maxLongEdgePx` (never more). Tiny selections are capped at
 * `MAX_CAPTURE_UPSCALE` so a near-zero-size drag does not request an absurd
 * render resolution.
 */
export function chooseCaptureScale(
  norm: NormalizedRect,
  pageSizePt: { readonly widthPt: number; readonly heightPt: number },
  maxLongEdgePx: number = MAX_CAPTURE_LONG_EDGE_PX,
): number {
  const widthPt = Math.abs(norm.width) * pageSizePt.widthPt;
  const heightPt = Math.abs(norm.height) * pageSizePt.heightPt;
  const longEdgePt = Math.max(widthPt, heightPt);

  if (longEdgePt <= 0) {
    return MAX_CAPTURE_UPSCALE;
  }

  const rawScale = maxLongEdgePx / longEdgePt;
  return Math.min(rawScale, MAX_CAPTURE_UPSCALE);
}

/**
 * Coordinate tolerance from docs/evaluation.md §7: 4 CSS px or 1% of the
 * displayed board's size, whichever is larger.
 */
export function rectTolerancePx(displayedBoardSize: number): number {
  return Math.max(RECT_TOLERANCE_CSS_PX, RECT_TOLERANCE_FRACTION * displayedBoardSize);
}

/** True when every edge of `a` and `b` is within `tolerancePx` of each other. */
export function rectsWithinTolerance(a: DisplayRect, b: DisplayRect, tolerancePx: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerancePx &&
    Math.abs(a.y - b.y) <= tolerancePx &&
    Math.abs(a.width - b.width) <= tolerancePx &&
    Math.abs(a.height - b.height) <= tolerancePx
  );
}
