import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const CLASS_ORDER = '.KQRBNPkqrbnp';
const root = resolve(import.meta.dirname, '../..');
const requireFixtures = /** @type {(id: string) => unknown} */ (
  createRequire(resolve(root, 'packages/test-fixtures/package.json'))
);
/** @type {typeof import('@napi-rs/canvas')} */
export const canvas = /** @type {typeof import('@napi-rs/canvas')} */ (
  requireFixtures('@napi-rs/canvas')
);
export const tilesPath = resolve(
  root,
  'packages/test-fixtures/node_modules/@scoriiu/fenshot/dist/tiles.js',
);
/** @typedef {{data: Float32Array, width: number, height: number}} GrayImage */
/** @typedef {{rgbaToGray: (rgba: Uint8ClampedArray, width: number, height: number) => GrayImage, extractTiles: (image: GrayImage, corners: {x0: number, y0: number, x1: number, y1: number}) => Float32Array}} TileModule */
const tileModule = /** @type {unknown} */ (await import(pathToFileURL(tilesPath).href));
if (
  tileModule === null ||
  typeof tileModule !== 'object' ||
  !('rgbaToGray' in tileModule) ||
  typeof tileModule.rgbaToGray !== 'function' ||
  !('extractTiles' in tileModule) ||
  typeof tileModule.extractTiles !== 'function'
)
  throw new Error('incompatible pinned extractor API');
const tileApi = /** @type {TileModule} */ (tileModule);
const { rgbaToGray, extractTiles } = tileApi;
/** @param {unknown} value @returns {unknown} */
const canonical = (value) =>
  Array.isArray(value)
    ? /** @type {unknown[]} */ (value).map(canonical)
    : value !== null && typeof value === 'object'
      ? (() => {
          /** @type {Array<readonly [string, unknown]>} */
          const entries = Object.keys(value)
            .sort()
            .map((k) => [k, canonical(/** @type {Record<string, unknown>} */ (value)[k])]);
          return Object.fromEntries(entries);
        })()
      : value;
/** @param {unknown} value @returns {Buffer} */
export const jsonBytes = (value) =>
  Buffer.from(
    `${JSON.stringify(canonical(value), null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`,
  );
/** @param {string} placement @returns {number[]} */
export function modelLabels(placement) {
  if (typeof placement !== 'string' || placement.length > 71) throw new Error('invalid placement');
  const ranks = placement.split('/').map((rank) => {
    /** @type {number[]} */
    const out = [];
    for (const char of rank) {
      if (/^[1-8]$/.test(char))
        out.push(.../** @type {number[]} */ (Array.from({ length: Number(char) }, () => 0)));
      else if (CLASS_ORDER.includes(char) && char !== '.') out.push(CLASS_ORDER.indexOf(char));
      else throw new Error('unknown placement class');
    }
    if (out.length !== 8) throw new Error('rank must contain eight squares');
    return out;
  });
  if (ranks.length !== 8) throw new Error('placement must contain eight ranks');
  return ranks.reverse().flat();
}
/** @param {Uint8ClampedArray} rgba @param {number} width @param {number} height @returns {Float32Array} */
export function preprocessRgba(rgba, width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 8 ||
    height < 8 ||
    width * height > 10_000_000 ||
    rgba.length !== width * height * 4
  )
    throw new Error('invalid image shape');
  const tiles = /** @type {Float32Array} */ (
    extractTiles(rgbaToGray(rgba, width, height), {
      x0: 0,
      y0: 0,
      x1: width,
      y1: height,
    })
  );
  if (
    tiles.length !== 65536 ||
    !tiles.every((/** @type {number} */ x) => Number.isFinite(x) && x >= 0 && x <= 1)
  )
    throw new Error('invalid tile values');
  return tiles;
}
