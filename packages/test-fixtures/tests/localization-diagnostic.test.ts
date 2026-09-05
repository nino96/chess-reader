/** Issue #24 causal experiment. Both paths see identical PDF-rendered pixels,
 * preprocessing, model and orientation code. Only the source of corners changes.
 * Oracle bounds are diagnostic ground truth, NEVER a production mitigation.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';
import {
  CONFIDENCE_FLOOR,
  extractTiles,
  probsToPlacement,
  recognizeGray,
  resolveOrientation,
  rgbaToGray,
  type BoardCorners,
  type GrayImage,
  type RecognitionResult,
} from '@scoriiu/fenshot';
import * as ort from 'onnxruntime-web/wasm';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';

import {
  BOARD_LEFT_PT,
  BOARD_SIZE_PT,
  BOARD_TOP_GAP_PT,
  PLACEMENT_FEN,
} from '../generators/lib/layout.mjs';
import { fixturePath, getFixture } from '../src/index';

const SWEEP = process.env['CHESS_READER_DIAGNOSTIC_SWEEP'] === '1';
const EDGES = SWEEP ? [320, 384, 512, 640, 768, 896, 1024, 1280] : [512, 1024];
const MARGINS = SWEEP ? [0, 0.01, 0.02, 0.03, 0.05, 0.08] : [0.03];
const STYLES = ['flat', 'hatched'] as const;

interface DiagnosticRun {
  style: (typeof STYLES)[number];
  edge: number;
  margin: number;
  truth: BoardCorners;
  normal: ReturnType<typeof measure>;
  bounded: ReturnType<typeof measure>;
  oracle: ReturnType<typeof measure>;
  candidates: ReturnType<typeof measure>[];
  normalMs: number;
  oracleMs: number;
}

function squares(placement: string): string[] {
  return Array.from(placement.replaceAll('/', '')).flatMap((ch) =>
    /^[1-8]$/.test(ch) ? Array<string>(Number(ch)).fill('1') : [ch],
  );
}

function iou(a: BoardCorners, b: BoardCorners): number {
  const overlap =
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return overlap / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - overlap);
}

function measure(
  read: RecognitionResult | null,
  corners: BoardCorners | null,
  truth: BoardCorners,
) {
  const actual = read ? squares(read.placement) : [];
  const expected = squares(PLACEMENT_FEN);
  const mismatches = expected.flatMap((piece, index) => (actual[index] === piece ? [] : [index]));
  return {
    detected: read !== null,
    exact: read?.placement === PLACEMENT_FEN,
    correctSquares: 64 - mismatches.length,
    // Indices only: diagnostic artifacts do not contain positions or square labels.
    mismatchIndicesTopLeft: mismatches,
    orientationCorrect: read ? resolveOrientation(read.placement).orientation === 'white' : null,
    reliable: read ? read.minConfidence >= CONFIDENCE_FLOOR : false,
    minConfidence: read?.minConfidence ?? null,
    meanConfidence: read?.meanConfidence ?? null,
    corners,
    iou: corners ? iou(corners, truth) : null,
  };
}

function inBounds(corners: BoardCorners, edge: number): boolean {
  return corners.x0 >= 0 && corners.y0 >= 0 && corners.x1 <= edge && corners.y1 <= edge;
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted[sorted.length - 1],
  };
}

/** Render directly to the bounded selection canvas at a controlled resolution.
 * Unlike product capture, retain fractional translation (no rounded full-page
 * crop or 4x upscale cap). This isolates the stages, not the capture adapter.
 */
async function capture(
  pdfBytes: Uint8Array,
  edge: number,
  margin: number,
): Promise<{
  gray: GrayImage;
  truth: BoardCorners;
}> {
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(2);
    const side = BOARD_SIZE_PT * (1 + 2 * margin);
    const scale = edge / side;
    const canvas = createCanvas(edge, edge);
    const context = canvas.getContext('2d');
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale }),
      transform: [
        1,
        0,
        0,
        1,
        -(BOARD_LEFT_PT - BOARD_SIZE_PT * margin) * scale,
        -(BOARD_TOP_GAP_PT - BOARD_SIZE_PT * margin) * scale,
      ],
    }).promise;
    const inset = BOARD_SIZE_PT * margin * scale;
    return {
      gray: rgbaToGray(context.getImageData(0, 0, edge, edge).data, edge, edge),
      truth: { x0: inset, y0: inset, x1: edge - inset, y1: edge - inset },
    };
  } finally {
    await task.destroy();
  }
}

