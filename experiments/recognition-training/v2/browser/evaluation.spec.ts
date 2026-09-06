import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, platform, release } from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';

import type * as Playwright from '@playwright/test';

import {
  CLASS_LABELS,
  loadBrowserEvaluationConfig,
  sha256File,
  type BoardLabels,
  type CandidateIdentity,
  type VectorSetConfig,
} from './config';
import { ORT_WASM_SHA256 } from '../../browser/constants';
import type { WorkerResponse } from '../../browser/protocol';

const localConfigPath = process.env.CHESS_READER_TRAINING_BROWSER_CONFIG;
if (!localConfigPath) {
  throw new Error('Set CHESS_READER_TRAINING_BROWSER_CONFIG to an ignored local-config.json');
}
const evaluation = loadBrowserEvaluationConfig(resolve(localConfigPath));
const webRequire = createRequire(resolve(import.meta.dirname, '../../../../apps/web/package.json'));
const { expect, test } = webRequire('@playwright/test') as typeof Playwright;
type BrowserContext = Playwright.BrowserContext;
type Page = Playwright.Page;
type Route = Playwright.Route;
const ortWasmPath = webRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm');
const RELIABILITY_FLOOR = 0.7;
const WARM_BOARD_LIMIT = 4;
const FULL_PASS_BOARD_CHUNK = 16;

interface ScoredBoard {
  readonly boardId: string;
  readonly exact: boolean;
  readonly correctSquares: number;
  readonly reliable: boolean;
  readonly reliableWrong: boolean;
  readonly minConfidence: number;
  readonly meanConfidence: number;
}

function currentCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ??
    null
  );
}

function distribution(values: readonly number[]) {
  return {
    count: values.length,
    min: values.length === 0 ? null : Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

function deployedDirectoryBytes(path: string): number {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    if (entry.name === '.vite' || entry.name.endsWith('.map')) return total;
    const child = resolve(path, entry.name);
    return total + (entry.isDirectory() ? deployedDirectoryBytes(child) : statSync(child).size);
  }, 0);
}

function routeToken(kind: string, id: string): string {
  return `/__recognition_training__/${kind}/${encodeURIComponent(id)}`;
}

async function installRoutes(
  context: BrowserContext,
  baseURL: string,
  candidate: CandidateIdentity,
  vectorSet: VectorSetConfig,
  corruptModel: boolean,
): Promise<string[]> {
  const allowedOrigin = new URL(baseURL).origin;
  const blocked: string[] = [];
  await context.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin !== allowedOrigin) {
      blocked.push(`${route.request().method()} external-origin`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  });
  await context.route(`**${routeToken('model', candidate.id)}.onnx`, async (route: Route) => {
    if (corruptModel) {
      await route.fulfill({ body: Buffer.from([0]), contentType: 'application/octet-stream' });
    } else {
      await route.fulfill({ path: candidate.modelPath, contentType: 'application/octet-stream' });
    }
  });
  await context.route(
    `**${routeToken('vectors', vectorSet.manifest.id)}.f32`,
    async (route: Route) => {
      await route.fulfill({ path: vectorSet.vectorsPath, contentType: 'application/octet-stream' });
    },
  );
  return blocked;
}

function initRequest(candidate: CandidateIdentity, vectorSet: VectorSetConfig) {
  return {
    modelUrl: `${routeToken('model', candidate.id)}.onnx`,
    modelSha256: candidate.sha256,
    vectorsUrl: `${routeToken('vectors', vectorSet.manifest.id)}.f32`,
    vectorsSha256: vectorSet.manifest.sha256,
    boardCount: vectorSet.manifest.shape[0],
  };
}

async function prepareHarness(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof globalThis.__recognitionTrainingBrowser.open === 'function',
  );
}

async function openSession(page: Page, candidate: CandidateIdentity, vectorSet: VectorSetConfig) {
  return page.evaluate(
    ({ init, timeoutMs }) => globalThis.__recognitionTrainingBrowser.open(init, timeoutMs),
    { init: initRequest(candidate, vectorSet), timeoutMs: evaluation.timeoutMs },
  );
}

function requireResult(response: WorkerResponse): Extract<WorkerResponse, { type: 'result' }> {
  if (response.type !== 'result') throw new Error(`Expected result, received ${response.type}`);
  return response;
}

