/**
 * Pure chess-position model for the editable board (issue #2). No DOM types,
 * no React, no adapter dependency: everything here is testable as plain data.
 *
 * Board indexing ("BoardSquares order"): index 0 is a8 and index 63 is h1, i.e.
 * exactly the order a FEN placement field reads in: rank 8 down to rank 1, each
 * rank read left to right (file a to file h). This is deliberately different
 * from the `RecognizedBoard.confidences` order documented in
 * apps/web/src/study/contracts.ts, which is A1..H8 rank-major (index 0 = a1,
 * index 63 = h8). `boardIndexToConfidenceIndex` / `confidenceIndexToBoardIndex`
 * convert between the two; see their doc comments.
 */

import type { BoardOrientation, PlacementFen } from '../study/contracts';

export type Piece =
  'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP' | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

export type Square = Piece | null;

/** Always exactly 64 entries, in BoardSquares order (index 0 = a8 ... 63 = h1). */
export type BoardSquares = readonly Square[];

export const BOARD_SIZE = 8;
export const SQUARE_COUNT = 64;

export const EMPTY_PLACEMENT: PlacementFen = '8/8/8/8/8/8/8/8';
export const START_PLACEMENT: PlacementFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

const FEN_CHAR_TO_PIECE: Readonly<Record<string, Piece>> = {
  K: 'wK',
  Q: 'wQ',
  R: 'wR',
  B: 'wB',
  N: 'wN',
  P: 'wP',
  k: 'bK',
  q: 'bQ',
  r: 'bR',
  b: 'bB',
  n: 'bN',
  p: 'bP',
};

const PIECE_TO_FEN_CHAR: Readonly<Record<Piece, string>> = {
  wK: 'K',
  wQ: 'Q',
  wR: 'R',
  wB: 'B',
  wN: 'N',
  wP: 'P',
  bK: 'k',
  bQ: 'q',
  bR: 'r',
  bB: 'b',
  bN: 'n',
  bP: 'p',
};

const PIECE_LABELS: Readonly<Record<Piece, string>> = {
  wK: 'white king',
  wQ: 'white queen',
  wR: 'white rook',
  wB: 'white bishop',
  wN: 'white knight',
  wP: 'white pawn',
  bK: 'black king',
  bQ: 'black queen',
  bR: 'black rook',
  bB: 'black bishop',
  bN: 'black knight',
  bP: 'black pawn',
};

const PIECE_GLYPHS: Readonly<Record<Piece, string>> = {
  wK: '♔',
  wQ: '♕',
  wR: '♖',
  wB: '♗',
  wN: '♘',
  wP: '♙',
  bK: '♚',
  bQ: '♛',
  bR: '♜',
  bB: '♝',
  bN: '♞',
  bP: '♟',
};

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacementError';
  }
}

/**
 * Parses a FEN piece-placement field into 64 squares in BoardSquares order.
 * Strict: exactly 8 ranks separated by "/", each rank's digits and piece
 * letters summing to exactly 8 files, only characters in "KQRBNPkqrbnp1-8",
 * and no two adjacent digits (e.g. "44" is rejected; use "8").
 */
export function parsePlacement(fen: PlacementFen): BoardSquares {
  const ranks = fen.split('/');
  if (ranks.length !== 8) {
    throw new PlacementError(
      `Placement must have exactly 8 ranks separated by "/", got ${String(ranks.length)}.`,
    );
  }

  const squares: Square[] = [];
  for (const [rankIndex, rank] of ranks.entries()) {
    if (rank.length === 0) {
      throw new PlacementError(`Rank ${String(rankIndex + 1)} is empty.`);
    }

    let fileCount = 0;
    let previousWasDigit = false;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        if (previousWasDigit) {
          throw new PlacementError(
            `Rank ${String(rankIndex + 1)} has two adjacent digits; use a single digit for a run of empty squares.`,
          );
        }
        fileCount += Number(ch);
        for (let i = 0; i < Number(ch); i += 1) {
          squares.push(null);
        }
        previousWasDigit = true;
        continue;
      }

      const piece = FEN_CHAR_TO_PIECE[ch];
      if (piece === undefined) {
        throw new PlacementError(
          `Rank ${String(rankIndex + 1)} contains an invalid character "${ch}".`,
        );
      }
      fileCount += 1;
      squares.push(piece);
      previousWasDigit = false;
    }

    if (fileCount !== 8) {
      throw new PlacementError(
        `Rank ${String(rankIndex + 1)} covers ${String(fileCount)} files; each rank must cover exactly 8.`,
      );
    }
  }

  return squares;
}

