/**
 * Issue #34 stage-separated browser observations over the locked printed-page
 * corpus. Accuracy is recorded, never asserted: these are the unchanged
 * FENShot baselines that issue #35 will compare against.
 */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { arch, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, version as nodeVersion } from 'node:process';

import {
  GRID_ERROR_SQUARES,
  MATCH_IOU,
  RELIABILITY_FLOOR,
  measureInput,
  type InputMetrics,
  type MetricAnnotation,
  type MetricPrediction,
} from '../../../packages/test-fixtures/src/corpus-metrics';
import {
  corpusPath,
  loadCorpus,
  type CorpusAnnotation,
  type CorpusPage,
} from '../../../packages/test-fixtures/src/corpus';
import { currentCommit, sha256OfFile, summarize, writeJsonReport } from './report';
import {
  isCorpusWorkerRequest,
  isCorpusWorkerResponse,
  type CorpusBrowserRun,
  type CorpusStage,
  type PixelRect,
} from './corpus.protocol';

const REPETITIONS = 3;
const MANUAL_PADDING_FRACTION = 0.08;
const INPUT_TIMEOUT_MS = 60_000;
const CORPUS_MANIFEST_PATH = corpusPath('corpus/v1/manifest.json');
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../eval-results');
const MODEL_PATH = fileURLToPath(import.meta.resolve('@scoriiu/fenshot/model/chess-tiles-v2.onnx'));
const RUNTIME_PATH = fileURLToPath(
  import.meta.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'),
);
const PINNED_MODEL_SHA256 = '883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d';
const PINNED_RUNTIME_SHA256 = 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d';

interface PlannedInput {
  readonly id: string;
  readonly stage: CorpusStage;
  readonly style: string;
  readonly annotationId: string | null;
  readonly oracle: boolean;
  readonly mode: 'classifier' | 'recognizer';
  readonly cropRect: PixelRect;
  readonly annotations: readonly MetricAnnotation[];
}

interface Observation {
  readonly pageId: string;
  readonly tags: readonly string[];
  readonly inputId: string;
  readonly stage: CorpusStage;
  readonly style: string;
  readonly annotationId: string | null;
  readonly repetition: number;
  readonly coldStart: boolean;
  readonly cropRect: PixelRect;
  readonly width: number;
  readonly height: number;
  readonly timing: {
    readonly workerTotalMs: number;
    readonly initializationMs: number | null;
    readonly recognitionMs: number;
  };
  readonly metrics: InputMetrics;
}

interface InfrastructureFailure {
  readonly pageId: string;
  readonly inputId: string | null;
  readonly repetition: number | null;
  readonly message: string;
}

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown harness failure';
  const firstLine = error.message.split('\n')[0] ?? 'unknown failure';
  const withoutUrl = firstLine.replaceAll(/https?:\/\/\S+/g, '<redacted-url>');
  const withoutPath = withoutUrl.replaceAll(
    /(?:file:\/\/)?\/(?:[^\s:]+\/)+[^\s:]+/g,
    '<redacted-path>',
  );
  return `${error.name || 'Error'}: ${withoutPath}`;
}

function workingTreeDirty(): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return true;
  }
}

function corpusSetSha256(corpus: ReturnType<typeof loadCorpus>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: corpus.schemaVersion,
        corpusId: corpus.corpusId,
        corpusVersion: corpus.corpusVersion,
        pages: corpus.pages.map(({ id, sha256 }) => ({ id, sha256 })),
      }),
    )
    .digest('hex');
}

function metricAnnotation(annotation: CorpusAnnotation, crop: PixelRect): MetricAnnotation {
  if (annotation.kind !== 'complete' || annotation.renderedPlacement === null) {
    throw new Error(`Complete metric annotation required for ${annotation.id}`);
  }
  const rect = annotation.pixelRect;
  return {
    id: annotation.id,
    corners: {
      x0: rect.x - crop.x,
      y0: rect.y - crop.y,
      x1: rect.x + rect.width - crop.x,
      y1: rect.y + rect.height - crop.y,
    },
    renderedPlacement: annotation.renderedPlacement,
    orientation: annotation.orientation,
  };
}

