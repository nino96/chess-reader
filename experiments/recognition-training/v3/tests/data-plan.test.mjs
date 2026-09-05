import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignment,
  boardSeed,
  CONDITIONS,
  familiesFor,
  SPLITS,
} from '../scripts/dataset-plan.mjs';
void test('artist groups are disjoint and sized 6/3/3', () => {
  const train = new Set(familiesFor('train'));
  const dev = new Set(familiesFor('dev'));
  const qualification = new Set(familiesFor('test'));
  assert.equal(train.size, 6);
  assert.equal(dev.size, 3);
  assert.equal(qualification.size, 3);
  for (const a of train) assert.ok(!dev.has(a) && !qualification.has(a));
  for (const a of dev) assert.ok(!qualification.has(a));
});
void test('every family receives all three conditions before repetition', () => {
  for (const split of /** @type {(keyof typeof SPLITS)[]} */ (Object.keys(SPLITS))) {
    const families = familiesFor(split),
      seen = new Set();
    for (let i = 0; i < families.length * 3; i++) {
      const a = assignment(split, i);
      assert.ok(a.condition);
      seen.add(`${a.family}/${a.condition.id}`);
    }
    assert.equal(seen.size, families.length * CONDITIONS.length);
  }
});
void test('IDs and seeds are deterministic and split-separated', () => {
  const values = new Set();
  for (const split of /** @type {(keyof typeof SPLITS)[]} */ (Object.keys(SPLITS)))
    for (let i = 0; i < 32; i++) values.add(`${split}/${i}/${boardSeed(split, i)}`);
  assert.equal(values.size, 96);
  assert.equal(boardSeed('dev', 7), boardSeed('dev', 7));
});
