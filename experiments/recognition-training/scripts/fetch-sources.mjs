#!/usr/bin/env node
// @ts-check

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LILA_REVISION, PIECE_CODES, SOURCE_FAMILIES } from '../source-lock.mjs';
import { parseArguments, resolveExperimentPath, verifySourceCache } from './protocol.mjs';

const args = parseArguments(process.argv.slice(2));
const cacheArgument = args['cache'];
if (cacheArgument !== undefined && typeof cacheArgument !== 'string')
  throw new Error('--cache needs a path');
const cacheRoot = resolveExperimentPath(cacheArgument ?? 'data/source-cache');
const sourceRoot = `https://raw.githubusercontent.com/lichess-org/lila/${LILA_REVISION}`;

/** @param {string} relativePath */
async function fetchPinned(relativePath) {
  const response = await fetch(`${sourceRoot}/${relativePath}`, { redirect: 'error' });
  if (!response.ok) throw new Error(`Could not fetch ${relativePath}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

await mkdir(cacheRoot, { recursive: true });
const copyingTemporary = resolve(cacheRoot, '.lila-COPYING.md.tmp');
await writeFile(copyingTemporary, await fetchPinned('COPYING.md'));
await rename(copyingTemporary, resolve(cacheRoot, 'lila-COPYING.md'));

for (const [family, source] of Object.entries(SOURCE_FAMILIES)) {
  const familyRoot = resolve(cacheRoot, family);
  await mkdir(familyRoot, { recursive: true });
  for (const code of PIECE_CODES) {
    const temporary = resolve(familyRoot, `.${code}.svg.tmp`);
    await writeFile(temporary, await fetchPinned(`${source.lilaPath}/${code}.svg`));
    await rename(temporary, resolve(familyRoot, `${code}.svg`));
  }
}

const hashes = await verifySourceCache(cacheRoot);
console.log(JSON.stringify({ cacheRoot, verifiedSourceHashes: hashes }, null, 2));
