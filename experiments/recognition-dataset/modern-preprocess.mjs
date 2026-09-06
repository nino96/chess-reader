#!/usr/bin/env node
// Exact production preprocessing for reviewed modern crops.  This is kept
// separate from Python/Pillow so the bytes are produced by the pinned FENShot
// implementation used by the application.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endianness } from 'node:os';
import {
  jsonBytes,
  modelLabels,
  preprocessRgba,
  canvas as nativeCanvas,
  tilesPath,
} from './preprocess-core.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const { loadImage, createCanvas } = /** @type {typeof import('@napi-rs/canvas')} */ (nativeCanvas);
const CLASS_ORDER = ['.', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];

/** @typedef {{status?: string, all64?: boolean, geometry?: boolean}} Review */
/** @typedef {{id: string, kind: string, sourceId: string, page: number, rect: number[], placement: string, orientation: string, family: string, split: string, tags: string[], proposal: unknown, proposalSha256: string, cropSha256: string, review?: Review}} BoardRecord */
/** @typedef {{schema: number, records: BoardRecord[]}} Manifest */
/** @typedef {{id: string, sourceId: string, page: number, split: string, family: string, tileOrder: string, shape: number[], labels: number[], tensor: {path: string, sha256: string}, preview: {path: string, sha256: string}}} OutputRecord */

/** @param {Uint8Array} bytes @returns {string} */
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @type {Map<string, string | boolean>} */
const args = new Map();
for (const [index, value] of process.argv.slice(2).entries()) {
  if (value.startsWith('--')) args.set(value, process.argv[index + 3] ?? true);
}
const manifestPath = resolve(
  String(args.get('--manifest') ?? resolve(HERE, 'work/modern/manifest.json')),
);
const work = resolve(String(args.get('--work') ?? resolve(HERE, 'work/modern')));
const manifestBytes = await readFile(manifestPath);
/** @param {string} text @returns {Manifest} */
const parseManifest = (text) => {
  const parsed = /** @type {unknown} */ (JSON.parse(text));
  if (parsed === null || typeof parsed !== 'object') throw new Error('manifest must be an object');
  const root = /** @type {Record<string, unknown>} */ (parsed);
  if (root['schema'] !== 2 || !Array.isArray(root['records']) || root['records'].length > 500)
    throw new Error('invalid manifest schema/count');
  const rows = /** @type {unknown[]} */ (root['records']);
  const records = rows.map((value) => {
    if (value === null || typeof value !== 'object') throw new Error('invalid board record');
    const row = /** @type {Record<string, unknown>} */ (value);
    for (const key of [
      'id',
      'sourceId',
      'kind',
      'placement',
      'orientation',
      'family',
      'split',
      'cropSha256',
      'proposalSha256',
    ]) {
      if (typeof row[key] !== 'string' || !row[key]) throw new Error(`missing board field: ${key}`);
    }
    if (typeof row['page'] !== 'number' || !Number.isSafeInteger(row['page']) || row['page'] < 1)
      throw new Error('invalid source page');
    if (
      !Array.isArray(row['rect']) ||
      row['rect'].length !== 4 ||
      !row['rect'].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    )
      throw new Error('invalid board rectangle');
    if (!Array.isArray(row['tags']) || !row['tags'].every((t) => typeof t === 'string'))
      throw new Error('invalid board tags');
    if (!['train', 'dev', 'held-out', 'exposed-diagnostic'].includes(String(row['split'])))
      throw new Error('invalid split');
    if (!['white-bottom', 'black-bottom', 'unknown'].includes(String(row['orientation'])))
      throw new Error('invalid orientation');
    if (
      !/^[a-z0-9][a-z0-9-]{0,95}$/.test(String(row['id'])) ||
      !/^[a-f0-9]{64}$/.test(String(row['cropSha256'])) ||
      !/^[a-f0-9]{64}$/.test(String(row['proposalSha256']))
    )
      throw new Error('invalid identity/hash');
    modelLabels(String(row['placement']));
    if (row['review'] === null || typeof row['review'] !== 'object')
      throw new Error('missing review');
    const review = /** @type {Record<string, unknown>} */ (row['review']);
    if (
      typeof review['status'] !== 'string' ||
      typeof review['all64'] !== 'boolean' ||
      typeof review['geometry'] !== 'boolean'
    )
      throw new Error('invalid review');
    return /** @type {BoardRecord} */ (value);
  });
  return { schema: 2, records };
};
if (endianness() !== 'LE') throw new Error('f32le export requires a little-endian host');
const manifest = parseManifest(manifestBytes.toString('utf8'));
if (manifest.schema !== 2 || !Array.isArray(manifest.records))
  throw new Error('unsupported modern manifest');
const accepted = manifest.records.filter(
  (row) => row.kind === 'board' && row.review?.status === 'accepted',
);
if (!accepted.length) throw new Error('no board records');
const classIds = modelLabels;

/** @param {string} path @returns {Promise<void>} */
async function rejectSymlinks(path) {
  let current = resolve(path);
  for (;;) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('symlink artifact path');
    } catch (/** @type {unknown} */ error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
}
/** @param {unknown} error @param {string} code @returns {boolean} */
const hasCode = (error, code) => error instanceof Error && 'code' in error && error.code === code;
await rejectSymlinks(work);
if (accepted.length > 500 || new Set(accepted.map((row) => row.id)).size !== accepted.length)
  throw new Error('invalid board count or duplicate IDs');

