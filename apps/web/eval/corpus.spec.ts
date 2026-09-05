/**
 * Stage-separated browser observations over the locked printed-page corpus.
 * Issue #34's unchanged FENShot control and issue #35's bounded localization
 * candidate use one runner, but retain separate tests and reports.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
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
import { LOCALIZATION_VERSION } from '../src/recognition/experimentalLocalization';
import {
  candidateEvaluationContext,
  type CandidateEvaluationContext,
} from './localized.assessment';
import { currentCommit, sha256OfFile, summarize, writeJsonReport } from './report';
import {
  isCorpusWorkerRequest,
  isCorpusWorkerResponse,
  type CorpusBrowserRun,
  type CorpusCandidate,
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
const LOCKED_CORPUS_MANIFEST_SHA256 =
  '767c0e91c7c685495a8d1be37fc8605208ca9e2dc6b672c39ea2d47567189b7a';
const ISSUE_34_BASELINE_SHA256: Readonly<Record<string, string>> = {
  chromium: 'b77771e51053af396deebd0abd9cd89123eaa86c34dcaa5ed446eb1b6df8ba78',
  firefox: '2ab1105682173cee9adc5166bc14eea835e65187c84a7496806be72e01038756',
  webkit: '7c5c01bc518873aacaefced816a4967b20ed786ab5f166f2dd82a2c4e332884d',
};
const DEVELOPMENT_PAGE_IDS = [
  'flat-gray-middlegame-white',
  'matched-hatch-45-middlegame-white',
] as const;
const DEVELOPMENT_PAGE_ID_SET = new Set<string>(DEVELOPMENT_PAGE_IDS);

type CorpusSplit = 'development' | 'held-out';

interface CandidateDefinition {
  readonly option: CorpusCandidate;
  readonly id: string;
  readonly suite: string;
  readonly testName: string;
  readonly reportName: (browserName: string) => string;
  readonly maximumPredictions: 1 | 4;
}

const UPSTREAM_CANDIDATE: CandidateDefinition = {
  option: 'upstream',
  id: 'fenshot-0.1.4-upstream-control',
  suite: 'issue-34-corpus',
  testName: 'records unchanged FENShot stages on the locked printed corpus',
  reportName: (browserName) => `corpus-${browserName}.json`,
  maximumPredictions: 1,
};
const LOCALIZED_CANDIDATE: CandidateDefinition = {
  option: 'localized',
  id: `fenshot-0.1.4/${LOCALIZATION_VERSION}`,
  suite: 'issue-35-localization-candidate',
  testName: 'records the bounded localization candidate on the locked printed corpus',
  reportName: (browserName) => `corpus-localized-${browserName}.json`,
  maximumPredictions: 4,
};
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
  readonly candidate: CorpusCandidate;
  readonly pageId: string;
  readonly split: CorpusSplit;
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

type AggregateObservation = Pick<Observation, 'coldStart' | 'metrics' | 'timing'>;

interface CandidateSummary {
  readonly byStage: Record<string, ReturnType<typeof aggregate>>;
  readonly byStageStyle: Record<string, ReturnType<typeof aggregate>>;
  readonly bySplitStage: Record<string, ReturnType<typeof aggregate>>;
  readonly bySplitStageStyle: Record<string, ReturnType<typeof aggregate>>;
}

const completedSummaries = new Map<string, Partial<Record<CorpusCandidate, CandidateSummary>>>();

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

function sourceSha256(sourceRoot: string): Record<string, string> {
  return {
    spec: sha256OfFile(fileURLToPath(import.meta.url)),
    browser: sha256OfFile(resolve(sourceRoot, 'corpus.ts')),
    worker: sha256OfFile(resolve(sourceRoot, 'corpus.worker.ts')),
    protocol: sha256OfFile(resolve(sourceRoot, 'corpus.protocol.ts')),
    reportWriter: sha256OfFile(resolve(sourceRoot, 'report.ts')),
    viteConfig: sha256OfFile(resolve(sourceRoot, '../vite.corpus.config.ts')),
    recognitionAssets: sha256OfFile(resolve(sourceRoot, '../src/recognition/assets.ts')),
    corpusManifestParser: sha256OfFile(
      resolve(sourceRoot, '../../../packages/test-fixtures/src/corpus.ts'),
    ),
    metrics: sha256OfFile(
      resolve(sourceRoot, '../../../packages/test-fixtures/src/corpus-metrics.ts'),
    ),
    candidateAssessment: sha256OfFile(resolve(sourceRoot, 'localized.assessment.ts')),
    candidateLocalization: sha256OfFile(
      resolve(sourceRoot, '../src/recognition/experimentalLocalization.ts'),
    ),
  };
}

function corpusInputPlanSha256(corpus: ReturnType<typeof loadCorpus>): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        corpus.pages.map((page) => ({
          pageId: page.id,
          inputs: inputsFor(page).map((input) => ({
            id: input.id,
            stage: input.stage,
            annotationId: input.annotationId,
            oracle: input.oracle,
            mode: input.mode,
            cropRect: input.cropRect,
            truthAnnotationIds: input.annotations.map((annotation) => annotation.id),
          })),
        })),
      ),
    )
    .digest('hex');
}

function corpusSplit(pageId: string): CorpusSplit {
  return DEVELOPMENT_PAGE_ID_SET.has(pageId) ? 'development' : 'held-out';
}

function splitStageGroups<T extends { readonly split: CorpusSplit; readonly stage: CorpusStage }>(
  values: readonly T[],
): Record<string, readonly T[]> {
  const stages: readonly CorpusStage[] = ['classifier', 'manual', 'full-page'];
  return Object.fromEntries(
    (['development', 'held-out'] as const).flatMap((split) =>
      stages.map((stage) => [
        `${split}/${stage}`,
        values.filter((value) => value.split === split && value.stage === stage),
      ]),
    ),
  );
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

function plannedMetrics(input: PlannedInput): InputMetrics {
  const predictions: readonly MetricPrediction[] = input.oracle
    ? input.annotations.map((annotation) => ({
        corners: annotation.corners,
        placement: annotation.renderedPlacement,
        minConfidence: 1,
        meanConfidence: 1,
        confidences: Array<number>(64).fill(1),
        orientation: annotation.orientation === 'black' ? 'black' : 'white',
        orientationAmbiguous: false,
      }))
    : [];
  return measureInput(input.annotations, predictions, {
    width: input.cropRect.width,
    height: input.cropRect.height,
    oracle: input.oracle,
  });
}

function aggregate(selected: readonly AggregateObservation[]) {
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

const COMPARISON_METRICS = [
  'predictions',
  'matchedBoards',
  'missedBoards',
  'falsePositiveBoards',
  'duplicateBoards',
  'detectionPrecision',
  'detectionRecall',
  'gridAlignedBoards',
  'exactBoards',
  'exactBoardAccuracy',
  'correctSquares',
  'squareAccuracy',
  'reliablePredictions',
  'unreliablePredictions',
  'reliableExactBoards',
  'reliableWrongBoards',
  'reliableWrongStudyPositions',
  'outOfImagePredictions',
  'correctOrientations',
  'orientationAccuracy',
] as const;

function compareAggregate(
  upstream: ReturnType<typeof aggregate>,
  localized: ReturnType<typeof aggregate>,
) {
  return {
    upstream,
    localized,
    localizedMinusUpstream: Object.fromEntries(
      COMPARISON_METRICS.map((metric) => {
        const upstreamValue = upstream[metric];
        const localizedValue = localized[metric];
        return [
          metric,
          typeof upstreamValue === 'number' && typeof localizedValue === 'number'
            ? localizedValue - upstreamValue
            : null,
        ];
      }),
    ),
  };
}

function compareGroups(
  upstream: Record<string, ReturnType<typeof aggregate>>,
  localized: Record<string, ReturnType<typeof aggregate>>,
) {
  const keys = [...new Set([...Object.keys(upstream), ...Object.keys(localized)])].sort();
  return Object.fromEntries(
    keys.map((key) => {
      const upstreamGroup = upstream[key];
      const localizedGroup = localized[key];
      if (!upstreamGroup || !localizedGroup) {
        throw new Error(`Candidate summaries do not share comparison group ${key}`);
      }
      return [key, compareAggregate(upstreamGroup, localizedGroup)];
    }),
  );
}

test('worker boundary rejects oversized or malformed evidence', () => {
  const request = {
    type: 'run',
    inputId: 'probe',
    candidate: 'upstream',
    mode: 'recognizer',
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
  };
  expect(isCorpusWorkerRequest(request)).toBe(true);
  const requestWithoutCandidate: Record<string, unknown> = { ...request };
  delete requestWithoutCandidate['candidate'];
  expect(isCorpusWorkerRequest(requestWithoutCandidate)).toBe(false);
  expect(isCorpusWorkerRequest({ ...request, candidate: 'unknown' })).toBe(false);
  expect(isCorpusWorkerRequest({ ...request, expectedBoardCount: 1 })).toBe(false);
  expect(
    isCorpusWorkerRequest({ ...request, width: 1025, data: new Uint8ClampedArray(4100) }),
  ).toBe(false);
  expect(isCorpusWorkerRequest({ ...request, data: new Uint8Array(4) })).toBe(false);
  expect(isCorpusWorkerRequest({ ...request, height: 0 })).toBe(false);
  expect(isCorpusWorkerRequest({ type: 'dispose', inputId: 'dispose' })).toBe(true);
  expect(
    isCorpusWorkerRequest({ type: 'dispose', inputId: 'dispose', candidate: 'upstream' }),
  ).toBe(false);
  expect(isCorpusWorkerResponse({ type: 'result', inputId: 'probe', predictions: [] })).toBe(false);
  expect(isCorpusWorkerResponse({ type: 'disposed', inputId: 'wrong-request' })).toBe(false);
});

test('worker boundary accepts no more than four identified candidate predictions', () => {
  const prediction = {
    corners: { x0: 0, y0: 0, x1: 8, y1: 8 },
    placement: '8/8/8/8/8/8/8/8',
    confidences: Array<number>(64).fill(0.9),
    minConfidence: 0.9,
    meanConfidence: 0.9,
    orientation: 'white',
    orientationAmbiguous: false,
  };
  const response = {
    type: 'result',
    inputId: 'probe',
    candidate: 'localized',
    predictions: Array(4).fill(prediction),
    initializationMs: null,
    recognitionMs: 1,
    modelSha256: 'a'.repeat(64),
    runtimeSha256: 'b'.repeat(64),
  };
  expect(isCorpusWorkerResponse(response)).toBe(true);
  expect(isCorpusWorkerResponse({ ...response, predictions: Array(5).fill(prediction) })).toBe(
    false,
  );
  expect(isCorpusWorkerResponse({ ...response, candidate: 'unknown' })).toBe(false);
  const responseWithoutCandidate: Record<string, unknown> = { ...response };
  delete responseWithoutCandidate['candidate'];
  expect(isCorpusWorkerResponse(responseWithoutCandidate)).toBe(false);
});

test('input plan keeps partial boards out of complete truth', () => {
  const corpus = loadCorpus();
  expect(corpus.matching.iouThreshold).toBe(MATCH_IOU);
  expect(corpus.tolerance.gridErrorSquares).toBe(GRID_ERROR_SQUARES);
  expect(
    corpus.pages.filter((page) => corpusSplit(page.id) === 'development').map((page) => page.id),
  ).toEqual(DEVELOPMENT_PAGE_IDS);
  expect(corpus.pages.filter((page) => corpusSplit(page.id) === 'held-out')).toHaveLength(14);
  expect(corpus.pages.reduce((total, page) => total + inputsFor(page).length, 0)).toBe(46);
  const plannedGroups = splitStageGroups(
    corpus.pages.flatMap((page) =>
      inputsFor(page).map((input) => ({
        split: corpusSplit(page.id),
        stage: input.stage,
        oracle: input.oracle,
        coldStart: false,
        timing: { workerTotalMs: 0, initializationMs: null, recognitionMs: 0 },
        metrics: plannedMetrics(input),
      })),
    ),
  );
  for (const [key, inputs] of Object.entries(plannedGroups)) {
    expect(inputs, `${key} must be represented in the 46-input plan`).not.toHaveLength(0);
    expect(
      [...new Set(inputs.map((input) => input.oracle))],
      `${key} must not mix oracle and recognizer measurements`,
    ).toHaveLength(1);
    expect(
      () => aggregate(inputs),
      `${key} summary must accept its planned observations`,
    ).not.toThrow();
  }
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

async function runCorpusCandidate(
  candidate: CandidateDefinition,
  evaluation: CandidateEvaluationContext,
  fixtures: {
    readonly page: Page;
    readonly browser: Browser;
    readonly browserName: string;
    readonly baseURL: string | undefined;
  },
): Promise<void> {
  const { page, browser, browserName, baseURL } = fixtures;
  const reportDirectory = resolve(REPORT_DIR, evaluation.reportSubdirectory);
  test.setTimeout(30 * 60_000);
  if (!baseURL) throw new Error('baseURL must be configured');
  const corpus = loadCorpus();
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const sourceSha256BeforeRun = sourceSha256(sourceRoot);
  const manifestSha256 = sha256OfFile(CORPUS_MANIFEST_PATH);
  const historicalBaselinePath = resolve(
    sourceRoot,
    `../../../docs/eval-baselines/issue-34-corpus-${browserName}.json`,
  );
  const historicalBaselineSha256 = sha256OfFile(historicalBaselinePath);
  const expectedHistoricalBaselineSha256 = ISSUE_34_BASELINE_SHA256[browserName];
  if (!expectedHistoricalBaselineSha256) {
    throw new Error(`No locked issue #34 baseline hash is declared for ${browserName}`);
  }
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
  let workerRequestToken = 0;
  let stop = false;
  try {
    expect(manifestSha256, 'corpus v1 manifest must remain byte-identical').toBe(
      LOCKED_CORPUS_MANIFEST_SHA256,
    );
    expect(historicalBaselineSha256, 'issue #34 browser baseline must remain byte-identical').toBe(
      expectedHistoricalBaselineSha256,
    );
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
            const opaqueWorkerInputId = String(workerRequestToken);
            workerRequestToken += 1;
            const browserRun: CorpusBrowserRun = await page.evaluate(
              (request) => globalThis.__chessReaderCorpus.run(request),
              {
                inputId: opaqueWorkerInputId,
                candidate: candidate.option,
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
            if (browserRun.result.candidate !== candidate.option) {
              throw new Error('Worker reported an unexpected candidate identity');
            }
            if (browserRun.result.predictions.length > candidate.maximumPredictions) {
              throw new Error('Worker returned more predictions than the candidate permits');
            }
            const predictions: readonly MetricPrediction[] = browserRun.result.predictions;
            observations.push({
              candidate: candidate.option,
              pageId: corpusPage.id,
              split: corpusSplit(corpusPage.id),
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
    if (JSON.stringify(sourceSha256(sourceRoot)) !== JSON.stringify(sourceSha256BeforeRun)) {
      throw new Error('Evaluation source changed during the corpus run');
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
    const report = {
      schemaVersion: 2,
      suite: candidate.suite,
      command: evaluation.command,
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
        manifestSha256,
        fixtureSetSha256: corpusSetSha256(corpus),
        inputPlanSha256: corpusInputPlanSha256(corpus),
        lockedBeforeTuning: corpus.lockedBeforeTuning,
        pages: corpus.pages.map(({ id, sha256, width, height, tags: pageTags }) => ({
          id,
          sha256,
          width,
          height,
          tags: pageTags,
        })),
      },
      historicalIssue34Baseline: {
        status: 'preserved-reference',
        file: `issue-34-corpus-${browserName}.json`,
        sha256: historicalBaselineSha256,
        caveat:
          'This known baseline is retained for auditability; the current comparison reruns the control from the same harness and is not blind validation.',
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
      candidate: {
        option: candidate.option,
        id: candidate.id,
        maximumPredictionsPerInput: candidate.maximumPredictions,
        localizationVersion: candidate.option === 'localized' ? LOCALIZATION_VERSION : null,
        sourceSha256BeforeRun:
          candidate.option === 'localized' ? sourceSha256BeforeRun['candidateLocalization'] : null,
        localizationModuleLoad:
          candidate.option === 'localized'
            ? 'lazy; first recognizer-stage load/evaluation is included in recognitionMs'
            : 'not loaded by the control path',
        exactBoundClassifier: 'unchanged-and-shared',
        manualSelectionHint: 'crop-pixels-only; no geometry or annotation is sent to the worker',
        fullPageHints: 'none',
      },
      sourceSha256: sourceSha256BeforeRun,
      repetitions: REPETITIONS,
      manualPaddingFractionPerSide: MANUAL_PADDING_FRACTION,
      workerTimeoutMs: INPUT_TIMEOUT_MS,
      policy: {
        matchingIou: MATCH_IOU,
        gridErrorSquares: GRID_ERROR_SQUARES,
        reliabilityFloor: RELIABILITY_FLOOR,
        partialAnnotations: 'excluded-from-complete-truth',
        duplicatePredictions: 'failure',
        split: {
          developmentPageIds: DEVELOPMENT_PAGE_IDS,
          heldOutPageIds: corpus.pages
            .map((corpusPage) => corpusPage.id)
            .filter((id) => !DEVELOPMENT_PAGE_ID_SET.has(id)),
          declaration:
            'Only the matched flat/hatch page pair and separate synthetic unit images may tune localization. All other corpus pages are held out from mitigation tuning.',
          historicalBaselineKnown:
            'The issue #34 upstream results were known before this split, so held-out candidate results are historical-baseline comparisons, not blind validation.',
        },
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
        bySplitStage: Object.fromEntries(
          Object.entries(splitStageGroups(observations)).map(([key, selected]) => [
            key,
            aggregate(selected),
          ]),
        ),
        bySplitStageStyle: Object.fromEntries(
          (['development', 'held-out'] as const).flatMap((split) =>
            stages.flatMap((stage) =>
              styles.flatMap((style) => {
                const selected = observations.filter(
                  (run) => run.split === split && run.stage === stage && run.style === style,
                );
                return selected.length === 0
                  ? []
                  : [[`${split}/${stage}/${style}`, aggregate(selected)]];
              }),
            ),
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
        'Host Playwright browsers are not physical-iPad evidence.',
        `${candidate.id} returns at most ${String(candidate.maximumPredictions)} board(s) per recognizer input; misses and duplicate behavior remain visible in the metrics.`,
        'Pinned FENShot always proposes white or black and has no orientation-abstention signal.',
        'Page tags overlap; byStageStyle uses the target board style or an explicit mixed full-page style.',
        'Stage timing excludes RGBA-to-gray conversion, image decode/crop, transport, initialization and the product editor.',
        'For localized sessions, the first recognizer-stage recognitionMs includes lazy candidate-module loading and evaluation; model coldStart may already have been recorded by the preceding classifier control.',
        'Peak dedicated-worker/WASM memory is unavailable through a reliable cross-browser API and is not inferred from main-page JavaScript heap samples.',
      ],
    };
    writeJsonReport(resolve(reportDirectory, candidate.reportName(browserName)), report);
    const previous = completedSummaries.get(browserName) ?? {};
    previous[candidate.option] = report.summary;
    completedSummaries.set(browserName, previous);
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
  expect(
    observations
      .filter(
        (observation) =>
          observation.metrics.reliableWrongBoards > 0 ||
          observation.metrics.reliableWrongStudyPositions > 0,
      )
      .map((observation) => ({
        pageId: observation.pageId,
        inputId: observation.inputId,
        repetition: observation.repetition,
        reliableWrongBoards: observation.metrics.reliableWrongBoards,
        reliableWrongStudyPositions: observation.metrics.reliableWrongStudyPositions,
      })),
    'reliable-wrong corpus results are unsafe in measurement and qualification modes',
  ).toEqual([]);
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    expect(
      observations.filter((run) => run.repetition === repetition && run.coldStart),
    ).toHaveLength(1);
  }
}

test.describe.serial('locked corpus candidate comparison', () => {
  test(UPSTREAM_CANDIDATE.testName, ({ page, browser, browserName, baseURL }, testInfo) =>
    runCorpusCandidate(
      UPSTREAM_CANDIDATE,
      candidateEvaluationContext(testInfo.config.metadata['candidateEvaluationMode']),
      { page, browser, browserName, baseURL },
    ),
  );
  test(LOCALIZED_CANDIDATE.testName, ({ page, browser, browserName, baseURL }, testInfo) =>
    runCorpusCandidate(
      LOCALIZED_CANDIDATE,
      candidateEvaluationContext(testInfo.config.metadata['candidateEvaluationMode']),
      { page, browser, browserName, baseURL },
    ),
  );

  test('writes a paired control/localization comparison by stage, style, and split', ({
    browser,
    browserName,
  }, testInfo) => {
    const evaluation = candidateEvaluationContext(
      testInfo.config.metadata['candidateEvaluationMode'],
    );
    const summaries = completedSummaries.get(browserName);
    const upstream = summaries?.upstream;
    const localized = summaries?.localized;
    expect(upstream, 'the unchanged control report must complete first').toBeDefined();
    expect(localized, 'the localization candidate report must complete first').toBeDefined();
    if (!upstream || !localized) return;

    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const corpus = loadCorpus();
    const report = {
      schemaVersion: 1,
      suite: 'issue-35-candidate-comparison',
      command: evaluation.command,
      commit: currentCommit(),
      workingTreeDirty: workingTreeDirty(),
      date: new Date().toISOString(),
      browser: { name: browserName, version: browser.version() },
      corpus: {
        id: corpus.corpusId,
        version: corpus.corpusVersion,
        manifestSha256: sha256OfFile(CORPUS_MANIFEST_PATH),
        fixtureSetSha256: corpusSetSha256(corpus),
        inputPlanSha256: corpusInputPlanSha256(corpus),
        inputsPerCandidatePerPass: corpus.pages.reduce(
          (total, page) => total + inputsFor(page).length,
          0,
        ),
        repetitionsPerCandidate: REPETITIONS,
      },
      candidates: {
        upstream: {
          option: UPSTREAM_CANDIDATE.option,
          id: UPSTREAM_CANDIDATE.id,
          maximumPredictionsPerInput: UPSTREAM_CANDIDATE.maximumPredictions,
        },
        localized: {
          option: LOCALIZED_CANDIDATE.option,
          id: LOCALIZED_CANDIDATE.id,
          maximumPredictionsPerInput: LOCALIZED_CANDIDATE.maximumPredictions,
          localizationVersion: LOCALIZATION_VERSION,
        },
      },
      sourceSha256: sourceSha256(sourceRoot),
      split: {
        developmentPageIds: DEVELOPMENT_PAGE_IDS,
        heldOutStatus:
          'Historical upstream outcomes were known; mitigation tuning excluded these pages, but this is not blind validation.',
      },
      comparison: {
        byStage: compareGroups(upstream.byStage, localized.byStage),
        byStageStyle: compareGroups(upstream.byStageStyle, localized.byStageStyle),
        bySplitStage: compareGroups(upstream.bySplitStage, localized.bySplitStage),
        bySplitStageStyle: compareGroups(upstream.bySplitStageStyle, localized.bySplitStageStyle),
      },
      limitations: [
        'Exact-bound classifier measurements are shared diagnostics and do not establish implementable detection.',
        'Host Playwright browsers are not physical-iPad evidence.',
        'Peak dedicated-worker/WASM memory is unavailable and remains unmeasured.',
      ],
    };
    writeJsonReport(
      resolve(REPORT_DIR, evaluation.reportSubdirectory, `corpus-comparison-${browserName}.json`),
      report,
    );
  });
});
