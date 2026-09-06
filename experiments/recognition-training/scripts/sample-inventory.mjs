#!/usr/bin/env node
// @ts-check

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseArguments, resolveExperimentPath, sha256 } from './protocol.mjs';
import { validateDatasetManifest } from './verify-dataset.mjs';

const BYTES_PER_BOARD = 64 * 1024 * 4;
const execFileAsync = promisify(execFile);

async function currentCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..'),
  });
  const commit = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('git rev-parse returned an invalid commit');
  return commit;
}

/** @param {string} path @param {number} boards */
async function perBoardHashes(path, boards) {
  /** @type {string[]} */
  const hashes = [];
  let remaining = Buffer.alloc(0);
  let boardBytes = 0;
  let hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.concat([remaining, /** @type {Buffer} */ (chunk)]);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const length = Math.min(BYTES_PER_BOARD - boardBytes, bytes.byteLength - offset);
      hash.update(bytes.subarray(offset, offset + length));
      boardBytes += length;
      offset += length;
      if (boardBytes === BYTES_PER_BOARD) {
        hashes.push(hash.digest('hex'));
        hash = createHash('sha256');
        boardBytes = 0;
      }
    }
    remaining = Buffer.alloc(0);
  }
  if (remaining.byteLength !== 0 || boardBytes !== 0 || hashes.length !== boards) {
    throw new Error(`${path} does not contain exactly ${boards} board vectors`);
  }
  return hashes;
}

/** @param {unknown} value @param {string} path */
function asRecord(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path */
function asBoards(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((board, index) => {
    const entry = asRecord(board, `${path}[${index}]`);
    if (typeof entry['id'] !== 'string' || typeof entry['family'] !== 'string') {
      throw new Error(`${path}[${index}] must contain an id and family`);
    }
    return { id: entry['id'], family: entry['family'] };
  });
}

/** @param {unknown} manifest @param {string} inputRoot */
export async function buildSampleInventory(manifest, inputRoot) {
  const counts = await validateDatasetManifest(manifest, inputRoot);
  const parsedManifest = asRecord(manifest, 'dataset-manifest');
  const artifacts = asRecord(parsedManifest['artifacts'], 'dataset-manifest.artifacts');
  /** @type {Record<string, { vectorSha256: string; samples: { id: string; family: string; vectorSha256: string }[] }>} */
  const splits = {};
  for (const split of /** @type {const} */ (['train', 'dev', 'test'])) {
    const artifact = asRecord(artifacts[split], `dataset-manifest.artifacts.${split}`);
    const vectors = asRecord(artifact['vectors'], `${split}.vectors`);
    const labels = asRecord(artifact['labels'], `${split}.labels`);
    if (typeof vectors['path'] !== 'string' || typeof vectors['sha256'] !== 'string') {
      throw new Error(`${split}.vectors has no path or SHA-256`);
    }
    if (typeof labels['path'] !== 'string') throw new Error(`${split}.labels has no path`);
    const labelsDocument = asRecord(
      JSON.parse(await readFile(resolve(inputRoot, labels['path']), 'utf8')),
      `${split}.labels`,
    );
    const boards = asBoards(labelsDocument['boards'], `${split}.labels.boards`);
    const count = counts[split];
    if (count === undefined || boards.length !== count)
      throw new Error(`${split} sample count changed`);
    const hashes = await perBoardHashes(resolve(inputRoot, vectors['path']), count);
    splits[split] = {
      vectorSha256: vectors['sha256'],
      samples: boards.map((board, index) => {
        const vectorSha256 = hashes[index];
        if (vectorSha256 === undefined) throw new Error(`${split} vector hash missing at ${index}`);
        return { ...board, vectorSha256 };
      }),
    };
  }
  return {
    schemaVersion: 1,
    id: 'synthetic-tilenet-v1-samples',
    datasetManifestSha256: sha256(`${JSON.stringify(manifest, null, 2)}\n`),
    generator: {
      command:
        'node scripts/sample-inventory.mjs --input data/full --output manifests/samples-v1.json',
      node: process.version,
      repositoryCommit: await currentCommit(),
    },
    splits,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const input = args['input'];
  const output = args['output'];
  if (typeof input !== 'string' || typeof output !== 'string') {
    throw new Error(
      'Usage: sample-inventory.mjs --input data/full --output manifests/samples-v1.json',
    );
  }
  const inputRoot = resolveExperimentPath(input);
  const outputPath = resolveExperimentPath(output);
  const manifest = /** @type {unknown} */ (
    JSON.parse(await readFile(resolve(inputRoot, 'dataset-manifest.json'), 'utf8'))
  );
  const inventory = await buildSampleInventory(manifest, inputRoot);
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outputPath,
        samples: Object.fromEntries(
          Object.entries(inventory.splits).map(([split, entry]) => [split, entry.samples.length]),
        ),
      },
      null,
      2,
    ),
  );
}