await mkdir(resolve(work, 'tensors'), { recursive: true });
await mkdir(resolve(work, 'tensor-review'), { recursive: true });
/** @type {OutputRecord[]} */
const records = [];
for (const row of accepted) {
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(row.id)) throw new Error('invalid board ID');
  const review = row.review;
  if (
    !review ||
    row.orientation === 'unknown' ||
    review.status !== 'accepted' ||
    review.all64 !== true ||
    review.geometry !== true
  )
    throw new Error(`unreviewed board: ${row.id}`);
  const cropPath = resolve(work, 'crops', `${row.id}.png`);
  await rejectSymlinks(cropPath);
  const cropBytes = await readFile(cropPath);
  if (digest(cropBytes) !== row.cropSha256) throw new Error(`crop hash mismatch: ${row.id}`);
  if (
    digest(
      jsonBytes({
        id: row.id,
        sourceId: row.sourceId,
        page: row.page,
        rect: row.rect,
        placement: row.placement,
        orientation: row.orientation,
        kind: row.kind,
        family: row.family,
        split: row.split,
        tags: row.tags,
        proposal: row.proposal,
      }),
    ) !== row.proposalSha256
  )
    throw new Error(`proposal hash mismatch: ${row.id}`);
  const image = await loadImage(cropBytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const tiles = preprocessRgba(rgba, image.width, image.height);
  if (tiles.length !== 64 * 1024) throw new Error(`unexpected tile shape: ${row.id}`);
  const tileBytes = Buffer.from(tiles.buffer, tiles.byteOffset, tiles.byteLength);
  const tensorName = `${row.id}.f32le`;
  await writeFile(resolve(work, 'tensors', tensorName), tileBytes, { flag: 'wx' }).catch(
    async (/** @type {unknown} */ error) => {
      if (!hasCode(error, 'EEXIST')) throw error;
      const existing = await readFile(resolve(work, 'tensors', tensorName));
      if (!existing.equals(tileBytes)) throw new Error(`tensor replay differs: ${row.id}`);
    },
  );
  const preview = createCanvas(256, 256);
  const previewContext = preview.getContext('2d');
  for (let index = 0; index < 64; index += 1) {
    const tile = tiles.subarray(index * 1024, (index + 1) * 1024);
    const tileCanvas = createCanvas(32, 32);
    const tileContext = tileCanvas.getContext('2d');
    const pixels = tileContext.createImageData(32, 32);
    for (let p = 0; p < 1024; p += 1) {
      const value = Math.round(Math.max(0, Math.min(1, tile[p] ?? 0)) * 255);
      pixels.data[p * 4] = value;
      pixels.data[p * 4 + 1] = value;
      pixels.data[p * 4 + 2] = value;
      pixels.data[p * 4 + 3] = 255;
    }
    tileContext.putImageData(pixels, 0, 0);
    previewContext.drawImage(tileCanvas, (index % 8) * 32, (7 - Math.floor(index / 8)) * 32);
  }
  const previewBytes = preview.toBuffer('image/png');
  const previewName = `${row.id}.png`;
  await writeFile(resolve(work, 'tensor-review', previewName), previewBytes, { flag: 'wx' }).catch(
    async (/** @type {unknown} */ error) => {
      if (!hasCode(error, 'EEXIST')) throw error;
      if (!(await readFile(resolve(work, 'tensor-review', previewName))).equals(previewBytes))
        throw new Error(`preview replay differs: ${row.id}`);
    },
  );
  records.push({
    id: row.id,
    sourceId: row.sourceId,
    page: row.page,
    split: row.split,
    family: row.family,
    tileOrder: 'A1..H8',
    shape: [64, 1024],
    labels: classIds(row.placement),
    tensor: { path: `tensors/${tensorName}`, sha256: digest(tileBytes) },
    preview: { path: `tensor-review/${previewName}`, sha256: digest(previewBytes) },
  });
}
const output = {
  schema: 1,
  manifestSha256: digest(manifestBytes),
  extractorSha256: digest(await readFile(tilesPath)),
  wrapperSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  coreSha256: digest(await readFile(resolve(HERE, 'preprocess-core.mjs'))),
  preprocessing: 'fenshot-0.1.4 rgbaToGray + extractTiles',
  classOrder: CLASS_ORDER,
  tileOrder: 'image-bottom-left-first, ranks upward',
  records,
};
await writeFile(resolve(work, 'preprocess-manifest.json'), jsonBytes(output), { flag: 'wx' }).catch(
  async (/** @type {unknown} */ error) => {
    if (!hasCode(error, 'EEXIST')) throw error;
    if (!(await readFile(resolve(work, 'preprocess-manifest.json'))).equals(jsonBytes(output)))
      throw new Error('preprocess manifest replay differs');
  },
);
console.log(
  JSON.stringify({
    records: records.length,
    acceptedBoards: records.length,
    manifest: resolve(work, 'preprocess-manifest.json'),
  }),
);
