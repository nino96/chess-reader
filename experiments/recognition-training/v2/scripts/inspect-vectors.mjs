#!/usr/bin/env node
// @ts-check
import { createRequire } from 'node:module';
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EXPERIMENT_ROOT, REPOSITORY_ROOT, sha256 } from './protocol.mjs';
const requireFixtures = createRequire(
  resolve(REPOSITORY_ROOT, 'packages/test-fixtures/package.json'),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- exact pinned canvas exports are cast at this boundary.
const canvas = /** @type {typeof import('@napi-rs/canvas')} */ (
  /** @type {unknown} */ (requireFixtures('@napi-rs/canvas'))
);
/** @type {Record<string,string>} */
const artifacts = {};
for (const role of ['train', 'dev', 'test']) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- locally generated labels are verified by the required quality audit.
  const input =
    /** @type {{boards:{id:string;family:string;labels:number[];render:{style:string;reduction:number;speckles:number}}[]}} */ (
      JSON.parse(await readFile(resolve(EXPERIMENT_ROOT, `data/full/${role}.labels.json`), 'utf8'))
    );
  const file = await open(resolve(EXPERIMENT_ROOT, `data/full/${role}.vectors.f32le`), 'r');
  const chosen = new Set();
  let number = 0;
  try {
    for (let index = 0; index < input.boards.length; index++) {
      const board = input.boards[index];
      if (board === undefined) throw new Error('Missing board');
      const key = `${board.family}/${board.render.style}`;
      if (chosen.has(key)) continue;
      chosen.add(key);
      const bytes = Buffer.alloc(64 * 1024 * 4);
      const read = await file.read(bytes, 0, bytes.length, index * bytes.length);
      if (read.bytesRead !== bytes.length) throw new Error('Truncated tensor');
      const surface = canvas.createCanvas(512, 544);
      const context = surface.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 512, 544);
      context.fillStyle = '#000';
      context.font = '12px sans-serif';
      context.fillText(
        `${role} ${key} scale ${board.render.reduction} speckles ${board.render.speckles}`,
        5,
        15,
      );
      for (let square = 0; square < 64; square++) {
        const tile = canvas.createCanvas(32, 32);
        const c = tile.getContext('2d');
        const pixels = c.createImageData(32, 32);
        for (let p = 0; p < 1024; p++) {
          const v = Math.round(bytes.readFloatLE((square * 1024 + p) * 4) * 255);
          pixels.data[p * 4] = v;
          pixels.data[p * 4 + 1] = v;
          pixels.data[p * 4 + 2] = v;
          pixels.data[p * 4 + 3] = 255;
        }
        c.putImageData(pixels, 0, 0);
        const x = (square % 8) * 64;
        const y = (7 - Math.floor(square / 8)) * 64 + 32;
        context.imageSmoothingEnabled = false;
        context.drawImage(tile, x, y, 64, 64);
        context.fillStyle = '#c00';
        context.font = '11px sans-serif';
        context.fillText('1KQRBNPkqrbnp'[board.labels[square] ?? 0] ?? '?', x + 2, y + 12);
      }
      const png = surface.toBuffer('image/png');
      const path = `runs/visual-review/actual-${role}-${number++}.png`;
      await writeFile(resolve(EXPERIMENT_ROOT, path), png);
      artifacts[path] = sha256(png);
    }
  } finally {
    await file.close();
  }
}
await writeFile(
  resolve(EXPERIMENT_ROOT, 'runs/visual-review/actual-manifest.json'),
  JSON.stringify({ schemaVersion: 1, artifacts }, null, 2) + '\n',
);
console.log(
  `Created ${Object.keys(artifacts).length} actual tensor board sheets with class annotations.`,
);
