/** Prepare ignored browser input manifests; never run inference or select weights. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const mode = process.argv[2];
if (mode !== 'pilot' && mode !== 'full') throw new Error('Usage: prepare-browser.ts pilot|full');
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid browser preparation input');
  return value as Record<string, unknown>;
};
const readJson = async (path: string): Promise<Record<string, unknown>> =>
  object(JSON.parse(await readFile(resolve(root, path), 'utf8')) as unknown);
await mkdir(resolve(root, 'runs'), { recursive: true });
if (mode === 'pilot') {
  const report = await readJson('runs/pilot/run-report.json');
  if (report['status'] !== 'completed' || object(report['run'])['seed'] !== 381)
    throw new Error('Successful pilot required');
  const labels = await readJson('data/full/dev.labels.json');
  if (labels['split'] !== 'dev' || !Array.isArray(labels['boards']))
    throw new Error('Development inputs required');
  const boards = (labels['boards'] as unknown[]).slice(0, 16).map((value) => {
    const board = object(value);
    return { boardId: board['id'], classes: board['labels'] };
  });
  const vectors = (await readFile(resolve(root, 'data/full/dev.vectors.f32le'))).subarray(
    0,
    16 * 64 * 1024 * 4,
  );
  const manifest = {
    schemaVersion: 1,
    id: 'pilot-development',
    role: 'development',
    dtype: 'float32-le',
    shape: [16, 64, 1024],
    byteLength: vectors.length,
    sha256: hash(vectors),
    labels: boards,
  };
  await writeFile(resolve(root, 'runs/pilot-development.f32'), vectors);
  await writeFile(
    resolve(root, 'runs/pilot-development.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  const model = await readFile(resolve(root, 'runs/pilot/candidate.onnx'));
  if (hash(model) !== object(report['model'])['sha256']) throw new Error('Pilot export changed');
  await mkdir(resolve(root, 'runs/pilot-browser'), { recursive: true });
  await writeFile(
    resolve(root, 'runs/pilot-browser/candidates.freeze.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        runKind: 'pilot',
        frozenAt: new Date().toISOString(),
        protocolSha256: hash(await readFile(resolve(root, 'protocol.json'))),
        testManifestSha256: null,
        candidates: [
          {
            id: 'tilenet-pilot-381',
            seed: 381,
            modelPath: '../pilot/candidate.onnx',
            sha256: hash(model),
            bytes: model.length,
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
const config = {
  schemaVersion: 1,
  freezeManifestPath:
    mode === 'pilot' ? 'pilot-browser/candidates.freeze.json' : 'candidates.freeze.json',
  vectorSets:
    mode === 'pilot'
      ? [{ manifestPath: 'pilot-development.json', vectorsPath: 'pilot-development.f32' }]
      : [
          {
            manifestPath: '../data/full/vectors.manifest.json',
            vectorsPath: '../data/full/test.vectors.f32le',
          },
          {
            manifestPath: '../data/regression/vectors.manifest.json',
            vectorsPath: '../data/regression/regression.vectors.f32le',
          },
        ],
  outputDirectory: mode === 'pilot' ? 'browser-pilot' : 'browser-results',
  coldSessions: 3,
  warmRepeats: 3,
  timeoutMs: 60000,
};
await writeFile(
  resolve(root, `runs/browser-${mode}.config.json`),
  JSON.stringify(config, null, 2) + '\n',
);
console.log(`Prepared ${mode} browser configuration without inference.`);
