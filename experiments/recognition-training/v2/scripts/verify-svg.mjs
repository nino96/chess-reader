#!/usr/bin/env node
// @ts-check

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { PIECE_CODES, SOURCE_FAMILIES } from '../source-lock.mjs';
import { EXPERIMENT_ROOT, parseArguments, sha256, verifySourceCache } from './protocol.mjs';
import { SVG_PIXELS, createSvgRenderer } from './svg-renderer.mjs';

const WHITE_COMPOSITE_MAE_LIMIT = 0.06;
const ALPHA_MAE_LIMIT = 0.03;
const DEFAULT_CACHE = resolve(EXPERIMENT_ROOT, '..', 'data/source-cache');
const DEFAULT_OUTPUT = resolve(EXPERIMENT_ROOT, 'runs/svg-fidelity.json');
const DEFAULT_CONTACT_SHEET = resolve(EXPERIMENT_ROOT, 'runs/svg-contact-sheet.png');
const execFileAsync = promisify(execFile);

const requireFromFixtures = createRequire(
  resolve(EXPERIMENT_ROOT, '..', '..', '..', 'packages/test-fixtures/package.json'),
);
const canvasValue = /** @type {unknown} */ (requireFromFixtures('@napi-rs/canvas'));

/** @param {unknown} value */
function canvasDependency(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('createCanvas' in value) ||
    typeof value.createCanvas !== 'function' ||
    !('loadImage' in value) ||
    typeof value.loadImage !== 'function'
  ) {
    throw new Error('Pinned canvas dependency is invalid');
  }
  return /** @type {Pick<typeof import('@napi-rs/canvas'), 'createCanvas' | 'loadImage'>} */ (
    value
  );
}

const canvas = canvasDependency(canvasValue);

export const SVG_FIDELITY_LIMITS = Object.freeze({
  normalizedWhiteCompositeMae: WHITE_COMPOSITE_MAE_LIMIT,
  normalizedAlphaMae: ALPHA_MAE_LIMIT,
});

export const CSS_CONTROL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><style>.light{fill:#fff2d4}</style><rect class="light" x="8" y="8" width="56" height="56"/></svg>',
);
export const EXPLICIT_CONTROL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect fill="#fff2d4" x="8" y="8" width="56" height="56"/></svg>',
);

/** @param {Uint8Array} pixels */
export function pixelSummary(pixels) {
  if (pixels.byteLength !== SVG_PIXELS * SVG_PIXELS * 4)
    throw new Error('Expected one 72px RGBA raster');
  let nonTransparentPixels = 0;
  let darkPixels = 0;
  let lightPixels = 0;
  let alphaTotal = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    const alpha = pixels[offset + 3] ?? 0;
    alphaTotal += alpha;
    if (alpha === 0) continue;
    nonTransparentPixels += 1;
    const luminance = (299 * red + 587 * green + 114 * blue) / 1000;
    if (luminance < 64) darkPixels += 1;
    if (luminance > 192) lightPixels += 1;
  }
  return { nonTransparentPixels, darkPixels, lightPixels, alphaTotal };
}

/** @param {Uint8Array} left @param {Uint8Array} right */
export function compareRasters(left, right) {
  if (left.byteLength !== right.byteLength || left.byteLength % 4 !== 0)
    throw new Error('Raster comparison requires equal RGBA buffers');
  let whiteCompositeDifference = 0;
  let alphaDifference = 0;
  const pixels = left.byteLength / 4;
  for (let offset = 0; offset < left.length; offset += 4) {
    const leftAlpha = left[offset + 3] ?? 0;
    const rightAlpha = right[offset + 3] ?? 0;
    alphaDifference += Math.abs(leftAlpha - rightAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const leftValue = left[offset + channel] ?? 0;
      const rightValue = right[offset + channel] ?? 0;
      const leftOnWhite = (leftValue * leftAlpha + 255 * (255 - leftAlpha)) / 255;
      const rightOnWhite = (rightValue * rightAlpha + 255 * (255 - rightAlpha)) / 255;
      whiteCompositeDifference += Math.abs(leftOnWhite - rightOnWhite);
    }
  }
  return {
    normalizedWhiteCompositeMae: whiteCompositeDifference / (pixels * 3 * 255),
    normalizedAlphaMae: alphaDifference / (pixels * 255),
  };
}

