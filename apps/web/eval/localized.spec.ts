/** Real PDF selection -> experimental worker -> existing editable board. */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arch, release } from 'node:os';
import { LOCALIZATION_VERSION } from '../src/recognition/experimentalLocalization';
import {
  assessCandidateCase,
  assessCandidateObservation,
  candidateEvaluationContext,
  type CandidateObservation,
} from './localized.assessment';
import { currentCommit, sha256OfFile, summarize, writeJsonReport } from './report';

const fixtureRoot = resolve(import.meta.dirname, '../../../packages/test-fixtures');
interface Fixture {
  id: string;
  path: string;
  sha256: string;
  expected: {
    locator: { pageIndex: number };
    boardRect: { x: number; y: number; width: number; height: number };
    placement: string;
  };
}
const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, 'manifest.json'), 'utf8')) as {
  fixtures: Fixture[];
};

async function select(page: Page, rect: Fixture['expected']['boardRect']): Promise<void> {
  await page.getByTestId('selection-toggle').click();
  const container = page.getByTestId('pdf-page-container');
  await container.scrollIntoViewIfNeeded();
  const box = await container.boundingBox();
  if (!box) throw new Error('PDF page must be laid out');
  const m = 0.03;
  await page.mouse.move(box.x + (rect.x - m) * box.width, box.y + (rect.y - m) * box.height);
  await page.mouse.down();
  await page.mouse.move(
    box.x + (rect.x + rect.width + m) * box.width,
    box.y + (rect.y + rect.height + m) * box.height,
    { steps: 8 },
  );
  await expect(page.getByTestId('selection-rect')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('selection-toggle')).toHaveAttribute('aria-pressed', 'false');
}

for (const fixtureId of ['pdf-synthetic-diagram-01', 'pdf-synthetic-hatched-01']) {
  test(`localized worker exercises editable PDF selection: ${fixtureId}`, async ({
    page,
    browser,
    browserName,
    baseURL,
  }, testInfo) => {
    test.setTimeout(180_000);
    const evaluation = candidateEvaluationContext(
      testInfo.config.metadata['candidateEvaluationMode'],
    );
    const reportDirectory = resolve(
      import.meta.dirname,
      '../eval-results',
      evaluation.reportSubdirectory,
    );
    // Keep the complete model/runtime/candidate identity frozen without importing
    // assets.ts here: its Vite `?url` imports cannot be evaluated by Playwright's
    // Node-side spec loader.
    const expectedVersion = `fenshot-0.1.4/chess-tiles-v2/ort-web-1.29.0/${LOCALIZATION_VERSION}`;
    const fixture = manifest.fixtures.find((entry) => entry.id === fixtureId);
    if (!fixture || !baseURL) throw new Error('Missing fixture or baseURL');
    const fixturePath = resolve(fixtureRoot, fixture.path);
    expect(sha256OfFile(fixturePath)).toBe(fixture.sha256);
    const blocked: string[] = [];
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== new URL(baseURL).origin) {
        blocked.push('external-request');
        await route.abort();
      } else await route.continue();
    });
    const observations: CandidateObservation[] = [];
    for (let session = 0; session < 3; session++) {
      await page.goto('/localized.html');
      await page.getByTestId('pdf-open-input').setInputFiles(fixturePath);
      await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/Page 1 of \d+/);
      for (let n = 0; n < fixture.expected.locator.pageIndex; n++)
        await page.getByTestId('pdf-page-next').click();
      await expect(page.getByTestId('pdf-reader-status')).toHaveAttribute('data-state', 'ready');
      for (let run = 0; run < 2; run++) {
        await select(page, fixture.expected.boardRect);
        const status = page.getByTestId('recognition-status');
        await expect(status).toHaveAttribute('data-phase', /^(done|no-board|error)$/);
        const board = page.getByTestId('floating-board');
        const phase = await status.getAttribute('data-phase');
        const placement =
          (await board.count()) === 0 ? null : await board.getAttribute('data-placement');
        observations.push(
          assessCandidateObservation(
            {
              session,
              run,
              phase,
              placement,
              reliable: await status.getAttribute('data-reliable'),
              totalMs: await status.getAttribute('data-total-ms'),
              stageMs: await status.getAttribute('data-inference-ms'),
              cold: await status.getAttribute('data-cold-start'),
              version: await status.getAttribute('data-recognizer-version'),
            },
            fixture.expected.placement,
            expectedVersion,
          ),
        );
        if (phase === 'done') {
          await page.getByTestId('palette-wN').click();
          await page.getByTestId('board-square-e4').click();
          await expect(page.getByTestId('board-square-e4')).toHaveAttribute('data-piece', 'wN');
          await page.getByTestId('board-flip').click();
          await expect(page.getByTestId('board-square-e4')).toHaveAttribute('data-piece', 'wN');
          if (session === 0 && run === 0)
            await page.screenshot({
              path: resolve(
                reportDirectory,
                `localized-${evaluation.mode}-${fixtureId}-${browserName}.png`,
              ),
              fullPage: true,
            });
          await page.getByTestId('board-close').click();
        }
      }
    }
    const assessment = assessCandidateCase(
      observations,
      blocked.map((_, index) => `non-same-origin-request-${String(index + 1)}`),
    );
    const report = {
      schemaVersion: 2,
      suite: 'issue-35-product-selection',
      command: evaluation.command,
      evaluationMode: evaluation.mode,
      commit: currentCommit(),
      date: new Date().toISOString(),
      environment: {
        node: process.version,
        os: process.platform,
        release: release(),
        arch: arch(),
      },
      browser: { name: browserName, version: browser.version() },
      fixture: { id: fixtureId, sha256: fixture.sha256, manifestSchemaVersion: 1 },
      observations,
      summary: {
        exactBoards: observations.filter((o) => o.exact).length,
        reliableExact: observations.filter((o) => o.exact && o.reliable).length,
        reliableWrong: observations.filter((o) => !o.exact && o.reliable).length,
        coldWorkerRoundTripMs: summarize(
          observations.flatMap((o) => (o.cold === true && o.totalMs !== null ? [o.totalMs] : [])),
        ),
        warmWorkerRoundTripMs: summarize(
          observations.flatMap((o) => (o.cold === false && o.totalMs !== null ? [o.totalMs] : [])),
        ),
        warmStageMs: summarize(
          observations.flatMap((o) => (o.cold === false && o.stageMs !== null ? [o.stageMs] : [])),
        ),
      },
      assessment,
      nonSameOriginRequests: blocked,
      limitations: [
        'Development fixtures; not held-out accuracy.',
        'Round trip begins after PDF capture and excludes editor paint; cold sessions do not clear disk/browser caches.',
        'Physical iPad deferred/unrun.',
      ],
    };
    writeJsonReport(
      resolve(
        reportDirectory,
        `issue-35-product-${evaluation.mode}-${fixtureId}-${browserName}.json`,
      ),
      report,
    );
    expect(blocked).toEqual([]);
    expect(assessment.infrastructure.failures).toEqual([]);
    expect(assessment.safety.failures).toEqual([]);
    if (evaluation.mode === 'qualification') {
      expect(assessment.qualification.failures).toEqual([]);
    }
  });
}
