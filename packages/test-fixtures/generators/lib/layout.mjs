// @ts-check
/**
 * Shared page/board geometry for `pdf-synthetic-diagram-01.pdf`. Both
 * `make-diagram-pdf.mjs` (drawing) and `tests/diagram-recognition.test.ts`
 * (cropping) import these constants so the two can never drift apart, and
 * `tests/manifest.test.ts` re-derives `manifest.json`'s `expected.boardRect`
 * from them to catch any hand-transcription mistake.
 *
 * The "*_PT" constants are PDF points in pdf-lib's native coordinate space:
 * origin at the page's bottom-left corner, y increasing upward. `NormalizedRect`
 * (see apps/web/src/study/contracts.ts) is the opposite convention: origin at
 * the page's top-left corner, y increasing downward, as fractions of page
 * width/height. `toNormalizedRect` converts between the two.
 */

export const PAGE_WIDTH_PT = 420;
export const PAGE_HEIGHT_PT = 640;
export const MARGIN_PT = 56;

/** "Board size about 60% of page width, centered." */
export const BOARD_SIZE_PT = PAGE_WIDTH_PT * 0.6;
export const BOARD_LEFT_PT = (PAGE_WIDTH_PT - BOARD_SIZE_PT) / 2;
/** Distance from the page's top edge down to the board's top edge. */
export const BOARD_TOP_GAP_PT = 232;
/** The board's bottom edge, in PDF (bottom-up) points. */
export const BOARD_BOTTOM_PT = PAGE_HEIGHT_PT - BOARD_TOP_GAP_PT - BOARD_SIZE_PT;
export const SQUARE_SIZE_PT = BOARD_SIZE_PT / 8;

/**
 * Mid-game position (after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.d3 d6, roughly) with pawns of
 * both colors on non-home ranks, so pawn-advance direction makes the orientation
 * decidable from pixels alone.
 */
export const PLACEMENT_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';

/** The board's outer border, in PDF points. */
export const BOARD_RECT_PT = {
  x: BOARD_LEFT_PT,
  bottom: BOARD_BOTTOM_PT,
  width: BOARD_SIZE_PT,
  height: BOARD_SIZE_PT,
};

/**
 * Page 0's title line ("Chess Reader Synthetic Fixture", 18pt bold at the top
 * margin): a real but sparse text region, used by the golden test's negative ("no
 * board found") case. A denser multi-line paragraph is more book-diagram-like than
 * it sounds -- text baselines are themselves a source of evenly spaced gradient
 * peaks, and empirically fenshot's board-shape detector occasionally locks onto a
 * dense paragraph as a false-positive "board." A single sparse heading line does
 * not exhibit that failure mode, which is why the negative case targets this
 * region rather than the longer paragraphs below it.
 */
export const NEGATIVE_TEXT_RECT_PT = {
  x: MARGIN_PT - 14,
  bottom: PAGE_HEIGHT_PT - 76.8,
  width: PAGE_WIDTH_PT - 2 * (MARGIN_PT - 14),
  height: 51.2,
};

/**
 * @param {{ x: number; bottom: number; width: number; height: number }} rectPt a
 *   rectangle in PDF points (origin bottom-left, y up).
 * @returns {{ x: number; y: number; width: number; height: number }} the same
 *   rectangle as fractions of page width/height (origin top-left, y down).
 */
export function toNormalizedRect(rectPt) {
  const topPt = PAGE_HEIGHT_PT - (rectPt.bottom + rectPt.height);
  return {
    x: rectPt.x / PAGE_WIDTH_PT,
    y: topPt / PAGE_HEIGHT_PT,
    width: rectPt.width / PAGE_WIDTH_PT,
    height: rectPt.height / PAGE_HEIGHT_PT,
  };
}

/**
 * @param {number} file 1 (the a-file) through 8 (the h-file).
 * @param {number} rank 1 through 8.
 * @returns {{ x: number; y: number }} the square's center, in PDF points.
 */
export function squareCenterPt(file, rank) {
  return {
    x: BOARD_LEFT_PT + (file - 0.5) * SQUARE_SIZE_PT,
    y: BOARD_BOTTOM_PT + (rank - 0.5) * SQUARE_SIZE_PT,
  };
}

/**
 * @param {number} file 1 (the a-file) through 8 (the h-file).
 * @param {number} rank 1 through 8.
 * @returns {boolean} `true` for a dark square (a1 is dark, as on a real board).
 */
export function isDarkSquare(file, rank) {
  return (file + rank) % 2 === 0;
}
