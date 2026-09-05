import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
void test('source lock contains 12 complete, artist-disjoint groups', async () => {
  const parsed = /** @type {unknown} */ (
    JSON.parse(await readFile(new URL('../source-lock.json', import.meta.url), 'utf8'))
  );
  const lock = requireLock(parsed);
  assert.equal(Object.keys(lock.families).length, 12);
  const artists = new Set();
  for (const source of Object.values(lock.families)) {
    assert.ok(source.artistGroup);
    assert.ok(source.license);
    assert.ok(source.sourceSha256);
    assert.ok(!artists.has(source.artistGroup));
    artists.add(source.artistGroup);
    if (source.kind === 'oga-single-color-svg') assert.equal(Object.keys(source.files).length, 6);
    else if (source.kind === 'oga-png-archive') assert.equal(Object.keys(source.files).length, 2);
    else assert.equal(Object.keys(source.files).length, 12);
  }
  assert.match(lock.exclusions.corpusV1, /excluded/);
});

/** @param {unknown} value @returns {{families: Record<string, {artistGroup: string, license: string, sourceSha256: string, kind: string, files: Record<string, string>}>, exclusions: {corpusV1: string}}} */
function requireLock(value) {
  if (
    !isRecord(value) ||
    !isRecord(value['families']) ||
    !isRecord(value['exclusions']) ||
    typeof value['exclusions']['corpusV1'] !== 'string'
  )
    throw new Error('Invalid source lock');
  /** @type {Record<string, {artistGroup: string, license: string, sourceSha256: string, kind: string, files: Record<string, string>}>} */
  const families = {};
  for (const [name, source] of Object.entries(value['families'])) {
    if (
      !isRecord(source) ||
      typeof source['artistGroup'] !== 'string' ||
      typeof source['license'] !== 'string' ||
      typeof source['sourceSha256'] !== 'string' ||
      typeof source['kind'] !== 'string' ||
      !isStringRecord(source['files'])
    )
      throw new Error(`Invalid source family ${name}`);
    families[name] = {
      artistGroup: source['artistGroup'],
      license: source['license'],
      sourceSha256: source['sourceSha256'],
      kind: source['kind'],
      files: source['files'],
    };
  }
  return { families, exclusions: { corpusV1: value['exclusions']['corpusV1'] } };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Record<string, string>} */
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}
