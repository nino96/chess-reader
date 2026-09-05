/**
 * `pnpm eval:recognition` — real-model recognition evaluation through the
 * product path (docs/evaluation.md §6). No recognizer fake is installed: the
 * page loads the pinned ONNX model in the real worker. Correctness against the
 * fixture ground truth is asserted; latency is measured and reported as a
 * distribution, never asserted against the provisional targets (the issue #2
 * baseline is measured, not claimed).
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';
import { platform, version as nodeVersion } from 'node:process';

import { candidateEvaluationContext } from './localized.assessment';
import { currentCommit, sha256OfFile, summarize, writeJsonReport } from './report';

const FIXTURES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/test-fixtures',
);
const FIXTURE_ID = 'pdf-synthetic-diagram-01';
const RUNS = Number(process.env['CHESS_READER_EVAL_RUNS'] ?? '6');
/** Extra margin around the ground-truth board rectangle to mimic a hand-drawn selection. */
const SELECTION_MARGIN_FRACTION = 0.03;

interface FixtureEntry {
  id: string;
  path: string;
  sha256: string;
  expected: {
    locator: { format: 'pdf'; pageIndex: number };
    boardRect: { x: number; y: number; width: number; height: number };
    placement: string;
    orientation: 'white' | 'black';
  };
}

function loadFixture(): FixtureEntry {
  const manifest = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'manifest.json'), 'utf8')) as {
    fixtures: FixtureEntry[];
  };
  const entry = manifest.fixtures.find((fixture) => fixture.id === FIXTURE_ID);
  if (!entry) {
    throw new Error(`fixture ${FIXTURE_ID} is missing from the manifest`);
  }
  return entry;
}

interface RunRecord {
  run: number;
  phase: string | null;
  placement: string | null;
  orientation: string | null;
  reliable: boolean | null;
  exactMatch: boolean;
  totalMs: number | null;
  inferenceMs: number | null;
  coldStart: boolean | null;
}

function numberAttribute(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanAttribute(value: string | null): boolean | null {
  return value === null ? null : value === 'true';
}

test('real recognizer reads the fixture diagram; latency distribution is recorded', async ({
  page,
  browserName,
  baseURL,
}, testInfo) => {
  const evaluation = candidateEvaluationContext(
    testInfo.config.metadata['candidateEvaluationMode'],
  );
  if (!baseURL) {
    throw new Error('baseURL must be configured');
  }
  const fixture = loadFixture();
  const fixturePath = resolve(FIXTURES_ROOT, fixture.path);
  expect(sha256OfFile(fixturePath), 'fixture bytes must match the manifest').toBe(fixture.sha256);

  const allowedOrigin = new URL(baseURL).origin;
  const blocked: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (new URL(url).origin !== allowedOrigin) {
      blocked.push(url);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByTestId('pdf-open-input').setInputFiles(fixturePath);
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/Page 1 of \d+/);
  for (let i = 0; i < fixture.expected.locator.pageIndex; i += 1) {
    await page.getByTestId('pdf-page-next').click();
  }
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(
    new RegExp(`Page ${String(fixture.expected.locator.pageIndex + 1)} of \\d+`),
  );
  await expect(page.getByTestId('pdf-reader-status')).toHaveAttribute('data-state', 'ready');

  const runs: RunRecord[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    // Selection mode is enabled BEFORE the page is measured: the toggle's label widens
    // when it turns on, which can rewrap the toolbar and shift the page down. Measuring
    // first would then aim the drag above the page.
    const toggle = page.getByTestId('selection-toggle');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('selection-layer')).toHaveAttribute('data-active', 'true');

    const container = page.getByTestId('pdf-page-container');
    await container.scrollIntoViewIfNeeded();
    const box = await container.boundingBox();
    if (!box) {
      throw new Error('page container must be laid out');
    }
    const rect = fixture.expected.boardRect;
    const m = SELECTION_MARGIN_FRACTION;
    const x0 = box.x + (rect.x - m) * box.width;
    const y0 = box.y + (rect.y - m) * box.height;
    const x1 = box.x + (rect.x + rect.width + m) * box.width;
    const y1 = box.y + (rect.y + rect.height + m) * box.height;

    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 });
    await page.mouse.move(x1, y1, { steps: 5 });
    // Fail on the drag itself rather than on a later, more confusing assertion if no
    // rectangle was produced, and wait for the confirmed selection to switch selection
    // mode back off, which is the observable proof that recognition was requested.
    await expect(page.getByTestId('selection-rect')).toBeVisible();
    await page.mouse.up();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    const status = page.getByTestId('recognition-status');
    await expect(status).toHaveAttribute('data-phase', /^(done|no-board|error)$/);
    const phase = await status.getAttribute('data-phase');
    const board = page.getByTestId('floating-board');
    const placement = phase === 'done' ? await board.getAttribute('data-placement') : null;
    const orientation = phase === 'done' ? await board.getAttribute('data-orientation') : null;

    runs.push({
      run,
      phase,
      placement,
      orientation,
      reliable: booleanAttribute(await status.getAttribute('data-reliable')),
      exactMatch: placement === fixture.expected.placement,
      totalMs: numberAttribute(await status.getAttribute('data-total-ms')),
      inferenceMs: numberAttribute(await status.getAttribute('data-inference-ms')),
      coldStart: booleanAttribute(await status.getAttribute('data-cold-start')),
    });

    if (phase === 'done') {
      await page.getByTestId('board-close').click();
    }
  }

  const recognizerVersion = await page
    .getByTestId('recognition-status')
    .getAttribute('data-recognizer-version');
  const warm = runs.filter((r) => r.coldStart === false && r.totalMs !== null);
  const cold = runs.filter((r) => r.coldStart === true && r.totalMs !== null);
  const report = {
    schemaVersion: 1,
    suite: 'eval:recognition',
    command: evaluation.command,
    commit: currentCommit(),
    date: new Date().toISOString(),
    environment: {
      os: `${platform} ${release()}`,
      node: nodeVersion,
      ci: !!process.env['CI'],
    },
    browser: browserName,
    fixture: { id: fixture.id, sha256: fixture.sha256, manifestSchemaVersion: 1 },
    recognizerVersion,
    runs,
    summary: {
      exactBoardAccuracy: runs.filter((r) => r.exactMatch).length / runs.length,
      coldTotalMs: summarize(cold.map((r) => r.totalMs ?? 0)),
      warmTotalMs: summarize(warm.map((r) => r.totalMs ?? 0)),
      warmInferenceMs: summarize(warm.map((r) => r.inferenceMs ?? 0)),
    },
    provisionalTargets: {
      note: 'docs/evaluation.md §6 targets apply to the reference iPad/Android devices; this run is a laptop-browser baseline and is recorded, not asserted.',
      warmP50MsTarget: 1000,
      warmP95MsTarget: 2000,
    },
    nonSameOriginRequests: blocked,
  };
  writeJsonReport(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../eval-results',
      evaluation.reportSubdirectory,
      `recognition-${browserName}.json`,
    ),
    report,
  );
  console.log(JSON.stringify(report.summary));

  expect(blocked, 'recognition must not contact any other origin').toEqual([]);
  for (const record of runs) {
    expect(record.placement, `run ${String(record.run)} placement`).toBe(
      fixture.expected.placement,
    );
    expect(record.orientation, `run ${String(record.run)} orientation`).toBe(
      fixture.expected.orientation,
    );
    expect(record.reliable, `run ${String(record.run)} reliable`).toBe(true);
  }
  expect(runs[0]?.coldStart, 'the first run pays the cold start').toBe(true);
});
