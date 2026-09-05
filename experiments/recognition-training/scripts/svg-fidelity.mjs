#!/usr/bin/env node
// @ts-check

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PIECE_CODES, SOURCE_FAMILIES } from '../source-lock.mjs';
import {
  EXPERIMENT_ROOT,
  assertNoCorpusV1,
  parseArguments,
  resolveExperimentPath,
  sha256,
  verifySourceCache,
} from './protocol.mjs';

/* global Image, document */

const requireFromFixtures = createRequire(
  resolve(EXPERIMENT_ROOT, '..', '..', 'packages/test-fixtures/package.json'),
);
const requireFromWeb = createRequire(resolve(EXPERIMENT_ROOT, '..', '..', 'apps/web/package.json'));
const requireFromPlaywrightTest = createRequire(requireFromWeb.resolve('@playwright/test'));
const canvasDependency = /** @type {unknown} */ (requireFromFixtures('@napi-rs/canvas'));
const playwrightDependency = /** @type {unknown} */ (requireFromPlaywrightTest('playwright'));
const execFileAsync = promisify(execFile);

const SVG_PIXELS = 72;
const SOURCE_CACHE = 'data/source-cache';
const DEFAULT_OUTPUT = 'runs/svg-fidelity.json';
const CSS_CONTROL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><style>.light{fill:#fff2d4}</style><rect class="light" x="8" y="8" width="56" height="56"/></svg>',
);
const EXPLICIT_CONTROL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect fill="#fff2d4" x="8" y="8" width="56" height="56"/></svg>',
);

/** @param {unknown} value @returns {value is Pick<typeof import('@napi-rs/canvas'), 'createCanvas' | 'loadImage'>} */
function isCanvasDependency(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'createCanvas' in value &&
    typeof value.createCanvas === 'function' &&
    'loadImage' in value &&
    typeof value.loadImage === 'function'
  );
}

/** @param {unknown} value @returns {value is Pick<typeof import('playwright'), 'chromium'>} */
function isPlaywrightDependency(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'chromium' in value &&
    value.chromium !== null &&
    typeof value.chromium === 'object' &&
    'launch' in value.chromium &&
    typeof value.chromium.launch === 'function'
  );
}

if (!isCanvasDependency(canvasDependency)) throw new Error('Pinned canvas dependency is invalid');
if (!isPlaywrightDependency(playwrightDependency))
  throw new Error('Pinned Playwright dependency is invalid');
/** @type {Pick<typeof import('@napi-rs/canvas'), 'createCanvas' | 'loadImage'>} */
const canvas = canvasDependency;
/** @type {Pick<typeof import('playwright'), 'chromium'>} */
const playwright = playwrightDependency;

const args = parseArguments(process.argv.slice(2));
for (const argument of Object.keys(args)) {
  if (argument !== 'output') throw new Error(`Unknown argument --${argument}`);
}
const outputArgument = args['output'] ?? DEFAULT_OUTPUT;
if (typeof outputArgument !== 'string') throw new Error('--output needs a path');
const outputPath = resolveExperimentPath(outputArgument);
assertNoCorpusV1(outputPath);
const cacheRoot = resolveExperimentPath(SOURCE_CACHE);
assertNoCorpusV1(cacheRoot);
const diagnosticPath = fileURLToPath(import.meta.url);

/** @param {Uint8Array | Uint8ClampedArray} pixels */
function pixelSummary(pixels) {
  let nonTransparentPixels = 0;
  let darkPixels = 0;
  let lightPixels = 0;
  const colors = new Set();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    const alpha = pixels[offset + 3] ?? 0;
    if (alpha === 0) continue;
    nonTransparentPixels += 1;
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    if (luminance < 64) darkPixels += 1;
    if (luminance > 192) lightPixels += 1;
    colors.add(`${red},${green},${blue},${alpha}`);
  }
  return {
    pixelSha256: sha256(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)),
    nonTransparentPixels,
    darkPixels,
    lightPixels,
    distinctRgba: colors.size,
  };
}

/** @param {Buffer} svg */
async function renderNative(svg) {
  const image = await canvas.loadImage(svg);
  const surface = canvas.createCanvas(SVG_PIXELS, SVG_PIXELS);
  const context = surface.getContext('2d');
  context.clearRect(0, 0, SVG_PIXELS, SVG_PIXELS);
  context.drawImage(image, 0, 0, SVG_PIXELS, SVG_PIXELS);
  return pixelSummary(context.getImageData(0, 0, SVG_PIXELS, SVG_PIXELS).data);
}

/** @param {unknown} value */
function browserPixels(value) {
  if (!Array.isArray(value) || value.length !== SVG_PIXELS * SVG_PIXELS * 4)
    throw new Error('Chromium SVG decode returned an invalid pixel buffer');
  if (
    !value.every((component) => Number.isInteger(component) && component >= 0 && component <= 255)
  )
    throw new Error('Chromium SVG decode returned an invalid pixel value');
  return Uint8Array.from(value);
}

