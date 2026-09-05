// @ts-check

import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLASS_ORDER, LILA_COPYING_SHA256, PIECE_CODES, SOURCE_FAMILIES } from '../source-lock.mjs';

export const EXPERIMENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPOSITORY_ROOT = resolve(EXPERIMENT_ROOT, '..', '..');
export const VECTOR_TILE_COUNT = 64;
export const VECTOR_TILE_PIXELS = 1024;
export const VECTOR_FLOAT_BYTES = 4;

/** @param {Uint8Array | string} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string} path */
export async function sha256File(path) {
  return sha256(await readFile(path));
}

/** @param {string} path */
export function assertInsideExperiment(path) {
  const absolute = resolve(path);
  const relativePath = relative(EXPERIMENT_ROOT, absolute);
  if (relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..'))
    return absolute;
  throw new Error(`Path escapes experiments/recognition-training: ${path}`);
}

/** @param {string} path */
export function assertNoCorpusV1(path) {
  if (resolve(path).includes(`${sep}packages${sep}test-fixtures${sep}corpus${sep}v1`)) {
    throw new Error('corpus v1 is forbidden from this training experiment');
  }
}

/** @param {string} cacheRoot @param {keyof typeof SOURCE_FAMILIES} family */
export async function hashCachedFamily(cacheRoot, family) {
  const familyRoot = resolve(cacheRoot, family);
  const files = await readdir(familyRoot);
  const expectedNames = PIECE_CODES.map((code) => `${code}.svg`).sort();
  const actualNames = files.filter((name) => name.endsWith('.svg')).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`${family} source cache must contain exactly the twelve piece SVGs`);
  }
  const rows = await Promise.all(
    actualNames.map(async (name) => {
      const hash = await sha256File(resolve(familyRoot, name));
      const expectedFileHash = /** @type {Readonly<Record<string, string>>} */ (
        SOURCE_FAMILIES[family].fileSha256
      )[name];
      if (hash !== expectedFileHash) {
        throw new Error(`${family}/${name} source hash changed; refuse to generate`);
      }
      return `${name} ${hash}`;
    }),
  );
  return sourceFamilyDigest(rows);
}

/** @param {readonly string[]} sortedRows */
export function sourceFamilyDigest(sortedRows) {
  return sha256(`${[...sortedRows].sort().join('\n')}\n`);
}

/** @param {string} cacheRoot */
export async function verifySourceCache(cacheRoot) {
  assertInsideExperiment(cacheRoot);
  assertNoCorpusV1(cacheRoot);
  const noticePath = resolve(cacheRoot, 'lila-COPYING.md');
  if ((await sha256File(noticePath)) !== LILA_COPYING_SHA256) {
    throw new Error('Pinned Lila COPYING.md hash changed; refuse to generate');
  }
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const family of Object.keys(SOURCE_FAMILIES)) {
    const typedFamily = /** @type {keyof typeof SOURCE_FAMILIES} */ (family);
    const actual = await hashCachedFamily(cacheRoot, typedFamily);
    const expected = SOURCE_FAMILIES[typedFamily].sourceSha256;
    if (actual !== expected) {
      throw new Error(`${typedFamily} source hash changed; refuse to generate`);
    }
    hashes[typedFamily] = actual;
  }
  return hashes;
}

/** @param {unknown} value @param {string} name */
export function parsePositiveInteger(value, name) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

/** @param {readonly string[]} argv */
export function parseArguments(argv) {
  /** @type {Record<string, string | true>} */
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) throw new Error(`Unknown argument ${token ?? ''}`);
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) parsed[name] = true;
    else {
      parsed[name] = next;
      index += 1;
    }
  }
  return parsed;
}

/** @param {string} path */
export async function mustExist(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing required file: ${path}`);
  }
}

/** @param {string} path */
export async function fileByteLength(path) {
  return (await stat(path)).size;
}

/** @param {string} path */
export function resolveExperimentPath(path) {
  return assertInsideExperiment(isAbsolute(path) ? path : resolve(EXPERIMENT_ROOT, path));
}

export function assertLittleEndian() {
  const value = new Uint16Array([0x0102]);
  if (new Uint8Array(value.buffer)[0] !== 0x02)
    throw new Error('This generator requires little-endian float32');
}

/** @param {number} boardCount */
export function expectedVectorByteLength(boardCount) {
  return boardCount * VECTOR_TILE_COUNT * VECTOR_TILE_PIXELS * VECTOR_FLOAT_BYTES;
}

export function emptyDistribution() {
  return Array.from({ length: CLASS_ORDER.length }, () => 0);
}
