#!/usr/bin/env node
// @ts-check
/**
 * Deterministic generator for `pdf/pdf-synthetic-diagram-01.pdf`.
 *
 * Writes a 2-page PDF: page 0 is a title plus a few paragraphs of plain text
 * with NO diagram (a negative fixture for "no board found" tests); page 1 has
 * a paragraph above a printed chess diagram and a caption below it. The
 * diagram imitates a printed chess book: plain white light squares, diagonally
 * hatched dark squares (the style `@scoriiu/fenshot`'s tile classifier was
 * trained on for book diagrams -- see its
 * `tools/tile-classifier/generate-corpus.ts` `proceduralHatchBoard`), and
 * pieces drawn as vector paths parsed from the chessnut piece set (see
 * `assets/pieces/chessnut/PROVENANCE.md`).
 *
 * Style iteration (see tests/diagram-recognition.test.ts, the real-model golden
 * test): the issue's style guidance additionally suggested a thin outer board
 * border and ~80% piece scale. A drawn border -- even a 0.5pt one -- reliably
 * pulled `findChessboardCorners`'s gradient-peak search off by roughly a
 * quarter square on this hatch texture (its own doc calls this a known failure
 * mode of hatched book diagrams), which either shifted the whole read by one
 * rank/file or pushed enough tiles' confidence below fenshot's 0.7 reliability
 * floor to fail `reliable === true`. No border, plus a slightly larger 88%
 * piece scale (more piece, less hatch per occupied tile), and flat-gray fill
 * passes the golden test. This is recorded as a fixture
 * limitation in manifest.json rather than silently diverging from the issue's
 * suggested style.
 *
 * Determinism: `PDFDocument.create({ updateMetadata: false })` skips
 * pdf-lib's constructor-time `updateInfoDict()` (which stamps `new Date()`),
 * so every Info-dict field below is set explicitly to a fixed value and
 * nothing overwrites it on `save()`. pdf-lib does not generate a random
 * trailer `/ID` for a freshly created (not loaded) document, so no further
 * patching is needed; `tests/manifest.test.ts` asserts byte-for-byte
 * reproducibility by regenerating into a temp file and comparing hashes.
 *
 * Usage: `node generators/make-diagram-pdf.mjs [outputPath]`
 * (defaults to `pdf/pdf-synthetic-diagram-01.pdf` next to this script).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
// Low-level content-stream operators: pdf-lib's high-level `drawRectangle` has no
// "fill with a repeating pattern clipped to this rect" option, so the hatch fill
// below builds it from a clip region plus many `drawLine` calls.
import { clip, endPath, pushGraphicsState, popGraphicsState, rectangle } from 'pdf-lib';

import {
  BOARD_BOTTOM_PT,
  BOARD_LEFT_PT,
  BOARD_RECT_PT,
  MARGIN_PT,
  NEGATIVE_TEXT_RECT_PT,
  PAGE_HEIGHT_PT,
  PAGE_WIDTH_PT,
  PLACEMENT_FEN,
  SQUARE_SIZE_PT,
  isDarkSquare,
  squareCenterPt,
  toNormalizedRect,
} from './lib/layout.mjs';
import { parsePieceSubpaths } from './lib/svg-shapes.mjs';

/** @typedef {import('pdf-lib').PDFPage} PDFPage */
/** @typedef {import('pdf-lib').PDFFont} PDFFont */
/** @typedef {import('./lib/svg-shapes.mjs').PieceSubpath} PieceSubpath */

const HERE = dirname(fileURLToPath(import.meta.url));
const PIECES_DIR = resolve(HERE, '..', 'assets', 'pieces', 'chessnut');
const DEFAULT_OUTPUT = resolve(HERE, '..', 'pdf', 'pdf-synthetic-diagram-01.pdf');

/** Fixed so every regeneration is byte-identical; see the module docstring. */
const FIXED_DATE = new Date('2026-09-04T00:00:00.000Z');

const PIECE_CODES = /** @type {const} */ ([
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP',
]);

/** Proportions matched to fenshot's training hatch pattern (square = 64px, line
 *  width 1-3px, gap 5-11px): both scaled here to this diagram's 31.5pt squares. */