/** @param {import('playwright').Page} page @param {Buffer} svg */
async function renderChromium(page, svg) {
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${encoded}`;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = 72;
    surface.height = 72;
    const context = surface.getContext('2d');
    if (context === null) throw new Error('Canvas 2D context is unavailable');
    context.drawImage(image, 0, 0, 72, 72);
    return Array.from(context.getImageData(0, 0, 72, 72).data);
  }, svg.toString('base64'));
  return pixelSummary(browserPixels(pixels));
}

/** @param {string} source */
function usesEmbeddedCss(source) {
  return source.includes('<style') || source.includes('class=');
}

/** @param {string} source */
function usesClassAttribute(source) {
  return source.includes('class=');
}

async function currentCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve(EXPERIMENT_ROOT, '..', '..'),
  });
  const commit = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('git rev-parse returned an invalid commit');
  return commit;
}

/** @param {unknown} value */
function canvasVersion(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error('Pinned canvas package metadata is invalid');
  }
  return value.version;
}

const sourceHashes = await verifySourceCache(cacheRoot);
/** @type {Record<string, unknown>} */
const sourceAssets = {};
/** @type {Record<string, Buffer>} */
const representativeGlyphs = {};
for (const [family] of Object.entries(SOURCE_FAMILIES)) {
  const files = (await readdir(resolve(cacheRoot, family)))
    .filter((file) => file.endsWith('.svg'))
    .sort();
  if (files.length !== PIECE_CODES.length) throw new Error(`${family} source asset count changed`);
  const assets = [];
  for (const file of files) {
    const bytes = await readFile(resolve(cacheRoot, family, file));
    const text = bytes.toString('utf8');
    assets.push({
      file,
      sha256: sha256(bytes),
      embeddedCss: usesEmbeddedCss(text),
      classAttribute: usesClassAttribute(text),
    });
  }
  const representative = await readFile(resolve(cacheRoot, family, 'wQ.svg'));
  representativeGlyphs[family] = representative;
  sourceAssets[family] = {
    sourceSha256: sourceHashes[family],
    assetCount: assets.length,
    embeddedCssAssetCount: assets.filter((asset) => asset.embeddedCss).length,
    classAttributeAssetCount: assets.filter((asset) => asset.classAttribute).length,
    assets,
  };
}

const browser = await playwright.chromium.launch({ headless: true });
/** @type {string[]} */
const nonDataRequests = [];
try {
  const context = await browser.newContext();
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:')) {
      await route.continue();
      return;
    }
    nonDataRequests.push(url);
    await route.abort();
  });
  const page = await context.newPage();
  const nativeControls = {
    classCss: await renderNative(CSS_CONTROL),
    explicitFill: await renderNative(EXPLICIT_CONTROL),
  };
  const chromiumControls = {
    classCss: await renderChromium(page, CSS_CONTROL),
    explicitFill: await renderChromium(page, EXPLICIT_CONTROL),
  };
  /** @type {Record<string, unknown>} */
  const samples = {};
  for (const [family, svg] of Object.entries(representativeGlyphs)) {
    samples[family] = {
      file: 'wQ.svg',
      sourceSha256: sha256(svg),
      native: await renderNative(svg),
      chromium: await renderChromium(page, svg),
    };
  }
  await context.close();
  const controls = {
    native: nativeControls,
    chromium: chromiumControls,
    nativeClassMatchesExplicit:
      nativeControls.classCss.pixelSha256 === nativeControls.explicitFill.pixelSha256,
    chromiumClassMatchesExplicit:
      chromiumControls.classCss.pixelSha256 === chromiumControls.explicitFill.pixelSha256,
    explicitFillMatchesAcrossRenderers:
      nativeControls.explicitFill.pixelSha256 === chromiumControls.explicitFill.pixelSha256,
  };
  const fidelityPassed =
    controls.nativeClassMatchesExplicit &&
    controls.chromiumClassMatchesExplicit &&
    controls.explicitFillMatchesAcrossRenderers &&
    nonDataRequests.length === 0;
  const canvasPackage = /** @type {unknown} */ (
    JSON.parse(
      await readFile(
        resolve(
          EXPERIMENT_ROOT,
          '..',
          '..',
          'packages/test-fixtures/node_modules/@napi-rs/canvas/package.json',
        ),
        'utf8',
      ),
    )
  );
  const report = {
    schemaVersion: 1,
    status: fidelityPassed ? 'passed' : 'failed',
    command: `node experiments/recognition-training/scripts/svg-fidelity.mjs --output ${outputArgument}`,
    commit: await currentCommit(),
    diagnostic: {
      path: 'scripts/svg-fidelity.mjs',
      sha256: sha256(await readFile(diagnosticPath)),
      sourceLockSha256: sha256(await readFile(resolve(EXPERIMENT_ROOT, 'source-lock.mjs'))),
    },
    sourceCache: { path: SOURCE_CACHE, verifiedFamilySha256: sourceHashes },
    environment: {
      node: process.version,
      operatingSystem: platform(),
      architecture: arch(),
      nativeRenderer: { package: '@napi-rs/canvas', version: canvasVersion(canvasPackage) },
      chromium: { version: browser.version() },
      noExternalRequests: nonDataRequests.length === 0,
      nonDataRequests,
      browserInput: 'data:image/svg+xml;base64',
    },
    controls: {
      classCssSha256: sha256(CSS_CONTROL),
      explicitFillSha256: sha256(EXPLICIT_CONTROL),
      ...controls,
    },
    pixelDefinitions: {
      nonTransparentPixels: 'alpha > 0',
      luminance: '(299 * red + 587 * green + 114 * blue) / 1000',
      darkPixels: 'nontransparent and luminance < 64',
      lightPixels: 'nontransparent and luminance > 192',
      dimensions: [72, 72],
    },
    representativeGlyphs: samples,
    familyCssUsage: sourceAssets,
    conclusion: fidelityPassed
      ? 'Pinned native and Chromium SVG rendering agree on class-based fill controls.'
      : 'Pinned native and Chromium SVG rendering disagree on class-based fill controls.',
  };
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, status: report.status }, null, 2));
  if (!fidelityPassed) process.exitCode = 1;
} finally {
  await browser.close();
}
