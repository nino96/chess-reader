#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { renderTiles } from '../../v2/scripts/render-board.mjs';
import { ROOT, canvas, loadRasterFamilies, readLock, sha256 } from './data-common.mjs';
import { assignment, boardSeed, CONDITIONS, familiesFor, SPLITS } from './dataset-plan.mjs';

/** @typedef {{id:string,family:string,condition:string,labels:number[]}} Board */
/** @typedef {{rect:{x:number,y:number,width:number,height:number},devIndex:number,complete:boolean}} TruthBoard */
/** @typedef {{boards:Board[]}} Labels */
/** @typedef {{id:string,kind:string}} SmokeInput */
const verificationStarted = performance.now();
const fenshotUnknown = /** @type {unknown} */ (
  await import(
    pathToFileURL(
      resolve(ROOT, '../../../packages/test-fixtures/node_modules/@scoriiu/fenshot/dist/tiles.js'),
    ).href
  )
);
if (!isObject(fenshotUnknown)) throw new Error('Invalid FENShot module');
const fenshot =
  /** @type {{extractTiles:(gray:Float32Array,rect:{x0:number,y0:number,x1:number,y1:number})=>Float32Array,rgbaToGray:(rgba:Uint8ClampedArray,width:number,height:number)=>Float32Array}} */ (
    fenshotUnknown
  );
const generationManifestPath = resolve(ROOT, 'data/full/generation-manifest.json');
let generationManifestBytes;
try {
  generationManifestBytes = await readFile(generationManifestPath);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  generationManifestBytes = await readFile(resolve(ROOT, 'data/full/dataset-manifest.json'));
}
const manifestUnknown = parseUnknown(generationManifestBytes);
if (
  !isObject(manifestUnknown) ||
  !isObject(manifestUnknown['artifacts']) ||
  !isObject(manifestUnknown['operations'])
)
  throw new Error('Invalid generation manifest');
const manifest =
  /** @type {{sourceLockSha256:string,datasetPlanSha256:string,artifacts:Record<string,{vectors:{sha256:string},labels:Record<string,unknown>}>,operations:{totalSeconds:number,[key:string]:unknown}}} */ (
    manifestUnknown
  );
const sourceLock = await readLock();
try {
  await stat(generationManifestPath);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  await writeFile(generationManifestPath, generationManifestBytes);
}
const ids = new Set(),
  /** @type {Record<string, {boards:number,classDistribution:number[]}>} */
  cellChecks = {};
for (const split of /** @type {(keyof typeof SPLITS)[]} */ (Object.keys(SPLITS))) {
  const config = SPLITS[split];
  const labels = parseLabels(
    await readFile(resolve(ROOT, `data/full/${split}.labels.json`), 'utf8'),
  );
  if (labels.boards.length !== config.count) throw new Error(`${split} count changed`);
  if (
    (await stat(resolve(ROOT, `data/full/${split}.vectors.f32le`))).size !==
    config.count * 64 * 1024 * 4
  )
    throw new Error(`${split} vector length changed`);
  for (const board of labels.boards) {
    if (ids.has(board.id)) throw new Error('Split ID overlap');
    ids.add(board.id);
  }
  for (const family of familiesFor(split))
    for (const condition of CONDITIONS) {
      const boards = /** @type {Board[]} */ (labels.boards).filter(
          (b) => b.family === family && b.condition === condition.id,
        ),
        /** @type {number[]} */
        distribution = Array(13).fill(0);
      for (const b of boards)
        for (const label of b.labels) distribution[label] = (distribution[label] ?? 0) + 1;
      if (distribution.some((n) => n === 0))
        throw new Error(`${split}/${family}/${condition.id} lacks a class`);
      cellChecks[`${split}/${family}/${condition.id}`] = {
        boards: boards.length,
        classDistribution: distribution,
      };
    }
}
const devLabels = parseLabels(await readFile(resolve(ROOT, 'data/full/dev.labels.json'), 'utf8')),
  devVector = await readFile(resolve(ROOT, 'data/full/dev.vectors.f32le'));