function score(
  result: Extract<WorkerResponse, { type: 'result' }>,
  labels: readonly BoardLabels[],
): { boards: ScoredBoard[]; confusion: number[][] } {
  const confusion = Array.from({ length: CLASS_LABELS.length }, () =>
    Array<number>(CLASS_LABELS.length).fill(0),
  );
  const boards = result.boardIndexes.map((boardIndex, resultIndex): ScoredBoard => {
    const truth = labels[boardIndex];
    if (!truth) throw new Error('Missing labels for returned board');
    const start = resultIndex * 64;
    const predicted = result.classes.slice(start, start + 64);
    const confidence = result.confidences.slice(start, start + 64);
    let correctSquares = 0;
    for (let square = 0; square < 64; square += 1) {
      const expectedClass = truth.classes[square];
      const predictedClass = predicted[square];
      if (expectedClass === undefined || predictedClass === undefined)
        throw new Error('Missing square result');
      const row = confusion[expectedClass];
      if (!row) throw new Error('Invalid expected class');
      row[predictedClass] = (row[predictedClass] ?? 0) + 1;
      if (expectedClass === predictedClass) correctSquares += 1;
    }
    const minConfidence = Math.min(...confidence);
    const meanConfidence = confidence.reduce((sum, value) => sum + value, 0) / 64;
    const exact = correctSquares === 64;
    const reliable = minConfidence >= RELIABILITY_FLOOR;
    return {
      boardId: truth.boardId,
      exact,
      correctSquares,
      reliable,
      reliableWrong: reliable && !exact,
      minConfidence,
      meanConfidence,
    };
  });
  return { boards, confusion };
}

