// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pieceCode, renderTiles } from '../scripts/render-board.mjs';
import { REPOSITORY_ROOT, sha256 } from '../scripts/protocol.mjs';
import { PIECE_CODES } from '../source-lock.mjs';
const requireFixtures = createRequire(
  resolve(REPOSITORY_ROOT, 'packages/test-fixtures/package.json'),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- pinned native canvas exports are typed at the import boundary.
const canvas = /** @type {typeof import('@napi-rs/canvas')} */ (
  /** @type {unknown} */ (requireFixtures('@napi-rs/canvas'))
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- exact pinned preprocessing exports are typed at the boundary.
const tiles = /** @type {Pick<typeof import('@scoriiu/fenshot'), 'extractTiles'|'rgbaToGray'>} */ (
  await import(
    pathToFileURL(
      resolve(
        REPOSITORY_ROOT,
        'packages/test-fixtures/node_modules/@scoriiu/fenshot/dist/tiles.js',
      ),
    ).href
  )
);

void test('all thirteen class indexes map to the exact intended color and piece', () => {
  assert.deepEqual(
    Array.from({ length: 13 }, (_, i) => pieceCode(i)),
    [null, ...PIECE_CODES],
  );
  assert.throws(() => pieceCode(13), /class/i);
});
void test('upstream preprocessing maps an independently coded pixel grid to A1 through H8', () => {
  const rgba = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const code = (7 - Math.floor(y / 32)) * 8 + Math.floor(x / 32);
      const i = (y * 256 + x) * 4;
      rgba[i] = code * 4;
      rgba[i + 1] = code * 4;
      rgba[i + 2] = code * 4;
      rgba[i + 3] = 255;
    }
  const result = tiles.extractTiles(tiles.rgbaToGray(rgba, 256, 256), {
    x0: 0,
    y0: 0,
    x1: 256,
    y1: 256,
  });
  for (let square = 0; square < 64; square++)
    for (let pixel = 0; pixel < 1024; pixel++)
      assert.ok(Math.abs((result[square * 1024 + pixel] ?? -1) - (square * 4) / 255) < 1e-7);
});
void test('rendered labels select their own glyph in every square; previews include all degradation pixels', async () => {
  /** @type {Map<string, import('@napi-rs/canvas').Image>} */
  const pieces = new Map();
  for (let i = 0; i < PIECE_CODES.length; i++) {
    const surface = canvas.createCanvas(72, 72);
    const c = surface.getContext('2d');
    const gray = 15 + i * 18;
    c.fillStyle = `rgb(${gray},${gray},${gray})`;
    c.fillRect(0, 0, 72, 72);
    pieces.set(PIECE_CODES[i] ?? '', await canvas.loadImage(surface.toBuffer('image/png')));
  }
  const labels = Array.from({ length: 64 }, (_, i) => 1 + (i % 12));
  for (const style of /** @type {const} */ (['flat', 'hatch', 'halftone']))
    for (const reduction of [1, 0.82, 0.64])
      for (const speckle of [false, true]) {
        const result = renderTiles(labels, pieces, 88112, true, { style, reduction, speckle });
        assert.ok(result.previewPng);
        const image = await canvas.loadImage(result.previewPng);
        const decoded = canvas.createCanvas(result.boardPixels, result.boardPixels);
        decoded.getContext('2d').drawImage(image, 0, 0);
        const rgba = decoded
          .getContext('2d')
          .getImageData(0, 0, result.boardPixels, result.boardPixels).data;
        assert.deepEqual(rgba, result.rgba);
        assert.deepEqual(
          tiles.extractTiles(tiles.rgbaToGray(rgba, result.boardPixels, result.boardPixels), {
            x0: 0,
            y0: 0,
            x1: result.boardPixels,
            y1: result.boardPixels,
          }),
          result.tiles,
        );
        for (let square = 0; square < 64; square++) {
          const expected = (15 + (square % 12) * 18) / 255;
          const center = [];
          for (let y = 13; y < 19; y++)
            for (let x = 13; x < 19; x++)
              center.push(result.tiles[square * 1024 + y * 32 + x] ?? -1);
          center.sort((a, b) => a - b);
          // The declared glyph alpha blends up to 10% background; interior median tolerates speckles.
          assert.ok(
            Math.abs((center[18] ?? -1) - expected) < 0.11,
            `Square ${square}: ${style}/${reduction}/${speckle}`,
          );
        }
        const repeat = renderTiles(labels, pieces, 88112, true, { style, reduction, speckle });
        assert.equal(
          sha256(Buffer.from(result.tiles.buffer)),
          sha256(Buffer.from(repeat.tiles.buffer)),
        );
        assert.equal(result.degradation.speckles > 0, speckle);
      }
});
