import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const CLASS_LABELS = '1KQRBNPkqrbnp';
export const BOARD_TILE_VALUES = 64 * 1024;

export type VectorRole = 'development' | 'held-out-test' | 'corpus-v1-regression';

export interface CandidateIdentity {
  readonly id: string;
  readonly seed: number | null;
  readonly modelPath: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface CandidateFreeze {
  readonly schemaVersion: 1;
  readonly runKind: 'pilot' | 'full';
  readonly frozenAt: string;
  readonly protocolSha256: string;
  readonly testManifestSha256: string | null;
  readonly candidates: readonly CandidateIdentity[];
}

export interface BoardLabels {
  readonly boardId: string;
  readonly classes: readonly number[];
}

export interface VectorManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly role: VectorRole;
  readonly dtype: 'float32-le';
  readonly shape: readonly [number, 64, 1024];
  readonly byteLength: number;
  readonly sha256: string;
  readonly labels: readonly BoardLabels[];
}

export interface VectorSetConfig {
  readonly manifestPath: string;
  readonly vectorsPath: string;
  readonly manifest: VectorManifest;
}

export interface BrowserEvaluationConfig {
  readonly schemaVersion: 1;
  readonly configPath: string;
  readonly freezeManifestPath: string;
  readonly freeze: CandidateFreeze;
  readonly vectorSets: readonly VectorSetConfig[];
  readonly outputDirectory: string;
  readonly coldSessions: number;
  readonly warmRepeats: number;
  readonly timeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key)
  );
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function finiteInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

function parseCandidate(value: unknown, base: string): CandidateIdentity {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['id', 'seed', 'modelPath', 'sha256', 'bytes']) ||
    !safeId(value.id) ||
    !(value.seed === null || finiteInteger(value.seed, 0)) ||
    typeof value.modelPath !== 'string' ||
    !SHA256_PATTERN.test(String(value.sha256)) ||
    !finiteInteger(value.bytes, 1)
  ) {
    throw new Error('Invalid candidate freeze entry');
  }
  const modelPath = resolve(base, value.modelPath);
  if (statSync(modelPath).size !== value.bytes || sha256File(modelPath) !== value.sha256) {
    throw new Error(`Candidate ${value.id} model bytes do not match its frozen identity`);
  }
  return {
    id: value.id,
    seed: value.seed,
    modelPath,
    sha256: value.sha256,
    bytes: value.bytes,
  };
}

export function parseCandidateFreeze(path: string): CandidateFreeze {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'runKind',
      'frozenAt',
      'protocolSha256',
      'testManifestSha256',
      'candidates',
    ]) ||
    value.schemaVersion !== 1 ||
    (value.runKind !== 'pilot' && value.runKind !== 'full') ||
    typeof value.frozenAt !== 'string' ||
    !Number.isFinite(Date.parse(value.frozenAt)) ||
    !SHA256_PATTERN.test(String(value.protocolSha256)) ||
    !(
      value.testManifestSha256 === null ||
      (typeof value.testManifestSha256 === 'string' &&
        SHA256_PATTERN.test(value.testManifestSha256))
    ) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0
  ) {
    throw new Error('Invalid candidates.freeze.json');
  }
  const candidates = value.candidates.map((candidate) => parseCandidate(candidate, dirname(path)));
  if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) {
    throw new Error('Candidate ids must be unique');
  }
  const seeds = candidates.map(({ seed }) => seed);
  if (value.runKind === 'full') {
    const expectedSeeds: readonly (number | null)[] = [null, 3811, 3812];
    if (
      seeds.length !== expectedSeeds.length ||
      !expectedSeeds.every((seed) => seeds.includes(seed)) ||
      value.testManifestSha256 === null
    ) {
      throw new Error(
        'Full freeze must contain shipped, seed 3811 and seed 3812 plus the test lock',
      );
    }
    const control = candidates.find(({ seed }) => seed === null);
    if (control?.id !== 'shipped') throw new Error('The null-seed control must have id "shipped"');
  }
  return {
    schemaVersion: 1,
    runKind: value.runKind,
    frozenAt: value.frozenAt,
    protocolSha256: value.protocolSha256 as string,
    testManifestSha256: value.testManifestSha256,
    candidates,
  };
}

function parseBoardLabels(value: unknown): BoardLabels {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['boardId', 'classes']) ||
    !safeId(value.boardId) ||
    !Array.isArray(value.classes) ||
    value.classes.length !== 64 ||
    !value.classes.every((item) => finiteInteger(item, 0) && item < CLASS_LABELS.length)
  ) {
    throw new Error('Invalid vector board labels');
  }
  return { boardId: value.boardId, classes: value.classes as number[] };
}

