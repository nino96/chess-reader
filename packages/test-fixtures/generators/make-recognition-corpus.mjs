#!/usr/bin/env node
// @ts-check
/** Generate the locked recognition corpus v1 and its visual overview. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { format } from 'prettier';

import {
  CORPUS_ID,
  CORPUS_SEED,
  CORPUS_VERSION,
  PAGE_HEIGHT,
  PAGE_SPECS,
  PAGE_WIDTH,
} from './recognition-corpus-spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..');
const DEFAULT_OUTPUT = resolve(FIXTURES_ROOT, 'corpus', 'v1');
const PIECES_DIR = resolve(FIXTURES_ROOT, 'assets', 'pieces', 'chessnut');
const outputRoot = resolve(process.argv[2] ?? DEFAULT_OUTPUT);

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

const BITMAP_FONT = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '01010'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
});

/** @param {Buffer | Uint8Array} bytes */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** @param {number} seed */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** @param {string} placement */
export function expandPlacement(placement) {
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`Invalid placement: ${placement}`);
  /** @type {(string | null)[]} */
  const squares = [];
  for (const rank of ranks) {
    for (const token of rank) {
      if (/^[1-8]$/.test(token)) squares.push(...Array(Number(token)).fill(null));
      else if (/^[prnbqkPRNBQK]$/.test(token)) squares.push(token);
      else throw new Error(`Invalid placement token ${token}`);
    }
  }
  if (squares.length !== 64)
    throw new Error(`Placement does not expand to 64 squares: ${placement}`);
  return squares;
}

/** @param {readonly (string | null)[]} squares */
function compressPlacement(squares) {
  /** @type {string[]} */
  const ranks = [];
  for (let row = 0; row < 8; row += 1) {
    let rank = '';
    let empty = 0;
    for (const piece of squares.slice(row * 8, row * 8 + 8)) {
      if (piece === null) empty += 1;
      else {
        if (empty > 0) rank += String(empty);
        empty = 0;
        rank += piece;
      }
    }
    if (empty > 0) rank += String(empty);
    ranks.push(rank);
  }
  return ranks.join('/');
}

