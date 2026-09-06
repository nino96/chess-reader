#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  FAMILIES,
  LILA_REVISION,
  LIVIUS_REVISION,
  LYRICSZ_ARCHIVE,
  LYRICSZ_ARCHIVE_SHA256,
  OGA_FILES,
  PIECE_CODES,
} from './sources.mjs';
const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const CACHE = resolve(ROOT, 'cache/sources');
/** @param {Uint8Array | string} b */
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** @param {string} url */
async function get(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for approved public source`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024)
    throw new Error('Source byte limit failed');
  return bytes;
}
/** @param {string} path @param {Uint8Array} bytes */
async function put(path, bytes) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}
/** @param {string} path @param {string} url */
async function cachedOrGet(path, url) {
  try {
    return await readFile(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const bytes = await get(url);
  await put(path, bytes);
  return bytes;
}
for (const [family, source] of Object.entries(FAMILIES)) {
  if (source.kind === 'lila-svg')
    for (const code of PIECE_CODES)
      await cachedOrGet(
        resolve(CACHE, family, `${code}.svg`),
        `https://raw.githubusercontent.com/lichess-org/lila/${LILA_REVISION}/public/piece/${requirePath(source)}/${code}.svg`,
      );
  if (source.kind === 'github-svg')
    for (const code of PIECE_CODES)
      await cachedOrGet(
        resolve(CACHE, family, `${code}.svg`),
        `https://raw.githubusercontent.com/kmar/chess_svg_piece_sets/${LIVIUS_REVISION}/livius/${code.toLowerCase()}.svg`,
      );
}
for (const [piece, url] of Object.entries(OGA_FILES))
  await cachedOrGet(resolve(CACHE, 'femrek', `${piece}.svg`), url);
const evidenceUrls = {
  'lila-COPYING.md': `https://raw.githubusercontent.com/lichess-org/lila/${LILA_REVISION}/COPYING.md`,
  'livius-README.md': `https://raw.githubusercontent.com/kmar/chess_svg_piece_sets/${LIVIUS_REVISION}/README.md`,
  'livius-LICENSE': `https://raw.githubusercontent.com/kmar/chess_svg_piece_sets/${LIVIUS_REVISION}/livius/LICENSE`,
  'femrek-page.html': requireFamily('femrek').sourcePage,
  'lyricsz-page.html': requireFamily('lyricsz').sourcePage,
};
for (const [name, url] of Object.entries(evidenceUrls))
  await cachedOrGet(resolve(CACHE, '_evidence', name), url);
const archive = await cachedOrGet(resolve(CACHE, '_archives/lyricsz-chess.zip'), LYRICSZ_ARCHIVE);
if (sha(archive) !== LYRICSZ_ARCHIVE_SHA256) throw new Error('Lyricsz archive identity changed');
await put(resolve(CACHE, '_archives/lyricsz-chess.zip'), archive);
const { stdout } = await execFileAsync('unzip', [
  '-Z1',
  resolve(CACHE, '_archives/lyricsz-chess.zip'),
]);
const names = stdout.trim().split('\n');
if (JSON.stringify(names) !== JSON.stringify(['chess.png', 'chess1.png', 'chess2.png']))
  throw new Error('Unexpected archive paths');
const listing = await execFileAsync('unzip', ['-l', resolve(CACHE, '_archives/lyricsz-chess.zip')]);
const sizes = [
  ...listing.stdout.matchAll(/^\s+(\d+)\s+\d{4}-\d\d-\d\d.*\s(chess(?:1|2)?\.png)$/gm),
].map((m) => Number(m[1]));
if (sizes.length !== 3 || sizes.reduce((a, b) => a + b, 0) > 16_384)
  throw new Error('Archive size/count limit failed');