export function parseVectorManifest(path: string, vectorsPath: string): VectorManifest {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'id',
      'role',
      'dtype',
      'shape',
      'byteLength',
      'sha256',
      'labels',
    ]) ||
    value.schemaVersion !== 1 ||
    !safeId(value.id) ||
    !['development', 'held-out-test', 'corpus-v1-regression'].includes(String(value.role)) ||
    value.dtype !== 'float32-le' ||
    !Array.isArray(value.shape) ||
    value.shape.length !== 3 ||
    !finiteInteger(value.shape[0], 1) ||
    value.shape[1] !== 64 ||
    value.shape[2] !== 1024 ||
    !finiteInteger(value.byteLength, 1) ||
    !SHA256_PATTERN.test(String(value.sha256)) ||
    !Array.isArray(value.labels)
  ) {
    throw new Error('Invalid vector manifest');
  }
  const labels = value.labels.map(parseBoardLabels);
  const boardCount = value.shape[0];
  const expectedBytes = boardCount * BOARD_TILE_VALUES * Float32Array.BYTES_PER_ELEMENT;
  if (
    labels.length !== boardCount ||
    new Set(labels.map(({ boardId }) => boardId)).size !== labels.length ||
    value.byteLength !== expectedBytes ||
    statSync(vectorsPath).size !== expectedBytes ||
    sha256File(vectorsPath) !== value.sha256
  ) {
    throw new Error(`Vector bytes or board identities do not match manifest ${value.id}`);
  }
  return {
    schemaVersion: 1,
    id: value.id,
    role: value.role as VectorRole,
    dtype: 'float32-le',
    shape: [boardCount, 64, 1024],
    byteLength: value.byteLength,
    sha256: value.sha256,
    labels,
  };
}

export function loadBrowserEvaluationConfig(path: string): BrowserEvaluationConfig {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'freezeManifestPath',
      'vectorSets',
      'outputDirectory',
      'coldSessions',
      'warmRepeats',
      'timeoutMs',
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.freezeManifestPath !== 'string' ||
    !Array.isArray(value.vectorSets) ||
    value.vectorSets.length === 0 ||
    typeof value.outputDirectory !== 'string' ||
    !finiteInteger(value.coldSessions, 1) ||
    value.coldSessions !== 3 ||
    !finiteInteger(value.warmRepeats, 2) ||
    value.warmRepeats > 20 ||
    !finiteInteger(value.timeoutMs, 1_000) ||
    value.timeoutMs > 300_000
  ) {
    throw new Error('Invalid browser local-config.json');
  }
  const base = dirname(path);
  const freezeManifestPath = resolve(base, value.freezeManifestPath);
  const freeze = parseCandidateFreeze(freezeManifestPath);
  const vectorSets = value.vectorSets.map((entry): VectorSetConfig => {
    if (
      !isRecord(entry) ||
      !exactKeys(entry, ['manifestPath', 'vectorsPath']) ||
      typeof entry.manifestPath !== 'string' ||
      typeof entry.vectorsPath !== 'string'
    ) {
      throw new Error('Invalid vector set configuration');
    }
    const manifestPath = resolve(base, entry.manifestPath);
    const vectorsPath = resolve(base, entry.vectorsPath);
    return {
      manifestPath,
      vectorsPath,
      manifest: parseVectorManifest(manifestPath, vectorsPath),
    };
  });
  if (new Set(vectorSets.map(({ manifest }) => manifest.id)).size !== vectorSets.length) {
    throw new Error('Vector set ids must be unique');
  }
  if (freeze.runKind === 'full') {
    const testSets = vectorSets.filter(({ manifest }) => manifest.role === 'held-out-test');
    if (
      testSets.length !== 1 ||
      sha256File(testSets[0]?.manifestPath ?? '') !== freeze.testManifestSha256
    ) {
      throw new Error('Full run held-out test manifest does not match the frozen test lock');
    }
  }
  return {
    schemaVersion: 1,
    configPath: resolve(path),
    freezeManifestPath,
    freeze,
    vectorSets,
    outputDirectory: resolve(base, value.outputDirectory),
    coldSessions: value.coldSessions,
    warmRepeats: value.warmRepeats,
    timeoutMs: value.timeoutMs,
  };
}
