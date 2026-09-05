// @ts-check

import assert from 'node:assert/strict';
import test from 'node:test';

import { CSS_CONTROL, EXPLICIT_CONTROL, compareRasters } from '../scripts/verify-svg.mjs';
import { createSvgRenderer } from '../scripts/svg-renderer.mjs';

void test('Chromium applies embedded SVG CSS and reproduces canonical PNG bytes', async () => {
  const first = await createSvgRenderer();
  const second = await createSvgRenderer();
  try {
    const [classCss, explicitFill, replay] = await Promise.all([
      first.render(CSS_CONTROL),
      first.render(EXPLICIT_CONTROL),
      second.render(CSS_CONTROL),
    ]);
    assert.equal(classCss.rgbaSha256, explicitFill.rgbaSha256);
    assert.equal(classCss.rgbaSha256, replay.rgbaSha256);
    assert.equal(classCss.pngSha256, replay.pngSha256);
    assert.deepEqual(first.externalRequests, []);
    assert.deepEqual(second.externalRequests, []);
  } finally {
    await Promise.allSettled([first.close(), second.close()]);
  }
});

void test('raster comparison ignores RGB hidden behind complete transparency', () => {
  const left = Uint8Array.from([0, 0, 0, 0, 10, 20, 30, 255]);
  const right = Uint8Array.from([255, 12, 99, 0, 10, 20, 30, 255]);
  assert.deepEqual(compareRasters(left, right), {
    normalizedWhiteCompositeMae: 0,
    normalizedAlphaMae: 0,
  });
});