const HATCH_LINE_WIDTH_PT = SQUARE_SIZE_PT * (1 / 64);
const HATCH_GAP_PT = SQUARE_SIZE_PT * (11 / 64);
const HATCH_INK = rgb(0, 0, 0);
/**
 * Dark-square style. `flat` (the default, and what the committed fixture uses) prints
 * dark squares as a solid light gray, the most common style in typeset chess books.
 * `hatched` uses the 45-degree diagonal hatch below.
 *
 * Measured on 2026-09-04 with the pinned model (`chess-tiles-v2`), sweeping six
 * selection margins (0% to 8% padding on each side) across eight capture resolutions
 * (320 to 1280 px long edge), asserting an exact placement match with minimum square
 * confidence at or above fenshot's 0.7 floor:
 *
 *   flat (gray 0.5/0.6/0.7/0.8)  18/18 per gray level at 512/768/1024 px
 *   hatched                       1/48 overall
 *
 * The hatch is a pathological input for fenshot's gradient-peak board detector: the
 * regular diagonal lines put more gradient energy inside the squares than on the grid
 * lines, so the detected grid lands a fraction of a square off and the read shifts by
 * whole ranks. Upstream documents this as a known failure mode of hatched diagrams and
 * mitigates it with a grid-snap candidate, which is not sufficient for this synthetic
 * pattern. Keeping `hatched` available preserves the
 * reproduction for the follow-up issue without tuning the corpus to a single operating
 * point that only passes by luck. Tracked as
 * https://github.com/nino96/chess-reader/issues/24.
 * Issue #24 now commits it as the separate pdf-synthetic-hatched-01 diagnostic
 * fixture. Exact-bound classification and limitations are recorded in
 * docs/investigations/issue-24-localization.md; the issue #2 golden stays flat.
 */
const DARK_SQUARE_STYLE = process.env['CHESS_READER_FIXTURE_STYLE'] ?? 'flat';
const FLAT_DARK_GRAY = Number(process.env['CHESS_READER_FIXTURE_GRAY'] ?? '0.7');

/** Piece glyphs fill most of their square (larger than the issue's ~80% suggestion;
 *  see the module docstring's "Style iteration" note on why). */
const PIECE_SCALE_FRACTION = 0.88;
/** The chessnut set's SVG viewBox is 0 0 800 800 for every piece. */
const PIECE_VIEWBOX_SIZE = 800;

/**
 * @param {string} fen the FEN piece-placement field (ranks 8..1, "/"-separated).
 * @returns {Map<string, string>} keyed by `"${file},${rank}"` (file/rank both 1..8), value is
 *   a piece code like "wK"/"bP" matching `assets/pieces/chessnut/<code>.svg`.
 */
function parsePlacement(fen) {
  const ranks = fen.split('/');
  if (ranks.length !== 8) {
    throw new Error(`Expected 8 "/"-separated ranks in FEN placement, got ${ranks.length}.`);
  }
  /** @type {Map<string, string>} */
  const board = new Map();
  for (let rankIndex = 0; rankIndex < 8; rankIndex += 1) {
    const rank = 8 - rankIndex;
    const rankStr = /** @type {string} */ (ranks[rankIndex]);
    let file = 1;
    for (const ch of rankStr) {
      if (/^[1-8]$/.test(ch)) {
        file += Number(ch);
        continue;
      }
      if (file > 8) {
        throw new Error(`FEN rank "${rankStr}" describes more than 8 files.`);
      }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      board.set(`${file},${rank}`, `${color}${ch.toUpperCase()}`);
      file += 1;
    }
  }
  return board;
}

/**
 * @returns {Promise<Map<string, PieceSubpath[]>>} piece code -> its parsed subpaths.
 */
async function loadPieceSubpaths() {
  /** @type {Map<string, PieceSubpath[]>} */
  const byCode = new Map();
  for (const code of PIECE_CODES) {
    const svgText = await readFile(resolve(PIECES_DIR, `${code}.svg`), 'utf8');
    byCode.set(code, parsePieceSubpaths(svgText));
  }
  return byCode;
}

/**
 * Fills a `size` x `size` square at `(x, y)` (bottom-left corner, PDF points) with a
 * 45-degree diagonal hatch: a white background plus parallel thin lines clipped to the
 * square, matching a printed book diagram's dark squares.
 *
 * @param {PDFPage} page
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @returns {void}
 */
function drawHatchedSquare(page, x, y, size) {
  page.pushOperators(pushGraphicsState(), rectangle(x, y, size, size), clip(), endPath());
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });

  // Line family y_local = x_local + c (a 45-degree "/" diagonal in the square's own
  // local coordinates), stepped by `c` so consecutive lines are HATCH_GAP_PT apart
  // (perpendicular distance = step / sqrt(2)). Each segment is drawn well beyond the
  // square's bounds; the clip path set above trims it to exactly the square.
  const step = HATCH_GAP_PT * Math.SQRT2;
  for (let c = -size - step; c <= size + step; c += step) {
    page.drawLine({
      start: { x: x - size, y: y - size + c },
      end: { x: x + 2 * size, y: y + 2 * size + c },
      thickness: HATCH_LINE_WIDTH_PT,
      color: HATCH_INK,
    });
  }

  page.pushOperators(popGraphicsState());
}

