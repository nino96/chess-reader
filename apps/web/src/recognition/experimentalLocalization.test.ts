import type { BoardCorners, GrayImage, RecognitionResult } from '@scoriiu/fenshot';
import { describe, expect, it, vi } from 'vitest';

import { LOCALIZATION_VERSION, locateBoards, recognizeLocalized } from './experimentalLocalization';

function image(width: number, height: number, value = 238): GrayImage {
  return { width, height, data: new Float32Array(width * height).fill(value) };
}

function paintBoard(
  target: GrayImage,
  left: number,
  top: number,
  side: number,
  options: { readonly textured?: boolean; readonly ranks?: number } = {},
): void {
  const cell = side / 8;
  const ranks = options.ranks ?? 8;
  for (let y = top; y < top + cell * ranks && y < target.height; y += 1) {
    for (let x = left; x < left + side && x < target.width; x += 1) {
      const rank = Math.floor((y - top) / cell);
      const file = Math.floor((x - left) / cell);
      const light = (rank + file) % 2 === 0;
      let value = light ? 222 : 72;
      if (options.textured === true && !light) {
        value += ((x + y) % 7) * 3;
      }
      target.data[y * target.width + x] = value;
    }
  }
  // Piece-like central marks must not overwhelm the corner-patch evidence.
  for (const [rank, file] of [
    [0, 0],
    [1, 4],
    [3, 3],
    [6, 2],
    [7, 7],
  ] as const) {
    if (rank >= ranks) continue;
    const cx = Math.round(left + (file + 0.5) * cell);
    const cy = Math.round(top + (rank + 0.5) * cell);
    const radius = Math.max(1, Math.floor(cell * 0.22));
    for (let y = cy - radius; y <= cy + radius; y += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        if (x >= 0 && y >= 0 && x < target.width && y < target.height) {
          target.data[y * target.width + x] = 25;
        }
      }
    }
  }
}

function classifierResult(confidence = 0.7): RecognitionResult {
  return {
    placement: '8/8/8/8/8/8/8/K6k',
    confidences: new Array<number>(64).fill(confidence),
    minConfidence: confidence,
    meanConfidence: confidence,
  };
}

describe('experimental localization candidate', () => {
  it('has a stable version and finds complete textured boards from page pixels', () => {
    const gray = image(384, 320);
    paintBoard(gray, 72, 48, 192, { textured: true });

    const boards = locateBoards(gray);

    expect(LOCALIZATION_VERSION).toBe('integral-checkerboard-v1');
    expect(boards).toHaveLength(1);
    expect(Math.abs((boards[0]?.x0 ?? 0) - 72)).toBeLessThanOrEqual(3);
    expect(Math.abs((boards[0]?.y0 ?? 0) - 48)).toBeLessThanOrEqual(3);
    expect(Math.abs((boards[0]?.x1 ?? 0) - 264)).toBeLessThanOrEqual(3);
    expect(Math.abs((boards[0]?.y1 ?? 0) - 240)).toBeLessThanOrEqual(3);
  });

  it('finds separate complete boards but bounds the public candidate count', () => {
    const gray = image(640, 640);
    paintBoard(gray, 24, 24, 128);
    paintBoard(gray, 232, 32, 128, { textured: true });
    paintBoard(gray, 40, 256, 128);
    paintBoard(gray, 240, 264, 128, { textured: true });
    paintBoard(gray, 448, 448, 128);

    const boards = locateBoards(gray);

    expect(boards.length).toBeGreaterThanOrEqual(2);
    expect(boards.length).toBeLessThanOrEqual(4);
    expect(boards.every((board) => board.x0 >= 0 && board.y0 >= 0)).toBe(true);
    expect(boards.every((board) => board.x1 <= gray.width && board.y1 <= gray.height)).toBe(true);
  });

  it('abstains on flat, ordinary grid, and partial-board pixels', () => {
    const flat = image(240, 240);
    const grid = image(240, 240);
    for (let index = 20; index <= 220; index += 25) {
      for (let x = 20; x <= 220; x += 1) grid.data[index * grid.width + x] = 30;
      for (let y = 20; y <= 220; y += 1) grid.data[y * grid.width + index] = 30;
    }
    const partial = image(240, 240);
    paintBoard(partial, 40, 40, 160, { ranks: 7 });

    expect(locateBoards(flat)).toEqual([]);
    expect(locateBoards(grid)).toEqual([]);
    expect(locateBoards(partial)).toEqual([]);
  });

  it('accepts bounded capture rounding but rejects malformed and oversized images', () => {
    const roundedCapture = image(1025, 128);
    paintBoard(roundedCapture, 800, 4, 120, { textured: true });
    expect(locateBoards(roundedCapture)).toHaveLength(1);

    expect(() => locateBoards({ width: 80, height: 80, data: new Float32Array(2) })).toThrow(
      /data length/,
    );
    expect(() => locateBoards({ width: 4097, height: 80, data: new Float32Array(1) })).toThrow(
      /at most 4096/,
    );
    const nonFinite = image(80, 80);
    nonFinite.data[4] = Number.NaN;
    expect(() => locateBoards(nonFinite)).toThrow(/finite values/);
  });

  it('passes detector geometry to classification and preserves a 0.7 result', async () => {
    const gray = image(256, 256);
    paintBoard(gray, 48, 48, 160, { textured: true });
    const classify = vi.fn((_corners: BoardCorners) => Promise.resolve(classifierResult()));

    const results = await recognizeLocalized(gray, classify);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.minConfidence).toBe(0.7);
    expect(results[0]?.corners).toEqual(classify.mock.calls[0]?.[0]);
  });

  it('honors cancellation before work and while classification is pending', async () => {
    const gray = image(256, 256);
    paintBoard(gray, 48, 48, 160);
    const before = new AbortController();
    before.abort();
    await expect(
      recognizeLocalized(gray, () => Promise.resolve(classifierResult()), before.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });

    const during = new AbortController();
    let release: ((result: RecognitionResult) => void) | undefined;
    const pending = recognizeLocalized(
      gray,
      () =>
        new Promise<RecognitionResult>((resolve) => {
          release = resolve;
        }),
      during.signal,
    );
    await vi.waitFor(() => {
      expect(release).toBeTypeOf('function');
    });
    during.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release?.(classifierResult());
  });

  it('propagates classifier failure without returning committed-looking results', async () => {
    const gray = image(256, 256);
    paintBoard(gray, 48, 48, 160);
    const failure = new Error('classifier failed');

    await expect(recognizeLocalized(gray, () => Promise.reject(failure))).rejects.toBe(failure);
  });
});