/** @param {string} placement @param {'white' | 'black' | 'ambiguous'} orientation */
export function renderedPlacement(placement, orientation) {
  const squares = expandPlacement(placement);
  return compressPlacement(orientation === 'black' ? [...squares].reverse() : squares);
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context @param {string} text @param {number} x @param {number} y @param {number} scale @param {string} [color] */
function drawPixelText(context, text, x, y, scale, color = '#24221f') {
  context.fillStyle = color;
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = BITMAP_FONT[char] ?? BITMAP_FONT[' '];
    if (glyph === undefined) continue;
    glyph.forEach((line, row) => {
      for (let column = 0; column < line.length; column += 1) {
        if (line[column] === '1')
          context.fillRect(cursor + column * scale, y + row * scale, scale, scale);
      }
    });
    cursor += 6 * scale;
  }
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context @param {string} text @param {number} x @param {number} y @param {number} maxWidth @param {number} [scale] @returns {number} */
function drawWrappedPixelText(context, text, x, y, maxWidth, scale = 1) {
  const maxCharacters = Math.max(1, Math.floor(maxWidth / (6 * scale)));
  /** @type {string[]} */
  const lines = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > maxCharacters && current.length > 0) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current.length > 0) lines.push(current);
  lines.forEach((line, index) => drawPixelText(context, line, x, y + index * 10 * scale, scale));
  return y + lines.length * 10 * scale;
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context @param {number} seed */
function drawBookText(context, seed) {
  const random = makeRandom(seed);
  context.fillStyle = '#32302c';
  drawPixelText(context, 'CHESS STUDIES', 54, 50, 3);
  drawPixelText(context, `SYNTHETIC PAGE ${String(seed & 0xff)}`, 54, 86, 1, '#55514b');
  drawWrappedPixelText(
    context,
    'THIS ORIGINAL SYNTHETIC PAGE TESTS LOCAL RECOGNITION OF A PRINTED CHESS POSITION. THE DIAGRAM AND EVERY LABEL ARE GENERATED FOR THIS CORPUS.',
    54,
    106,
    PAGE_WIDTH - 108,
  );
  for (const blockY of [155, 740]) {
    for (let line = 0; line < 7; line += 1) {
      const y = blockY + line * 15;
      let x = 54;
      const words = 8 + Math.floor(random() * 6);
      for (let word = 0; word < words && x < PAGE_WIDTH - 68; word += 1) {
        const width = 10 + Math.floor(random() * 42);
        context.fillRect(x, y, Math.min(width, PAGE_WIDTH - 58 - x), 2);
        x += width + 5 + Math.floor(random() * 8);
      }
    }
  }
  context.fillRect(54, 225, PAGE_WIDTH - 108, 1);
  context.fillRect(54, 855, PAGE_WIDTH - 108, 1);
  drawWrappedPixelText(
    context,
    'THE POSITION IS SHOWN FOR GEOMETRY AND CLASSIFICATION TESTS. NO SOURCE BOOK TEXT OR USER DATA IS INCLUDED.',
    54,
    866,
    PAGE_WIDTH - 108,
  );
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context @param {number} x @param {number} y @param {number} size @param {NonNullable<import('./recognition-corpus-spec.mjs').BoardSpec['style']>} style */
function drawDarkSquare(context, x, y, size, style) {
  if (style.kind === 'flat') {
    const channel = Math.round((style.gray ?? 0.64) * 255);
    context.fillStyle = `rgb(${channel}, ${channel}, ${channel})`;
    context.fillRect(x, y, size, size);
    return;
  }
  context.fillStyle = '#f7f5ef';
  context.fillRect(x, y, size, size);
  context.save();
  context.beginPath();
  context.rect(x, y, size, size);
  context.clip();
  context.strokeStyle = '#282724';
  context.fillStyle = '#282724';
  const density = style.density ?? 'medium';
  const gap = density === 'dense' ? 4 : density === 'sparse' ? 10 : 7;
  if (style.kind === 'halftone') {
    const radius = density === 'dense' ? 1.55 : density === 'sparse' ? 1 : 1.3;
    for (let dotY = y + gap / 2; dotY < y + size; dotY += gap) {
      for (let dotX = x + gap / 2; dotX < x + size; dotX += gap) {
        context.beginPath();
        context.arc(dotX, dotY, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else {
    context.lineWidth = density === 'dense' ? 1.4 : 1;
    const angle = style.angle ?? 45;
    if (angle === 0 || angle === 90) {
      for (let offset = gap / 2; offset < size; offset += gap) {
        context.beginPath();
        if (angle === 0) {
          context.moveTo(x, y + offset);
          context.lineTo(x + size, y + offset);
        } else {
          context.moveTo(x + offset, y);
          context.lineTo(x + offset, y + size);
        }
        context.stroke();
      }
    } else {
      for (let offset = -size; offset <= size * 2; offset += gap) {
        context.beginPath();
        if (angle === 45) {
          context.moveTo(x + offset, y + size);
          context.lineTo(x + offset + size, y);
        } else {
          context.moveTo(x + offset, y);
          context.lineTo(x + offset + size, y + size);
        }
        context.stroke();
      }
    }
  }
  context.restore();
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context @param {import('./recognition-corpus-spec.mjs').BoardSpec} board @param {ReadonlyMap<string, import('@napi-rs/canvas').Image>} pieces */
function drawBoard(context, board, pieces) {
  const square = board.size / 8;
  const displayed = expandPlacement(renderedPlacement(board.placement, board.orientation));
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const x = board.x + column * square;
      const y = board.y + row * square;
      const canonicalFile = board.orientation === 'black' ? 7 - column : column;
      const canonicalRankIndex = board.orientation === 'black' ? 7 - row : row;
      const dark = (canonicalFile + canonicalRankIndex) % 2 === 1;
      if (dark) drawDarkSquare(context, x, y, square, board.style);
      else {
        context.fillStyle = '#fbfaf6';
        context.fillRect(x, y, square, square);
      }
      const token = displayed[row * 8 + column];
      if (token !== null && token !== undefined) {
        const code = `${token === token.toUpperCase() ? 'w' : 'b'}${token.toUpperCase()}`;
        const image = pieces.get(code);
        if (image === undefined) throw new Error(`Missing piece image ${code}`);
        const inset = square * 0.06;
        context.drawImage(image, x + inset, y + inset, square - inset * 2, square - inset * 2);
      }
    }
  }
  if (board.borderWidth > 0) {
    context.strokeStyle = '#181715';
    context.lineWidth = board.borderWidth;
    context.strokeRect(board.x, board.y, board.size, board.size);
  }
  if (board.labels) {
    const files = board.orientation === 'black' ? 'HGFEDCBA' : 'ABCDEFGH';
    const ranks = board.orientation === 'black' ? '12345678' : '87654321';
    for (let index = 0; index < 8; index += 1) {
      drawPixelText(
        context,
        files[index] ?? '',
        board.x + index * square + square / 2 - 3,
        board.y + board.size + 6,
        1,
      );
      drawPixelText(
        context,
        ranks[index] ?? '',
        board.x - 10,
        board.y + index * square + square / 2 - 3,
        1,
      );
    }
  }
}

/** @param {import('@napi-rs/canvas').Canvas} canvas @param {NonNullable<import('./recognition-corpus-spec.mjs').PageSpec['degradation']>} degradation @param {number} seed */
function degrade(canvas, degradation, seed) {
  const context = canvas.getContext('2d');
  if (degradation.lowResolution !== undefined) {
    const lowWidth = degradation.lowResolution;
    const lowHeight = Math.round((PAGE_HEIGHT / PAGE_WIDTH) * lowWidth);
    const low = createCanvas(lowWidth, lowHeight);
    const lowContext = low.getContext('2d');
    lowContext.imageSmoothingEnabled = true;
    lowContext.drawImage(canvas, 0, 0, lowWidth, lowHeight);
    context.imageSmoothingEnabled = true;
    context.drawImage(low, 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  }
  const image = context.getImageData(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  const data = image.data;
  const contrast = degradation.contrast ?? 1;
  const random = makeRandom(seed);
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[index + channel];
      if (value !== undefined) data[index + channel] = Math.round(238 + (value - 238) * contrast);
    }
    if (random() < (degradation.speckle ?? 0)) {
      const ink = random() < 0.82 ? Math.floor(35 + random() * 80) : 245;
      data[index] = ink;
      data[index + 1] = ink;
      data[index + 2] = ink;
    }
  }
  context.putImageData(image, 0, 0);
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context */
function drawTextNegative(context) {
  drawPixelText(context, 'CHAPTER 8 - MINORITY ATTACK', 54, 50, 3);
  const paragraphs = [
    'THIS PAGE CONTAINS ORIGINAL SYNTHETIC PROSE AND NO CHESSBOARD. IT TESTS WHETHER REGULAR LINES OF PRINT ARE MISTAKEN FOR A DIAGRAM.',
    'WHITE MAY PLAN A QUEEN SIDE ADVANCE WHILE BLACK SEEKS COUNTERPLAY IN THE CENTER. THE SENTENCE DESCRIBES NO POSITION AND CARRIES NO GROUND TRUTH.',
    'A READER SHOULD KEEP THE PAGE AVAILABLE WHILE LOCAL ANALYSIS RUNS. NO TEXT IMAGE POSITION OR FILE NAME LEAVES THE DEVICE.',
    'SHORT LINES LONG LINES HEADINGS AND PARAGRAPH GAPS CREATE A BOOK LIKE RHYTHM WITHOUT COPYING PUBLISHED MATERIAL.',
    'THE EVALUATION EXPECTS ZERO COMPLETE BOARDS ON THIS PAGE. A CONFIDENT FALSE POSITIVE IS RECORDED AS A FAILURE.',
    'THE CORPUS IS LOCKED BEFORE CANDIDATE TUNING. FUTURE REPRESENTATIVENESS CHANGES REQUIRE A NEW VERSION AND EXPLICIT REVIEW.',
  ];
  for (let column = 0; column < 2; column += 1) {
    let y = 125;
    for (let repeat = 0; repeat < 3; repeat += 1) {
      for (const paragraph of paragraphs) {
        y = drawWrappedPixelText(context, paragraph, 54 + column * 350, y, 310);
        y += 14;
        if (y > 900) break;
      }
      if (y > 900) break;
    }
  }
  drawPixelText(context, 'NO DIAGRAM ON THIS PAGE', 215, 930, 2, '#55514b');
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context */
function drawGridNegative(context) {
  drawPixelText(context, 'TOURNAMENT CROSSTABLE', 96, 54, 3);
  const left = 74;
  const top = 170;
  const width = 620;
  const height = 560;
  context.strokeStyle = '#302e2a';
  context.lineWidth = 2;
  for (let column = 0; column <= 10; column += 1) {
    const x = left + (width / 10) * column;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + height);
    context.stroke();
  }
  for (let row = 0; row <= 14; row += 1) {
    const y = top + (height / 14) * row;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(left + width, y);
    context.stroke();
  }
  for (let row = 0; row < 14; row += 1) {
    drawPixelText(context, String(row + 1), 82, top + row * 40 + 15, 1);
    for (let column = 1; column < 10; column += 1) {
      drawPixelText(
        context,
        (row + column) % 3 === 0 ? '1' : '0',
        left + column * 62 + 28,
        top + row * 40 + 15,
        1,
      );
    }
  }
}

/** @param {import('./recognition-corpus-spec.mjs').PageSpec} spec @param {ReadonlyMap<string, import('@napi-rs/canvas').Image>} pieces @param {number} index */
function renderPage(spec, pieces, index) {
  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext('2d');
  const layoutSeedOffset = spec.sourceLayoutSeedOffset ?? index;
  context.fillStyle =
    layoutSeedOffset % 3 === 0 ? '#f2efe7' : layoutSeedOffset % 3 === 1 ? '#f7f4ec' : '#ebe8df';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  if (spec.layout === 'text-negative') drawTextNegative(context);
  else if (spec.layout === 'grid-negative') drawGridNegative(context);
  else {
    drawBookText(context, CORPUS_SEED + layoutSeedOffset);
    for (const board of spec.boards) drawBoard(context, board, pieces);
    if (spec.layout === 'partial')
      drawPixelText(context, 'PARTIAL DIAGRAM - NOT COMPLETE TRUTH', 348, 470, 2);
  }
  if (spec.degradation !== undefined)
    degrade(canvas, spec.degradation, CORPUS_SEED + (spec.degradation.seedOffset ?? index));
  return canvas;
}

/** @param {import('./recognition-corpus-spec.mjs').PageSpec} spec */
function annotationsFor(spec) {
  return spec.boards.map((board) => {
    const partial = spec.layout === 'partial';
    const visibleX = Math.max(0, board.x);
    const visibleY = Math.max(0, board.y);
    const visibleRight = Math.min(PAGE_WIDTH, board.x + board.size);
    const visibleBottom = Math.min(PAGE_HEIGHT, board.y + board.size);
    return {
      id: board.id,
      kind: partial ? 'partial' : 'complete',
      pixelRect: {
        x: partial ? visibleX : board.x,
        y: partial ? visibleY : board.y,
        width: partial ? visibleRight - visibleX : board.size,
        height: partial ? visibleBottom - visibleY : board.size,
      },
      canonicalPlacement: partial ? null : board.placement,
      renderedPlacement: partial ? null : renderedPlacement(board.placement, board.orientation),
      orientation: partial ? 'ambiguous' : board.orientation,
      pieceStyle: 'chessnut',
      squareStyle: board.style,
      hasCoordinateLabels: board.labels,
      borderWidthPx: board.borderWidth,
    };
  });
}

/** @param {readonly {spec: import('./recognition-corpus-spec.mjs').PageSpec, canvas: import('@napi-rs/canvas').Canvas}[]} rendered */
function renderContactSheet(rendered) {
  const sheet = createCanvas(768, 1024);
  const context = sheet.getContext('2d');
  context.fillStyle = '#dedad0';
  context.fillRect(0, 0, 768, 1024);
  drawPixelText(context, 'PRINTED BOOK CORPUS V1', 24, 10, 2);
  rendered.forEach(({ spec, canvas }, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 24 + column * 186;
    const y = 42 + row * 242;
    context.fillStyle = '#ffffff';
    context.fillRect(x - 2, y - 2, 148, 196);
    context.drawImage(canvas, x, y, 144, 192);
    drawPixelText(context, `${String(index + 1)} ${spec.id.slice(0, 20)}`, x, y + 198, 1);
  });
  return sheet;
}

/** @param {readonly import('./recognition-corpus-spec.mjs').PageSpec[]} specs */
function overviewMarkdown(specs) {
  const rows = specs.map((spec) => {
    const styles =
      spec.boards
        .map((board) =>
          board.style.kind === 'hatch'
            ? `hatch ${String(board.style.angle)} ${board.style.density ?? ''}`
            : `${board.style.kind} ${board.style.density ?? ''}`,
        )
        .join('; ') || 'none';
    const orientations =
      spec.boards
        .map((board) => (spec.layout === 'partial' ? 'partial/unknown' : board.orientation))
        .join(', ') || 'N/A';
    const boardCount =
      spec.layout === 'partial'
        ? `0 + ${String(spec.boards.length)} partial`
        : String(spec.boards.length);
    return `| ${spec.id} | ${boardCount} | ${styles} | ${orientations} | ${spec.tags.join(', ')} |`;
  });
  const completeBoards = specs.flatMap((spec) =>
    spec.layout === 'partial' ? [] : spec.boards,
  ).length;
  const partialBoards = specs.filter((spec) => spec.layout === 'partial').length;
  return `# Printed-book recognition corpus v1\n\nStatus: locked before model inference or candidate tuning for issue #34.\n\n![Contact sheet](contact-sheet.png)\n\nAll ${String(specs.length)} pages are deterministic synthetic 768 x 1024 PNGs. Board rectangles use top-left image pixel coordinates. Complete annotations contain both canonical FEN placement and the placement in rendered image order; partial-board annotations deliberately omit placement truth. The corpus is CC0-1.0 except for rendered Chessnut glyphs, which remain Apache-2.0.\n\n| Page | Complete + partial boards | Square treatment | Orientation | Coverage tags |\n| --- | ---: | --- | --- | --- |\n${rows.join('\n')}\n\n## Coverage and exclusions\n\nThe matrix has ${String(completeBoards)} complete boards across opening, middlegame, endgame, and pawnless positions, plus ${String(partialBoards)} partial challenge regions. It covers flat grayscale, hatch angles 0/45/90/135 at sparse/medium/dense spacing, halftone, boards with and without borders or coordinate labels, both decided orientations, an intentionally ambiguous pawnless piece-only orientation, scan-like low-resolution/contrast/speckle degradation, two multi-board pages, text and table-grid negatives, and partial boards missing files or bottom ranks. The flat and 45-degree hatch Italian-position pages use identical placement and geometry so texture has a controlled comparison.\n\nOnly the locally vetted Chessnut piece set is used. A second piece family was excluded from v1 because the repository had no other complete style with a pinned upstream revision, complete license text, author attribution, and per-file hashes. Fetching an unreviewed set solely to increase style count would weaken the fixture provenance contract. Issue #35 may propose a separately reviewed v2 rather than changing this locked corpus. The pages are synthetic approximations, not photographs, handwritten diagrams, colored pages, warped book gutters, or owner book samples. These representativeness limits remain tracked by #24 and candidate comparison by #35.\n\n## Matching and tolerances\n\nFull-page predictions match complete annotations one-to-one by descending intersection-over-union (IoU), with prediction index then annotation index as deterministic tie-breakers. IoU >= 0.9 is a localization match. Grid-edge error at or below 0.08 squares is reported separately as an alignment diagnostic. Rectangle fixture checks allow one pixel for serialization/render bookkeeping. Missed and duplicate boards remain failures. Partial annotations are exclusion/challenge regions and never complete-board truth. Oracle/exact-bound input isolates classification and never counts as successful detection.\n\n## Provenance\n\n- Page layout, text-like marks, patterns, degradation, and positions: generated in this repository by \`generators/make-recognition-corpus.mjs\` from \`generators/recognition-corpus-spec.mjs\`, seed \`${String(CORPUS_SEED)}\`, CC0-1.0.\n- Piece glyphs: Chessnut by Alexis Luengas, Apache-2.0, commit \`2b8eaf14a31edad7e9deb53b1473e1d4857868a9\`; see \`../../../assets/pieces/chessnut/PROVENANCE.md\`.\n- No book page, user data, model output, or inferred label appears in this corpus.\n`;
}

async function main() {
  await mkdir(resolve(outputRoot, 'pages'), { recursive: true });
  /** @type {Map<string, import('@napi-rs/canvas').Image>} */
  const pieces = new Map();
  for (const code of PIECE_CODES)
    pieces.set(code, await loadImage(resolve(PIECES_DIR, `${code}.svg`)));

  const rendered = PAGE_SPECS.map((spec, index) => ({
    spec,
    canvas: renderPage(spec, pieces, index),
  }));
  /** @type {Array<Record<string, unknown>>} */
  const pages = [];
  for (const { spec, canvas } of rendered) {
    const bytes = canvas.toBuffer('image/png');
    const relativePath = `corpus/v1/pages/${spec.id}.png`;
    await writeFile(resolve(outputRoot, 'pages', `${spec.id}.png`), bytes);
    pages.push({
      id: spec.id,
      path: relativePath,
      sha256: sha256(bytes),
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      tags: spec.tags,
      generator: {
        spec: 'generators/recognition-corpus-spec.mjs',
        seed: CORPUS_SEED + (spec.sourceLayoutSeedOffset ?? PAGE_SPECS.indexOf(spec)),
        degradation: spec.degradation ?? null,
      },
      annotations: annotationsFor(spec),
    });
  }
  const contactSheet = renderContactSheet(rendered).toBuffer('image/png');
  await writeFile(resolve(outputRoot, 'contact-sheet.png'), contactSheet);
  const manifest = {
    schemaVersion: 1,
    corpusId: CORPUS_ID,
    corpusVersion: CORPUS_VERSION,
    lockedBeforeTuning: true,
    coordinateSystem: 'top-left-image-pixels',
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    matching: {
      rule: 'one-to-one-descending-iou',
      iouThreshold: 0.9,
      tieBreakers: ['prediction-index', 'annotation-index'],
      duplicatePredictions: 'failure',
      partialAnnotations: 'excluded-from-complete-truth',
    },
    tolerance: { rectanglePixels: 1, gridErrorSquares: 0.08 },
    generation: {
      generator: 'generators/make-recognition-corpus.mjs',
      spec: 'generators/recognition-corpus-spec.mjs',
      seed: CORPUS_SEED,
      renderer: '@napi-rs/canvas@1.0.8',
      pieceStyles: [
        {
          id: 'chessnut',
          license: 'Apache-2.0',
          provenance: 'assets/pieces/chessnut/PROVENANCE.md',
        },
      ],
      exclusions: [
        'A second piece style was excluded because no other complete, provenance-verified set was locally available.',
      ],
    },
    contactSheet: {
      path: 'corpus/v1/contact-sheet.png',
      sha256: sha256(contactSheet),
      width: 768,
      height: 1024,
    },
    pages,
  };
  /** @type {import('prettier').Options} */
  const prettierOptions = {
    printWidth: 100,
    singleQuote: true,
    semi: true,
    trailingComma: 'all',
    proseWrap: 'preserve',
  };
  const manifestBytes = Buffer.from(
    await format(JSON.stringify(manifest), { ...prettierOptions, parser: 'json' }),
  );
  await writeFile(resolve(outputRoot, 'manifest.json'), manifestBytes);
  const overview = await format(overviewMarkdown(PAGE_SPECS), {
    ...prettierOptions,
    parser: 'markdown',
  });
  await writeFile(resolve(outputRoot, 'OVERVIEW.md'), overview);
  const overviewBytes = await readFile(resolve(outputRoot, 'OVERVIEW.md'));
  process.stdout.write(
    `${JSON.stringify({ outputRoot, manifestSha256: sha256(manifestBytes), contactSheetSha256: sha256(contactSheet), overviewSha256: sha256(overviewBytes), pages: pages.map((page) => ({ id: page['id'], path: page['path'], sha256: page['sha256'] })) }, null, 2)}\n`,
  );
}

await main();
