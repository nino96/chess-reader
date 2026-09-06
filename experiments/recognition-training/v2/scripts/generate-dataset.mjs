#!/usr/bin/env node
// @ts-check
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- pinned fixture dependencies are cast at the import boundary below. */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { renderTiles } from './render-board.mjs';
import { createSvgRenderer } from './svg-renderer.mjs';

import {
  CLASS_ORDER,
  DATASET_SEED,
  FULL_SPLIT_SIZES,
  PIECE_CODES,
  PILOT_SPLIT_SIZES,
  SOURCE_FAMILIES,
} from '../source-lock.mjs';
import { makeRandom, randomPosition, sampleSeed } from './recipe.mjs';
import {
  EXPERIMENT_ROOT,
  REPOSITORY_ROOT,
  assertLittleEndian,
  assertNoCorpusV1,
  emptyDistribution,
  expectedVectorByteLength,
  fileByteLength,
  parseArguments,
  resolveExperimentPath,
  sha256,
  sha256File,
  verifySourceCache,
} from './protocol.mjs';

const requireFromFixtures = createRequire(
  resolve(REPOSITORY_ROOT, 'packages/test-fixtures/package.json'),
);
const { loadImage } = /** @type {typeof import('@napi-rs/canvas')} */ (
  requireFromFixtures('@napi-rs/canvas')
);
const args = parseArguments(process.argv.slice(2));
const outputArgument = args['output'];
const cacheArgument = args['cache'];
const presetArgument = args['preset'] ?? 'full';
const previewArgument = args['preview'];
if (typeof outputArgument !== 'string')
  throw new Error('Usage: generate-dataset.mjs --output data/<name> [--preset full|pilot]');
if (cacheArgument !== undefined && typeof cacheArgument !== 'string')
  throw new Error('--cache needs a path');
if (presetArgument !== 'full' && presetArgument !== 'pilot')
  throw new Error('--preset must be full or pilot');
if (previewArgument !== undefined && previewArgument !== true)
  throw new Error('--preview does not take a value');

const outputRoot = resolveExperimentPath(outputArgument);
const cacheRoot =
  cacheArgument === undefined
    ? resolve(EXPERIMENT_ROOT, '../data/source-cache')
    : resolveExperimentPath(cacheArgument);
assertNoCorpusV1(outputRoot);
assertNoCorpusV1(cacheRoot);
assertLittleEndian();

const splitSizes = presetArgument === 'pilot' ? PILOT_SPLIT_SIZES : FULL_SPLIT_SIZES;
const sourceHashes = await verifySourceCache(cacheRoot);
await mkdir(outputRoot, { recursive: true });
// A new run must never replace frozen corpus bytes.
try {
  await readFile(resolve(outputRoot, 'dataset-manifest.json'));
  throw new Error('Output dataset already exists');
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
/** @param {unknown} value */
function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid SVG fidelity evidence');
  return /** @type {Record<string, unknown>} */ (value);
}
const fidelityBytes = await readFile(resolve(EXPERIMENT_ROOT, 'reports/svg-fidelity.json'));
const fidelity = record(/** @type {unknown} */ (JSON.parse(fidelityBytes.toString())));
if (
  fidelity['status'] !== 'passed' ||
  fidelity['assetCount'] !== 72 ||
  !Array.isArray(fidelity['assets']) ||
  fidelity['noExternalRequests'] !== true
)
  throw new Error('Passing all-source SVG fidelity evidence required');
const verifiedAssets = new Map(
  fidelity['assets'].map((value) => {
    const a = record(value);
    return [`${String(a['family'])}/${String(a['code'])}`, a];
  }),
);
const svgRenderer = await createSvgRenderer();
if (record(fidelity['renderer'])['chromium'] !== svgRenderer.version)
  throw new Error('SVG browser version changed');
/** @type {Record<string, unknown>} */
const rasterAssets = {};

