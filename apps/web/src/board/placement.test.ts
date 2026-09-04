import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  EMPTY_PLACEMENT,
  PlacementError,
  START_PLACEMENT,
  SQUARE_COUNT,
  boardIndexToConfidenceIndex,
  confidenceIndexToBoardIndex,
  displayOrder,
  flipOrientation,
  isValidPlacement,
  parsePlacement,
  pieceGlyph,
  pieceLabel,
  serializePlacement,
  setSquare,
  squareIndex,
  squareName,
  type BoardSquares,
} from './placement';

describe('parsePlacement / serializePlacement round trips', () => {
  it('round-trips the empty placement', () => {
    const squares = parsePlacement(EMPTY_PLACEMENT);
    expect(squares).toHaveLength(SQUARE_COUNT);
    expect(squares.every((s) => s === null)).toBe(true);
    expect(serializePlacement(squares)).toBe(EMPTY_PLACEMENT);
  });

  it('round-trips the start placement', () => {
    const squares = parsePlacement(START_PLACEMENT);
    expect(squares).toHaveLength(SQUARE_COUNT);
    expect(squares[0]).toBe('bR'); // a8
    expect(squares[4]).toBe('bK'); // e8
    expect(squares[56]).toBe('wR'); // a1
    expect(squares[60]).toBe('wK'); // e1
    expect(serializePlacement(squares)).toBe(START_PLACEMENT);
  });

  it('round-trips an arbitrary mixed placement', () => {
    const fen = '4k3/8/8/8/4Pp2/8/8/4K3';
    const squares = parsePlacement(fen);
    expect(serializePlacement(squares)).toBe(fen);
  });
});

describe('parsePlacement validation', () => {
  it('rejects too few or too many ranks', () => {
    expect(() => parsePlacement('8/8/8/8/8/8/8')).toThrow(PlacementError);
    expect(() => parsePlacement('8/8/8/8/8/8/8/8/8')).toThrow(PlacementError);
  });

  it('rejects a rank with too many files', () => {
    expect(() => parsePlacement('9/8/8/8/8/8/8/8')).toThrow(PlacementError);
    expect(() => parsePlacement('pppppppp1/8/8/8/8/8/8/8')).toThrow(PlacementError);
  });

  it('rejects a rank with too few files', () => {
    expect(() => parsePlacement('7/8/8/8/8/8/8/8')).toThrow(PlacementError);
  });

  it('rejects invalid characters', () => {
    expect(() => parsePlacement('xxxxxxxx/8/8/8/8/8/8/8')).toThrow(PlacementError);
    expect(() => parsePlacement('PPPPPPPZ/8/8/8/8/8/8/8')).toThrow(PlacementError);
  });

  it('rejects adjacent digits', () => {
    expect(() => parsePlacement('44/8/8/8/8/8/8/8')).toThrow(PlacementError);
  });

  it('rejects an empty rank string', () => {
    expect(() => parsePlacement('/8/8/8/8/8/8/8')).toThrow(PlacementError);
  });
});

describe('isValidPlacement', () => {
  it('returns true for valid placements and false for invalid ones', () => {
    expect(isValidPlacement(EMPTY_PLACEMENT)).toBe(true);
    expect(isValidPlacement(START_PLACEMENT)).toBe(true);
    expect(isValidPlacement('not-a-fen')).toBe(false);
    expect(isValidPlacement('9/8/8/8/8/8/8/8')).toBe(false);
  });
});

describe('setSquare', () => {
  it('returns a new array and does not mutate the input', () => {
    const original: BoardSquares = parsePlacement(EMPTY_PLACEMENT);
    const updated = setSquare(original, 0, 'wK');

    expect(original[0]).toBeNull();
    expect(updated[0]).toBe('wK');
    expect(updated).not.toBe(original);
    expect(updated).toHaveLength(SQUARE_COUNT);
  });

  it('can clear a square by setting null', () => {
    const withKing = setSquare(parsePlacement(EMPTY_PLACEMENT), 10, 'bQ');
    const cleared = setSquare(withKing, 10, null);
    expect(cleared[10]).toBeNull();
  });

  it('throws for an out-of-range index', () => {
    const squares = parsePlacement(EMPTY_PLACEMENT);
    expect(() => setSquare(squares, -1, 'wK')).toThrow(RangeError);
    expect(() => setSquare(squares, 64, 'wK')).toThrow(RangeError);
  });
});

