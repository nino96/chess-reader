/** Freeze every declared candidate before opening held-out inference. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';

const root = import.meta.dirname;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid freeze input object');
  return value as Record<string, unknown>;
};
const readJson = async (path: string): Promise<Record<string, unknown>> =>
  object(JSON.parse(await readFile(path, 'utf8')) as unknown);
const runs = resolve(root, 'runs');
const data = resolve(root, 'data/full');
const protocolBytes = await readFile(resolve(root, 'protocol.json'));
const protocol = object(JSON.parse(protocolBytes.toString()) as unknown);
const full = object(protocol['full']);
const seeds = full['seeds'];
if (!Array.isArray(seeds) || JSON.stringify(seeds) !== '[3801,3802]')
  throw new Error('Predeclared seeds changed');
const protocolSha256 = hash(protocolBytes);
const datasetBytes = await readFile(resolve(data, 'dataset-manifest.json'));
const datasetSha256 = hash(datasetBytes);
const dataset = object(JSON.parse(datasetBytes.toString()) as unknown);
const testLockBytes = await readFile(resolve(root, 'manifests/test-lock-v1.json'));
const testLock = object(JSON.parse(testLockBytes.toString()) as unknown);
if (testLock['datasetManifestSha256'] !== datasetSha256 || testLock['role'] !== 'held-out-test')
  throw new Error('Pretraining held-out lock changed');
const testArtifacts = object(object(dataset['artifacts'])['test']);
const testVectors = object(testArtifacts['vectors']);
const testLabels = object(testArtifacts['labels']);
const vectors = await readFile(resolve(data, 'test.vectors.f32le'));
const labelsBytes = await readFile(resolve(data, 'test.labels.json'));
if (hash(vectors) !== testVectors['sha256'] || hash(labelsBytes) !== testLabels['sha256'])
  throw new Error('Held-out lock changed');
const labels = object(JSON.parse(labelsBytes.toString()) as unknown)['boards'];
if (!Array.isArray(labels) || labels.length !== full['testBoards'])
  throw new Error('Held-out count changed');
const browserManifest = {
  schemaVersion: 1,
  id: 'print-held-out-v1',
  role: 'held-out-test',
  dtype: 'float32-le',
  shape: [labels.length, 64, 1024],
  byteLength: vectors.length,
  sha256: hash(vectors),
  labels: labels.map((value: unknown) => {
    const board = object(value);
    if (
      typeof board['id'] !== 'string' ||
      !Array.isArray(board['labels']) ||
      board['labels'].length !== 64 ||
      !board['labels'].every(
        (label: unknown) =>
          typeof label === 'number' && Number.isInteger(label) && label >= 0 && label < 13,
      )
    )
      throw new Error('Invalid held-out labels');
    return { boardId: board['id'], classes: board['labels'] as number[] };
  }),
};
const manifestText = JSON.stringify(browserManifest, null, 2) + '\n';
const testManifestSha256 = hash(Buffer.from(manifestText));
const pilot = await readJson(resolve(runs, 'pilot/run-report.json'));
if (
  pilot['status'] !== 'completed' ||
  object(pilot['recovery'])['equivalent'] !== true ||
  pilot['protocolSha256'] !== protocolSha256
)
  throw new Error('Successful matching pilot required');
const candidates: {
  id: string;
  seed: number | null;
  modelPath: string;
  sha256: string;
  bytes: number;
}[] = [];
const reports: {
  seed: number;
  reportSha256: string;
  checkpointSha256: unknown;
  commit: unknown;
}[] = [];
for (const seed of seeds as number[]) {
  const runDir = resolve(runs, `full-${seed}`);
  const reportPath = resolve(runDir, 'run-report.json');
  const report = await readJson(reportPath);
  const run = object(report['run']);
  const model = object(report['model']);
  const environment = object(report['environment']);
  if (
    report['status'] !== 'completed' ||
    run['mode'] !== 'full' ||
    run['seed'] !== seed ||
    environment['device'] !== 'cuda' ||
    environment['cudaAvailable'] !== true ||
    environment['python'] !== '3.12.3' ||
    report['protocolSha256'] !== protocolSha256 ||
    run['epochs'] !== full['epochs'] ||
    typeof report['elapsedSeconds'] !== 'number' ||
    report['elapsedSeconds'] > Number(full['wallSecondsPerSeed']) ||
    object(model['onnxParity'])['passed'] !== true ||
    model['externalData'] !== false ||
    model['onnxChecker'] !== 'passed' ||
    model['cpuOnnxRuntime'] !== 'passed'
  )
    throw new Error('Incomplete candidate or failed export gate');
  const modelPath = resolve(runDir, 'candidate.onnx');
  const bytes = await readFile(modelPath);
  if (hash(bytes) !== model['sha256'] || bytes.length !== model['bytes'])
    throw new Error('Candidate changed after training');
  const checkpoint = object(report['checkpoint']);
  if (hash(await readFile(resolve(runDir, 'checkpoint.pt'))) !== checkpoint['sha256'])
    throw new Error('Checkpoint changed');
  for (const split of ['train', 'dev']) {
    const usedData = object(object(report['data'])[split]);
    const splitArtifacts = object(object(dataset['artifacts'])[split]);
    if (
      usedData['vectorSha256'] !== object(splitArtifacts['vectors'])['sha256'] ||
      usedData['labelsSha256'] !== object(splitArtifacts['labels'])['sha256'] ||
      usedData['datasetManifestSha256'] !== datasetSha256
    )
      throw new Error('Training or checkpoint-selection data lock differs');
  }
  candidates.push({
    id: `tilenet-full-${seed}`,
    seed,
    modelPath: relative(runs, modelPath),
    sha256: hash(bytes),
    bytes: bytes.length,
  });
  reports.push({
    seed,
    reportSha256: hash(await readFile(reportPath)),
    checkpointSha256: checkpoint['sha256'],
    commit: report['commit'],
  });
}
const fixtureRequire = createRequire(resolve(root, '../../packages/test-fixtures/package.json'));
const shippedPath = fixtureRequire.resolve('@scoriiu/fenshot/model/chess-tiles-v2.onnx');
const shippedBytes = await readFile(shippedPath);
if (hash(shippedBytes) !== '883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d')
  throw new Error('Shipped control changed');
candidates.unshift({
  id: 'shipped',
  seed: null,
  modelPath: relative(runs, shippedPath),
  sha256: hash(shippedBytes),
  bytes: shippedBytes.length,
});
await mkdir(runs, { recursive: true });
await writeFile(resolve(data, 'vectors.manifest.json'), manifestText, { flag: 'wx' });
const freeze = {
  schemaVersion: 1,
  runKind: 'full',
  frozenAt: new Date().toISOString(),
  protocolSha256,
  testManifestSha256,
  candidates,
};
await writeFile(resolve(runs, 'candidates.freeze.json'), JSON.stringify(freeze, null, 2) + '\n', {
  flag: 'wx',
});
// Portable review evidence omits local model paths. The executable freeze stays ignored.
await writeFile(
  resolve(runs, 'candidates.evidence.json'),
  JSON.stringify(
    {
      ...freeze,
      datasetSha256,
      pretrainingTestLockSha256: hash(testLockBytes),
      candidates: candidates.map(({ modelPath: _path, ...candidate }) => candidate),
      reports,
      freezeFileSha256: hash(await readFile(resolve(runs, 'candidates.freeze.json'))),
      heldOutVectorBytes: (await stat(resolve(data, 'test.vectors.f32le'))).size,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log('Both predeclared candidates frozen; held-out inference is now permitted.');
