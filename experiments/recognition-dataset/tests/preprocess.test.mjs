import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLabels, preprocessRgba, jsonBytes } from '../preprocess-core.mjs';
await test('image-top-first labels become extractor bottom-first labels', () => {
  const labels = modelLabels('k7/8/8/8/8/8/8/R6K');
  assert.equal(/** @type {number} */ (labels[0]), 3);
  assert.equal(/** @type {number} */ (labels[7]), 1);
  assert.equal(/** @type {number} */ (labels[56]), 7);
  assert.throws(() => modelLabels('9/7/8/8/8/8/8/8'));
});
await test('real pinned extractor preserves every tile position and grayscale value', () => {
  const rgba = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const value = (Math.floor(y / 32) * 8 + Math.floor(x / 32)) * 4,
        index = (y * 256 + x) * 4;
      rgba[index] = rgba[index + 1] = rgba[index + 2] = value;
      rgba[index + 3] = 255;
    }
  const tiles = preprocessRgba(rgba, 256, 256);
  for (let k = 0; k < 64; k++) {
    const value = (((7 - Math.floor(k / 8)) * 8 + (k % 8)) * 4) / 255;
    for (const p of [0, 17, 511, 1023])
      assert.ok(Math.abs(/** @type {number} */ (tiles[k * 1024 + p]) - value) < 1e-6);
  }
});
await test('proposal canonicalization matches Python sorted ensure_ascii JSON', () => {
  assert.equal(
    jsonBytes({ z: 'é', a: { b: 1 } }).toString(),
    '{\n  "a": {\n    "b": 1\n  },\n  "z": "\\u00e9"\n}\n',
  );
});
