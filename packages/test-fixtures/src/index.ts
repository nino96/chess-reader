/**
 * Entry point for the fixture corpus. Fixture ids, paths, and expectations are
 * defined by `manifest.json` (schema: docs/fixtures.md §5); this module resolves
 * paths and provides a runtime-validated loader so no consumer has to hand-parse
 * or hand-trust the manifest's JSON shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function fixturePath(relativePath: string): string {
  return resolve(FIXTURES_ROOT, relativePath);
}

/** One of the three provenance kinds a fixture may declare (docs/fixtures.md §1). */
export type FixtureSourceKind = 'synthetic' | 'public-domain' | 'licensed';

export interface FixtureSource {
  readonly kind: FixtureSourceKind;
  /** Present when `kind` is generated in-repo; mutually exclusive with `url`. */
  readonly generator?: string;
  /** Present when `kind` was fetched from an external source; mutually exclusive
   *  with `generator`. */
  readonly url?: string;
  readonly license: string;
  /** ISO 8601 date (`YYYY-MM-DD`). */
  readonly retrieved: string;
}

export type FixtureContentType =
  'application/pdf' | 'application/epub+zip' | 'image/png' | 'image/jpeg' | 'application/json';

/**
 * One fixture's manifest entry. `expected` and `tolerance` are intentionally loose
 * (`docs/fixtures.md` §5 keeps them suite-specific, e.g. rectangles for a reader
 * fixture vs. FEN/perft counts for a chess fixture): a consumer narrows the shape
 * it needs at the point of use rather than this module inventing a second schema.
 */
export interface FixtureEntry {
  readonly id: string;
  readonly sha256: string;
  readonly path: string;
  readonly contentType: FixtureContentType;
  readonly source: FixtureSource;
  readonly tags: readonly string[];
  readonly expected: Readonly<Record<string, unknown>>;
  readonly tolerance: Readonly<Record<string, unknown>>;
  readonly limitations: readonly string[];
  readonly consumers: readonly string[];
  readonly addedInIssue: number;
}

export interface FixtureManifest {
  readonly schemaVersion: 1;
  readonly fixtures: readonly FixtureEntry[];
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTENT_TYPES: readonly FixtureContentType[] = [
  'application/pdf',
  'application/epub+zip',
  'image/png',
  'image/jpeg',
  'application/json',
];
const SOURCE_KINDS: readonly FixtureSourceKind[] = ['synthetic', 'public-domain', 'licensed'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Throws with a path-qualified message; keeps every validation failure actionable. */
function fail(path: string, message: string): never {
  throw new Error(`Invalid fixture manifest at ${path}: ${message}`);
}

function validateSource(value: unknown, path: string): asserts value is FixtureSource {
  if (!isPlainObject(value)) {
    fail(path, 'expected an object');
  }
  const allowedKeys = new Set(['kind', 'generator', 'url', 'license', 'retrieved']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`${path}.${key}`, 'unexpected property');
    }
  }
  const kind = value['kind'];
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind as FixtureSourceKind)) {
    fail(`${path}.kind`, `must be one of ${SOURCE_KINDS.join(', ')}`);
  }
  const license = value['license'];
  if (typeof license !== 'string' || license.length === 0) {
    fail(`${path}.license`, 'must be a non-empty string');
  }
  const retrieved = value['retrieved'];
  if (typeof retrieved !== 'string' || !DATE_PATTERN.test(retrieved)) {
    fail(`${path}.retrieved`, 'must be a YYYY-MM-DD date string');
  }
  const generator = value['generator'];
  const url = value['url'];
  const hasGenerator = generator !== undefined;
  const hasUrl = url !== undefined;
  if (hasGenerator === hasUrl) {
    fail(path, 'must set exactly one of "generator" or "url"');
  }
  if (hasGenerator && (typeof generator !== 'string' || generator.length === 0)) {
    fail(`${path}.generator`, 'must be a non-empty string');
  }
  if (hasUrl && (typeof url !== 'string' || url.length === 0)) {
    fail(`${path}.url`, 'must be a non-empty string');
  }
}

const FIXTURE_REQUIRED_KEYS = [
  'id',
  'sha256',
  'path',
  'contentType',
  'source',
  'tags',
  'expected',
  'tolerance',
  'limitations',
  'consumers',
  'addedInIssue',
] as const;