it('isolates localization from classification on the locked flat/hatch pair', async () => {
  ort.env.wasm.numThreads = 1;
  const modelBytes = await readFile(
    fileURLToPath(import.meta.resolve('@scoriiu/fenshot/model/chess-tiles-v2.onnx')),
  );
  const initStart = performance.now();
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
  const initializationMs = performance.now() - initStart;
  const runs: DiagnosticRun[] = [];
  const fixtures = [];
  try {
    for (const style of STYLES) {
      const fixture = getFixture(
        style === 'flat' ? 'pdf-synthetic-diagram-01' : 'pdf-synthetic-hatched-01',
      );
      const bytes = await readFile(fixturePath(fixture.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
      fixtures.push({ id: fixture.id, sha256: fixture.sha256 });
      for (const edge of EDGES) {
        for (const margin of MARGINS) {
          const { gray, truth } = await capture(bytes, edge, margin);
          const candidates: ReturnType<typeof measure>[] = [];
          const classify = async (corners: BoardCorners) => {
            const output = await session.run({
              tiles: new ort.Tensor('float32', extractTiles(gray, corners), [64, 1024]),
            });
            const probs = output['probs']?.data;
            if (!(probs instanceof Float32Array)) throw new Error('Expected float32 probabilities');
            return probsToPlacement(probs);
          };
          const start = performance.now();
          const normal = await recognizeGray(gray, async (corners) => {
            const read = await classify(corners);
            candidates.push(measure(read, corners, truth));
            return read;
          });
          const normalMs = performance.now() - start;
          // Smallest safety-only experiment: reject the chosen external box.
          // Does not use truth or pretend rejection recovers the position.
          const bounded = normal && inBounds(normal.corners, edge) ? normal : null;
          const oracleStart = performance.now();
          const oracle = await classify(truth);
          runs.push({
            style,
            edge,
            margin,
            truth,
            normal: measure(normal, normal?.corners ?? null, truth),
            bounded: measure(bounded, bounded?.corners ?? null, truth),
            oracle: measure(oracle, truth, truth),
            candidates,
            normalMs,
            oracleMs: performance.now() - oracleStart,
          });
        }
      }
    }
  } finally {
    await session.release();
  }
  const summary = STYLES.map((style) => {
    const selected = runs.filter((run) => run.style === style);
    return {
      style,
      runs: selected.length,
      normalMs: distribution(selected.map((run) => run.normalMs)),
      oracleMs: distribution(selected.map((run) => run.oracleMs)),
      paths: (['normal', 'bounded', 'oracle'] as const).map((path) => ({
        path,
        detected: selected.filter((run) => run[path].detected).length,
        noBoard: selected.filter((run) => !run[path].detected).length,
        notReliable: selected.filter((run) => !run[path].reliable).length,
        exact: selected.filter((run) => run[path].exact).length,
        reliableExact: selected.filter((run) => run[path].exact && run[path].reliable).length,
        acceptedWrong: selected.filter((run) => !run[path].exact && run[path].reliable).length,
        squareAccuracy:
          selected.reduce((sum, run) => sum + run[path].correctSquares, 0) / (64 * selected.length),
        localized: selected.filter((run) => (run[path].iou ?? 0) >= 0.9).length,
        orientationCorrect: selected.filter((run) => run[path].orientationCorrect).length,
      })),
    };
  });
  const outputDir = fixturePath('eval-results');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    `${outputDir}/localization-diagnostic${SWEEP ? '-sweep' : ''}.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suite: 'issue-24-localization-diagnostic',
        command: `${SWEEP ? 'CHESS_READER_DIAGNOSTIC_SWEEP=1 ' : ''}pnpm test:unit --project test-fixtures localization-diagnostic`,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        workingTreeDirty:
          execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
        date: new Date().toISOString(),
        environment: {
          node: process.version,
          os: process.platform,
          release: release(),
          arch: arch(),
          browser: null,
        },
        fixtureManifestSchemaVersion: 1,
        fixtures,
        recognizer: 'fenshot-0.1.4/chess-tiles-v2',
        runtime: 'onnxruntime-web-1.29.0/wasm/single-thread',
        modelSha256: createHash('sha256').update(modelBytes).digest('hex'),
        modelBytes: modelBytes.length,
        diagnosticSourceSha256: createHash('sha256')
          .update(await readFile(fileURLToPath(import.meta.url)))
          .digest('hex'),
        initializationMs,
        limitations: [
          'Oracle requires ground truth; not a production candidate.',
          'Single position, piece set and hatch angle/density; not the issue #24 feasibility corpus.',
          'Node PDF rasterizer; browser-worker and physical-iPad evidence remain separate.',
        ],
        summary,
        runs,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify(summary));
  // This is an attribution experiment, not an assertion that upstream meets
  // the product gate. Keep the existing real-model golden gate unchanged.
  expect(runs).toHaveLength(STYLES.length * EDGES.length * MARGINS.length);
  for (const run of runs) {
    expect(run.oracle.detected).toBe(true);
    expect(run.oracle.iou).toBe(1);
    if (run.margin === 0.03 && [512, 1024].includes(run.edge)) {
      expect(run.oracle.exact, `${run.style}/${String(run.edge)} oracle`).toBe(true);
      expect(run.oracle.reliable).toBe(true);
    }
    if (run.normal.corners && !inBounds(run.normal.corners, run.edge)) {
      expect(run.bounded.detected).toBe(false);
    }
  }
}, 180_000);
