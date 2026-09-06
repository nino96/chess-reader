#!/usr/bin/env node
// @ts-check
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PIECE_CODES } from './sources.mjs';
import { ROOT, canvas, loadRasterFamilies, readLock, sha256 } from './data-common.mjs';
const started = performance.now(),
  out = resolve(ROOT, 'data/preflight');
await mkdir(out, { recursive: true });
const lock = await readLock(),
  families = await loadRasterFamilies(lock),
  /** @type {Record<string, string>} */
  artifacts = {},
  /** @type {Array<{family:string,code:string,pixels:Uint8Array}>} */
  signatures = [];
for (const [family, images] of families) {
  const sheet = canvas.createCanvas(12 * 88, 98),
    c = sheet.getContext('2d');
  c.fillStyle = '#eee9df';
  c.fillRect(0, 0, sheet.width, sheet.height);
  c.font = '12px sans-serif';
  c.textAlign = 'center';
  for (const [i, code] of PIECE_CODES.entries()) {
    const image = images.get(code);
    if (!image) throw new Error(`Missing ${family}/${code}`);
    c.fillStyle = i % 2 ? '#b8b1a4' : '#fff';
    c.fillRect(i * 88 + 8, 0, 72, 72);
    c.drawImage(image, i * 88 + 8, 0);
    c.fillStyle = '#111';
    c.fillText(code, i * 88 + 44, 88);
    const sample = canvas.createCanvas(72, 72),
      sc = sample.getContext('2d');
    sc.drawImage(image, 0, 0);
    const p = sc.getImageData(0, 0, 72, 72).data;
    signatures.push({ family, code, pixels: Uint8Array.from(p) });
  }
  const bytes = sheet.toBuffer('image/png'),
    name = `${family}.png`;
  await writeFile(resolve(out, name), bytes);
  artifacts[name] = sha256(bytes);
}
const similarities = [];
for (let a = 0; a < signatures.length; a++)
  for (let b = a + 1; b < signatures.length; b++) {
    const x = signatures[a],
      y = signatures[b];
    if (!x || !y) throw new Error('Missing raster signature');
    if (x.code !== y.code || x.family === y.family) continue;
    let alpha = 0,
      luma = 0;
    for (let i = 0; i < x.pixels.length; i += 4) {
      alpha += Math.abs((x.pixels[i + 3] ?? 0) - (y.pixels[i + 3] ?? 0));
      luma += Math.abs((x.pixels[i] ?? 0) - (y.pixels[i] ?? 0));
    }
    const alphaMae = alpha / (72 * 72 * 255),
      lumaMae = luma / (72 * 72 * 255);
    if (alphaMae < 0.04)
      similarities.push({
        left: `${x.family}/${x.code}`,
        right: `${y.family}/${y.code}`,
        alphaMae,
        lumaMae,
        flag: 'visual review required; similarity does not prove common lineage',
      });
  }
const elapsed = (performance.now() - started) / 1000;
const report = {
  schemaVersion: 1,
  status: 'preflight-only',
  sourceLockSha256: sha256(
    await (await import('node:fs/promises')).readFile(resolve(ROOT, 'source-lock.json')),
  ),
  familyCount: families.size,
  pieceCount: families.size * 12,
  checks: { allPiecesRendered: true, noModelInference: true, corpusV1Excluded: true },
  similarityFlags: similarities,
  artifacts,
  elapsedSeconds: elapsed,
  ceilingSeconds: 600,
};
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
if (elapsed > 600) throw new Error('600-second source preflight/generation ceiling exceeded');
console.log(
  JSON.stringify({
    elapsedSeconds: elapsed,
    families: families.size,
    similarityFlags: similarities.length,
  }),
);