function validateFixture(value: unknown, path: string): asserts value is FixtureEntry {
  if (!isPlainObject(value)) {
    fail(path, 'expected an object');
  }
  const allowedKeys = new Set<string>(FIXTURE_REQUIRED_KEYS);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`${path}.${key}`, 'unexpected property');
    }
  }
  for (const key of FIXTURE_REQUIRED_KEYS) {
    if (!(key in value)) {
      fail(path, `missing required property "${key}"`);
    }
  }

  const id = value['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    fail(`${path}.id`, 'must be lower-kebab-case (e.g. "pdf-scanned-rotated-90")');
  }
  const sha256 = value['sha256'];
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    fail(`${path}.sha256`, 'must be a 64-character lowercase hex string');
  }
  const fixturePathValue = value['path'];
  if (typeof fixturePathValue !== 'string' || fixturePathValue.length === 0) {
    fail(`${path}.path`, 'must be a non-empty string');
  }
  const contentType = value['contentType'];
  if (
    typeof contentType !== 'string' ||
    !CONTENT_TYPES.includes(contentType as FixtureContentType)
  ) {
    fail(`${path}.contentType`, `must be one of ${CONTENT_TYPES.join(', ')}`);
  }
  validateSource(value['source'], `${path}.source`);
  const tags = value['tags'];
  if (!isStringArray(tags) || tags.length === 0) {
    fail(`${path}.tags`, 'must be a non-empty array of strings');
  }
  if (!isPlainObject(value['expected'])) {
    fail(`${path}.expected`, 'must be an object');
  }
  if (!isPlainObject(value['tolerance'])) {
    fail(`${path}.tolerance`, 'must be an object');
  }
  const limitations = value['limitations'];
  if (!isStringArray(limitations)) {
    fail(`${path}.limitations`, 'must be an array of strings');
  }
  const consumers = value['consumers'];
  if (!isStringArray(consumers) || consumers.length === 0) {
    fail(`${path}.consumers`, 'must be a non-empty array of strings');
  }
  const addedInIssue = value['addedInIssue'];
  if (typeof addedInIssue !== 'number' || !Number.isInteger(addedInIssue) || addedInIssue < 1) {
    fail(`${path}.addedInIssue`, 'must be a positive integer');
  }
}

/**
 * Parses and validates `manifest.json` against the schema in `docs/fixtures.md` §5
 * (mirrored, byte-for-byte, in `manifest.schema.json`). Throws a descriptive `Error`
 * naming the offending field on any shape mismatch rather than returning a
 * partially-trusted value.
 */
export function loadManifest(): FixtureManifest {
  const raw = readFileSync(fixturePath('manifest.json'), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`manifest.json is not valid JSON: ${message}`);
  }

  if (!isPlainObject(parsed)) {
    fail('$', 'expected an object');
  }
  const allowedKeys = new Set(['schemaVersion', 'fixtures']);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      fail(`$.${key}`, 'unexpected property');
    }
  }
  if (parsed['schemaVersion'] !== 1) {
    fail('$.schemaVersion', 'must be exactly 1');
  }
  const fixtures = parsed['fixtures'];
  if (!Array.isArray(fixtures)) {
    fail('$.fixtures', 'must be an array');
  }
  fixtures.forEach((fixture, index) => {
    validateFixture(fixture, `$.fixtures[${String(index)}]`);
  });

  const ids = new Set<string>();
  for (const fixture of fixtures as FixtureEntry[]) {
    if (ids.has(fixture.id)) {
      fail('$.fixtures', `duplicate fixture id "${fixture.id}"`);
    }
    ids.add(fixture.id);
  }

  return { schemaVersion: 1, fixtures: fixtures as FixtureEntry[] };
}

/** Looks up one fixture by id. Throws a descriptive error when it is not present. */
export function getFixture(id: string): FixtureEntry {
  const manifest = loadManifest();
  const fixture = manifest.fixtures.find((entry) => entry.id === id);
  if (!fixture) {
    const known = manifest.fixtures.map((entry) => entry.id).join(', ') || '(none)';
    throw new Error(`No fixture with id "${id}" in manifest.json. Known ids: ${known}`);
  }
  return fixture;
}