/**
 * @param {PDFPage} page
 * @returns {void}
 */
function drawBoardSquares(page) {
  for (let rank = 1; rank <= 8; rank += 1) {
    for (let file = 1; file <= 8; file += 1) {
      const x = BOARD_LEFT_PT + (file - 1) * SQUARE_SIZE_PT;
      const y = BOARD_BOTTOM_PT + (rank - 1) * SQUARE_SIZE_PT;
      if (isDarkSquare(file, rank) && DARK_SQUARE_STYLE === 'hatched') {
        drawHatchedSquare(page, x, y, SQUARE_SIZE_PT);
      } else if (isDarkSquare(file, rank)) {
        page.drawRectangle({
          x,
          y,
          width: SQUARE_SIZE_PT,
          height: SQUARE_SIZE_PT,
          color: rgb(FLAT_DARK_GRAY, FLAT_DARK_GRAY, FLAT_DARK_GRAY),
        });
      } else {
        page.drawRectangle({
          x,
          y,
          width: SQUARE_SIZE_PT,
          height: SQUARE_SIZE_PT,
          color: rgb(1, 1, 1),
        });
      }
    }
  }
}

/**
 * @param {PDFPage} page
 * @param {Map<string, string>} placement
 * @param {Map<string, PieceSubpath[]>} pieceSubpaths
 * @returns {void}
 */
function drawPieces(page, placement, pieceSubpaths) {
  const pieceSizePt = SQUARE_SIZE_PT * PIECE_SCALE_FRACTION;
  const scale = pieceSizePt / PIECE_VIEWBOX_SIZE;

  for (let rank = 1; rank <= 8; rank += 1) {
    for (let file = 1; file <= 8; file += 1) {
      const code = placement.get(`${file},${rank}`);
      if (code === undefined) {
        continue;
      }
      const subpaths = pieceSubpaths.get(code);
      if (subpaths === undefined) {
        throw new Error(`No parsed SVG for piece code "${code}".`);
      }
      const center = squareCenterPt(file, rank);
      // drawSvgPath's (x, y) is where the path data's local (0,0) lands, with the path's
      // positive-y content extending DOWN the page from there (see the module's y-flip
      // note below) -- i.e. (x, y) is the glyph's top-left corner in page space.
      const originX = center.x - pieceSizePt / 2;
      const originY = center.y + pieceSizePt / 2;

      for (const sub of subpaths) {
        /** @type {import('pdf-lib').PDFPageDrawSVGOptions} */
        const options = {
          x: originX,
          y: originY,
          scale,
          ...(sub.fill !== null ? { color: rgb(sub.fill.r, sub.fill.g, sub.fill.b) } : {}),
          ...(sub.stroke !== null
            ? {
                borderColor: rgb(sub.stroke.r, sub.stroke.g, sub.stroke.b),
                borderWidth: sub.strokeWidth,
              }
            : {}),
        };
        page.drawSvgPath(sub.d, options);
      }
    }
  }
}

const TEXT_MAX_WIDTH_PT = PAGE_WIDTH_PT - 2 * MARGIN_PT;

/**
 * Greedy word-wrap using the font's own metrics, so lines never overrun the page's
 * margins regardless of how the surrounding paragraph text is edited later.
 *
 * @param {PDFFont} font
 * @param {string} text
 * @param {number} size
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapParagraph(font, text, size, maxWidth) {
  /** @type {string[]} */
  const lines = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length > 0 && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * Draws each paragraph (word-wrapped to `TEXT_MAX_WIDTH_PT`) top to bottom, starting
 * `topPt` below the page's top edge, with a blank line's worth of extra gap between
 * paragraphs.
 *
 * @param {PDFPage} page
 * @param {PDFFont} font
 * @param {readonly string[]} paragraphs
 * @param {number} topPt distance from the page's top edge to the first line's baseline area.
 * @param {number} size
 * @param {number} leading
 * @returns {void}
 */
function drawParagraphs(page, font, paragraphs, topPt, size, leading) {
  let y = PAGE_HEIGHT_PT - topPt;
  for (const paragraph of paragraphs) {
    for (const line of wrapParagraph(font, paragraph, size, TEXT_MAX_WIDTH_PT)) {
      page.drawText(line, { x: MARGIN_PT, y, size, font, color: rgb(0, 0, 0) });
      y -= leading;
    }
    y -= leading;
  }
}

