import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadBrowserEvaluationConfig, sha256File } from './config';

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'recognition-browser-config-'));
  const modelPath = resolve(root, 'model.onnx');
  const vectorsPath = resolve(root, 'test.f32');
  const vectorManifestPath = resolve(root, 'test.vectors.manifest.json');
  const freezePath = resolve(root, 'candidates.freeze.json');
  const configPath = resolve(root, 'local-config.json');
  writeFileSync(modelPath, new Uint8Array([1]));
  writeFileSync(vectorsPath, new Uint8Array(64 * 1024 * 4));
  writeJson(vectorManifestPath, {
    schemaVersion: 1,
    id: 'locked-test',
    role: 'held-out-test',
    dtype: 'float32-le',
    shape: [1, 64, 1024],
    byteLength: 64 * 1024 * 4,
    sha256: sha256File(vectorsPath),
    labels: [{ boardId: 'board-1', classes: Array<number>(64).fill(0) }],
  });
  const candidate = (id: string, seed: number | null) => ({
    id,
    seed,
    modelPath: 'model.onnx',
    sha256: sha256File(modelPath),
    bytes: 1,
  });
  writeJson(freezePath, {
    schemaVersion: 1,
    runKind: 'full',
    frozenAt: '2026-09-05T00:00:00.000Z',
    protocolSha256: 'a'.repeat(64),
    testManifestSha256: sha256File(vectorManifestPath),
    candidates: [
      candidate('shipped', null),
      candidate('tilenet-3801', 3801),
      candidate('tilenet-3802', 3802),
    ],
  });
  writeJson(configPath, {
    schemaVersion: 1,
    freezeManifestPath: 'candidates.freeze.json',
    vectorSets: [{ manifestPath: 'test.vectors.manifest.json', vectorsPath: 'test.f32' }],
    outputDirectory: 'results',
    coldSessions: 3,
    warmRepeats: 3,
    timeoutMs: 60_000,
  });
  return { configPath, vectorManifestPath };
}

describe('browser evaluation frozen configuration', () => {
  it('accepts the exact full-run seeds and locked held-out manifest', () => {
    const input = fixture();
    const config = loadBrowserEvaluationConfig(input.configPath);
    expect(config.freeze.candidates.map(({ seed }) => seed)).toEqual([null, 3801, 3802]);
    expect(config.vectorSets[0]?.manifest.role).toBe('held-out-test');
  });

  it('rejects a held-out manifest changed after the candidate freeze', () => {
    const input = fixture();
    writeFileSync(input.vectorManifestPath, '{}\n', 'utf8');
    expect(() => loadBrowserEvaluationConfig(input.configPath)).toThrow();
  });
});
