/** Pure validation for the immutable issue #38 freeze boundary. */

export const CANONICAL_DATASET_MANIFEST_SHA256 =
  '10b347f5f88693fd18d63b49b4b2f81156cf673820145c82949e1d425743a401';
export const CANONICAL_TEST_LOCK_SHA256 =
  '403c413a58df489b3879fd386859a282d7497d3546b28a74fcef684f0ab7b414';
export const CLASS_ORDER = '1KQRBNPkqrbnp';
export const TEST_SHAPE = [256, 64, 1024] as const;

type RecordValue = Record<string, unknown>;

const record = (value: unknown, name: string): RecordValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as RecordValue;
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const requireEqual = (actual: unknown, expected: unknown, name: string): void => {
  if (!sameJson(actual, expected)) throw new Error(`${name} differs from the canonical lock`);
};

const requireSha256 = (value: unknown, name: string): void => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${name} must be a SHA-256 hex digest`);
};

const requireNonnegativeInteger = (value: unknown, name: string): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
};

/** Validate the committed data lock and held-out lock against each other. */
export function validateCanonicalLocks(input: {
  datasetManifestSha256: string;
  testLockSha256: string;
  dataset: unknown;
  testLock: unknown;
}): void {
  if (input.datasetManifestSha256 !== CANONICAL_DATASET_MANIFEST_SHA256)
    throw new Error('Generated dataset manifest is not the canonical issue-38 lock');
  if (input.testLockSha256 !== CANONICAL_TEST_LOCK_SHA256)
    throw new Error('Held-out test lock is not the canonical issue-38 lock');

  const dataset = record(input.dataset, 'dataset manifest');
  const testLock = record(input.testLock, 'test lock');
  if (dataset['classOrder'] !== CLASS_ORDER || testLock['classOrder'] !== CLASS_ORDER)
    throw new Error('Class order differs from the canonical lock');
  if (dataset['tileOrder'] !== 'A1..H8' || testLock['tileOrder'] !== 'A1..H8')
    throw new Error('Tile order differs from the canonical lock');
  if (dataset['dtype'] !== 'float32-le' || testLock['dtype'] !== 'float32-le')
    throw new Error('Vector dtype differs from the canonical lock');
  if (testLock['role'] !== 'held-out-test' || testLock['id'] !== 'print-held-out-v1')
    throw new Error('Held-out lock identity is invalid');
  if (testLock['datasetManifestSha256'] !== CANONICAL_DATASET_MANIFEST_SHA256)
    throw new Error('Held-out lock does not bind the canonical dataset manifest');

  const artifacts = record(dataset['artifacts'], 'dataset.artifacts');
  const testArtifacts = record(artifacts['test'], 'dataset.artifacts.test');
  const testVectors = record(testArtifacts['vectors'], 'dataset.artifacts.test.vectors');
  const testLabels = record(testArtifacts['labels'], 'dataset.artifacts.test.labels');
  const lockedVectors = record(testLock['vectors'], 'testLock.vectors');
  const lockedLabels = record(testLock['labels'], 'testLock.labels');
  requireSha256(testVectors['sha256'], 'dataset test vectors SHA-256');
  requireSha256(testLabels['sha256'], 'dataset test labels SHA-256');
  requireSha256(lockedVectors['sha256'], 'test lock vectors SHA-256');
  requireSha256(lockedLabels['sha256'], 'test lock labels SHA-256');
  requireNonnegativeInteger(testVectors['byteLength'], 'dataset test vectors byte length');
  requireNonnegativeInteger(testLabels['byteLength'], 'dataset test labels byte length');
  requireNonnegativeInteger(lockedVectors['byteLength'], 'test lock vectors byte length');
  requireNonnegativeInteger(lockedLabels['byteLength'], 'test lock labels byte length');
  requireEqual(lockedVectors, testVectors, 'Held-out vector metadata');
  requireEqual(lockedLabels, testLabels, 'Held-out label metadata');
  requireEqual(lockedVectors['shape'], [...TEST_SHAPE], 'Held-out vector shape');

  const sources = record(dataset['sources'], 'dataset.sources');
  const expectedSource = record(sources['rhosgfx'], 'dataset.sources.rhosgfx');
  requireEqual(testLock['source'], expectedSource, 'Held-out source provenance');
  if (testLock['sourceRevision'] !== '2e48c25007bc3344411811a24cd6cab666c67cbf')
    throw new Error('Held-out source revision differs from the canonical lock');
  if (
    testLock['sourceUrl'] !==
    'https://github.com/lichess-org/lila/tree/2e48c25007bc3344411811a24cd6cab666c67cbf/public/piece/rhosgfx'
  )
    throw new Error('Held-out source URL differs from the canonical lock');
  requireEqual(testLock['generator'], dataset['generator'], 'Generator provenance');
  requireEqual(testLock['generatorLock'], dataset['generatorLock'], 'Generator lock provenance');
}

/** Enforce the predeclared minimum-development-loss checkpoint rule. */
export function validateCheckpointSelection(
  lossesValue: unknown,
  checkpointValue: unknown,
  expectedEpochs: number,
): void {
  if (!Number.isInteger(expectedEpochs) || expectedEpochs < 1)
    throw new Error('Expected epoch count is invalid');
  if (!Array.isArray(lossesValue) || lossesValue.length !== expectedEpochs)
    throw new Error('Loss history must contain every declared epoch');

  let bestEpoch = 0;
  let bestLoss = Number.POSITIVE_INFINITY;
  lossesValue.forEach((value, index) => {
    const loss = record(value, `losses[${index}]`);
    const epoch = loss['epoch'];
    const devLoss = loss['devMeanCrossEntropy'];
    const trainLoss = loss['trainMeanCrossEntropy'];
    if (epoch !== index + 1)
      throw new Error('Loss history epochs must be contiguous and start at one');
    if (
      typeof devLoss !== 'number' ||
      !Number.isFinite(devLoss) ||
      devLoss < 0 ||
      typeof trainLoss !== 'number' ||
      !Number.isFinite(trainLoss) ||
      trainLoss < 0
    )
      throw new Error('Loss history contains a non-finite or invalid loss');
    if (devLoss < bestLoss) {
      bestLoss = devLoss;
      bestEpoch = index + 1;
    }
  });

  const checkpoint = record(checkpointValue, 'checkpoint');
  if (checkpoint['selectedEpoch'] !== bestEpoch || checkpoint['selectedDevLoss'] !== bestLoss)
    throw new Error('Checkpoint selection does not match the minimum development loss');
}