describe('squareName / squareIndex', () => {
  it('maps index 0 to a8 and index 63 to h1', () => {
    expect(squareName(0)).toBe('a8');
    expect(squareName(63)).toBe('h1');
  });

  it('maps a few known squares both ways', () => {
    const cases: readonly (readonly [number, string])[] = [
      [0, 'a8'],
      [7, 'h8'],
      [8, 'a7'],
      [28, 'e5'],
      [56, 'a1'],
      [60, 'e1'],
      [63, 'h1'],
    ];
    for (const [index, name] of cases) {
      expect(squareName(index)).toBe(name);
      expect(squareIndex(name)).toBe(index);
    }
  });

  it('throws for invalid inputs', () => {
    expect(() => squareName(-1)).toThrow(RangeError);
    expect(() => squareName(64)).toThrow(RangeError);
    expect(() => squareIndex('i1')).toThrow(RangeError);
    expect(() => squareIndex('a9')).toThrow(RangeError);
    expect(() => squareIndex('a')).toThrow(RangeError);
  });
});

describe('displayOrder', () => {
  it('is the identity order for white (a8 first, h1 last)', () => {
    const order = displayOrder('white');
    expect(order).toHaveLength(SQUARE_COUNT);
    expect(order[0]).toBe(0);
    expect(order[63]).toBe(63);
    expect(squareName(order[0] ?? -1)).toBe('a8');
    expect(squareName(order[63] ?? -1)).toBe('h1');
  });

  it('is fully reversed for black (h1 first, a8 last)', () => {
    const order = displayOrder('black');
    expect(order).toHaveLength(SQUARE_COUNT);
    expect(order[0]).toBe(63);
    expect(order[63]).toBe(0);
    expect(squareName(order[0] ?? -1)).toBe('h1');
    expect(squareName(order[63] ?? -1)).toBe('a8');
  });

  it('covers every board index exactly once for both orientations', () => {
    for (const orientation of ['white', 'black'] as const) {
      const order = displayOrder(orientation);
      expect(new Set(order).size).toBe(SQUARE_COUNT);
    }
  });
});

describe('flipOrientation', () => {
  it('toggles between white and black', () => {
    expect(flipOrientation('white')).toBe('black');
    expect(flipOrientation('black')).toBe('white');
  });
});

describe('pieceLabel / pieceGlyph', () => {
  it('returns a human-readable label for every piece', () => {
    expect(pieceLabel('wN')).toBe('white knight');
    expect(pieceLabel('bK')).toBe('black king');
  });

  it('returns a unicode glyph for every piece', () => {
    expect(pieceGlyph('wK')).toBe('♔');
    expect(pieceGlyph('bP')).toBe('♟');
  });
});

describe('confidence index conversion', () => {
  it('maps board index 0 (a8) to confidence index 56', () => {
    expect(boardIndexToConfidenceIndex(0)).toBe(56);
    expect(confidenceIndexToBoardIndex(56)).toBe(0);
  });

  it('maps board index 63 (h1) to confidence index 7', () => {
    expect(boardIndexToConfidenceIndex(63)).toBe(7);
    expect(confidenceIndexToBoardIndex(7)).toBe(63);
  });

  it('maps confidence index 0 (a1) to board index 56', () => {
    expect(confidenceIndexToBoardIndex(0)).toBe(56);
    expect(boardIndexToConfidenceIndex(56)).toBe(0);
  });

  it('maps confidence index 63 (h8) to board index 7', () => {
    expect(confidenceIndexToBoardIndex(63)).toBe(7);
    expect(boardIndexToConfidenceIndex(7)).toBe(63);
  });

  it('round-trips for every square', () => {
    for (let boardIndex = 0; boardIndex < SQUARE_COUNT; boardIndex += 1) {
      const confidenceIndex = boardIndexToConfidenceIndex(boardIndex);
      expect(confidenceIndexToBoardIndex(confidenceIndex)).toBe(boardIndex);
    }
  });

  it('is consistent with square names: confidence index N%8 + 8*(rank-1) matches algebraic order', () => {
    // a1..h1 are confidence indexes 0..7; a8..h8 are confidence indexes 56..63.
    expect(confidenceIndexToBoardIndex(0)).toBe(squareIndex('a1'));
    expect(confidenceIndexToBoardIndex(7)).toBe(squareIndex('h1'));
    expect(confidenceIndexToBoardIndex(56)).toBe(squareIndex('a8'));
    expect(confidenceIndexToBoardIndex(63)).toBe(squareIndex('h8'));
  });

  it('throws for out-of-range inputs', () => {
    expect(() => boardIndexToConfidenceIndex(-1)).toThrow(RangeError);
    expect(() => boardIndexToConfidenceIndex(64)).toThrow(RangeError);
    expect(() => confidenceIndexToBoardIndex(-1)).toThrow(RangeError);
    expect(() => confidenceIndexToBoardIndex(64)).toThrow(RangeError);
  });
});

describe('constants', () => {
  it('exposes board size and square count', () => {
    expect(BOARD_SIZE).toBe(8);
    expect(SQUARE_COUNT).toBe(64);
  });
});