function exactRect(annotation: CorpusAnnotation): PixelRect {
  return { ...annotation.pixelRect };
}

function annotationStyle(annotation: CorpusAnnotation): string {
  const style = annotation.squareStyle;
  if (style.kind === 'flat') return `flat-gray-${String(style.gray)}`;
  if (style.kind === 'hatch') return `hatch-${String(style.angle)}-${style.density}`;
  return `halftone-${style.density}`;
}

function fullPageStyle(page: CorpusPage): string {
  const styles = [...new Set(page.annotations.map(annotationStyle))].sort();
  if (styles.length === 0) return 'negative';
  if (styles.length === 1) return styles[0] ?? 'negative';
  return `mixed:${styles.join('+')}`;
}

function manualRect(annotation: CorpusAnnotation, page: CorpusPage): PixelRect {
  const rect = annotation.pixelRect;
  const padding = rect.width * MANUAL_PADDING_FRACTION;
  const x0 = Math.max(0, Math.floor(rect.x - padding));
  const y0 = Math.max(0, Math.floor(rect.y - padding));
  const x1 = Math.min(page.width, Math.ceil(rect.x + rect.width + padding));
  const y1 = Math.min(page.height, Math.ceil(rect.y + rect.height + padding));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function inputsFor(page: CorpusPage): PlannedInput[] {
  const inputs: PlannedInput[] = [];
  for (const annotation of page.annotations) {
    if (annotation.kind === 'complete') {
      const cropRect = exactRect(annotation);
      inputs.push({
        id: `classifier:${annotation.id}`,
        stage: 'classifier',
        style: annotationStyle(annotation),
        annotationId: annotation.id,
        oracle: true,
        mode: 'classifier',
        cropRect,
        annotations: [metricAnnotation(annotation, cropRect)],
      });
    }
    const cropRect = manualRect(annotation, page);
    inputs.push({
      id: `manual:${annotation.id}`,
      stage: 'manual',
      style: annotationStyle(annotation),
      annotationId: annotation.id,
      oracle: false,
      mode: 'recognizer',
      cropRect,
      annotations: annotation.kind === 'complete' ? [metricAnnotation(annotation, cropRect)] : [],
    });
  }
  const fullPageRect: PixelRect = { x: 0, y: 0, width: page.width, height: page.height };
  inputs.push({
    id: `full-page:${page.id}`,
    stage: 'full-page',
    style: fullPageStyle(page),
    annotationId: null,
    oracle: false,
    mode: 'recognizer',
    cropRect: fullPageRect,
    annotations: page.annotations
      .filter((annotation) => annotation.kind === 'complete')
      .map((annotation) => metricAnnotation(annotation, fullPageRect)),
  });
  return inputs;
}

function aggregate(selected: readonly Observation[]) {
  const oracle = selected[0]?.metrics.oracle ?? null;
  if (selected.some((run) => run.metrics.oracle !== oracle)) {
    throw new Error('Cannot aggregate oracle and recognizer observations together');
  }
  const sum = (pick: (metrics: InputMetrics) => number): number =>
    selected.reduce((total, run) => total + pick(run.metrics), 0);
  const nullableSum = (
    key: 'matchedBoards' | 'missedBoards' | 'falsePositiveBoards' | 'duplicateBoards',
  ): number | null =>
    oracle === true || oracle === null
      ? null
      : selected.reduce((total, run) => total + (run.metrics[key] ?? 0), 0);
  const expectedBoards = sum((metrics) => metrics.expectedBoards);
  const expectedSquares = sum((metrics) => metrics.expectedSquares);
  const identifiableOrientations = sum((metrics) => metrics.identifiableOrientations);
  const detectionExpected = oracle ? 0 : expectedBoards;
  const detectionPredictions = oracle ? 0 : sum((metrics) => metrics.predictions);
  const matchedBoards = nullableSum('matchedBoards');
  const exactBoards = sum((metrics) => metrics.exactBoards);
  const correctSquares = sum((metrics) => metrics.correctSquares);
  const correctOrientations = sum((metrics) => metrics.correctOrientations);
  return {
    observations: selected.length,
    oracle,
    expectedBoards,
    predictions: sum((metrics) => metrics.predictions),
    matchedBoards,
    missedBoards: nullableSum('missedBoards'),
    falsePositiveBoards: nullableSum('falsePositiveBoards'),
    duplicateBoards: nullableSum('duplicateBoards'),
    noBoardObservations: selected.filter((run) => run.metrics.noBoard).length,
    detectionPrecision:
      oracle || detectionPredictions === 0 || matchedBoards === null
        ? null
        : matchedBoards / detectionPredictions,
    detectionRecall:
      oracle || detectionExpected === 0 || matchedBoards === null
        ? null
        : matchedBoards / detectionExpected,
    gridAlignedBoards: oracle ? null : sum((metrics) => metrics.gridAlignedBoards ?? 0),
    exactBoards,
    exactBoardAccuracy: expectedBoards === 0 ? null : exactBoards / expectedBoards,
    correctSquares,
    expectedSquares,
    squareAccuracy: expectedSquares === 0 ? null : correctSquares / expectedSquares,
    reliablePredictions: sum((metrics) => metrics.reliablePredictions),
    unreliablePredictions: sum((metrics) => metrics.unreliablePredictions),
    reliableExactBoards: sum((metrics) => metrics.reliableExactBoards),
    reliableWrongBoards: sum((metrics) => metrics.reliableWrongBoards),
    reliableWrongStudyPositions: sum((metrics) => metrics.reliableWrongStudyPositions),
    outOfImagePredictions: sum((metrics) => metrics.outOfImagePredictions),
    correctOrientations,
    identifiableOrientations,
    ambiguousTruthBoards: sum((metrics) => metrics.ambiguousTruthBoards),
    ambiguousPredictions: sum((metrics) => metrics.ambiguousPredictions),
    ambiguityAcknowledged: sum((metrics) => metrics.ambiguityAcknowledged),
    orientationAccuracy:
      identifiableOrientations === 0 ? null : correctOrientations / identifiableOrientations,
    initializationMs: summarize(
      selected.flatMap((run) =>
        run.timing.initializationMs === null ? [] : [run.timing.initializationMs],
      ),
    ),
    recognitionMs: summarize(selected.map((run) => run.timing.recognitionMs)),
    freshSessionFirstRecognitionMs: summarize(
      selected.filter((run) => run.coldStart).map((run) => run.timing.recognitionMs),
    ),
    warmRecognitionMs: summarize(
      selected.filter((run) => !run.coldStart).map((run) => run.timing.recognitionMs),
    ),
    workerTotalMs: summarize(selected.map((run) => run.timing.workerTotalMs)),
  };
}

function failureReasons(observation: Observation): string[] {
  const metrics = observation.metrics;
  const reasons: string[] = [];
  if ((metrics.missedBoards ?? 0) > 0) reasons.push('missed-board');
  if ((metrics.falsePositiveBoards ?? 0) > 0) reasons.push('false-positive-board');
  if ((metrics.duplicateBoards ?? 0) > 0) reasons.push('duplicate-board');
  if ((metrics.gridAlignedBoards ?? 0) < (metrics.matchedBoards ?? 0)) {
    reasons.push('grid-misaligned');
  }
  if (metrics.records.some((record) => record.comparison?.exact === false)) {
    reasons.push('classification-mismatch');
  }
  if (metrics.reliableWrongStudyPositions > 0) reasons.push('reliable-wrong-study-position');
  if (metrics.records.some((record) => record.comparison?.orientationCorrect === false)) {
    reasons.push('orientation-mismatch');
  }
  if (metrics.outOfImagePredictions > 0) reasons.push('out-of-image');
  return reasons;
}

test('worker boundary rejects oversized or malformed evidence', () => {
  const request = {
    type: 'run',
    inputId: 'probe',
    mode: 'recognizer',
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
  };
  expect(isCorpusWorkerRequest(request)).toBe(true);
  expect(
    isCorpusWorkerRequest({ ...request, width: 1025, data: new Uint8ClampedArray(4100) }),
  ).toBe(false);
  expect(isCorpusWorkerRequest({ ...request, data: new Uint8Array(4) })).toBe(false);
  expect(isCorpusWorkerRequest({ ...request, height: 0 })).toBe(false);
  expect(isCorpusWorkerResponse({ type: 'result', inputId: 'probe', predictions: [] })).toBe(false);
  expect(isCorpusWorkerResponse({ type: 'disposed', inputId: 'wrong-request' })).toBe(false);
});

test('input plan keeps partial boards out of complete truth', () => {
  const corpus = loadCorpus();
  expect(corpus.matching.iouThreshold).toBe(MATCH_IOU);
  expect(corpus.tolerance.gridErrorSquares).toBe(GRID_ERROR_SQUARES);
  for (const corpusPage of corpus.pages) {
    const inputs = inputsFor(corpusPage);
    const complete = corpusPage.annotations.filter((annotation) => annotation.kind === 'complete');
    const partial = corpusPage.annotations.filter((annotation) => annotation.kind === 'partial');
    expect(inputs.filter((input) => input.stage === 'classifier')).toHaveLength(complete.length);
    expect(inputs.filter((input) => input.stage === 'manual')).toHaveLength(
      corpusPage.annotations.length,
    );
    for (const annotation of partial) {
      expect(
        inputs.find((input) => input.id === `classifier:${annotation.id}`),
        `${corpusPage.id}/${annotation.id} must not receive oracle classification`,
      ).toBeUndefined();
      const manual = inputs.find((input) => input.id === `manual:${annotation.id}`);
      expect(manual, `${corpusPage.id}/${annotation.id} manual input`).toBeDefined();
      expect(manual?.annotations).toEqual([]);
      expect(manual?.oracle).toBe(false);
    }
    const fullPage = inputs.find((input) => input.stage === 'full-page');
    expect(fullPage?.annotations).toHaveLength(complete.length);
    expect(fullPage?.oracle).toBe(false);
  }
});

test('records unchanged FENShot stages on the locked printed corpus', async ({
  page,
  browser,
  browserName,
  baseURL,
}) => {
  test.setTimeout(30 * 60_000);
  if (!baseURL) throw new Error('baseURL must be configured');
  const corpus = loadCorpus();
  expect(corpus.lockedBeforeTuning, 'corpus must be locked before observations').toBe(true);

  const pageFiles = new Map<string, string>();
  for (const corpusPage of corpus.pages) {
    const path = corpusPath(corpusPage.path);
    pageFiles.set(`/corpus-pages/${encodeURIComponent(corpusPage.id)}.png`, path);
  }

  const allowedOrigin = new URL(baseURL).origin;
  const blocked: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== allowedOrigin) {
      blocked.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.route('**/corpus-pages/*.png', async (route) => {
    const fixturePath = pageFiles.get(new URL(route.request().url()).pathname);
    if (!fixturePath) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ path: fixturePath, contentType: 'image/png' });
  });

  const observations: Observation[] = [];
  const infrastructureFailures: InfrastructureFailure[] = [];
  let stop = false;
  try {
    expect(sha256OfFile(MODEL_PATH), 'installed model bytes must match the pinned hash').toBe(
      PINNED_MODEL_SHA256,
    );
    expect(sha256OfFile(RUNTIME_PATH), 'installed runtime bytes must match the pinned hash').toBe(
      PINNED_RUNTIME_SHA256,
    );
    for (const corpusPage of corpus.pages) {
      expect(
        sha256OfFile(corpusPath(corpusPage.path)),
        `${corpusPage.id} bytes must match the locked corpus`,
      ).toBe(corpusPage.sha256);
    }
    await page.goto('/corpus.html');
    await page.waitForFunction(() => typeof globalThis.__chessReaderCorpus.run === 'function');

    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
      let passStarted = false;
      let activePageId = 'harness';
      let activeInputId: string | null = null;
      try {
        await page.evaluate(() => {
          globalThis.__chessReaderCorpus.startPass();
        });
        passStarted = true;
        for (const corpusPage of corpus.pages) {
          activePageId = corpusPage.id;
          activeInputId = null;
          const imageUrl = `/corpus-pages/${encodeURIComponent(corpusPage.id)}.png`;
          await page.evaluate((source) => globalThis.__chessReaderCorpus.loadPage(source), {
            url: imageUrl,
            width: corpusPage.width,
            height: corpusPage.height,
          });

          for (const input of inputsFor(corpusPage)) {
            activeInputId = input.id;
            const browserRun: CorpusBrowserRun = await page.evaluate(
              (request) => globalThis.__chessReaderCorpus.run(request),
              {
                inputId: `${corpusPage.id}/${input.id}/${String(repetition)}`,
                mode: input.mode,
                cropRect: input.cropRect,
              },
            );
            if (
              browserRun.result.modelSha256 !== PINNED_MODEL_SHA256 ||
              browserRun.result.runtimeSha256 !== PINNED_RUNTIME_SHA256
            ) {
              throw new Error('Worker reported an unexpected model or runtime hash');
            }
            const predictions: readonly MetricPrediction[] = browserRun.result.predictions;
            observations.push({
              pageId: corpusPage.id,
              tags: corpusPage.tags,
              inputId: input.id,
              stage: input.stage,
              style: input.style,
              annotationId: input.annotationId,
              repetition,
              coldStart: browserRun.result.initializationMs !== null,
              cropRect: browserRun.cropRect,
              width: browserRun.width,
              height: browserRun.height,
              timing: {
                workerTotalMs: browserRun.workerTotalMs,
                initializationMs: browserRun.result.initializationMs,
                recognitionMs: browserRun.result.recognitionMs,
              },
              metrics: measureInput(input.annotations, predictions, {
                width: browserRun.width,
                height: browserRun.height,
                oracle: input.oracle,
              }),
            });
          }
        }
      } catch (error) {
        infrastructureFailures.push({
          pageId: activePageId,
          inputId: activeInputId,
          repetition,
          message: messageOf(error),
        });
        stop = true;
      } finally {
        if (passStarted) {
          try {
            await page.evaluate(() => globalThis.__chessReaderCorpus.endPass());
          } catch (error) {
            infrastructureFailures.push({
              pageId: activePageId,
              inputId: activeInputId,
              repetition,
              message: messageOf(error),
            });
            stop = true;
          }
        }
      }
      if (stop) break;
    }
  } catch (error) {
    infrastructureFailures.push({
      pageId: 'harness',
      inputId: null,
      repetition: null,
      message: messageOf(error),
    });
    stop = true;
  } finally {
    const stages: readonly CorpusStage[] = ['classifier', 'manual', 'full-page'];
    const tags = [...new Set(corpus.pages.flatMap((corpusPage) => corpusPage.tags))].sort();
    const styles = [
      ...new Set(
        corpus.pages.flatMap((corpusPage) => inputsFor(corpusPage).map((input) => input.style)),
      ),
    ].sort();
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const report = {
      schemaVersion: 1,
      suite: 'issue-34-corpus',
      command: 'pnpm eval:recognition',
      commit: currentCommit(),
      workingTreeDirty: workingTreeDirty(),
      date: new Date().toISOString(),
      environment: {
        node: nodeVersion,
        os: platform,
        release: release(),
        arch: arch(),
        ci: !!process.env['CI'],
      },
      browser: { name: browserName, version: browser.version() },
      corpus: {
        id: corpus.corpusId,
        version: corpus.corpusVersion,
        manifestSchemaVersion: corpus.schemaVersion,
        manifestSha256: sha256OfFile(CORPUS_MANIFEST_PATH),
        fixtureSetSha256: corpusSetSha256(corpus),
        lockedBeforeTuning: corpus.lockedBeforeTuning,
        pages: corpus.pages.map(({ id, sha256, width, height, tags: pageTags }) => ({
          id,
          sha256,
          width,
          height,
          tags: pageTags,
        })),
      },
      recognizer: {
        version: 'fenshot-0.1.4/chess-tiles-v2/ort-web-1.29.0',
        fenshot: '0.1.4',
        runtime: 'onnxruntime-web-1.29.0/wasm/single-thread',
        threads: 1,
        modelSha256: sha256OfFile(MODEL_PATH),
        modelBytes: statSync(MODEL_PATH).size,
        runtimeSha256: sha256OfFile(RUNTIME_PATH),
        runtimeBytes: statSync(RUNTIME_PATH).size,
      },
      sourceSha256: {
        spec: sha256OfFile(fileURLToPath(import.meta.url)),
        browser: sha256OfFile(resolve(sourceRoot, 'corpus.ts')),
        worker: sha256OfFile(resolve(sourceRoot, 'corpus.worker.ts')),
        protocol: sha256OfFile(resolve(sourceRoot, 'corpus.protocol.ts')),
        metrics: sha256OfFile(
          resolve(sourceRoot, '../../../packages/test-fixtures/src/corpus-metrics.ts'),
        ),
      },
      repetitions: REPETITIONS,
      manualPaddingFractionPerSide: MANUAL_PADDING_FRACTION,
      workerTimeoutMs: INPUT_TIMEOUT_MS,
      policy: {
        matchingIou: MATCH_IOU,
        gridErrorSquares: GRID_ERROR_SQUARES,
        reliabilityFloor: RELIABILITY_FLOOR,
        partialAnnotations: 'excluded-from-complete-truth',
        duplicatePredictions: 'failure',
      },
      summary: {
        overall: {
          observations: observations.length,
          plannedInputsPerPass: corpus.pages.reduce(
            (total, corpusPage) => total + inputsFor(corpusPage).length,
            0,
          ),
          workerSessions: REPETITIONS,
          initializationObservations: observations.filter((run) => run.coldStart).length,
        },
        byStage: Object.fromEntries(
          stages.map((stage) => [
            stage,
            aggregate(observations.filter((run) => run.stage === stage)),
          ]),
        ),
        byStageTag: Object.fromEntries(
          stages.flatMap((stage) =>
            tags.flatMap((tag) => {
              const selected = observations.filter(
                (run) => run.stage === stage && run.tags.includes(tag),
              );
              return selected.length === 0 ? [] : [[`${stage}/${tag}`, aggregate(selected)]];
            }),
          ),
        ),
        byStageStyle: Object.fromEntries(
          stages.flatMap((stage) =>
            styles.flatMap((style) => {
              const selected = observations.filter(
                (run) => run.stage === stage && run.style === style,
              );
              return selected.length === 0 ? [] : [[`${stage}/${style}`, aggregate(selected)]];
            }),
          ),
        ),
        byInput: Object.fromEntries(
          corpus.pages.flatMap((corpusPage) =>
            inputsFor(corpusPage).map((input) => {
              const key = `${corpusPage.id}/${input.id}`;
              return [
                key,
                aggregate(
                  observations.filter(
                    (run) => run.pageId === corpusPage.id && run.inputId === input.id,
                  ),
                ),
              ];
            }),
          ),
        ),
      },
      failures: observations
        .map((observation) => ({
          pageId: observation.pageId,
          inputId: observation.inputId,
          stage: observation.stage,
          annotationId: observation.annotationId,
          repetition: observation.repetition,
          reasons: failureReasons(observation),
        }))
        .filter((failure) => failure.reasons.length > 0),
      observations,
      infrastructureFailures,
      nonSameOriginRequests: blocked,
      limitations: [
        'Oracle classifier inputs use locked ground-truth geometry and are diagnostic only.',
        'Laptop Playwright browsers are not physical-iPad evidence.',
        'FENShot returns at most one board per recognizer input; misses and duplicate behavior remain visible in the metrics.',
        'Pinned FENShot always proposes white or black and has no orientation-abstention signal.',
        'Page tags overlap; byStageStyle uses the target board style or an explicit mixed full-page style.',
        'Stage timing excludes RGBA-to-gray conversion, image decode/crop, transport, initialization and the product editor; peak worker memory is unmeasured.',
      ],
    };
    writeJsonReport(resolve(REPORT_DIR, `corpus-${browserName}.json`), report);
    console.log(JSON.stringify(report.summary.byStage));
  }

  expect(blocked, 'corpus evaluation must not contact any other origin').toEqual([]);
  expect(infrastructureFailures, 'corpus harness infrastructure must remain valid').toEqual([]);
  expect(stop, 'corpus harness must reach every planned observation').toBe(false);
  const plannedInputs = corpus.pages.reduce(
    (total, corpusPage) => total + inputsFor(corpusPage).length,
    0,
  );
  expect(observations).toHaveLength(plannedInputs * REPETITIONS);
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    expect(
      observations.filter((run) => run.repetition === repetition && run.coldStart),
    ).toHaveLength(1);
  }
});