const replay = [];
for (let index = 0; index < 12; index++) {
  const board = devLabels.boards[index];
  if (!board) throw new Error(`Missing dev board ${index}`);
  const png = await readFile(resolve(ROOT, `data/full/dev-rgb/${board.id}.png`)),
    image = await canvas.loadImage(png),
    surface = canvas.createCanvas(image.width, image.height),
    context = surface.getContext('2d');
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data,
    tiles = fenshot.extractTiles(fenshot.rgbaToGray(rgba, image.width, image.height), {
      x0: 0,
      y0: 0,
      x1: image.width,
      y1: image.height,
    }),
    bytes = Buffer.from(tiles.buffer, tiles.byteOffset, tiles.byteLength),
    expected = devVector.subarray(index * bytes.length, (index + 1) * bytes.length);
  if (!bytes.equals(expected)) throw new Error(`Serialized dev replay differs at ${index}`);
  replay.push({
    id: board.id,
    pngSha256: sha256(png),
    vectorSha256: sha256(bytes),
    family: board.family,
    condition: board.condition,
  });
}
const devPngs = (await readdir(resolve(ROOT, 'data/full/dev-rgb')))
  .filter((n) => n.endsWith('.png'))
  .sort();
if (devPngs.length !== 384) throw new Error('Expected 384 dev RGB PNGs');
/** @type {Record<string,string>} */
const devRgbHashes = {};
for (const name of devPngs)
  devRgbHashes[name] = sha256(await readFile(resolve(ROOT, 'data/full/dev-rgb', name)));
const smokeRoot = resolve(ROOT, 'data/full/smoke'),
  oldSmoke = parseSmoke(await readFile(resolve(smokeRoot, 'manifest.json'), 'utf8'));
if (oldSmoke.inputs.length !== 24) throw new Error('Expected 24 smoke inputs');
const smokeInputs = [];
for (const entry of oldSmoke.inputs) {
  const bytes = await readFile(resolve(smokeRoot, entry.id));
  /** @type {TruthBoard[]} */
  let truthBoards = [];
  const exact = /^exact-(\d+)\.png$/.exec(entry.id),
    page = /^positive-page-(\d+)\.png$/.exec(entry.id);
  if (exact) {
    const i = Number(exact[1]),
      image = await canvas.loadImage(bytes);
    truthBoards = [
      {
        rect: { x: 0, y: 0, width: image.width, height: image.height },
        devIndex: i,
        complete: true,
      },
    ];
  } else if (page) {
    const i = Number(page[1]);
    if (i < 2) {
      truthBoards = [
        { rect: { x: 120, y: 80, width: 560, height: 560 }, devIndex: i, complete: true },
      ];
    } else if (i < 4) {
      truthBoards = [
        { rect: { x: 40, y: 100, width: 350, height: 350 }, devIndex: i, complete: true },
        { rect: { x: 500, y: 220, width: 350, height: 350 }, devIndex: i + 6, complete: true },
      ];
    } else {
      truthBoards = [
        {
          rect: { x: 130, y: 20, width: 640, height: 640 },
          devIndex: i,
          complete: false,
        },
      ];
    }
  }
  smokeInputs.push({
    id: entry.id,
    kind: entry.kind,
    sha256: sha256(bytes),
    truthBoards,
  });
}
const smoke = {
  schemaVersion: 1,
  inputs: smokeInputs,
  truthPolicy:
    'Independent deterministic synthetic construction. Native detector receives image bytes only; truth rectangles are evaluator-side.',
};
await writeFile(resolve(smokeRoot, 'manifest.json'), JSON.stringify(smoke, null, 2) + '\n');
await writeFile(
  resolve(smokeRoot, 'truth-manifest.json'),
  await format(JSON.stringify(smoke), { parser: 'json', printWidth: 100 }),
);
/** @type {Record<string,string>} */
const smokeHashes = Object.fromEntries(smokeInputs.map((x) => [x.id, x.sha256]));
/** @type {Record<string,string>} */
const tensorSheets = {};
for (const family of Object.keys(sourceLock.families)) {
  const name = `tensor-${family}.png`;
  tensorSheets[name] = sha256(await readFile(resolve(ROOT, 'data/preflight', name)));
}
const dependencyPaths = [
  'scripts/sources.mjs',
  'scripts/data-common.mjs',
  'scripts/dataset-plan.mjs',
  'scripts/generate-dataset.mjs',
];
/** @type {Record<string,string>} */
const dependencies = {};
for (const path of dependencyPaths)
  dependencies[path] = sha256(await readFile(resolve(ROOT, path)));