/** @param {Buffer} png */
export async function decodeNativePng(png) {
  const image = await canvas.loadImage(png);
  if (image.width !== SVG_PIXELS || image.height !== SVG_PIXELS)
    throw new Error('Canonical glyph PNG must be 72px square');
  const surface = canvas.createCanvas(SVG_PIXELS, SVG_PIXELS);
  const context = surface.getContext('2d');
  context.clearRect(0, 0, SVG_PIXELS, SVG_PIXELS);
  context.drawImage(image, 0, 0);
  return Uint8Array.from(context.getImageData(0, 0, SVG_PIXELS, SVG_PIXELS).data);
}

/** @param {Uint8Array} browserPixels @param {Uint8Array} nativePixels */
export function assertNativeRoundTrip(browserPixels, nativePixels) {
  if (browserPixels.byteLength !== nativePixels.byteLength)
    throw new Error('Native PNG decode changed raster dimensions');
  for (let offset = 0; offset < browserPixels.length; offset += 4) {
    const browserAlpha = browserPixels[offset + 3] ?? 0;
    const nativeAlpha = nativePixels[offset + 3] ?? 0;
    if (browserAlpha !== nativeAlpha) throw new Error('Native PNG decode changed alpha');
    if (browserAlpha === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (browserPixels[offset + channel] !== nativePixels[offset + channel]) {
        throw new Error('Native PNG decode changed a visible RGB component');
      }
    }
  }
}

/** @param {{ family: string; code: string; png: Buffer }[]} assets */
async function makeContactSheet(assets) {
  const cell = 88;
  const labelHeight = 22;
  const families = Object.keys(SOURCE_FAMILIES);
  const surface = canvas.createCanvas(
    cell * PIECE_CODES.length,
    (SVG_PIXELS + labelHeight) * families.length,
  );
  const context = surface.getContext('2d');
  context.fillStyle = '#f6f2e9';
  context.fillRect(0, 0, surface.width, surface.height);
  context.font = '12px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const [familyIndex, family] of families.entries()) {
    for (const [codeIndex, code] of PIECE_CODES.entries()) {
      const asset = assets.find((entry) => entry.family === family && entry.code === code);
      if (asset === undefined) throw new Error(`Contact-sheet asset missing: ${family}/${code}`);
      const x = codeIndex * cell;
      const y = familyIndex * (SVG_PIXELS + labelHeight);
      context.fillStyle = (codeIndex + familyIndex) % 2 === 0 ? '#ffffff' : '#ded8ca';
      context.fillRect(x + 8, y, SVG_PIXELS, SVG_PIXELS);
      context.drawImage(await canvas.loadImage(asset.png), x + 8, y);
      context.fillStyle = '#181713';
      context.fillText(`${family}/${code}`, x + cell / 2, y + SVG_PIXELS + labelHeight / 2);
    }
  }
  return surface.toBuffer('image/png');
}

async function currentCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve(EXPERIMENT_ROOT, '..', '..', '..'),
  });
  const commit = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('git returned an invalid commit');
  return commit;
}

/** @param {string} cacheRoot */
function safeCachePath(cacheRoot) {
  const path = relative(EXPERIMENT_ROOT, cacheRoot).replaceAll('\\', '/');
  return path === '' ? '.' : path;
}

/** @param {unknown} error */
function safeError(error) {
  const name = error instanceof Error ? error.name : 'Error';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage
    .split('\n')[0]
    ?.replaceAll(resolve(EXPERIMENT_ROOT, '..', '..', '..'), '<repository>')
    .replaceAll(EXPERIMENT_ROOT, '<experiment>');
  return { name, message: message ?? 'SVG verification failed' };
}

/**
 * @param {{ cacheRoot?: string; includeContactSheet?: boolean }} [options]
 */
