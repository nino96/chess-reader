/**
 * Real-model golden test: renders `pdf-synthetic-diagram-01.pdf` with
 * `pdfjs-dist` in Node, crops the region the fixture manifest says the board
 * (or, for the negative case, a text-only paragraph) occupies -- padded by a
 * few percent to mimic a hand-drawn selection -- and runs the crop through
 * fenshot's actual detection + ONNX classification pipeline: the same
 * `recognizeGray` core `apps/web/src/recognition/pipeline.ts` calls. This
 * proves the recognizer reads a real, rendered PDF page correctly end to end,
 * not just a synthetic RGBA buffer assembled directly in memory.
 *
 * fenshot's `dist/*.js` files use extensionless relative imports (`from
 * "./recognize"`), which plain `node` cannot resolve but Vitest's resolver
 * can -- so this suite only runs under Vitest.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  extractTiles,
  probsToPlacement,
  recognizeGray,
  resolveOrientation,
  rgbaToGray,
  type GrayImage,
  type TileClassifier,
} from '@scoriiu/fenshot';
import { createCanvas } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  NEGATIVE_TEXT_RECT_PT,
  PAGE_HEIGHT_PT,
  PAGE_WIDTH_PT,
  toNormalizedRect,
} from '../generators/lib/layout.mjs';
import { fixturePath, getFixture } from '../src/index';

/**
 * Mirrors `apps/web/src/study/contracts.ts`'s `MAX_CAPTURE_LONG_EDGE_PX`. Duplicated
 * (not imported) so this package never depends on `apps/web`.
 */
const MAX_CAPTURE_LONG_EDGE_PX = 1024;

/** Pads a manual selection's rectangle by this fraction on every side, mimicking a
 *  hand-drawn crop that is never pixel-perfect around the board's border. */
const SELECTION_MARGIN_FRACTION = 0.03;

interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RgbaImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

function isNormalizedRect(value: unknown): value is NormalizedRect {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['x'] === 'number' &&
    typeof record['y'] === 'number' &&
    typeof record['width'] === 'number' &&
    typeof record['height'] === 'number'
  );
}

/** Narrows `pdf-synthetic-diagram-01`'s manifest `expected` object, which is
 *  otherwise typed as `Record<string, unknown>` (docs/fixtures.md keeps `expected`
 *  suite-specific). Throws descriptively rather than letting a shape drift produce
 *  a confusing downstream `TypeError`. */
function readExpectedDiagram(expected: Readonly<Record<string, unknown>>): {
  readonly pageIndex: number;
  readonly boardRect: NormalizedRect;
  readonly placement: string;
  readonly orientation: string;
  readonly negativePages: readonly number[];
} {
  const locator = expected['locator'];
  const pageIndex =
    typeof locator === 'object' && locator !== null
      ? (locator as Record<string, unknown>)['pageIndex']
      : undefined;
  const boardRect = expected['boardRect'];
  const placement = expected['placement'];
  const orientation = expected['orientation'];
  const negativePages = expected['negativePages'];

  if (typeof pageIndex !== 'number') {
    throw new Error('manifest expected.locator.pageIndex must be a number');
  }
  if (!isNormalizedRect(boardRect)) {
    throw new Error('manifest expected.boardRect must be a NormalizedRect');
  }
  if (typeof placement !== 'string') {
    throw new Error('manifest expected.placement must be a string');
  }
  if (typeof orientation !== 'string') {
    throw new Error('manifest expected.orientation must be a string');
  }
  if (!Array.isArray(negativePages) || !negativePages.every((page) => typeof page === 'number')) {
    throw new Error('manifest expected.negativePages must be a number array');
  }

  return { pageIndex, boardRect, placement, orientation, negativePages };
}

/** Renders one page of `pdfPath` to an RGBA raster at `scale` (PDF points -> device
 *  pixels) using pdfjs-dist's Node canvas factory (`@napi-rs/canvas`, auto-selected
 *  by pdfjs when it detects it is running in Node). */
async function renderPageToRgba(
  pdfPath: string,
  pageIndex: number,
  scale: number,
): Promise<RgbaImage> {
  const data = new Uint8Array(await readFile(pdfPath));
  // pdfjs warns "standardFontDataUrl" is unset for this fixture's non-embedded
  // Helvetica text; it still renders correctly with built-in fallback metrics
  // (confirmed visually), and the warning does not affect the board crop below.
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });

  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const imageData = context.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

/** Expands a `NormalizedRect` by `marginFraction` of its own size on every side,
 *  clamped to stay within the unit square. */
