/** Publish only held-out identities/provenance, never inference or labels. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = import.meta.dirname;
const bytes = await readFile(resolve(root, 'manifests/dataset-v2.json'));
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid data lock');
  return value as Record<string, unknown>;
};
const data = object(JSON.parse(bytes.toString()) as unknown);
const test = object(object(data['artifacts'])['test']);
const vectors = object(test['vectors']);
if (JSON.stringify(vectors['shape']) !== '[256,64,1024]')
  throw new Error('Held-out recipe size changed');
const source = object(object(data['sources'])['rhosgfx']);
if (source['split'] !== 'test' || source['license'] !== 'CC0-1.0')
  throw new Error('Held-out source family changed');
const result = {
  schemaVersion: 1,
  role: 'held-out-test',
  id: 'print-held-out-v2',
  command: 'node experiments/recognition-training/v2/lock-test.ts',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  datasetManifestSha256: createHash('sha256').update(bytes).digest('hex'),
  classOrder: data['classOrder'],
  tileOrder: data['tileOrder'],
  dtype: data['dtype'],
  vectors,
  labels: test['labels'],
  familyMembership: ['rhosgfx'],
  source,
  sourceRevision: '2e48c25007bc3344411811a24cd6cab666c67cbf',
  sourceUrl:
    'https://github.com/lichess-org/lila/tree/2e48c25007bc3344411811a24cd6cab666c67cbf/public/piece/rhosgfx',
  generator: data['generator'],
  generatorLock: data['generatorLock'],
  policy:
    'No checkpoint selection, tuning, early stopping or inference until both predeclared full-run candidates are frozen.',
};
await writeFile(
  resolve(root, 'manifests/test-lock-v2.json'),
  JSON.stringify(result, null, 2) + '\n',
  { flag: 'wx' },
);
console.log('Held-out source, family membership and tensor identities locked without inference.');
