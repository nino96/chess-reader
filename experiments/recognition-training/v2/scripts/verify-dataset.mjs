#!/usr/bin/env node
// @ts-check
/* eslint-disable @typescript-eslint/no-unsafe-argument -- JSON is narrowed through record()/artifact() before use. */

import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { CLASS_ORDER, SOURCE_FAMILIES } from '../source-lock.mjs';
import {
  EXPERIMENT_ROOT,
  assertNoCorpusV1,
  expectedVectorByteLength,
  fileByteLength,
  parseArguments,
  resolveExperimentPath,
  sha256File,
  verifySourceCache,
} from './protocol.mjs';

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path */
function string(value, path) {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

/** @param {unknown} value @param {string} path */
function nonnegativeInteger(value, path) {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0)
    throw new Error(`${path} must be a non-negative integer`);
  return value;
}

/** @param {unknown} value @param {string} path */
function sha(value, path) {
  const parsed = string(value, path);
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${path} must be a SHA-256 hex digest`);
  return parsed;
}

/** @param {unknown} value @param {string} path */
function shape(value, path) {
  if (!Array.isArray(value) || value.length !== 3)
    throw new Error(`${path} must be [boards,64,1024]`);
  const parsed = value.map((part, index) => nonnegativeInteger(part, `${path}[${index}]`));
  if (parsed[1] !== 64 || parsed[2] !== 1024) throw new Error(`${path} must be [boards,64,1024]`);
  return /** @type {[number, number, number]} */ (parsed);
}

/** @param {string} path @param {number} boards */
async function verifyVectorValues(path, boards) {
  const expectedBytes = expectedVectorByteLength(boards);
  if ((await fileByteLength(path)) !== expectedBytes)
    throw new Error(`${path} has an invalid vector byte length`);
  let remainder = Buffer.alloc(0);
  let values = 0;
  let boardBytes = 0;
  let boardHash = createHash('sha256');
  /** @type {string[]} */
  const boardHashes = [];
  const bytesPerBoard = 64 * 1024 * 4;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.concat([remainder, /** @type {Buffer} */ (chunk)]);
    const usable = bytes.byteLength - (bytes.byteLength % 4);
    for (let offset = 0; offset < usable;) {
      const length = Math.min(bytesPerBoard - boardBytes, usable - offset);
      boardHash.update(bytes.subarray(offset, offset + length));
      boardBytes += length;
      offset += length;
      if (boardBytes === bytesPerBoard) {
        boardHashes.push(boardHash.digest('hex'));
        boardHash = createHash('sha256');
        boardBytes = 0;
      }
    }
    for (let offset = 0; offset < usable; offset += 4) {
      const value = bytes.readFloatLE(offset);
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error(`${path} has a non-finite or out-of-range float`);
      values += 1;
    }
    remainder = bytes.subarray(usable);
  }
  if (
    remainder.byteLength !== 0 ||
    values !== boards * 64 * 1024 ||
    boardBytes !== 0 ||
    boardHashes.length !== boards
  )
    throw new Error(`${path} has malformed float32 data`);
  return boardHashes;
}

/** @param {unknown} value @param {'train' | 'dev' | 'test'} split @param {Set<string>} ids @param {Map<string, string>} families @param {Map<string, string>} authorFamilies */
function verifyLabels(value, split, ids, families, authorFamilies) {
  const parsed = record(value, `${split}.labels`);
  if (
    parsed['schemaVersion'] !== 1 ||
    parsed['split'] !== split ||
    !Array.isArray(parsed['boards'])
  ) {
    throw new Error(`${split}.labels does not match schema version 1`);
  }
  const boards = parsed['boards'];
  for (const [index, board] of boards.entries()) {
    const entry = record(board, `${split}.labels.boards[${index}]`);
    const id = string(entry['id'], `${split}.labels.boards[${index}].id`);
    const family = string(entry['family'], `${split}.labels.boards[${index}].family`);
    if (ids.has(id)) throw new Error(`Board id overlaps a split: ${id}`);
    ids.add(id);
    const source = SOURCE_FAMILIES[/** @type {keyof typeof SOURCE_FAMILIES} */ (family)];
    if (source.split !== split) throw new Error(`${id} uses a family outside ${split}`);
    const previousSplit = families.get(family);
    if (previousSplit !== undefined && previousSplit !== split)
      throw new Error(`${family} crosses split roles`);
    families.set(family, split);
    const previousAuthorSplit = authorFamilies.get(source.authorFamily);
    if (previousAuthorSplit !== undefined && previousAuthorSplit !== split) {
      throw new Error(`${source.authorFamily} crosses split roles`);
    }
    authorFamilies.set(source.authorFamily, split);
    if (!Array.isArray(entry['labels']) || entry['labels'].length !== 64)
      throw new Error(`${id} must have 64 labels`);
    for (const [labelIndex, label] of entry['labels'].entries()) {
      if (
        !Number.isInteger(label) ||
        typeof label !== 'number' ||
        label < 0 ||
        label >= CLASS_ORDER.length
      ) {
        throw new Error(`${id}.labels[${labelIndex}] is outside 0..12`);
      }
    }
  }
  return boards.length;
}

/** @param {unknown} value @param {string} path */
function artifact(value, path) {
  const parsed = record(value, path);
  const vectors = record(parsed['vectors'], `${path}.vectors`);
  const labels = record(parsed['labels'], `${path}.labels`);
  return {
    vectors: {
      path: string(vectors['path'], `${path}.vectors.path`),
      sha256: sha(vectors['sha256'], `${path}.vectors.sha256`),
      byteLength: nonnegativeInteger(vectors['byteLength'], `${path}.vectors.byteLength`),
      shape: shape(vectors['shape'], `${path}.vectors.shape`),
    },
    labels: {
      path: string(labels['path'], `${path}.labels.path`),
      sha256: sha(labels['sha256'], `${path}.labels.sha256`),
      byteLength: nonnegativeInteger(labels['byteLength'], `${path}.labels.byteLength`),
    },
  };
}

/** @param {unknown} value @param {string} root */
export async function validateDatasetManifest(value, root) {
  const manifest = record(value, 'dataset-manifest');
  if (
    manifest['schemaVersion'] !== 1 ||
    manifest['dtype'] !== 'float32-le' ||
    manifest['classOrder'] !== CLASS_ORDER ||
    manifest['tileOrder'] !== 'A1..H8'
  ) {
    throw new Error('dataset-manifest has an incompatible data protocol');
  }
  if (!JSON.stringify(manifest['exclusions']).includes('corpus/v1')) {
    throw new Error('dataset-manifest must explicitly exclude corpus v1');
  }
  const artifacts = record(manifest['artifacts'], 'dataset-manifest.artifacts');
  const ids = new Set();
  const families = new Map();
  const authorFamilies = new Map();
  const vectorContentHashes = new Set();
  /** @type {Record<string, number>} */
  const boardCounts = {};
  for (const split of /** @type {const} */ (['train', 'dev', 'test'])) {
    const entry = artifact(artifacts[split], `dataset-manifest.artifacts.${split}`);
    const vectorPath = resolve(root, entry.vectors.path);
    const labelPath = resolve(root, entry.labels.path);
    assertNoCorpusV1(vectorPath);
    assertNoCorpusV1(labelPath);
    if (entry.vectors.shape[0] * 64 * 1024 * 4 !== entry.vectors.byteLength)
      throw new Error(`${split} manifest vector size conflicts with shape`);
    if (
      (await fileByteLength(vectorPath)) !== entry.vectors.byteLength ||
      (await sha256File(vectorPath)) !== entry.vectors.sha256
    )
      throw new Error(`${split} vector hash or byte length changed`);
    if (
      (await fileByteLength(labelPath)) !== entry.labels.byteLength ||
      (await sha256File(labelPath)) !== entry.labels.sha256
    )
      throw new Error(`${split} label hash or byte length changed`);
    const labels = /** @type {unknown} */ (JSON.parse(await readFile(labelPath, 'utf8')));
    const count = verifyLabels(labels, split, ids, families, authorFamilies);
    if (count !== entry.vectors.shape[0])
      throw new Error(`${split} labels do not match vector board count`);
    const boardHashes = await verifyVectorValues(vectorPath, count);
    for (const hash of boardHashes) {
      if (vectorContentHashes.has(hash))
        throw new Error(`A board vector crosses split roles: ${hash}`);
      vectorContentHashes.add(hash);
    }
    boardCounts[split] = count;
  }
  return boardCounts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const input = args['input'];
  const cache = args['cache'];
  if (typeof input !== 'string')
    throw new Error('Usage: verify-dataset.mjs --input data/<name> [--cache data/source-cache]');
  if (cache !== undefined && typeof cache !== 'string') throw new Error('--cache needs a path');
  const inputRoot = resolveExperimentPath(input);
  const cacheRoot =
    cache === undefined
      ? resolve(EXPERIMENT_ROOT, '../data/source-cache')
      : resolveExperimentPath(cache);
  await verifySourceCache(cacheRoot);
  const counts = await validateDatasetManifest(
    JSON.parse(await readFile(resolve(inputRoot, 'dataset-manifest.json'), 'utf8')),
    inputRoot,
  );
  console.log(JSON.stringify({ inputRoot, boardCounts: counts, verified: true }, null, 2));
}
