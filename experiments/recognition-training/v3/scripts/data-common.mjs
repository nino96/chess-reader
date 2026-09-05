// @ts-check
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSvgRenderer } from '../../v2/scripts/svg-renderer.mjs';
import { FAMILIES, PIECE_CODES } from './sources.mjs';

export const ROOT = resolve(import.meta.dirname, '..');
export const CACHE = resolve(ROOT, 'cache/sources');
const requireFixtures = createRequire(
  resolve(ROOT, '../../../packages/test-fixtures/package.json'),
);
const requireUnknown = /** @type {(id:string) => unknown} */ (requireFixtures);
const canvasModule = requireUnknown('@napi-rs/canvas');
if (!isObject(canvasModule)) throw new Error('Canvas module unavailable');
export const canvas = /** @type {typeof import('@napi-rs/canvas')} */ (canvasModule);
/** @param {string | NodeJS.ArrayBufferView} value */
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function readLock() {
  /** @type {unknown} */
  const value = JSON.parse(await readFile(resolve(ROOT, 'source-lock.json'), 'utf8'));
  if (!isObject(value) || !isObject(value['families'])) throw new Error('Invalid source lock');
  for (const source of Object.values(value['families']))
    if (!isObject(source) || !isStringRecord(source['files']))
      throw new Error('Invalid source lock family');
  return /** @type {SourceLock} */ (value);
}
/** @param {{families: Record<string, {files: Record<string, string>}>}} lock */
export async function verifyLockedSources(lock) {
  for (const [family, source] of Object.entries(lock.families))
    for (const [name, expected] of Object.entries(source.files)) {
      const actual = sha256(await readFile(resolve(CACHE, family, name)));
      if (actual !== expected) throw new Error(`${family}/${name} differs from source lock`);
    }
}

/** @param {{families: Record<string, {files: Record<string, string>}>}} lock */
export async function loadRasterFamilies(lock) {
  await verifyLockedSources(lock);
  const renderer = await createSvgRenderer();
  /** @type {Map<string, Map<string, import('@napi-rs/canvas').Image>>} */
  const families = new Map();
  try {
    for (const [family, source] of Object.entries(FAMILIES)) {
      /** @type {Map<string, import('@napi-rs/canvas').Image>} */
      const images = new Map();
      if (source.kind === 'oga-png-archive') {
        const order = { P: 0, Q: 1, N: 2, B: 3, K: 4, R: 5 };
        for (const code of PIECE_CODES) {
          const image = await canvas.loadImage(
            resolve(CACHE, family, code.startsWith('w') ? 'chess2.png' : 'chess1.png'),
          );
          const surface = canvas.createCanvas(72, 72),
            c = surface.getContext('2d');
          c.imageSmoothingEnabled = false;
          const piece = /** @type {keyof typeof order} */ (code.slice(1));
          c.drawImage(image, order[piece] * 32, 0, 32, 32, 4, 4, 64, 64);
          images.set(code, await canvas.loadImage(surface.toBuffer('image/png')));
        }
      } else
        for (const code of PIECE_CODES) {
          const name = source.kind === 'oga-single-color-svg' ? `${code[1]}.svg` : `${code}.svg`;
          const raster = await renderer.render(await readFile(resolve(CACHE, family, name)));
          if (source.kind !== 'oga-single-color-svg')
            images.set(code, await canvas.loadImage(raster.png));
          else {
            const base = await canvas.loadImage(raster.png),
              surface = canvas.createCanvas(72, 72),
              c = surface.getContext('2d');
            c.drawImage(base, 0, 0);
            c.globalCompositeOperation = 'source-in';
            c.fillStyle = code.startsWith('w') ? '#f5f1e8' : '#242321';
            c.fillRect(0, 0, 72, 72);
            images.set(code, await canvas.loadImage(surface.toBuffer('image/png')));
          }
        }
      families.set(family, images);
    }
    if (renderer.externalRequests.length) throw new Error('Source SVG attempted external requests');
  } finally {
    await renderer.close();
  }
  return families;
}

/** @typedef {{families: Record<string, {files: Record<string,string>, sourceSha256?:string}>, conditions:Array<{id:string,style:'flat'|'hatch'|'halftone',reduction:number,speckle:boolean}>, splitSeeds:Record<string,number>, classOrder:string[]}} SourceLock */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is Record<string, string>} */
function isStringRecord(value) {
  return isObject(value) && Object.values(value).every((item) => typeof item === 'string');
}