/** @param {string} family */
async function loadFamilyImages(family) {
  const root = resolve(cacheRoot, family);
  const images = new Map();
  for (const code of PIECE_CODES) {
    const svg = await readFile(resolve(root, `${code}.svg`));
    const raster = await svgRenderer.render(svg);
    const expected = verifiedAssets.get(`${family}/${code}`);
    if (
      expected?.['sourceSha256'] !== sha256(svg) ||
      record(expected['chromium'])['pngSha256'] !== sha256(raster.png) ||
      record(expected['chromium'])['rgbaSha256'] !== sha256(raster.rgba)
    )
      throw new Error('Source raster differs from verified SVG fidelity evidence');
    images.set(code, await loadImage(raster.png));
    rasterAssets[`${family}/${code}`] = {
      sourceSha256: sha256(svg),
      pngSha256: sha256(raster.png),
      rgbaSha256: sha256(raster.rgba),
    };
  }
  return images;
}

/** @param {import('node:fs').WriteStream} output @param {Buffer} bytes */
async function writeChunk(output, bytes) {
  if (!output.write(bytes)) await once(output, 'drain');
}

/** @param {'train' | 'dev' | 'test'} split */
function splitFamilies(split) {
  return Object.entries(SOURCE_FAMILIES)
    .filter(([, source]) => source.split === split)
    .map(([family]) => family);
}