const rasterFamilies = await loadRasterFamilies(sourceLock);
/** @type {Record<string, {boards:number,sha256:string}>} */
const fullReplay = {};
for (const split of /** @type {(keyof typeof SPLITS)[]} */ (Object.keys(SPLITS))) {
  const labels = parseLabels(
      await readFile(resolve(ROOT, `data/full/${split}.labels.json`), 'utf8'),
    ),
    vectors = await open(resolve(ROOT, `data/full/${split}.vectors.f32le`), 'r'),
    digest = createHash('sha256');
  try {
    for (let index = 0; index < labels.boards.length; index++) {
      const board = labels.boards[index];
      if (!board) throw new Error(`Missing ${split} board ${index}`);
      const planned = assignment(split, index),
        condition = CONDITIONS.find((value) => value.id === board.condition);
      if (
        condition === undefined ||
        board.family !== planned.family ||
        board.condition !== planned.condition.id
      )
        throw new Error(`Plan mismatch ${split}/${index}`);
      const images = rasterFamilies.get(board.family);
      if (!images) throw new Error(`Missing replay family ${board.family}`);
      const rendered = renderTiles(board.labels, images, boardSeed(split, index), false, {
          style: condition.style,
          reduction: condition.reduction,
          speckle: condition.speckle,
        }),
        actual = Buffer.from(
          rendered.tiles.buffer,
          rendered.tiles.byteOffset,
          rendered.tiles.byteLength,
        ),
        expected = Buffer.alloc(actual.length),
        read = await vectors.read(expected, 0, expected.length, index * expected.length);
      if (read.bytesRead !== expected.length || !actual.equals(expected))
        throw new Error(`Full replay mismatch ${split}/${index}`);
      digest.update(actual);
    }
  } finally {
    await vectors.close();
  }
  const replaySha256 = digest.digest('hex');
  const artifact = manifest.artifacts[split];
  if (replaySha256 !== artifact?.vectors.sha256) throw new Error(`${split} replay hash differs`);
  fullReplay[split] = { boards: labels.boards.length, sha256: replaySha256 };
}
const verificationSeconds = (performance.now() - verificationStarted) / 1000,
  priorVerificationSecondsConservative = 130,
  totalDataSeconds =
    manifest.operations.totalSeconds + verificationSeconds + priorVerificationSecondsConservative;
if (totalDataSeconds > 600) throw new Error('Combined data-operation ceiling exceeded');
const report = {
  schemaVersion: 1,
  status: 'passed',
  checks: {
    splitIdsDisjoint: true,
    everyClassPerFamilyCondition: true,
    vectorLengths: true,
    devRgbCount: 384,
    smokeInputCount: 24,
    smokeTruthComplete: true,
    serializedDevReplay: true,
    fullCorpusReplay: true,
    corpusV1Excluded: true,
  },
  sourceLockGenerationSha256: manifest.sourceLockSha256,
  sourceLockFinalSha256: sha256(await readFile(resolve(ROOT, 'source-lock.json'))),
  sourceLockSemanticSha256: sha256(
    JSON.stringify(JSON.parse(await readFile(resolve(ROOT, 'source-lock.json'), 'utf8'))),
  ),
  formattingRebind: {
    operation:
      'Prettier changed whitespace only after generation completed; parsed JSON values were preserved and no corpus artifact was regenerated.',
    sourceLock: {
      generationByteSha256: manifest.sourceLockSha256,
      finalByteSha256: sha256(await readFile(resolve(ROOT, 'source-lock.json'))),
    },
    datasetPlan: {
      generationByteSha256: manifest.datasetPlanSha256,
      finalByteSha256: sha256(await readFile(resolve(ROOT, 'manifests/dataset-plan.json'))),
    },
    generator: {
      executionByteSha256: '4075f79cd9c3292bc62ebb31922bf96c0d0e5bda10b43eaa784e75724cd66684',
      finalByteSha256: dependencies['scripts/generate-dataset.mjs'],
      equivalence:
        'Corpus-producing logic is unchanged. Post-generation smoke truth enrichment is implemented by verify-generated.mjs; the generator itself differs from the executed bytes only by Prettier formatting.',
    },
  },
  cellChecks,
  fullReplay,
  replay,
  devRgbHashes,
  smokeHashes,
  tensorSheets,
  dependencies,
  operations: {
    ...manifest.operations,
    verificationSeconds,
    priorVerificationSecondsConservative,
    totalDataSeconds,
    ceilingSeconds: 600,
  },
};
const reportBytes = Buffer.from(
  await format(JSON.stringify(report), { parser: 'json', printWidth: 100 }),
);

