import { describe, expect, it } from 'vitest';

import {
  MAX_REGION_DIMENSION_PX,
  MIN_REGION_DIMENSION_PX,
  runRecognition,
  validateRegion,
} from './pipeline';

/**
 * Builds a synthetic RGBA checkerboard: an 8x8 grid of `tile`-px squares
 * centered in a `margin`-px flat border. This shape is what fenshot's
 * gradient-peak detector (chessboard_finder.py port) locks onto: crisp,
 * evenly spaced edges on both axes. Verified directly against
 * `findChessboardCorners` during development (exact corner match at
 * tile=32, margin=32).
 */
function createCheckerboardRegion(
  tile = 32,
  margin = 32,
): { width: number; height: number; data: Uint8ClampedArray } {
  const boardSize = tile * 8;
  const size = boardSize + margin * 2;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 200;
    data[i * 4 + 1] = 200;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const light = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
      const value = light ? 255 : 0;
      const px = margin + x;
      const py = margin + y;
      const idx = (py * size + px) * 4;
      data[idx] = value;
      data[idx + 1] = value;
      data[idx + 2] = value;
      data[idx + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function createFlatRegion(
  width = 64,
  height = 64,
  value = 128,
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

const STARTING_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
/** 180-degree rotation of the starting position: a board photographed from
 *  Black's side would read this way (white pawns appear "high" in the read). */
const BLACK_POV_PLACEMENT = 'RNBKQBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbkqbnr';

function makeConfidences(value: number): number[] {
  return new Array(64).fill(value) as number[];
}

describe('runRecognition', () => {
  it('maps a detected board to a board outcome with expected fields', async () => {
    const region = createCheckerboardRegion();
    const classify = async () =>
      Promise.resolve({
        placement: STARTING_PLACEMENT,
        confidences: makeConfidences(0.9),
        minConfidence: 0.9,
        meanConfidence: 0.9,
      });

    const outcome = await runRecognition(region, classify);

    expect(outcome.kind).toBe('board');
    if (outcome.kind !== 'board') {
      throw new Error('expected a board outcome');
    }
    expect(outcome.board.placement).toBe(STARTING_PLACEMENT);
    expect(outcome.board.confidences).toHaveLength(64);
    expect(outcome.board.minConfidence).toBeCloseTo(0.9);
    expect(outcome.board.meanConfidence).toBeCloseTo(0.9);
    expect(outcome.board.reliable).toBe(true);
    expect(outcome.board.proposedOrientation).toBe('white');
    // The detector should find the board close to its known location.
    expect(outcome.board.corners.x0).toBeGreaterThanOrEqual(0);
    expect(outcome.board.corners.x1).toBeGreaterThan(outcome.board.corners.x0);
    expect(outcome.board.corners.y1).toBeGreaterThan(outcome.board.corners.y0);
  });

  it('proposes black orientation for a placement read from Black point of view, without flipping placement', async () => {
    const region = createCheckerboardRegion();
    const classify = async () =>
      Promise.resolve({
        placement: BLACK_POV_PLACEMENT,
        confidences: makeConfidences(0.95),
        minConfidence: 0.95,
        meanConfidence: 0.95,
      });

    const outcome = await runRecognition(region, classify);

    expect(outcome.kind).toBe('board');
    if (outcome.kind !== 'board') {
      throw new Error('expected a board outcome');
    }
    // Placement must stay exactly as read; only orientation is proposed.
    expect(outcome.board.placement).toBe(BLACK_POV_PLACEMENT);
    expect(outcome.board.proposedOrientation).toBe('black');
  });

  it('marks a board unreliable when any tile confidence is below the floor', async () => {
    const region = createCheckerboardRegion();
    const confidences = makeConfidences(0.95);
    confidences[10] = 0.4;
    const classify = async () =>
      Promise.resolve({
        placement: STARTING_PLACEMENT,
        confidences,
        minConfidence: 0.4,
        meanConfidence: 0.9,
      });

    const outcome = await runRecognition(region, classify);

    expect(outcome.kind).toBe('board');
    if (outcome.kind !== 'board') {
      throw new Error('expected a board outcome');
    }
    expect(outcome.board.reliable).toBe(false);
  });

  it('returns no-board for a flat region with no detectable structure', async () => {
    const region = createFlatRegion();
    let called = false;
    const classify = async () => {
      called = true;
      return Promise.resolve({
        placement: STARTING_PLACEMENT,
        confidences: makeConfidences(1),
        minConfidence: 1,
        meanConfidence: 1,
      });
    };

    const outcome = await runRecognition(region, classify);

    expect(outcome).toEqual({ kind: 'no-board' });
    expect(called).toBe(false);
  });

  it('throws when data length does not match width*height*4', () => {
    expect(() => {
      validateRegion({ width: 10, height: 10, data: new Uint8ClampedArray(10) });
    }).toThrow(/data length/);
  });

  it('throws when a dimension is below the minimum', () => {
    expect(() => {
      validateRegion({
        width: MIN_REGION_DIMENSION_PX - 1,
        height: MIN_REGION_DIMENSION_PX,
        data: new Uint8ClampedArray((MIN_REGION_DIMENSION_PX - 1) * MIN_REGION_DIMENSION_PX * 4),
      });
    }).toThrow(/at least/);
  });

  it('throws when a dimension exceeds the maximum', () => {
    expect(() => {
      validateRegion({
        width: MAX_REGION_DIMENSION_PX + 1,
        height: MIN_REGION_DIMENSION_PX,
        data: new Uint8ClampedArray(1),
      });
    }).toThrow(/at most/);
  });

  it('throws when a dimension is not an integer', () => {
    expect(() => {
      validateRegion({ width: 10.5, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) });
    }).toThrow(/integers/);
  });
});
