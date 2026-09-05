// @ts-check

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { EXPERIMENT_ROOT } from '../scripts/protocol.mjs';
import { SVG_FIDELITY_LIMITS, verifySvgSources } from '../scripts/verify-svg.mjs';

void test('all locked source glyphs pass browser, replay, and native PNG fidelity gates', async () => {
  const report = await verifySvgSources({
    cacheRoot: resolve(EXPERIMENT_ROOT, '..', 'data/source-cache'),
    includeContactSheet: false,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.assetCount, 72);
  assert.equal(report.assets.length, 72);
  assert.equal(report.noExternalRequests, true);
  for (const asset of report.assets) {
    assert.equal(asset['freshChromiumRenderExact'], true);
    assert.equal(asset['nativePngVisiblePixelsExact'], true);
    const comparison = /** @type {Record<string, number>} */ (asset['crossEngine']);
    const whiteCompositeMae = comparison['normalizedWhiteCompositeMae'];
    const alphaMae = comparison['normalizedAlphaMae'];
    assert.equal(typeof whiteCompositeMae, 'number');
    assert.equal(typeof alphaMae, 'number');
    if (whiteCompositeMae === undefined || alphaMae === undefined)
      throw new Error('Cross-engine metrics are missing');
    assert.ok(whiteCompositeMae <= SVG_FIDELITY_LIMITS.normalizedWhiteCompositeMae);
    assert.ok(alphaMae <= SVG_FIDELITY_LIMITS.normalizedAlphaMae);
  }
});
