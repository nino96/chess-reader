// @ts-check
/* global Image, document */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { EXPERIMENT_ROOT, sha256 } from './protocol.mjs';

export const SVG_PIXELS = 72;

const requireFromWeb = createRequire(
  resolve(EXPERIMENT_ROOT, '..', '..', '..', 'apps/web/package.json'),
);
const requireFromPlaywright = createRequire(requireFromWeb.resolve('@playwright/test'));
const playwrightValue = /** @type {unknown} */ (requireFromPlaywright('playwright'));

/** @param {unknown} value */
function playwright(value) {
  if (value === null || typeof value !== 'object') throw new Error('Pinned Playwright is invalid');
  const dependency = /** @type {Record<string, unknown>} */ (value);
  for (const name of ['chromium', 'firefox']) {
    const browserType = dependency[name];
    if (
      browserType === null ||
      typeof browserType !== 'object' ||
      !('launch' in browserType) ||
      typeof browserType.launch !== 'function'
    ) {
      throw new Error(`Pinned Playwright ${name} launcher is invalid`);
    }
  }
  return /** @type {Pick<typeof import('@playwright/test'), 'chromium' | 'firefox'>} */ (value);
}

const browserTypes = playwright(playwrightValue);

/** @param {unknown} value */
function encodedRender(value) {
  if (value === null || typeof value !== 'object')
    throw new Error('Browser SVG render returned an invalid result');
  const result = /** @type {Record<string, unknown>} */ (value);
  if (
    !Array.isArray(result['rgba']) ||
    result['rgba'].length !== SVG_PIXELS * SVG_PIXELS * 4 ||
    !result['rgba'].every(
      (component) => Number.isInteger(component) && component >= 0 && component <= 255,
    ) ||
    typeof result['png'] !== 'string'
  ) {
    throw new Error('Browser SVG render returned invalid pixels');
  }
  const png = Buffer.from(result['png'], 'base64');
  if (png.byteLength < 8 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Browser SVG render did not return a PNG');
  }
  return { rgba: Uint8Array.from(result['rgba']), png };
}

/**
 * Decode SVG source with a browser that supports its embedded CSS, then freeze
 * the result as a transparent 72px PNG for the native board compositor.
 *
 * @param {{ browserName?: 'chromium' | 'firefox' }} [options]
 */
export async function createSvgRenderer(options = {}) {
  const browserName = options.browserName ?? 'chromium';
  const browser = await browserTypes[browserName].launch({ headless: true });
  const context = await browser.newContext();
  /** @type {string[]} */
  const externalRequests = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:')) {
      await route.continue();
      return;
    }
    externalRequests.push(url);
    await route.abort();
  });
  const page = await context.newPage();
  let closed = false;

  return {
    browserName,
    version: browser.version(),
    get externalRequests() {
      return [...externalRequests];
    },
    /** @param {Buffer | Uint8Array} svg */
    async render(svg) {
      if (closed) throw new Error('SVG renderer is closed');
      const source = Buffer.from(svg);
      const value = await page.evaluate(
        async ({ encoded, pixels }) => {
          const image = new Image();
          image.src = `data:image/svg+xml;base64,${encoded}`;
          await image.decode();
          const surface = document.createElement('canvas');
          surface.width = pixels;
          surface.height = pixels;
          const context = surface.getContext('2d');
          if (context === null) throw new Error('Canvas 2D context is unavailable');
          context.clearRect(0, 0, pixels, pixels);
          context.drawImage(image, 0, 0, pixels, pixels);
          const rgba = Array.from(context.getImageData(0, 0, pixels, pixels).data);
          const png = surface.toDataURL('image/png').split(',')[1];
          if (png === undefined) throw new Error('Canvas PNG encoding failed');
          return { rgba, png };
        },
        { encoded: source.toString('base64'), pixels: SVG_PIXELS },
      );
      const rendered = encodedRender(value);
      return {
        ...rendered,
        sourceSha256: sha256(source),
        rgbaSha256: sha256(rendered.rgba),
        pngSha256: sha256(rendered.png),
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await context.close();
      await browser.close();
    },
  };
}