export async function verifySvgSources(options = {}) {
  const cacheRoot = resolve(options.cacheRoot ?? DEFAULT_CACHE);
  const sourceHashes = await verifySourceCache(cacheRoot);
  const chromiumA = await createSvgRenderer({ browserName: 'chromium' });
  const chromiumB = await createSvgRenderer({ browserName: 'chromium' });
  const firefox = await createSvgRenderer({ browserName: 'firefox' });
  /** @type {{ family: string; code: string; png: Buffer }[]} */
  const contactAssets = [];
  /** @type {Record<string, unknown>[]} */
  const assets = [];
  try {
    for (const [family, source] of Object.entries(SOURCE_FAMILIES)) {
      const familyRgbaHashes = new Set();
      for (const code of PIECE_CODES) {
        const file = `${code}.svg`;
        const svg = await readFile(resolve(cacheRoot, family, file));
        const expectedHash = /** @type {Readonly<Record<string, string>>} */ (source.fileSha256)[
          file
        ];
        if (sha256(svg) !== expectedHash)
          throw new Error(`${family}/${file} changed after cache check`);
        const [first, second, independent] = await Promise.all([
          chromiumA.render(svg),
          chromiumB.render(svg),
          firefox.render(svg),
        ]);
        if (first.rgbaSha256 !== second.rgbaSha256 || first.pngSha256 !== second.pngSha256) {
          throw new Error(`${family}/${file} is not reproducible in fresh Chromium contexts`);
        }
        const summary = pixelSummary(first.rgba);
        if (
          summary.nonTransparentPixels === 0 ||
          summary.nonTransparentPixels === SVG_PIXELS * SVG_PIXELS
        ) {
          throw new Error(`${family}/${file} has an empty or full-frame alpha silhouette`);
        }
        if (familyRgbaHashes.has(first.rgbaSha256))
          throw new Error(`${family}/${file} duplicates another piece raster in its family`);
        familyRgbaHashes.add(first.rgbaSha256);
        const native = await decodeNativePng(first.png);
        assertNativeRoundTrip(first.rgba, native);
        const comparison = compareRasters(first.rgba, independent.rgba);
        if (
          comparison.normalizedWhiteCompositeMae > WHITE_COMPOSITE_MAE_LIMIT ||
          comparison.normalizedAlphaMae > ALPHA_MAE_LIMIT
        ) {
          throw new Error(
            `${family}/${file} exceeds the frozen Firefox fidelity tolerance: ${JSON.stringify(comparison)}`,
          );
        }
        contactAssets.push({ family, code, png: first.png });
        assets.push({
          family,
          code,
          file,
          sourceSha256: first.sourceSha256,
          chromium: { rgbaSha256: first.rgbaSha256, pngSha256: first.pngSha256, ...summary },
          firefox: {
            rgbaSha256: independent.rgbaSha256,
            pngSha256: independent.pngSha256,
          },
          crossEngine: comparison,
          nativePngVisiblePixelsExact: true,
          freshChromiumRenderExact: true,
        });
      }
      for (const piece of ['K', 'Q', 'R', 'B', 'N', 'P']) {
        const white = assets.find(
          (asset) => asset['family'] === family && asset['code'] === `w${piece}`,
        );
        const black = assets.find(
          (asset) => asset['family'] === family && asset['code'] === `b${piece}`,
        );
        if (white?.['chromium'] === undefined || black?.['chromium'] === undefined)
          throw new Error(`${family}/${piece} color pair is missing`);
        const { rgbaSha256: whiteHash } = /** @type {{ rgbaSha256: unknown }} */ (
          white['chromium']
        );
        const { rgbaSha256: blackHash } = /** @type {{ rgbaSha256: unknown }} */ (
          black['chromium']
        );
        if (whiteHash === blackHash) {
          throw new Error(`${family}/${piece} white and black rasters are identical`);
        }
      }
    }

    /** @type {Partial<Record<'chromium' | 'firefox', Record<string, unknown>>>} */
    const controls = {};
    for (const renderer of [chromiumA, firefox]) {
      const css = await renderer.render(CSS_CONTROL);
      const explicit = await renderer.render(EXPLICIT_CONTROL);
      if (css.rgbaSha256 !== explicit.rgbaSha256)
        throw new Error(`${renderer.browserName} ignores the embedded CSS control`);
      controls[renderer.browserName] = {
        classCssRgbaSha256: css.rgbaSha256,
        explicitFillRgbaSha256: explicit.rgbaSha256,
        exact: true,
      };
    }
    const externalRequests = [
      ...chromiumA.externalRequests,
      ...chromiumB.externalRequests,
      ...firefox.externalRequests,
    ];
    if (externalRequests.length > 0)
      throw new Error(
        `SVG verification attempted external requests: ${externalRequests.join(', ')}`,
      );
    const contactSheet =
      options.includeContactSheet === false ? undefined : await makeContactSheet(contactAssets);
    return {
      schemaVersion: 1,
      status: 'passed',
      commit: await currentCommit(),
      sourceCache: { path: safeCachePath(cacheRoot), verifiedFamilySha256: sourceHashes },
      renderer: {
        pixels: SVG_PIXELS,
        chromium: chromiumA.version,
        firefox: firefox.version,
        canonical:
          'Chromium SVG image decoded to transparent PNG; native compositing reads PNG only',
      },
      limits: SVG_FIDELITY_LIMITS,
      controls,
      assetCount: assets.length,
      assets,
      noExternalRequests: true,
      environment: { node: process.version, operatingSystem: platform(), architecture: arch() },
      contactSheet:
        contactSheet === undefined
          ? undefined
          : { path: 'runs/svg-contact-sheet.png', sha256: sha256(contactSheet) },
      contactSheetBytes: contactSheet,
    };
  } finally {
    await Promise.allSettled([chromiumA.close(), chromiumB.close(), firefox.close()]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const cacheArgument = args['cache'];
  const outputArgument = args['output'];
  const contactArgument = args['contact-sheet'];
  if (cacheArgument !== undefined && typeof cacheArgument !== 'string')
    throw new Error('--cache needs a path');
  if (outputArgument !== undefined && typeof outputArgument !== 'string')
    throw new Error('--output needs a path');
  if (contactArgument !== undefined && typeof contactArgument !== 'string')
    throw new Error('--contact-sheet needs a path');
  const outputPath =
    typeof outputArgument === 'string' ? resolve(EXPERIMENT_ROOT, outputArgument) : DEFAULT_OUTPUT;
  const contactPath =
    typeof contactArgument === 'string'
      ? resolve(EXPERIMENT_ROOT, contactArgument)
      : DEFAULT_CONTACT_SHEET;
  if (
    !outputPath.startsWith(`${EXPERIMENT_ROOT}/`) ||
    !contactPath.startsWith(`${EXPERIMENT_ROOT}/`)
  )
    throw new Error('SVG verification outputs must stay inside recognition-training/v2');
  const cacheRoot =
    typeof cacheArgument === 'string'
      ? isAbsolute(cacheArgument)
        ? cacheArgument
        : resolve(EXPERIMENT_ROOT, cacheArgument)
      : DEFAULT_CACHE;
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    const report = await verifySvgSources({ cacheRoot });
    const contactSheet = report.contactSheetBytes;
    if (contactSheet === undefined) throw new Error('SVG verifier did not create a contact sheet');
    const serializable = {
      ...report,
      contactSheet: { path: safeCachePath(contactPath), sha256: sha256(contactSheet) },
      contactSheetBytes: undefined,
    };
    await mkdir(dirname(contactPath), { recursive: true });
    await writeFile(contactPath, contactSheet);
    await writeFile(outputPath, `${JSON.stringify(serializable, null, 2)}\n`);
    console.log(JSON.stringify({ outputPath, contactPath, status: report.status }, null, 2));
  } catch (error) {
    let sourceHashes;
    try {
      sourceHashes = await verifySourceCache(cacheRoot);
    } catch {
      sourceHashes = undefined;
    }
    const failure = {
      schemaVersion: 1,
      status: 'failed',
      commit: await currentCommit(),
      sourceCache: {
        path: safeCachePath(cacheRoot),
        verifiedFamilySha256: sourceHashes,
      },
      limits: SVG_FIDELITY_LIMITS,
      error: safeError(error),
      environment: { node: process.version, operatingSystem: platform(), architecture: arch() },
    };
    await writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`);
    console.error(
      JSON.stringify({ outputPath, status: failure.status, error: failure.error }, null, 2),
    );
    process.exitCode = 1;
  }
}
