#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PIECE_CODES, SOURCE_FAMILIES } from '../source-lock.mjs';
import { EXPERIMENT_ROOT, REPOSITORY_ROOT, sha256 } from './protocol.mjs';
import { createSvgRenderer } from './svg-renderer.mjs';
import { renderTiles } from './render-board.mjs';
const requireFixtures = createRequire(
  resolve(REPOSITORY_ROOT, 'packages/test-fixtures/package.json'),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- pinned native canvas exports are typed at the import boundary.
const { createCanvas, loadImage } = /** @type {typeof import('@napi-rs/canvas')} */ (
  /** @type {unknown} */ (requireFixtures('@napi-rs/canvas'))
);
const renderer = await createSvgRenderer();
const root = resolve(EXPERIMENT_ROOT, 'runs/visual-review');
await mkdir(root, { recursive: true });
/** @type {Record<string,string>} */
const artifacts = {};
try {
  for (const family of Object.keys(SOURCE_FAMILIES)) {
    /** @type {Map<string, import('@napi-rs/canvas').Image>} */
    const images = new Map();
    for (const code of PIECE_CODES)
      images.set(
        code,
        await loadImage(
          (
            await renderer.render(
              await readFile(
                resolve(EXPERIMENT_ROOT, '../data/source-cache', family, `${code}.svg`),
              ),
            )
          ).png,
        ),
      );
    // Each piece/color appears on both square colors; zeros occupy the final rows.
    const labels = Array.from({ length: 64 }, (_, i) =>
      i < 48 ? 1 + (Math.floor(i / 2) % 12) : 0,
    );
    const sheet = createCanvas(13 * 64, 18 * 80);
    const context = sheet.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, sheet.width, sheet.height);
    let row = 0;
    for (const style of /** @type {const} */ (['flat', 'hatch', 'halftone']))
      for (const reduction of [1, 0.82, 0.64])
        for (const speckle of [false, true]) {
          const result = renderTiles(labels, images, 38177, true, { style, reduction, speckle });
          assert.ok(result.previewPng);
          const preview = await loadImage(result.previewPng);
          const decoded = createCanvas(result.boardPixels, result.boardPixels);
          decoded.getContext('2d').drawImage(preview, 0, 0);
          assert.deepEqual(
            decoded.getContext('2d').getImageData(0, 0, result.boardPixels, result.boardPixels)
              .data,
            result.rgba,
          );
          context.fillStyle = '#000';
          context.font = '12px sans-serif';
          context.fillText(
            `${family}: ${style}, scale ${reduction}, speckle ${speckle}`,
            4,
            row * 80 + 13,
          );
          for (let klass = 0; klass < 13; klass++) {
            const index = klass === 0 ? 48 : (klass - 1) * 2;
            const tile = createCanvas(32, 32);
            const c = tile.getContext('2d');
            const data = c.createImageData(32, 32);
            for (let p = 0; p < 1024; p++) {
              const value = Math.round((result.tiles[index * 1024 + p] ?? 0) * 255);
              data.data[p * 4] = value;
              data.data[p * 4 + 1] = value;
              data.data[p * 4 + 2] = value;
              data.data[p * 4 + 3] = 255;
            }
            c.putImageData(data, 0, 0);
            context.imageSmoothingEnabled = false;
            context.drawImage(tile, klass * 64, row * 80 + 16, 64, 64);
          }
          if (style === 'hatch' && reduction === 0.64 && speckle) {
            const name = `${family}-hatch-low-resolution.png`;
            await writeFile(resolve(root, name), result.previewPng);
            artifacts[`runs/visual-review/${name}`] = sha256(result.previewPng);
          }
          row++;
        }
    const png = sheet.toBuffer('image/png');
    const name = `${family}-all-conditions.png`;
    await writeFile(resolve(root, name), png);
    artifacts[`runs/visual-review/${name}`] = sha256(png);
  }
} finally {
  await renderer.close();
}
await writeFile(
  resolve(root, 'manifest.json'),
  JSON.stringify({ schemaVersion: 1, checks: { previewPixelsExact: true }, artifacts }, null, 2) +
    '\n',
);
console.log(
  'Created all-family, all-class visual evidence for 18 texture/degradation combinations.',
);