/** @param {'train' | 'dev' | 'test'} split @param {number} count */
async function generateSplit(split, count) {
  const vectorName = `${split}.vectors.f32le`;
  const labelName = `${split}.labels.json`;
  const temporaryVector = resolve(outputRoot, `.${vectorName}.tmp`);
  const vectorPath = resolve(outputRoot, vectorName);
  const families = splitFamilies(split);
  const entries = await Promise.all(
    families.map(
      async (family) =>
        /** @type {[string, Map<string, import('@napi-rs/canvas').Image>]} */ ([
          family,
          await loadFamilyImages(family),
        ]),
    ),
  );
  const images = new Map(entries);
  const stream = createWriteStream(temporaryVector, { flags: 'w' });
  const hash = createHash('sha256');
  /** @type {{ id: string; family: string; labels: number[]; render: {style:string; reduction:number; speckles:number} }[]} */
  const boards = [];
  const distribution = emptyDistribution();
  /** @type {Record<string, number>} */
  const styleDistribution = {};
  /** @type {Record<string, number>} */
  const reductionDistribution = {};
  let speckledBoards = 0;
  for (let index = 0; index < count; index += 1) {
    const seed = sampleSeed(split, index);
    const random = makeRandom(seed);
    const family = families[index % families.length];
    if (family === undefined) throw new Error(`No source family for ${split}`);
    const pieceImages = images.get(family);
    if (pieceImages === undefined) throw new Error(`Images missing for ${family}`);
    const labels = randomPosition(random);
    const rendered = renderTiles(
      labels,
      pieceImages,
      seed,
      previewArgument === true && split === 'train' && index === 0,
    );
    const { tiles } = rendered;
    if (tiles.length !== 64 * 1024)
      throw new Error(`FENShot emitted unexpected tile shape for ${split}/${index}`);
    for (const value of tiles) {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error('FENShot tile values must be finite [0,1]');
    }
    const bytes = Buffer.from(tiles.buffer, tiles.byteOffset, tiles.byteLength);
    hash.update(bytes);
    await writeChunk(stream, bytes);
    for (const label of labels) {
      if (!Number.isInteger(label) || label < 0 || label >= CLASS_ORDER.length)
        throw new Error('Invalid label');
      const current = distribution[label];
      if (current === undefined) throw new Error('Class distribution invariant failed');
      distribution[label] = current + 1;
    }
    boards.push({
      id: `synthetic-v2-${split}-${family}-${String(index).padStart(5, '0')}`,
      family,
      labels,
      render: { style: rendered.style, ...rendered.degradation },
    });
    if (rendered.previewPng !== undefined) {
      await writeFile(resolve(outputRoot, `${split}-preview.png`), rendered.previewPng);
    }
    styleDistribution[rendered.style] = (styleDistribution[rendered.style] ?? 0) + 1;
    const reductionKey = String(rendered.degradation.reduction);
    reductionDistribution[reductionKey] = (reductionDistribution[reductionKey] ?? 0) + 1;
    if (rendered.degradation.speckles > 0) speckledBoards += 1;
  }
  stream.end();
  await once(stream, 'finish');
  await rename(temporaryVector, vectorPath);
  const labelsPath = resolve(outputRoot, labelName);
  const labelsBytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, split, boards }, null, 2)}\n`,
  );
  await writeFile(labelsPath, labelsBytes);
  const byteLength = await fileByteLength(vectorPath);
  const expected = expectedVectorByteLength(count);
  if (byteLength !== expected)
    throw new Error(`${split} vector size ${byteLength} does not equal ${expected}`);
  return {
    vectors: { path: vectorName, sha256: hash.digest('hex'), byteLength, shape: [count, 64, 1024] },
    labels: { path: labelName, sha256: sha256(labelsBytes), byteLength: labelsBytes.byteLength },
    classDistribution: distribution,
    renderDistribution: {
      style: styleDistribution,
      reduction: reductionDistribution,
      speckledBoards,
    },
    families,
  };
}

/** @param {string} path */
async function generatorHash(path) {
  return sha256(await readFile(path));
}

const artifacts = {
  train: await generateSplit('train', splitSizes.train),
  dev: await generateSplit('dev', splitSizes.dev),
  test: await generateSplit('test', splitSizes.test),
};
if (svgRenderer.externalRequests.length !== 0)
  throw new Error('SVG generation attempted external requests');
await svgRenderer.close();
const generatorPath = fileURLToPath(import.meta.url);
const generatorDependencies = {
  'scripts/protocol.mjs': await generatorHash(resolve(dirname(generatorPath), 'protocol.mjs')),
  'scripts/render-board.mjs': await generatorHash(
    resolve(dirname(generatorPath), 'render-board.mjs'),
  ),
  'scripts/svg-renderer.mjs': await generatorHash(
    resolve(dirname(generatorPath), 'svg-renderer.mjs'),
  ),
  'scripts/recipe.mjs': await generatorHash(resolve(dirname(generatorPath), 'recipe.mjs')),
  'source-lock.mjs': await generatorHash(resolve(dirname(generatorPath), '..', 'source-lock.mjs')),
  'packages/test-fixtures/package.json': await generatorHash(
    resolve(REPOSITORY_ROOT, 'packages/test-fixtures/package.json'),
  ),
  'pnpm-lock.yaml': await generatorHash(resolve(REPOSITORY_ROOT, 'pnpm-lock.yaml')),
};
const manifest = {
  schemaVersion: 1,
  id: 'synthetic-tilenet-v2',
  seed: DATASET_SEED,
  preset: presetArgument,
  dtype: 'float32-le',
  classOrder: CLASS_ORDER,
  tileOrder: 'A1..H8',
  preprocessing: 'fenshot-0.1.4 rgbaToGray + extractTiles',
  rendering: {
    svgFidelitySha256: sha256(fidelityBytes),
    svgRenderer: {
      name: 'Chromium SVG via PNG',
      version: svgRenderer.version,
      assets: Object.fromEntries(
        Object.entries(rasterAssets).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    whiteSilhouetteOutline: {
      color: '#2b2926',
      offsetsPx: 0.75,
      directions: ['left', 'right', 'up', 'down'],
    },
  },
  sourceNotice: {
    path: 'lila-COPYING.md',
    sha256: (await import('../source-lock.mjs')).LILA_COPYING_SHA256,
  },
  sources: Object.fromEntries(
    Object.entries(SOURCE_FAMILIES).map(([family, source]) => [
      family,
      { ...source, actualSha256: sourceHashes[family] },
    ]),
  ),
  splits: Object.fromEntries(
    Object.entries(artifacts).map(([split, artifact]) => [split, { families: artifact.families }]),
  ),
  artifacts,
  generator: { path: 'scripts/generate-dataset.mjs', sha256: await generatorHash(generatorPath) },
  generatorDependencies,
  generatorLock: {
    path: 'source-lock.mjs',
    sha256: await generatorHash(resolve(dirname(generatorPath), '..', 'source-lock.mjs')),
  },
  exclusions: [
    'packages/test-fixtures/corpus/v1',
    'production inference',
    'book content',
    'model weights',
  ],
};
const manifestPath = resolve(outputRoot, 'dataset-manifest.json');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      outputRoot,
      preset: presetArgument,
      splitSizes,
      manifestSha256: await sha256File(manifestPath),
    },
    null,
    2,
  ),
);
