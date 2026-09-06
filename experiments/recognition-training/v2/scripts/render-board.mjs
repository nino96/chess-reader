// @ts-check
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- pinned fixture dependencies are cast at the import boundary. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLASS_ORDER } from '../source-lock.mjs';
import { integer, makeRandom } from './recipe.mjs';
import { REPOSITORY_ROOT } from './protocol.mjs';
const requireFromFixtures = createRequire(
  resolve(REPOSITORY_ROOT, 'packages/test-fixtures/package.json'),
);
const { createCanvas } = /** @type {typeof import('@napi-rs/canvas')} */ (
  requireFromFixtures('@napi-rs/canvas')
);
const fenshotModule = await import(
  pathToFileURL(
    resolve(REPOSITORY_ROOT, 'packages/test-fixtures/node_modules/@scoriiu/fenshot/dist/tiles.js'),
  ).href
);
const { extractTiles, rgbaToGray } =
  /** @type {Pick<typeof import('@scoriiu/fenshot'), 'extractTiles' | 'rgbaToGray'>} */ (
    fenshotModule
  );
/** @param {number} classIndex */
export function pieceCode(classIndex) {
  const piece = CLASS_ORDER[classIndex];
  if (!Number.isInteger(classIndex) || piece === undefined) throw new Error('Invalid class index');
  if (piece === '1') return null;
  return `${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}`;
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} context @param {number} x @param {number} y @param {number} size @param {'flat' | 'hatch' | 'halftone'} style @param {() => number} random */
function drawDarkSquare(context, x, y, size, style, random) {
  if (style === 'flat') {
    const channel = integer(82, 190, random);
    context.fillStyle = `rgb(${channel}, ${channel}, ${channel})`;
    context.fillRect(x, y, size, size);
    return;
  }
  context.fillStyle = style === 'hatch' ? '#eeeae1' : '#ede9df';
  context.fillRect(x, y, size, size);
  context.save();
  context.beginPath();
  context.rect(x, y, size, size);
  context.clip();
  context.strokeStyle = '#34322e';
  context.fillStyle = '#34322e';
  if (style === 'hatch') {
    const gap = integer(4, 10, random);
    context.lineWidth = random() > 0.5 ? 1 : 1.5;
    const reverse = random() > 0.5;
    for (let offset = -size; offset < size * 2; offset += gap) {
      context.beginPath();
      if (reverse) {
        context.moveTo(x + offset, y);
        context.lineTo(x + offset + size, y + size);
      } else {
        context.moveTo(x + offset, y + size);
        context.lineTo(x + offset + size, y);
      }
      context.stroke();
    }
  } else {
    const gap = integer(5, 10, random);
    for (let dotY = y + gap / 2; dotY < y + size; dotY += gap) {
      for (let dotX = x + gap / 2; dotX < x + size; dotX += gap) {
        context.beginPath();
        context.arc(dotX, dotY, random() > 0.5 ? 1 : 1.3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  context.restore();
}

/** @param {() => number} random */
function styleForBoard(random) {
  const styles = /** @type {const} */ (['flat', 'hatch', 'halftone']);
  const style = styles[integer(0, styles.length - 1, random)];
  if (style === undefined) throw new Error('Style selection failed');
  return style;
}

/** @param {readonly number[]} labels @param {Map<string, import('@napi-rs/canvas').Image>} pieces @param {number} seed @param {boolean} includePreview @param {{style?: 'flat'|'hatch'|'halftone', reduction?: number, speckle?: boolean}} [forced] */
export function renderTiles(labels, pieces, seed, includePreview, forced = {}) {
  const random = makeRandom(seed);
  const boardPixels = integer(280, 504, random);
  const canvas = createCanvas(boardPixels, boardPixels);
  const context = canvas.getContext('2d');
  const square = boardPixels / 8;
  const drawnStyle = styleForBoard(random);
  const style = forced.style ?? drawnStyle;
  context.fillStyle = '#f9f7f1';
  context.fillRect(0, 0, boardPixels, boardPixels);
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const x = file * square;
      const y = (7 - rank) * square;
      if ((file + rank) % 2 === 0) drawDarkSquare(context, x, y, square, style, random);
      const label = labels[rank * 8 + file];
      if (label === undefined) throw new Error('Expected 64 labels');
      const code = pieceCode(label);
      if (code !== null) {
        const image = pieces.get(code);
        if (image === undefined) throw new Error(`Missing source glyph ${code}`);
        const inset = square * (0.035 + random() * 0.05);
        if (code.startsWith('w')) {
          // Several licensed print sets use a white silhouette. A fixed dark
          // contour preserves that ink-on-paper distinction after grayscale
          // conversion without changing the locked SVG source asset.
          const glyphPixels = Math.ceil(square - inset * 2);
          const mask = createCanvas(glyphPixels, glyphPixels);
          const maskContext = mask.getContext('2d');
          maskContext.drawImage(image, 0, 0, glyphPixels, glyphPixels);
          maskContext.globalCompositeOperation = 'source-in';
          maskContext.fillStyle = '#2b2926';
          maskContext.fillRect(0, 0, glyphPixels, glyphPixels);
          const outline = 0.75;
          for (const [offsetX = 0, offsetY = 0] of [
            [-outline, 0],
            [outline, 0],
            [0, -outline],
            [0, outline],
          ]) {
            context.drawImage(mask, x + inset + offsetX, y + inset + offsetY);
          }
        }
        context.globalAlpha = 0.9 + random() * 0.1;
        context.drawImage(image, x + inset, y + inset, square - inset * 2, square - inset * 2);
        context.globalAlpha = 1;
      }
    }
  }
  if (random() > 0.35) {
    context.strokeStyle = '#292724';
    context.lineWidth = random() > 0.5 ? 1 : 2;
    context.strokeRect(0, 0, boardPixels, boardPixels);
  }
  const drawnReduction = [1, 0.82, 0.64][integer(0, 2, random)];
  const reduction = forced.reduction ?? drawnReduction;
  if (reduction === undefined) throw new Error('Degradation selection failed');
  const degraded = createCanvas(boardPixels, boardPixels);
  const degradedContext = degraded.getContext('2d');
  if (reduction < 1) {
    const reducedPixels = Math.max(64, Math.round(boardPixels * reduction));
    const reduced = createCanvas(reducedPixels, reducedPixels);
    reduced.getContext('2d').drawImage(canvas, 0, 0, reducedPixels, reducedPixels);
    degradedContext.drawImage(reduced, 0, 0, boardPixels, boardPixels);
  } else degradedContext.drawImage(canvas, 0, 0);
  const imageData = degradedContext.getImageData(0, 0, boardPixels, boardPixels);
  const drawnSpeckle = random() >= 0.5;
  const speckles = Math.floor(
    boardPixels * boardPixels * ((forced.speckle ?? drawnSpeckle) ? 0.0015 : 0),
  );
  for (let index = 0; index < speckles; index += 1) {
    const offset = integer(0, boardPixels * boardPixels - 1, random) * 4;
    const value = random() < 0.5 ? 0 : 255;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
  }
  degradedContext.putImageData(imageData, 0, 0);
  return {
    rgba: imageData.data,
    boardPixels,
    tiles: extractTiles(rgbaToGray(imageData.data, boardPixels, boardPixels), {
      x0: 0,
      y0: 0,
      x1: boardPixels,
      y1: boardPixels,
    }),
    style,
    degradation: { reduction, speckles },
    previewPng: includePreview ? degraded.toBuffer('image/png') : undefined,
  };
}
