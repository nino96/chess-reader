#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { renderTiles } from '../../v2/scripts/render-board.mjs';
import { makeRandom, randomPosition } from '../../v2/scripts/recipe.mjs';
import { CLASS_ORDER, FAMILIES } from './sources.mjs';
import { assignment, boardSeed, CONDITIONS, familiesFor, SPLITS } from './dataset-plan.mjs';
import { ROOT, canvas, loadRasterFamilies, readLock, sha256 } from './data-common.mjs';

const args = new Set(process.argv.slice(2));
const randomPositionTyped = /** @type {(random: () => number) => number[]} */ (randomPosition);
if (!args.has('--approved'))
  throw new Error('Full generation requires lead-reviewed preflight and explicit --approved');
const plan = parseObject(await readFile(resolve(ROOT, 'manifests/dataset-plan.json'), 'utf8'));
if (plan['fullGenerationAuthorized'] !== true)
  throw new Error('dataset-plan.json must record lead authorization before generation');
const output = resolve(ROOT, 'data/full');
try {
  await readFile(resolve(output, 'dataset-manifest.json'));
  throw new Error('Refuse to overwrite an existing dataset');
} catch (e) {
  if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
}
const preflight = parseObject(await readFile(resolve(ROOT, 'data/preflight/report.json'), 'utf8'));
if (
  preflight['status'] !== 'preflight-only' ||
  !isObject(preflight['checks']) ||
  preflight['checks']['allPiecesRendered'] !== true ||
  typeof preflight['elapsedSeconds'] !== 'number'
)
  throw new Error('Passing source preflight is required');
const started = performance.now(),
  lock = await readLock(),
  rasterFamilies = await loadRasterFamilies(lock);
await mkdir(output, { recursive: true });
/** @type {Record<string, unknown>} */
const artifacts = {};
/** @type {Buffer[]} */
const devPngs = [];
await makeTensorSheets();
/** @param {keyof typeof SPLITS} role */
async function split(role) {
  const count = SPLITS[role].count,
    tmp = resolve(output, `.${role}.vectors.tmp`),
    path = resolve(output, `${role}.vectors.f32le`),
    stream = createWriteStream(tmp, { flags: 'wx' }),
    hash = createHash('sha256');
  /** @type {Array<{id:string,family:string,artistGroup:string,condition:string,labels:number[],render:unknown}>} */
  const boards = [];
  /** @type {Record<string, number>} */
  const byFamily = {};
  /** @type {Record<string, number>} */
  const byCondition = {};
  /** @type {number[]} */
  const distribution = Array(13).fill(0);
  for (let index = 0; index < count; index++) {
    const { family, condition } = assignment(role, index),
      seed = boardSeed(role, index),
      labels = randomPositionTyped(makeRandom(seed)),
      images = rasterFamilies.get(family);
    if (!family || !images) throw new Error(`Missing family raster for ${role}/${index}`);
    const familyInfo = FAMILIES[/** @type {keyof typeof FAMILIES} */ (family)];
    if (!familyInfo) throw new Error(`Unknown family ${family}`);
    const rendered = renderTiles(labels, images, seed, role === 'dev', {
      style: condition.style,
      reduction: condition.reduction,
      speckle: condition.speckle,
    });
    const bytes = Buffer.from(
      rendered.tiles.buffer,
      rendered.tiles.byteOffset,
      rendered.tiles.byteLength,
    );
    hash.update(bytes);
    if (!stream.write(bytes)) await once(stream, 'drain');
    for (const label of labels) distribution[label] = (distribution[label] ?? 0) + 1;
    byFamily[family] = (byFamily[family] ?? 0) + 1;
    byCondition[condition.id] = (byCondition[condition.id] ?? 0) + 1;
    const id = `synthetic-v3-${role}-${String(index).padStart(5, '0')}`;
    boards.push({
      id,
      family,
      artistGroup: familyInfo.artistGroup,
      condition: condition.id,
      labels,
      render: { style: rendered.style, ...rendered.degradation },
    });
    if (role === 'dev') {
      const name = `dev-rgb/${id}.png`;
      await mkdir(resolve(output, 'dev-rgb'), { recursive: true });
      if (!rendered.previewPng) throw new Error('Dev render lacks preview PNG');
      await writeFile(resolve(output, name), rendered.previewPng);
      if (index < 12) devPngs.push(rendered.previewPng);
    }
  }
  stream.end();
  await once(stream, 'finish');
  await rename(tmp, path);
  if (distribution.some((n) => n === 0)) throw new Error(`${role} lacks a class`);
  for (const family of familiesFor(role))
    for (const condition of ['pristine', 'hatch', 'low-fidelity'])
      if (!boards.some((b) => b.family === family && b.condition === condition))
        throw new Error('Missing family/condition cell');
  const labelBytes = Buffer.from(
    JSON.stringify(
      { schemaVersion: 1, split: role, classOrder: CLASS_ORDER, tileOrder: 'A1..H8', boards },
      null,
      2,
    ) + '\n',
  );
  await writeFile(resolve(output, `${role}.labels.json`), labelBytes);
  return {
    count,
    families: familiesFor(role),
    vectors: {
      path: `${role}.vectors.f32le`,
      sha256: hash.digest('hex'),
      byteLength: count * 64 * 1024 * 4,
      shape: [count, 64, 1024],
    },
    labels: { path: `${role}.labels.json`, sha256: sha256(labelBytes) },
    classDistribution: distribution,
    byFamily,
    byCondition,
  };
}
artifacts['train'] = await split('train');
artifacts['dev'] = await split('dev');
artifacts['test'] = await split('test');
await makeSmokeInputs(devPngs);
const elapsed = (performance.now() - started) / 1000,
  totalElapsed = preflight['elapsedSeconds'] + elapsed;