/**
 * @param {PDFDocument} pdfDoc
 * @param {PDFFont} bodyFont
 * @param {PDFFont} boldFont
 * @returns {void}
 */
function buildNegativePage(pdfDoc, bodyFont, boldFont) {
  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
  page.drawText('Chess Reader Synthetic Fixture', {
    x: MARGIN_PT,
    y: PAGE_HEIGHT_PT - MARGIN_PT,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  drawParagraphs(
    page,
    bodyFont,
    [
      'This is fixture pdf-synthetic-diagram-01, generated by ' +
        'packages/test-fixtures/generators/make-diagram-pdf.mjs for issue #2 of the ' +
        'chess-reader project. It contains only synthetic text and a synthetic chess ' +
        'diagram: no copyrighted book content of any kind.',
    ],
    100,
    11,
    16,
  );

  drawParagraphs(
    page,
    bodyFont,
    [
      'This page intentionally carries no chess diagram. It exists so the ' +
        'recognition test suite can assert the recognizer correctly reports ' +
        '"no board found" here, instead of only ever being tested against a ' +
        'page that does contain a diagram.',
    ],
    236,
    11,
    16,
  );

  drawParagraphs(
    page,
    bodyFont,
    [
      "See this fixture's entry in manifest.json for full provenance, " +
        'licensing, and expected-value detail.',
    ],
    370,
    11,
    16,
  );
}

/**
 * @param {PDFDocument} pdfDoc
 * @param {PDFFont} bodyFont
 * @param {Map<string, PieceSubpath[]>} pieceSubpaths
 * @returns {void}
 */
function buildDiagramPage(pdfDoc, bodyFont, pieceSubpaths) {
  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);

  drawParagraphs(
    page,
    bodyFont,
    [
      'Diagram: a synthetic mid-game position, printed in an imitation ' +
        'book-diagram style (hatched dark squares, vector piece glyphs) to ' +
        'exercise the fenshot recognizer end-to-end from a real PDF page.',
    ],
    80,
    11,
    16,
  );

  drawBoardSquares(page);
  drawPieces(page, parsePlacement(PLACEMENT_FEN), pieceSubpaths);

  page.drawText('Position (White to move):', {
    x: MARGIN_PT,
    y: BOARD_BOTTOM_PT - 20,
    size: 9,
    font: bodyFont,
    color: rgb(0, 0, 0),
  });
  page.drawText(PLACEMENT_FEN, {
    x: MARGIN_PT,
    y: BOARD_BOTTOM_PT - 34,
    size: 9,
    font: bodyFont,
    color: rgb(0, 0, 0),
  });
}

/**
 * @param {string} outputPath
 * @returns {Promise<{ bytes: Uint8Array; sha256: string }>}
 */
export async function generateDiagramPdf(outputPath) {
  const pieceSubpaths = await loadPieceSubpaths();

  // `updateMetadata: false` skips pdf-lib's constructor-time Info-dict stamp (which
  // uses `new Date()`); every field below is then set to a fixed value instead, and
  // `save()` never re-touches the Info dict, so the output is byte-identical run to run.
  const pdfDoc = await PDFDocument.create({ updateMetadata: false });
  pdfDoc.setTitle('Chess Reader Synthetic Fixture');
  pdfDoc.setAuthor('chess-reader test-fixtures');
  pdfDoc.setSubject('Synthetic chess diagram fixture for issue #2');
  pdfDoc.setKeywords(['chess-reader', 'fixture', 'synthetic']);
  pdfDoc.setCreator('packages/test-fixtures/generators/make-diagram-pdf.mjs');
  pdfDoc.setProducer('packages/test-fixtures/generators/make-diagram-pdf.mjs');
  pdfDoc.setCreationDate(FIXED_DATE);
  pdfDoc.setModificationDate(FIXED_DATE);

  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  buildNegativePage(pdfDoc, bodyFont, boldFont);
  buildDiagramPage(pdfDoc, bodyFont, pieceSubpaths);

  const bytes = await pdfDoc.save();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256 };
}

/**
 * @returns {boolean}
 */
function isMainModule() {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  const outputPath = process.argv[2] !== undefined ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const { bytes, sha256 } = await generateDiagramPdf(outputPath);
  console.log(
    JSON.stringify(
      {
        outputPath,
        bytes: bytes.length,
        sha256,
        boardRect: toNormalizedRect(BOARD_RECT_PT),
        placement: PLACEMENT_FEN,
        negativeTextRect: toNormalizedRect(NEGATIVE_TEXT_RECT_PT),
      },
      null,
      2,
    ),
  );
}
