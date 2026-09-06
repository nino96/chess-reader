#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FAMILIES,
  LYRICSZ_ARCHIVE,
  LYRICSZ_ARCHIVE_SHA256,
  OGA_FILES,
  PIECE_CODES,
} from './sources.mjs';
const ROOT = resolve(import.meta.dirname, '..');
if (!process.argv.includes('--initial'))
  throw new Error('Refuse to rewrite source-lock.json without one-time --initial');
const observed = requireObserved(
  /** @type {unknown} */ (
    JSON.parse(await readFile(resolve(ROOT, 'cache/sources/observed-sources.json'), 'utf8'))
  ),
);
/** @param {Record<string, string>} files */
const digest = (files) =>
  createHash('sha256')
    .update(
      Object.entries(files)
        .sort()
        .map(([n, h]) => `${n} ${h}`)
        .join('\n') + '\n',
    )
    .digest('hex');
/** @type {Record<string, import('./sources.mjs').Source & {files: Record<string, string>, sourceSha256: string}>} */
const families = {};
for (const [name, source] of Object.entries(FAMILIES)) {
  const files = observed.files[name];
  if (!files || Object.keys(files).length === 0) throw new Error(`Missing observed ${name}`);
  families[name] = { ...source, files, sourceSha256: digest(files) };
}
const lock = {
  schemaVersion: 1,
  classOrder: '1KQRBNPkqrbnp',
  pieceCodes: PIECE_CODES,
  splitSeeds: { train: 3830, dev: 3831, test: 3832 },
  splitSizes: { train: 4096, dev: 384, test: 384 },
  conditions: [
    { id: 'pristine', style: 'flat', reduction: 1, speckle: false },
    { id: 'hatch', style: 'hatch', reduction: 0.82, speckle: true },
    { id: 'low-fidelity', style: 'halftone', reduction: 0.64, speckle: true },
  ],
  archiveLimits: {
    maxDownloadBytes: 8388608,
    maxEntries: 16,
    maxExpandedBytes: 16384,
    forbidAbsoluteOrTraversal: true,
  },
  evidenceFiles: observed.evidence,
  externalSources: {
    femrekFiles: OGA_FILES,
    lyricszArchive: {
      url: LYRICSZ_ARCHIVE,
      sha256: LYRICSZ_ARCHIVE_SHA256,
      entries: observed.archive.entries,
    },
  },
  families,
  exclusions: {
    corpusV1: 'excluded from generation/training/dev/test/calibration/selection',
    firi: 'diagnostic only',
    rhosgfx: 'diagnostic only',
  },
  distributionReview:
    'Copyleft/share-alike artwork is cleared only for this local research; resulting-model distribution remains unresolved.',
};
await writeFile(resolve(ROOT, 'source-lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(`Locked ${Object.keys(families).length} artist groups`);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Record<string, string>} */
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** @param {unknown} value @returns {{files: Record<string, Record<string, string>>, evidence: Record<string, string>, archive: {entries: string[]}}} */
function requireObserved(value) {
  if (
    !isRecord(value) ||
    !isRecord(value['files']) ||
    !isStringRecord(value['evidence']) ||
    !isRecord(value['archive']) ||
    !Array.isArray(value['archive']['entries']) ||
    !value['archive']['entries'].every((item) => typeof item === 'string')
  )
    throw new Error('Observed source schema invalid');
  /** @type {Record<string, Record<string, string>>} */
  const files = {};
  for (const [name, entries] of Object.entries(value['files'])) {
    if (!isStringRecord(entries)) throw new Error(`Observed family ${name} invalid`);
    files[name] = entries;
  }
  return { files, evidence: value['evidence'], archive: { entries: value['archive']['entries'] } };
}
