// @ts-check

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { CLASS_ORDER, SOURCE_FAMILIES } from '../source-lock.mjs';
import { sourceFamilyDigest } from '../scripts/protocol.mjs';
import { makeRandom, randomPosition, sampleSeed } from '../scripts/recipe.mjs';
import { buildSampleInventory } from '../scripts/sample-inventory.mjs';
import { validateDatasetManifest } from '../scripts/verify-dataset.mjs';

/** @param {Uint8Array | string} bytes */
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} root @param {'train' | 'dev' | 'test'} split @param {string} family @param {string} id @param {number} [value] */
async function writeSplit(root, split, family, id, value = 0) {
  const vectors = Buffer.alloc(64 * 1024 * 4);
  for (let offset = 0; offset < vectors.byteLength; offset += 4)
    vectors.writeFloatLE(value, offset);
  const labels = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, split, boards: [{ id, family, labels: Array.from({ length: 64 }, () => 0) }] })}\n`,
  );
  await writeFile(join(root, `${split}.vectors.f32le`), vectors);
  await writeFile(join(root, `${split}.labels.json`), labels);
  return {
    vectors: {
      path: `${split}.vectors.f32le`,
      sha256: sha(vectors),
      byteLength: vectors.byteLength,
      shape: [1, 64, 1024],
    },
    labels: { path: `${split}.labels.json`, sha256: sha(labels), byteLength: labels.byteLength },
  };
}

void test('data protocol accepts disjoint pinned family boards and f32le vectors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chess-reader-training-protocol-'));
  try {
    const artifacts = {
      train: await writeSplit(root, 'train', 'chessnut', 'train-001'),
      dev: await writeSplit(root, 'dev', 'firi', 'dev-001', 0.25),
      test: await writeSplit(root, 'test', 'rhosgfx', 'test-001', 0.5),
    };
    const counts = await validateDatasetManifest(
      {
        schemaVersion: 1,
        dtype: 'float32-le',
        classOrder: CLASS_ORDER,
        tileOrder: 'A1..H8',
        exclusions: ['packages/test-fixtures/corpus/v1'],
        artifacts,
      },
      root,
    );
    assert.deepEqual(counts, { train: 1, dev: 1, test: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('data protocol rejects a board id or glyph family crossing split roles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chess-reader-training-overlap-'));
  try {
    const artifacts = {
      train: await writeSplit(root, 'train', 'chessnut', 'same-id'),
      dev: await writeSplit(root, 'dev', 'firi', 'same-id', 0.25),
      test: await writeSplit(root, 'test', 'rhosgfx', 'test-001', 0.5),
    };
    await assert.rejects(
      validateDatasetManifest(
        {
          schemaVersion: 1,
          dtype: 'float32-le',
          classOrder: CLASS_ORDER,
          tileOrder: 'A1..H8',
          exclusions: ['packages/test-fixtures/corpus/v1'],
          artifacts,
        },
        root,
      ),
      /Board id overlaps/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('data protocol rejects copied vector content with a renamed board id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chess-reader-training-copied-vector-'));
  try {
    const artifacts = {
      train: await writeSplit(root, 'train', 'chessnut', 'train-001'),
      dev: await writeSplit(root, 'dev', 'firi', 'renamed-copy'),
      test: await writeSplit(root, 'test', 'rhosgfx', 'test-001', 0.5),
    };
    await assert.rejects(
      validateDatasetManifest(
        {
          schemaVersion: 1,
          dtype: 'float32-le',
          classOrder: CLASS_ORDER,
          tileOrder: 'A1..H8',
          exclusions: ['packages/test-fixtures/corpus/v1'],
          artifacts,
        },
        root,
      ),
      /board vector crosses split roles/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('source aggregate changes when a locked glyph hash changes', () => {
  const original = sourceFamilyDigest(['bK.svg aaa', 'wK.svg bbb']);
  const changed = sourceFamilyDigest(['bK.svg aaa', 'wK.svg ccc']);
  assert.notEqual(changed, original);
  assert.equal(SOURCE_FAMILIES.celtic.authorFamily, SOURCE_FAMILIES.fantasy.authorFamily);
});

void test('the fixed seed regenerates an identical board label sequence', () => {
  const seed = sampleSeed('train', 123);
  assert.deepEqual(randomPosition(makeRandom(seed)), randomPosition(makeRandom(seed)));
  assert.notEqual(sampleSeed('train', 123), sampleSeed('dev', 123));
});

void test('sample inventory carries opaque ids, families and vector hashes but no labels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chess-reader-training-inventory-'));
  try {
    const artifacts = {
      train: await writeSplit(root, 'train', 'chessnut', 'train-001'),
      dev: await writeSplit(root, 'dev', 'firi', 'dev-001', 0.25),
      test: await writeSplit(root, 'test', 'rhosgfx', 'test-001', 0.5),
    };
    const inventory = await buildSampleInventory(
      {
        schemaVersion: 1,
        dtype: 'float32-le',
        classOrder: CLASS_ORDER,
        tileOrder: 'A1..H8',
        exclusions: ['packages/test-fixtures/corpus/v1'],
        artifacts,
      },
      root,
    );
    assert.deepEqual(inventory.splits['train']?.samples[0], {
      id: 'train-001',
      family: 'chessnut',
      vectorSha256: sha(Buffer.alloc(64 * 1024 * 4)),
    });
    assert.equal(JSON.stringify(inventory).includes('labels'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