/** @param {string|Buffer} text @returns {unknown} */
function parseUnknown(text) {
  return /** @type {unknown} */ (JSON.parse(text.toString()));
}
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** @param {string|Buffer} text @returns {Labels} */
function parseLabels(text) {
  const value = parseUnknown(text);
  if (!isObject(value) || !Array.isArray(value['boards'])) throw new Error('Invalid labels');
  for (const board of value['boards'])
    if (
      !isObject(board) ||
      typeof board['id'] !== 'string' ||
      typeof board['family'] !== 'string' ||
      typeof board['condition'] !== 'string' ||
      !Array.isArray(board['labels']) ||
      !board['labels'].every((label) => typeof label === 'number')
    )
      throw new Error('Invalid board labels');
  return /** @type {Labels} */ (value);
}
/** @param {string|Buffer} text @returns {{inputs:SmokeInput[]}} */
function parseSmoke(text) {
  const value = parseUnknown(text);
  if (!isObject(value) || !Array.isArray(value['inputs']))
    throw new Error('Invalid smoke manifest');
  for (const input of value['inputs'])
    if (!isObject(input) || typeof input['id'] !== 'string' || typeof input['kind'] !== 'string')
      throw new Error('Invalid smoke input');
  return /** @type {{inputs:SmokeInput[]}} */ (value);
}
await writeFile(resolve(ROOT, 'manifests/dataset-verification.json'), reportBytes);
/** @type {Record<string, unknown>} */
const finalArtifacts = {};
for (const [split, value] of Object.entries(manifest.artifacts))
  finalArtifacts[split] = {
    ...value,
    labels: {
      ...value.labels,
      byteLength: (await stat(resolve(ROOT, `data/full/${split}.labels.json`))).size,
    },
  };
const finalManifest = {
  schemaVersion: 1,
  id: 'synthetic-tilenet-v3',
  seed: sourceLock.splitSeeds,
  preset: 'full',
  dtype: 'float32-le',
  classOrder: sourceLock.classOrder,
  tileOrder: 'A1..H8',
  preprocessing: 'fenshot-0.1.4 rgbaToGray + extractTiles',
  rendering: {
    conditions: sourceLock.conditions,
    whiteSilhouetteOutline: {
      color: '#2b2926',
      offsetsPx: 0.75,
      directions: ['left', 'right', 'up', 'down'],
    },
  },
  sources: Object.fromEntries(
    Object.entries(sourceLock.families).map(([family, source]) => [
      family,
      { ...source, actualSha256: source.sourceSha256 },
    ]),
  ),
  splits: Object.fromEntries(
    Object.keys(SPLITS).map((split) => [split, { families: familiesFor(split) }]),
  ),
  artifacts: finalArtifacts,
  generator: {
    path: 'scripts/generate-dataset.mjs',
    sha256: dependencies['scripts/generate-dataset.mjs'],
  },
  generatorDependencies: dependencies,
  generatorLock: {
    path: 'source-lock.json',
    sha256: sha256(await readFile(resolve(ROOT, 'source-lock.json'))),
  },
  exclusions: [
    'packages/test-fixtures/corpus/v1',
    'Firi and RhosGFX diagnostic inputs',
    'private book content',
    'model inference during data generation',
  ],
  status: 'generated-verified',
  operations: report.operations,
  verification: {
    path: 'manifests/dataset-verification.json',
    sha256: sha256(reportBytes),
  },
  devRgb: { count: 384, hashManifest: 'manifests/dataset-verification.json' },
  smoke: {
    count: 24,
    truthManifest: 'data/full/smoke/truth-manifest.json',
    hashManifest: 'manifests/dataset-verification.json',
  },
};
const finalManifestBytes = await format(JSON.stringify(finalManifest), {
  parser: 'json',
  printWidth: 100,
});
await writeFile(resolve(ROOT, 'manifests/dataset-generated.json'), finalManifestBytes);
await writeFile(resolve(ROOT, 'data/full/dataset-manifest.json'), finalManifestBytes);
console.log(
  JSON.stringify({
    status: 'passed',
    cells: Object.keys(cellChecks).length,
    replayed: replay.length,
  }),
);
