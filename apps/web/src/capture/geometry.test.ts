import { describe, expect, it } from 'vitest';

import {
  MAX_CAPTURE_LONG_EDGE_PX,
  RECT_TOLERANCE_CSS_PX,
  RECT_TOLERANCE_FRACTION,
} from '../study/contracts';
import {
  MAX_CAPTURE_UPSCALE,
  chooseCaptureScale,
  clampDisplayRect,
  displayRectToNormalized,
  normalizeDragRect,
  normalizedRectToDisplay,
  normalizedRectToPixelRect,
  rectTolerancePx,
  rectsWithinTolerance,
} from './geometry';

/** Small deterministic linear-congruential PRNG so "random" tests are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

describe('normalizeDragRect', () => {
  it('handles a drag to the bottom-right', () => {
    expect(normalizeDragRect({ x: 10, y: 20 }, { x: 50, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it('handles a drag to the top-left', () => {
    expect(normalizeDragRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it('handles a drag to the top-right', () => {
    expect(normalizeDragRect({ x: 10, y: 80 }, { x: 50, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it('handles a drag to the bottom-left', () => {
    expect(normalizeDragRect({ x: 50, y: 20 }, { x: 10, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it('handles a zero-size drag', () => {
    expect(normalizeDragRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 0,
      height: 0,
    });
  });
});

describe('clampDisplayRect', () => {
  const bounds = { width: 100, height: 200 };

  it('leaves an already-contained rect untouched', () => {
    const rect = { x: 10, y: 10, width: 20, height: 20 };
    expect(clampDisplayRect(rect, bounds)).toEqual(rect);
  });

  it('clamps a rect that overflows the right/bottom edges', () => {
    expect(clampDisplayRect({ x: 90, y: 190, width: 50, height: 50 }, bounds)).toEqual({
      x: 90,
      y: 190,
      width: 10,
      height: 10,
    });
  });

  it('clamps a rect that starts before the top-left origin', () => {
    expect(clampDisplayRect({ x: -20, y: -30, width: 50, height: 50 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 20,
    });
  });

  it('collapses a rect entirely outside the bounds to zero size', () => {
    const clamped = clampDisplayRect({ x: 500, y: 500, width: 50, height: 50 }, bounds);
    expect(clamped.width).toBe(0);
    expect(clamped.height).toBe(0);
  });
});

describe('displayRectToNormalized / normalizedRectToDisplay round trip', () => {
  const displaySize = { width: 400, height: 300 };

  it('round trips within 1e-9', () => {
    const rect = { x: 40, y: 30, width: 120, height: 90 };
    const norm = displayRectToNormalized(rect, displaySize);
    const back = normalizedRectToDisplay(norm, displaySize);
    expect(back.x).toBeCloseTo(rect.x, 9);
    expect(back.y).toBeCloseTo(rect.y, 9);
    expect(back.width).toBeCloseTo(rect.width, 9);
    expect(back.height).toBeCloseTo(rect.height, 9);
  });

  it('returns a degenerate normalized rect for a zero-size display area', () => {
    expect(
      displayRectToNormalized({ x: 1, y: 1, width: 1, height: 1 }, { width: 0, height: 0 }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('normalizedRectToPixelRect', () => {
  const sourceSize = { width: 1000, height: 500 };

  it('converts and rounds to integer pixels', () => {
    const pixelRect = normalizedRectToPixelRect(
      { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      sourceSize,
    );
    expect(Number.isInteger(pixelRect.x)).toBe(true);
    expect(Number.isInteger(pixelRect.y)).toBe(true);
    expect(Number.isInteger(pixelRect.width)).toBe(true);
    expect(Number.isInteger(pixelRect.height)).toBe(true);
    expect(pixelRect).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });

  it('never produces a zero-width or zero-height rect for a tiny selection', () => {
    const pixelRect = normalizedRectToPixelRect(
      { x: 0.5, y: 0.5, width: 0.0001, height: 0.0001 },
      sourceSize,
    );
    expect(pixelRect.width).toBeGreaterThanOrEqual(1);
    expect(pixelRect.height).toBeGreaterThanOrEqual(1);
  });

  it('never produces a zero-size rect even at the far edge of the bitmap', () => {
    const pixelRect = normalizedRectToPixelRect(
      { x: 0.9999, y: 0.9999, width: 0.00001, height: 0.00001 },
      sourceSize,
    );
    expect(pixelRect.width).toBeGreaterThanOrEqual(1);
    expect(pixelRect.height).toBeGreaterThanOrEqual(1);
    expect(pixelRect.x + pixelRect.width).toBeLessThanOrEqual(sourceSize.width);
    expect(pixelRect.y + pixelRect.height).toBeLessThanOrEqual(sourceSize.height);
  });

  it('clamps a normalized rect that extends past the page edge', () => {
    const pixelRect = normalizedRectToPixelRect(
      { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
      sourceSize,
    );
    expect(pixelRect.x + pixelRect.width).toBeLessThanOrEqual(sourceSize.width);
    expect(pixelRect.y + pixelRect.height).toBeLessThanOrEqual(sourceSize.height);
  });

  it('never produces a non-integer or out-of-bounds rect across many random inputs', () => {
    const random = seededRandom(42);
    for (let i = 0; i < 500; i += 1) {
      const x = random();
      const y = random();
      const width = random() * (1 - x);
      const height = random() * (1 - y);
      const pixelRect = normalizedRectToPixelRect({ x, y, width, height }, sourceSize);
      expect(Number.isInteger(pixelRect.x)).toBe(true);
      expect(Number.isInteger(pixelRect.y)).toBe(true);
      expect(Number.isInteger(pixelRect.width)).toBe(true);
      expect(Number.isInteger(pixelRect.height)).toBe(true);
      expect(pixelRect.width).toBeGreaterThanOrEqual(1);
      expect(pixelRect.height).toBeGreaterThanOrEqual(1);
      expect(pixelRect.x).toBeGreaterThanOrEqual(0);
      expect(pixelRect.y).toBeGreaterThanOrEqual(0);
      expect(pixelRect.x + pixelRect.width).toBeLessThanOrEqual(sourceSize.width);
      expect(pixelRect.y + pixelRect.height).toBeLessThanOrEqual(sourceSize.height);
    }
  });
});

describe('chooseCaptureScale', () => {
  const pageSizePt = { widthPt: 612, heightPt: 792 };

  it('produces a long edge that matches the ceiling for a large selection', () => {
    const norm = { x: 0, y: 0, width: 1, height: 1 };
    const scale = chooseCaptureScale(norm, pageSizePt);
    const longEdgePt = Math.max(norm.width * pageSizePt.widthPt, norm.height * pageSizePt.heightPt);
    expect(longEdgePt * scale).toBeCloseTo(MAX_CAPTURE_LONG_EDGE_PX, 6);
  });

  it('never exceeds the requested long-edge ceiling across many random rects', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const x = random();
      const y = random();
      const width = random() * (1 - x) || 0.0001;
      const height = random() * (1 - y) || 0.0001;
      const norm = { x, y, width, height };
      const scale = chooseCaptureScale(norm, pageSizePt);
      const longEdgePt = Math.max(width * pageSizePt.widthPt, height * pageSizePt.heightPt);
      expect(longEdgePt * scale).toBeLessThanOrEqual(MAX_CAPTURE_LONG_EDGE_PX + 1e-6);
    }
  });

  it('caps the scale for a tiny selection instead of upscaling arbitrarily', () => {
    const scale = chooseCaptureScale({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 }, pageSizePt);
    expect(scale).toBeLessThanOrEqual(MAX_CAPTURE_UPSCALE);
  });

  it('respects a custom maxLongEdgePx', () => {
    const norm = { x: 0, y: 0, width: 1, height: 1 };
    const scale = chooseCaptureScale(norm, pageSizePt, 512);
    const longEdgePt = Math.max(pageSizePt.widthPt, pageSizePt.heightPt);
    expect(longEdgePt * scale).toBeCloseTo(512, 6);
  });
});

describe('rectTolerancePx / rectsWithinTolerance', () => {
  it('uses the fixed CSS px floor for a small board', () => {
    expect(rectTolerancePx(100)).toBe(RECT_TOLERANCE_CSS_PX);
  });

  it('uses the percentage once it exceeds the fixed floor', () => {
    const size = 10000;
    expect(rectTolerancePx(size)).toBeCloseTo(RECT_TOLERANCE_FRACTION * size, 9);
  });

  it('treats rects within tolerance as matching', () => {
    const a = { x: 10, y: 10, width: 100, height: 100 };
    const b = { x: 12, y: 8, width: 103, height: 97 };
    expect(rectsWithinTolerance(a, b, 4)).toBe(true);
  });

  it('treats rects outside tolerance as not matching', () => {
    const a = { x: 10, y: 10, width: 100, height: 100 };
    const b = { x: 20, y: 10, width: 100, height: 100 };
    expect(rectsWithinTolerance(a, b, 4)).toBe(false);
  });
});

describe('crop-coordinate proof', () => {
  it('maps a CSS-px drag through normalization, capture scale, and pixel rect, and back within tolerance', () => {
    const pageSizePt = { widthPt: 612, heightPt: 792 };
    const displaySize = { width: 620, height: 802 };
    const drag = { start: { x: 50, y: 60 }, end: { x: 250, y: 340 } };

    const displayRect = clampDisplayRect(normalizeDragRect(drag.start, drag.end), displaySize);
    const normalizedRect = displayRectToNormalized(displayRect, displaySize);

    const scale = chooseCaptureScale(normalizedRect, pageSizePt);
    const sourceSize = { width: pageSizePt.widthPt * scale, height: pageSizePt.heightPt * scale };

    const pixelRect = normalizedRectToPixelRect(normalizedRect, sourceSize);

    const roundTrippedNormalized = {
      x: pixelRect.x / sourceSize.width,
      y: pixelRect.y / sourceSize.height,
      width: pixelRect.width / sourceSize.width,
      height: pixelRect.height / sourceSize.height,
    };
    const roundTrippedDisplay = normalizedRectToDisplay(roundTrippedNormalized, displaySize);

    const tolerancePx = rectTolerancePx(Math.max(displaySize.width, displaySize.height));
    expect(rectsWithinTolerance(displayRect, roundTrippedDisplay, tolerancePx)).toBe(true);
  });

  it('holds across many random drags on many page/display sizes', () => {
    const random = seededRandom(123);
    for (let i = 0; i < 200; i += 1) {
      const pageSizePt = { widthPt: 400 + random() * 400, heightPt: 400 + random() * 700 };
      const displaySize = { width: 300 + random() * 500, height: 300 + random() * 700 };
      const start = { x: random() * displaySize.width, y: random() * displaySize.height };
      const end = { x: random() * displaySize.width, y: random() * displaySize.height };

      const displayRect = clampDisplayRect(normalizeDragRect(start, end), displaySize);
      if (displayRect.width < 1 || displayRect.height < 1) {
        continue;
      }
      const normalizedRect = displayRectToNormalized(displayRect, displaySize);

      const scale = chooseCaptureScale(normalizedRect, pageSizePt);
      const sourceSize = { width: pageSizePt.widthPt * scale, height: pageSizePt.heightPt * scale };
      const pixelRect = normalizedRectToPixelRect(normalizedRect, sourceSize);

      const roundTrippedNormalized = {
        x: pixelRect.x / sourceSize.width,
        y: pixelRect.y / sourceSize.height,
        width: pixelRect.width / sourceSize.width,
        height: pixelRect.height / sourceSize.height,
      };
      const roundTrippedDisplay = normalizedRectToDisplay(roundTrippedNormalized, displaySize);

      const tolerancePx = rectTolerancePx(Math.max(displaySize.width, displaySize.height));
      expect(rectsWithinTolerance(displayRect, roundTrippedDisplay, tolerancePx)).toBe(true);
    }
  });
});