/** Serializes 64 squares in BoardSquares order back into a FEN placement field. */
export function serializePlacement(squares: BoardSquares): PlacementFen {
  if (squares.length !== SQUARE_COUNT) {
    throw new PlacementError(
      `Expected ${String(SQUARE_COUNT)} squares, got ${String(squares.length)}.`,
    );
  }

  const ranks: string[] = [];
  for (let rank = 0; rank < BOARD_SIZE; rank += 1) {
    let rankStr = '';
    let emptyRun = 0;
    for (let file = 0; file < BOARD_SIZE; file += 1) {
      const square = squares[rank * BOARD_SIZE + file];
      if (square === undefined) {
        throw new PlacementError('Squares array is missing an entry.');
      }
      if (square === null) {
        emptyRun += 1;
        continue;
      }
      if (emptyRun > 0) {
        rankStr += String(emptyRun);
        emptyRun = 0;
      }
      rankStr += PIECE_TO_FEN_CHAR[square];
    }
    if (emptyRun > 0) {
      rankStr += String(emptyRun);
    }
    ranks.push(rankStr);
  }

  return ranks.join('/');
}

export function isValidPlacement(fen: PlacementFen): boolean {
  try {
    parsePlacement(fen);
    return true;
  } catch {
    return false;
  }
}

/** Immutably returns a new BoardSquares with `piece` placed at `index`. */
export function setSquare(squares: BoardSquares, index: number, piece: Square): BoardSquares {
  if (!Number.isInteger(index) || index < 0 || index >= SQUARE_COUNT) {
    throw new RangeError(`Square index out of range: ${String(index)}.`);
  }
  const next = squares.slice();
  next[index] = piece;
  return next;
}

const FILE_LETTERS = 'abcdefgh';

/** BoardSquares index (0 = a8 ... 63 = h1) to algebraic name ("a8" ... "h1"). */
export function squareName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= SQUARE_COUNT) {
    throw new RangeError(`Square index out of range: ${String(index)}.`);
  }
  const file = index % BOARD_SIZE;
  const rankFromTop = Math.floor(index / BOARD_SIZE);
  const rank = BOARD_SIZE - rankFromTop;
  const letter = FILE_LETTERS[file];
  if (letter === undefined) {
    throw new RangeError(`Unreachable: file out of range: ${String(file)}.`);
  }
  return `${letter}${String(rank)}`;
}

/** Algebraic name ("a8" ... "h1") to BoardSquares index (0 = a8 ... 63 = h1). */
export function squareIndex(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) {
    throw new RangeError(`Invalid square name: "${name}".`);
  }
  const file = FILE_LETTERS.indexOf(name[0] ?? '');
  const rank = Number(name[1]);
  const rankFromTop = BOARD_SIZE - rank;
  return rankFromTop * BOARD_SIZE + file;
}

/**
 * The 64 BoardSquares indexes (0 = a8 ... 63 = h1) in visual reading order,
 * top-left to bottom-right, for the given orientation. For "white" (white at
 * the bottom) this is a8 first, h1 last -- the identity order. For "black"
 * (black at the bottom) the board is visually rotated 180 degrees, so h1 is
 * top-left and a8 is bottom-right.
 */
export function displayOrder(orientation: BoardOrientation): readonly number[] {
  const identity = Array.from({ length: SQUARE_COUNT }, (_, i) => i);
  return orientation === 'white' ? identity : identity.slice().reverse();
}

export function flipOrientation(orientation: BoardOrientation): BoardOrientation {
  return orientation === 'white' ? 'black' : 'white';
}

export function pieceLabel(piece: Piece): string {
  return PIECE_LABELS[piece];
}

export function pieceGlyph(piece: Piece): string {
  return PIECE_GLYPHS[piece];
}

/**
 * Converts a BoardSquares index (0 = a8 ... 63 = h1) to the corresponding index
 * into a 64-entry confidence array using the A1..H8 rank-major order documented
 * on `RecognizedBoard.confidences` in apps/web/src/study/contracts.ts (index 0 =
 * a1, index 7 = h1, index 8 = a2, ... index 63 = h8).
 */
export function boardIndexToConfidenceIndex(boardIndex: number): number {
  if (!Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex >= SQUARE_COUNT) {
    throw new RangeError(`Board index out of range: ${String(boardIndex)}.`);
  }
  const file = boardIndex % BOARD_SIZE;
  const rankFromTop = Math.floor(boardIndex / BOARD_SIZE);
  const rank = BOARD_SIZE - rankFromTop;
  return (rank - 1) * BOARD_SIZE + file;
}

/** The inverse of `boardIndexToConfidenceIndex`. */
export function confidenceIndexToBoardIndex(confidenceIndex: number): number {
  if (
    !Number.isInteger(confidenceIndex) ||
    confidenceIndex < 0 ||
    confidenceIndex >= SQUARE_COUNT
  ) {
    throw new RangeError(`Confidence index out of range: ${String(confidenceIndex)}.`);
  }
  const file = confidenceIndex % BOARD_SIZE;
  const rank = Math.floor(confidenceIndex / BOARD_SIZE) + 1;
  const rankFromTop = BOARD_SIZE - rank;
  return rankFromTop * BOARD_SIZE + file;
}