function padNormalizedRect(rect: NormalizedRect, marginFraction: number): NormalizedRect {
  const marginX = rect.width * marginFraction;
  const marginY = rect.height * marginFraction;
  const x0 = Math.max(0, rect.x - marginX);
  const y0 = Math.max(0, rect.y - marginY);
  const x1 = Math.min(1, rect.x + rect.width + marginX);
  const y1 = Math.min(1, rect.y + rect.height + marginY);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Crops `page` to the pixel rectangle `rect` describes (fractions of page size). */
function cropToRgba(page: RgbaImage, rect: NormalizedRect): RgbaImage {
  const px = Math.round(rect.x * page.width);
  const py = Math.round(rect.y * page.height);
  const pw = Math.min(page.width - px, Math.round(rect.width * page.width));
  const ph = Math.min(page.height - py, Math.round(rect.height * page.height));

  const out = new Uint8ClampedArray(pw * ph * 4);
  for (let row = 0; row < ph; row += 1) {
    const srcStart = ((py + row) * page.width + px) * 4;
    const destStart = row * pw * 4;
    out.set(page.data.subarray(srcStart, srcStart + pw * 4), destStart);
  }
  return { data: out, width: pw, height: ph };
}

describe('diagram-recognition (real ONNX model, golden test)', () => {
  let session: ort.InferenceSession;
  let totalInferenceMs: number;
  let inferenceCalls: number;

  beforeAll(async () => {
    // Pure-wasm single-thread: deterministic and avoids relying on worker-thread
    // support in whatever Node/Vitest worker pool runs this suite.
    ort.env.wasm.numThreads = 1;
    const modelUrl = import.meta.resolve('@scoriiu/fenshot/model/chess-tiles-v2.onnx');
    const modelBytes = await readFile(fileURLToPath(modelUrl));
    session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
  }, 60_000);

  function makeClassifier(gray: GrayImage): TileClassifier {
    totalInferenceMs = 0;
    inferenceCalls = 0;
    return async (corners) => {
      const tiles = extractTiles(gray, corners);
      const start = performance.now();
      const output = await session.run({ tiles: new ort.Tensor('float32', tiles, [64, 1024]) });
      totalInferenceMs += performance.now() - start;
      inferenceCalls += 1;
      const probsTensor = output['probs'];
      if (probsTensor === undefined) {
        throw new Error('Model output is missing the "probs" tensor.');
      }
      const probsData = probsTensor.data;
      if (!(probsData instanceof Float32Array)) {
        throw new Error('Model output "probs" tensor is not a Float32Array.');
      }
      return probsToPlacement(probsData);
    };
  }

  it('reads the synthetic printed diagram correctly from the rendered PDF page', async () => {
    const fixture = getFixture('pdf-synthetic-diagram-01');
    const expected = readExpectedDiagram(fixture.expected);
    const pdfPath = fixturePath(fixture.path);

    // Render at a scale that puts the board's long edge at approximately
    // MAX_CAPTURE_LONG_EDGE_PX device pixels, mirroring the real capture
    // pipeline's resolution ceiling.
    const boardLongEdgePt = Math.max(
      expected.boardRect.width * PAGE_WIDTH_PT,
      expected.boardRect.height * PAGE_HEIGHT_PT,
    );
    const scale = MAX_CAPTURE_LONG_EDGE_PX / boardLongEdgePt;

    const page = await renderPageToRgba(pdfPath, expected.pageIndex, scale);
    const cropRect = padNormalizedRect(expected.boardRect, SELECTION_MARGIN_FRACTION);
    const crop = cropToRgba(page, cropRect);
    const gray = rgbaToGray(crop.data, crop.width, crop.height);

    const classify = makeClassifier(gray);
    const start = performance.now();
    const result = await recognizeGray(gray, classify);
    const totalMs = performance.now() - start;

    console.log(
      JSON.stringify({
        test: 'pdf-synthetic-diagram-01 positive',
        cropWidth: crop.width,
        cropHeight: crop.height,
        totalMs,
        inferenceMs: totalInferenceMs,
        inferenceCalls,
      }),
    );

    if (result === null) {
      throw new Error('Expected recognizeGray to find a board, but it returned null.');
    }
    expect(result.placement).toBe(expected.placement);
    expect(result.reliable).toBe(true);
    expect(resolveOrientation(result.placement).orientation).toBe(expected.orientation);
  }, 60_000);

  it('reports no board on a text-only region of the negative page', async () => {
    const fixture = getFixture('pdf-synthetic-diagram-01');
    const expected = readExpectedDiagram(fixture.expected);
    const pdfPath = fixturePath(fixture.path);
    const negativePageIndex = expected.negativePages[0];
    if (negativePageIndex === undefined) {
      throw new Error('manifest expected.negativePages must list at least one page');
    }

    // Page 0's title line (see generators/lib/layout.mjs NEGATIVE_TEXT_RECT_PT
    // for why a sparse heading, not a dense paragraph, is the reliable "no
    // board" case here).
    const textRect = toNormalizedRect(NEGATIVE_TEXT_RECT_PT);

    const textRectLongEdgePt = Math.max(
      textRect.width * PAGE_WIDTH_PT,
      textRect.height * PAGE_HEIGHT_PT,
    );
    const scale = MAX_CAPTURE_LONG_EDGE_PX / textRectLongEdgePt;
    const page = await renderPageToRgba(pdfPath, negativePageIndex, scale);
    const crop = cropToRgba(page, textRect);
    const gray = rgbaToGray(crop.data, crop.width, crop.height);

    const classify = makeClassifier(gray);
    const start = performance.now();
    const result = await recognizeGray(gray, classify);
    const totalMs = performance.now() - start;

    console.log(
      JSON.stringify({
        test: 'pdf-synthetic-diagram-01 negative',
        cropWidth: crop.width,
        cropHeight: crop.height,
        totalMs,
        inferenceMs: totalInferenceMs,
        inferenceCalls,
      }),
    );

    expect(result).toBeNull();
  }, 60_000);
});