function writeReport(
  browserName: string,
  candidate: CandidateIdentity,
  vectorSet: VectorSetConfig,
  report: unknown,
): void {
  mkdirSync(evaluation.outputDirectory, { recursive: true });
  const file = `browser-${browserName}-${candidate.id}-${vectorSet.manifest.id}.json`;
  writeFileSync(
    resolve(evaluation.outputDirectory, file),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
}

for (const candidate of evaluation.freeze.candidates) {
  for (const vectorSet of evaluation.vectorSets) {
    test(`${candidate.id} on ${vectorSet.manifest.id}: frozen classifier vectors`, async ({
      page,
      context,
      browser,
      browserName,
      baseURL,
    }) => {
      if (!baseURL) throw new Error('baseURL is required');
      const blocked = await installRoutes(context, baseURL, candidate, vectorSet, false);
      await prepareHarness(page);
      const initializationMs: number[] = [];
      const firstBoardAfterFreshInitializationMs: number[] = [];
      let fullResult: Extract<WorkerResponse, { type: 'result' }> | null = null;
      const warmMs: number[] = [];
      for (let coldSession = 0; coldSession < evaluation.coldSessions; coldSession += 1) {
        const session = await openSession(page, candidate, vectorSet);
        expect(session.ready.modelSha256).toBe(candidate.sha256);
        expect(session.ready.runtimeSha256).toBe(ORT_WASM_SHA256);
        initializationMs.push(session.ready.initializationMs);
        if (coldSession === 0) {
          const indexes = Array.from({ length: vectorSet.manifest.shape[0] }, (_, index) => index);
          const chunks: Extract<WorkerResponse, { type: 'result' }>[] = [];
          for (let offset = 0; offset < indexes.length; offset += FULL_PASS_BOARD_CHUNK) {
            const requested = indexes.slice(offset, offset + FULL_PASS_BOARD_CHUNK);
            const chunk = requireResult(
              await page.evaluate(
                ({ sessionId, indexes: requestedIndexes, timeoutMs }) =>
                  globalThis.__recognitionTrainingBrowser.run(
                    sessionId,
                    requestedIndexes,
                    timeoutMs,
                  ),
                {
                  sessionId: session.id,
                  indexes: requested,
                  timeoutMs: evaluation.timeoutMs,
                },
              ),
            );
            expect(chunk.boardIndexes).toEqual(requested);
            chunks.push(chunk);
          }
          const firstChunk = chunks[0];
          if (!firstChunk) throw new Error('Full pass produced no chunks');
          fullResult = {
            type: 'result',
            requestId: firstChunk.requestId,
            boardIndexes: chunks.flatMap((chunk) => chunk.boardIndexes),
            classes: chunks.flatMap((chunk) => chunk.classes),
            confidences: chunks.flatMap((chunk) => chunk.confidences),
            inferenceMs: chunks.flatMap((chunk) => chunk.inferenceMs),
          };
          expect(fullResult.boardIndexes).toEqual(indexes);
          const firstInference = fullResult.inferenceMs[0];
          if (firstInference === undefined) throw new Error('Full pass omitted its first timing');
          firstBoardAfterFreshInitializationMs.push(firstInference);
          const warmIndexes = Array.from(
            {
              length:
                Math.min(WARM_BOARD_LIMIT, vectorSet.manifest.shape[0]) * evaluation.warmRepeats,
            },
            (_, index) => index % Math.min(WARM_BOARD_LIMIT, vectorSet.manifest.shape[0]),
          );
          const warm = requireResult(
            await page.evaluate(
              ({ sessionId, indexes: requested, timeoutMs }) =>
                globalThis.__recognitionTrainingBrowser.run(sessionId, requested, timeoutMs),
              { sessionId: session.id, indexes: warmIndexes, timeoutMs: evaluation.timeoutMs },
            ),
          );
          warmMs.push(...warm.inferenceMs);
        } else {
          const firstBoard = requireResult(
            await page.evaluate(
              ({ sessionId, timeoutMs }) =>
                globalThis.__recognitionTrainingBrowser.run(sessionId, [0], timeoutMs),
              { sessionId: session.id, timeoutMs: evaluation.timeoutMs },
            ),
          );
          const firstInference = firstBoard.inferenceMs[0];
          if (firstInference === undefined)
            throw new Error('Fresh session omitted its first timing');
          firstBoardAfterFreshInitializationMs.push(firstInference);
        }
        await page.evaluate(
          ({ sessionId, timeoutMs }) =>
            globalThis.__recognitionTrainingBrowser.close(sessionId, timeoutMs),
          { sessionId: session.id, timeoutMs: evaluation.timeoutMs },
        );
      }
      if (!fullResult) throw new Error('Full vector pass did not run');
      expect(fullResult.boardIndexes).toHaveLength(vectorSet.manifest.shape[0]);
      const scored = score(fullResult, vectorSet.manifest.labels);
      const exactBoards = scored.boards.filter(({ exact }) => exact).length;
      const correctSquares = scored.boards.reduce((sum, board) => sum + board.correctSquares, 0);
      const confidentCorrectSquares = fullResult.classes.reduce((total, predictedClass, index) => {
        const boardResultIndex = Math.floor(index / 64);
        const square = index % 64;
        const boardIndex = fullResult.boardIndexes[boardResultIndex];
        const expectedClass =
          boardIndex === undefined
            ? undefined
            : vectorSet.manifest.labels[boardIndex]?.classes[square];
        const confidence = fullResult.confidences[index];
        return (
          total +
          (expectedClass === predictedClass &&
          confidence !== undefined &&
          confidence >= RELIABILITY_FLOOR
            ? 1
            : 0)
        );
      }, 0);
      const perClassErrors = scored.confusion.map(
        (row, expectedClass) =>
          row.reduce((sum, count) => sum + count, 0) - (row[expectedClass] ?? 0),
      );
      const deployedBuildBytes = deployedDirectoryBytes(
        resolve(import.meta.dirname, '../../browser/dist'),
      );
      writeReport(browserName, candidate, vectorSet, {
        schemaVersion: 1,
        suite: 'recognition-training-browser',
        command: {
          fromRepositoryRoot:
            'pnpm --dir apps/web exec playwright test --config ../../experiments/recognition-training/v2/browser/playwright.config.ts',
          environment: {
            CHESS_READER_TRAINING_BROWSER_CONFIG: relative(
              resolve(import.meta.dirname, '../../../../apps/web'),
              evaluation.configPath,
            ),
          },
          environmentPathBase: 'apps/web (pnpm exec working directory)',
        },
        commit: currentCommit(),
        date: new Date().toISOString(),
        environment: {
          os: platform(),
          release: release(),
          arch: arch(),
          node: process.version,
          browser: { name: browserName, version: browser.version() },
        },
        freeze: {
          runKind: evaluation.freeze.runKind,
          protocolSha256: evaluation.freeze.protocolSha256,
          testManifestSha256: evaluation.freeze.testManifestSha256,
        },
        candidate: {
          id: candidate.id,
          seed: candidate.seed,
          modelSha256: candidate.sha256,
          modelBytes: candidate.bytes,
        },
        vectors: {
          id: vectorSet.manifest.id,
          role: vectorSet.manifest.role,
          sha256: vectorSet.manifest.sha256,
          bytes: vectorSet.manifest.byteLength,
          boards: vectorSet.manifest.shape[0],
        },
        contract: {
          input: { name: 'tiles', dtype: 'float32', shapePerBoard: [64, 1024] },
          output: { name: 'probs', dtype: 'float32', shapePerBoard: [64, 13] },
          classLabels: CLASS_LABELS,
          reliabilityFloor: RELIABILITY_FLOOR,
          executionProvider: 'wasm',
          threads: 1,
        },
        runtime: {
          ortWasmSha256: sha256File(ortWasmPath),
          ortWasmBytes: statSync(ortWasmPath).size,
          modelAndOrtWasmBytes: candidate.bytes + statSync(ortWasmPath).size,
          deployedEvaluationBuildBytes: deployedBuildBytes,
          totalEvaluationRuntimeBytes: candidate.bytes + deployedBuildBytes,
          byteDefinition:
            'modelAndOrtWasmBytes is candidate ONNX plus pinned ORT WASM. totalEvaluationRuntimeBytes adds the candidate to deployed harness HTML/JS/WASM and excludes source maps/build metadata.',
        },
        timing: {
          coldInitializationMs: distribution(initializationMs),
          firstBoardAfterFreshInitializationMs: distribution(firstBoardAfterFreshInitializationMs),
          fullPassInferenceMs: distribution(fullResult.inferenceMs),
          warmSubsetInferenceMs: distribution(warmMs),
          coldSessions: evaluation.coldSessions,
          warmRepeatsPerBoard: evaluation.warmRepeats,
          warmBoardLimit: WARM_BOARD_LIMIT,
          fullPassMaximumBoardsPerRequest: FULL_PASS_BOARD_CHUNK,
          fullPassRequestCount: Math.ceil(vectorSet.manifest.shape[0] / FULL_PASS_BOARD_CHUNK),
        },
        rawTiming: {
          coldInitializationMs: initializationMs,
          firstBoardAfterFreshInitializationMs,
          fullPassInferenceMs: fullResult.inferenceMs,
          warmSubsetInferenceMs: warmMs,
        },
        summary: {
          exactBoards,
          totalBoards: scored.boards.length,
          exactBoardAccuracy: exactBoards / scored.boards.length,
          correctSquares,
          confidentCorrectSquares,
          totalSquares: scored.boards.length * 64,
          squareAccuracy: correctSquares / (scored.boards.length * 64),
          confidenceQualifiedSquareAccuracy: confidentCorrectSquares / (scored.boards.length * 64),
          reliableExact: scored.boards.filter(({ exact, reliable }) => exact && reliable).length,
          reliableWrong: scored.boards.filter(({ reliableWrong }) => reliableWrong).length,
          minimumConfidence: Math.min(...scored.boards.map(({ minConfidence }) => minConfidence)),
          meanConfidence:
            scored.boards.reduce((sum, { meanConfidence }) => sum + meanConfidence, 0) /
            scored.boards.length,
          perClassErrors,
          confusion: scored.confusion,
        },
        observations: scored.boards,
        nonSameOriginRequests: blocked,
        privacy:
          'No vectors, class sequences, FENs, source filenames or absolute paths are persisted in this report.',
        limitations: [
          'Classifier-stage frozen-vector evidence only; it is not end-to-end recognition qualification.',
          'Physical iPad deferred/unrun.',
        ],
      });
      expect(blocked).toEqual([]);
    });
  }

  test(`${candidate.id}: cancellation, timeout recovery, integrity and warm offline`, async ({
    page,
    context,
    browserName,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('baseURL is required');
    const vectorSet = evaluation.vectorSets[0];
    if (!vectorSet) throw new Error('At least one vector set is required');
    const blocked = await installRoutes(context, baseURL, candidate, vectorSet, false);
    await prepareHarness(page);

    const cancelSession = await openSession(page, candidate, vectorSet);
    const repeated = Array<number>(32).fill(0);
    const cancelled = await page.evaluate(
      ({ sessionId, indexes, timeoutMs }) =>
        globalThis.__recognitionTrainingBrowser.runAndCancel(sessionId, indexes, timeoutMs),
      { sessionId: cancelSession.id, indexes: repeated, timeoutMs: evaluation.timeoutMs },
    );
    expect(cancelled.type).toBe('cancelled');
    if (cancelled.type !== 'cancelled') throw new Error('Cancellation was not acknowledged');
    expect(cancelled.completedBoards).toBeGreaterThan(0);
    expect(cancelled.completedBoards).toBeLessThan(repeated.length);
    await page.evaluate(
      ({ sessionId, timeoutMs }) =>
        globalThis.__recognitionTrainingBrowser.close(sessionId, timeoutMs),
      { sessionId: cancelSession.id, timeoutMs: evaluation.timeoutMs },
    );

    const timeoutSession = await openSession(page, candidate, vectorSet);
    await expect(
      page.evaluate(
        ({ sessionId }) => globalThis.__recognitionTrainingBrowser.hang(sessionId, 250),
        { sessionId: timeoutSession.id },
      ),
    ).rejects.toThrow(/worker-timeout/);
    const recoverySession = await openSession(page, candidate, vectorSet);
    const recovered = requireResult(
      await page.evaluate(
        ({ sessionId, timeoutMs }) =>
          globalThis.__recognitionTrainingBrowser.run(sessionId, [0], timeoutMs),
        { sessionId: recoverySession.id, timeoutMs: evaluation.timeoutMs },
      ),
    );
    expect(recovered.boardIndexes).toEqual([0]);
    await page.evaluate(
      ({ sessionId, timeoutMs }) =>
        globalThis.__recognitionTrainingBrowser.close(sessionId, timeoutMs),
      { sessionId: recoverySession.id, timeoutMs: evaluation.timeoutMs },
    );

    await context.unroute(`**${routeToken('model', candidate.id)}.onnx`);
    await context.route(`**${routeToken('model', candidate.id)}.onnx`, async (route: Route) => {
      await route.fulfill({ body: Buffer.from([0]), contentType: 'application/octet-stream' });
    });
    await expect(openSession(page, candidate, vectorSet)).rejects.toThrow(/asset-integrity/);
    await context.unroute(`**${routeToken('model', candidate.id)}.onnx`);
    await context.route(`**${routeToken('model', candidate.id)}.onnx`, async (route: Route) => {
      await route.fulfill({ path: candidate.modelPath, contentType: 'application/octet-stream' });
    });

    const offlineSession = await openSession(page, candidate, vectorSet);
    await context.setOffline(true);
    const offline = requireResult(
      await page.evaluate(
        ({ sessionId, timeoutMs }) =>
          globalThis.__recognitionTrainingBrowser.run(sessionId, [0], timeoutMs),
        { sessionId: offlineSession.id, timeoutMs: evaluation.timeoutMs },
      ),
    );
    expect(offline.boardIndexes).toEqual([0]);
    await context.setOffline(false);
    await page.evaluate(
      ({ sessionId, timeoutMs }) =>
        globalThis.__recognitionTrainingBrowser.close(sessionId, timeoutMs),
      { sessionId: offlineSession.id, timeoutMs: evaluation.timeoutMs },
    );

    mkdirSync(evaluation.outputDirectory, { recursive: true });
    writeFileSync(
      resolve(evaluation.outputDirectory, `browser-faults-${browserName}-${candidate.id}.json`),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          suite: 'recognition-training-browser-faults',
          commit: currentCommit(),
          date: new Date().toISOString(),
          browser: browserName,
          candidate: { id: candidate.id, seed: candidate.seed, sha256: candidate.sha256 },
          vectorSet: { id: vectorSet.manifest.id, sha256: vectorSet.manifest.sha256 },
          cancellation: {
            passed: true,
            completedBoards: cancelled.completedBoards,
            plannedBoards: repeated.length,
          },
          timeoutTerminationAndRecovery: { passed: true, timeoutMs: 250 },
          modelIntegrityFailureBeforeInference: { passed: true },
          warmOfflineInference: { passed: true },
          nonSameOriginRequests: blocked,
          limitations: [
            'Warm offline means model, vectors, worker and ORT were initialized before network was disabled.',
            'Cold offline reload/readiness is not claimed; it belongs to the service-worker/offline issue.',
            'Physical iPad deferred/unrun.',
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    expect(blocked).toEqual([]);
  });
}

test('frozen browser inputs are complete and runtime is pinned', () => {
  expect(evaluation.freeze.candidates.length).toBeGreaterThan(0);
  expect(evaluation.vectorSets.length).toBeGreaterThan(0);
  expect(sha256File(ortWasmPath)).toBe(ORT_WASM_SHA256);
  expect(basename(evaluation.freezeManifestPath)).toBe('candidates.freeze.json');
});
