import { describe, expect, it } from 'vitest';

import {
  CANONICAL_DATASET_MANIFEST_SHA256,
  CANONICAL_TEST_LOCK_SHA256,
  validateCanonicalLocks,
  validateCheckpointSelection,
} from '../freeze-validation.js';

const source = {
  split: 'test',
  authorFamily: 'RhosGFX',
  license: 'CC0-1.0',
  lilaPath: 'public/piece/rhosgfx',
  sourceSha256: 'f'.repeat(64),
  fileSha256: {},
  actualSha256: 'f'.repeat(64),
};

function lockedInputs() {
  const vectors = {
    path: 'test.vectors.f32le',
    sha256: 'a'.repeat(64),
    byteLength: 67108864,
    shape: [256, 64, 1024],
  };
  const labels = { path: 'test.labels.json', sha256: 'b'.repeat(64), byteLength: 209652 };
  const generator = { path: 'scripts/generate-dataset.mjs', sha256: 'c'.repeat(64) };
  const generatorLock = { path: 'source-lock.mjs', sha256: 'd'.repeat(64) };
  const dataset = {
    classOrder: '1KQRBNPkqrbnp',
    tileOrder: 'A1..H8',
    dtype: 'float32-le',
    artifacts: { test: { vectors, labels } },
    sources: { rhosgfx: source },
    generator,
    generatorLock,
  };
  const testLock = {
    id: 'print-held-out-v1',
    role: 'held-out-test',
    datasetManifestSha256: CANONICAL_DATASET_MANIFEST_SHA256,
    classOrder: '1KQRBNPkqrbnp',
    tileOrder: 'A1..H8',
    dtype: 'float32-le',
    vectors,
    labels,
    source,
    sourceRevision: '2e48c25007bc3344411811a24cd6cab666c67cbf',
    sourceUrl:
      'https://github.com/lichess-org/lila/tree/2e48c25007bc3344411811a24cd6cab666c67cbf/public/piece/rhosgfx',
    generator,
    generatorLock,
  };
  return { dataset, testLock };
}

describe('freeze validation', () => {
  it('rejects a held-out lock whose artifact metadata is changed', () => {
    const { dataset, testLock } = lockedInputs();
    testLock.labels = { ...testLock.labels, byteLength: testLock.labels.byteLength + 1 };
    expect(() =>
      validateCanonicalLocks({
        datasetManifestSha256: CANONICAL_DATASET_MANIFEST_SHA256,
        testLockSha256: CANONICAL_TEST_LOCK_SHA256,
        dataset,
        testLock,
      }),
    ).toThrow('Held-out label metadata');
  });

  it('selects the earliest epoch when development losses tie', () => {
    const losses = [
      { epoch: 1, trainMeanCrossEntropy: 1, devMeanCrossEntropy: 0.5 },
      { epoch: 2, trainMeanCrossEntropy: 0.8, devMeanCrossEntropy: 0.4 },
      { epoch: 3, trainMeanCrossEntropy: 0.7, devMeanCrossEntropy: 0.4 },
    ];
    expect(() =>
      validateCheckpointSelection(losses, { selectedEpoch: 2, selectedDevLoss: 0.4 }, 3),
    ).not.toThrow();
    expect(() =>
      validateCheckpointSelection(losses, { selectedEpoch: 3, selectedDevLoss: 0.4 }, 3),
    ).toThrow('minimum development loss');
  });

  it('rejects non-contiguous loss history', () => {
    const losses = [
      { epoch: 1, trainMeanCrossEntropy: 1, devMeanCrossEntropy: 0.5 },
      { epoch: 3, trainMeanCrossEntropy: 0.8, devMeanCrossEntropy: 0.4 },
    ];
    expect(() =>
      validateCheckpointSelection(losses, { selectedEpoch: 2, selectedDevLoss: 0.4 }, 2),
    ).toThrow('contiguous');
  });
});