await mkdir(resolve(CACHE, 'lyricsz'), { recursive: true });
await execFileAsync('unzip', [
  '-oq',
  resolve(CACHE, '_archives/lyricsz-chess.zip'),
  'chess1.png',
  'chess2.png',
  '-d',
  resolve(CACHE, 'lyricsz'),
]);
/** @type {Record<string, Record<string, string>>} */
const files = {};
for (const family of Object.keys(FAMILIES)) {
  const dir = resolve(CACHE, family);
  /** @type {Record<string, string>} */
  const familyFiles = {};
  for (const name of (await readdir(dir)).sort())
    familyFiles[name] = sha(await readFile(resolve(dir, name)));
  files[family] = familyFiles;
}
/** @type {Record<string, string>} */
const evidence = {};
/** @type {Record<string, string>} */
const evidenceText = {};
for (const name of Object.keys(evidenceUrls).sort()) {
  evidence[name] = sha(await readFile(resolve(CACHE, '_evidence', name)));
  evidenceText[name] = await readFile(resolve(CACHE, '_evidence', name), 'utf8');
}
if (
  !requireText(evidenceText, 'femrek-page.html').includes('femrek') ||
  !requireText(evidenceText, 'femrek-page.html').includes('CC0')
)
  throw new Error('Femrek page snapshot lacks author/license proof');
if (
  !requireText(evidenceText, 'lyricsz-page.html').includes('Lyricsz') ||
  !requireText(evidenceText, 'lyricsz-page.html').includes('CC0')
)
  throw new Error('Lyricsz page snapshot lacks author/license proof');
if (
  !requireText(evidenceText, 'livius-README.md').toLowerCase().includes('cc0') ||
  !requireText(evidenceText, 'livius-README.md').includes('original design')
)
  throw new Error('Livius provenance proof changed');
if (
  !requireText(evidenceText, 'lila-COPYING.md').includes('public/piece/totoy') ||
  !requireText(evidenceText, 'lila-COPYING.md').includes('public/piece/papercut')
)
  throw new Error('Lila attribution proof changed');
await writeFile(
  resolve(CACHE, 'observed-sources.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      archive: { url: LYRICSZ_ARCHIVE, sha256: sha(archive), entries: names },
      evidence,
      files,
    },
    null,
    2,
  ) + '\n',
);
try {
  const parsed = /** @type {unknown} */ (
    JSON.parse(await readFile(resolve(ROOT, 'source-lock.json'), 'utf8'))
  );
  const lock = requireLock(parsed);
  if (JSON.stringify(lock.evidenceFiles) !== JSON.stringify(evidence))
    throw new Error('Evidence differs from source lock');
  for (const [family, source] of Object.entries(lock.families))
    if (JSON.stringify(source.files) !== JSON.stringify(files[family]))
      throw new Error(`${family} differs from source lock`);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
console.log(JSON.stringify({ families: Object.keys(files).length, archiveSha256: sha(archive) }));

/** @param {import('./sources.mjs').Source} source */
function requirePath(source) {
  if (typeof source.path !== 'string' || !source.path) throw new Error('Lila source path missing');
  return source.path;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {{evidenceFiles: Record<string, string>, families: Record<string, {files: Record<string, string>}>}} */
function requireLock(value) {
  if (!isRecord(value) || !isStringRecord(value['evidenceFiles']) || !isRecord(value['families']))
    throw new Error('Source lock schema invalid');
  /** @type {Record<string, {files: Record<string, string>}>} */
  const families = {};
  for (const [name, source] of Object.entries(value['families'])) {
    if (!isRecord(source) || !isStringRecord(source['files']))
      throw new Error(`Source lock family ${name} invalid`);
    families[name] = { files: source['files'] };
  }
  return { evidenceFiles: value['evidenceFiles'], families };
}

/** @param {unknown} value @returns {value is Record<string, string>} */
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** @param {string} name */
function requireFamily(name) {
  const source = FAMILIES[name];
  if (!source) throw new Error(`Missing source family ${name}`);
  return source;
}

/** @param {Record<string, string>} values @param {string} name */
function requireText(values, name) {
  const value = values[name];
  if (value === undefined) throw new Error(`Missing evidence ${name}`);
  return value;
}