if (totalElapsed > 600)
  throw new Error('600-second combined preflight/generation ceiling exceeded');
const manifest = {
  schemaVersion: 1,
  status: 'generated-unreviewed',
  sourceLockSha256: sha256(await readFile(resolve(ROOT, 'source-lock.json'))),
  datasetPlanSha256: sha256(await readFile(resolve(ROOT, 'manifests/dataset-plan.json'))),
  classOrder: CLASS_ORDER,
  tileOrder: 'A1..H8',
  artifacts,
  operations: {
    sourcePreflightSeconds: preflight['elapsedSeconds'],
    generationSeconds: elapsed,
    totalSeconds: totalElapsed,
  },
  ceilingSeconds: 600,
  corpusV1Excluded: true,
};
await writeFile(resolve(output, 'dataset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  resolve(ROOT, 'manifests/dataset-generated.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(JSON.stringify({ elapsedSeconds: elapsed, boards: 4864 }));

/** @param {Buffer[]} boards */
async function makeSmokeInputs(boards) {
  const root = resolve(output, 'smoke');
  await mkdir(root, { recursive: true });
  const entries = [];
  for (let i = 0; i < 12; i++) {
    const name = `exact-${String(i).padStart(2, '0')}.png`;
    const board = boards[i];
    if (!board) throw new Error(`Missing smoke board ${i}`);
    await writeFile(resolve(root, name), board);
    entries.push({ id: name, kind: 'positive-exact-board', expectedBoards: 1 });
  }
  for (let i = 0; i < 6; i++) {
    const s = canvas.createCanvas(900, 700),
      c = s.getContext('2d');
    c.fillStyle = '#faf8f1';
    c.fillRect(0, 0, 900, 700);
    c.fillStyle = '#333';
    c.font = '28px serif';
    c.fillText(`Synthetic negative page ${i + 1}`, 60, 80);
    for (let y = 140; y < 620; y += 35) c.fillRect(60, y, 700 - (y % 91), 2);
    const name = `negative-${i}.png`;
    await writeFile(resolve(root, name), s.toBuffer('image/png'));
    entries.push({ id: name, kind: 'negative-page', expectedBoards: 0 });
  }
  for (let i = 0; i < 6; i++) {
    const s = canvas.createCanvas(900, 700),
      c = s.getContext('2d');
    c.fillStyle = '#fffdf8';
    c.fillRect(0, 0, 900, 700);
    const firstBytes = boards[i],
      secondBytes = boards[i + 6];
    if (!firstBytes || !secondBytes) throw new Error(`Missing page source ${i}`);
    const first = await canvas.loadImage(firstBytes),
      second = await canvas.loadImage(secondBytes);
    const kind =
      i < 2 ? 'loose-selection' : i < 4 ? 'multiple-board-page' : 'partial-board-selection';
    if (i < 2) {
      c.drawImage(first, 120, 80, 560, 560);
    } else if (i < 4) {
      c.drawImage(first, 40, 100, 350, 350);
      c.drawImage(second, 500, 220, 350, 350);
    } else {
      c.save();
      c.beginPath();
      c.rect(180, 80, 540, 390);
      c.clip();
      c.drawImage(first, 130, 20, 640, 640);
      c.restore();
    }
    const name = `positive-page-${i}.png`;
    await writeFile(resolve(root, name), s.toBuffer('image/png'));
    entries.push({ id: name, kind, expectedBoards: i < 2 ? 1 : i < 4 ? 2 : 1 });
  }
  await writeFile(
    resolve(root, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        inputs: entries,
        truthPolicy: 'Synthetic construction; detector receives images only.',
      },
      null,
      2,
    ) + '\n',
  );
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string | Buffer} text @returns {Record<string, unknown>} */
function parseObject(text) {
  /** @type {unknown} */
  const value = JSON.parse(text.toString());
  if (!isObject(value)) throw new Error('Expected a JSON object');
  return value;
}

async function makeTensorSheets() {
  const root = resolve(ROOT, 'data/preflight');
  const labels = Array.from({ length: 64 }, (_, i) => (i < 13 ? i : i % 13));
  for (const [family, images] of rasterFamilies) {
    const sheet = canvas.createCanvas(13 * 70, 3 * 92),
      context = sheet.getContext('2d');
    context.fillStyle = '#eee9df';
    context.fillRect(0, 0, sheet.width, sheet.height);
    context.font = '11px sans-serif';
    context.textAlign = 'center';
    for (let row = 0; row < 3; row++) {
      const condition = CONDITIONS[row];
      if (!condition) throw new Error(`Missing tensor condition ${row}`);
      const familyInfo = FAMILIES[/** @type {keyof typeof FAMILIES} */ (family)];
      if (!familyInfo) throw new Error(`Unknown family ${family}`);
      const rendered = renderTiles(labels, images, boardSeed(familyInfo.split, row + 9000), false, {
        style: condition.style,
        reduction: condition.reduction,
        speckle: condition.speckle,
      });
      const serialized = Buffer.from(
        rendered.tiles.buffer,
        rendered.tiles.byteOffset,
        rendered.tiles.byteLength,
      );
      for (let klass = 0; klass < 13; klass++) {
        const tile = canvas.createCanvas(32, 32),
          c = tile.getContext('2d'),
          data = c.createImageData(32, 32);
        for (let p = 0; p < 1024; p++) {
          const value = Math.round(serialized.readFloatLE((klass * 1024 + p) * 4) * 255);
          for (let q = 0; q < 3; q++) data.data[p * 4 + q] = value;
          data.data[p * 4 + 3] = 255;
        }
        c.putImageData(data, 0, 0);
        context.imageSmoothingEnabled = false;
        context.drawImage(tile, klass * 70 + 3, row * 92 + 2, 64, 64);
        context.fillStyle = '#111';
        context.fillText(CLASS_ORDER[klass] ?? '', klass * 70 + 35, row * 92 + 80);
      }
      context.textAlign = 'left';
      context.fillText(condition.id, 3, row * 92 + 91);
      context.textAlign = 'center';
    }
    await writeFile(resolve(root, `tensor-${family}.png`), sheet.toBuffer('image/png'));
  }
}
