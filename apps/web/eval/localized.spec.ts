/** Real PDF selection -> experimental worker -> existing editable board. */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arch, release } from 'node:os';
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
  }) => {
    test.setTimeout(180_000);
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
    const observations: {
      session: number;
      run: number;
      exact: boolean;
      reliable: boolean;
      phase: string | null;
      totalMs: number;
      stageMs: number;
      cold: boolean;
      version: string | null;
    }[] = [];
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
        observations.push({
          session,
          run,
          phase,
          exact:
            phase === 'done' &&
            (await board.getAttribute('data-placement')) === fixture.expected.placement,
          reliable: (await status.getAttribute('data-reliable')) === 'true',
          totalMs: Number(await status.getAttribute('data-total-ms')),
          stageMs: Number(await status.getAttribute('data-inference-ms')),
          cold: (await status.getAttribute('data-cold-start')) === 'true',
          version: await status.getAttribute('data-recognizer-version'),
        });
        if (phase === 'done') {
          await page.getByTestId('palette-wN').click();
          await page.getByTestId('board-square-e4').click();
          await expect(page.getByTestId('board-square-e4')).toHaveAttribute('data-piece', 'wN');
          await page.getByTestId('board-flip').click();
          await expect(page.getByTestId('board-square-e4')).toHaveAttribute('data-piece', 'wN');
          if (session === 0 && run === 0)
            await page.screenshot({
              path: resolve(
                import.meta.dirname,
                `../eval-results/localized-${fixtureId}-${browserName}.png`,
              ),
              fullPage: true,
            });
          await page.getByTestId('board-close').click();
        }
      }
    }
    const report = {
      schemaVersion: 1,
      suite: 'issue-35-product-selection',
      command: 'pnpm eval:recognition',
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
        coldWorkerRoundTripMs: summarize(observations.filter((o) => o.cold).map((o) => o.totalMs)),
        warmWorkerRoundTripMs: summarize(observations.filter((o) => !o.cold).map((o) => o.totalMs)),
        warmStageMs: summarize(observations.filter((o) => !o.cold).map((o) => o.stageMs)),
      },
      nonSameOriginRequests: blocked,
      limitations: [
        'Development fixtures; not held-out accuracy.',
        'Round trip begins after PDF capture and excludes editor paint; cold sessions do not clear disk/browser caches.',
        'Physical iPad deferred/unrun.',
      ],
    };
    writeJsonReport(
      resolve(
        import.meta.dirname,
        `../eval-results/issue-35-product-${fixtureId}-${browserName}.json`,
      ),
      report,
    );
    expect(blocked).toEqual([]);
    for (const observation of observations) {
      expect(observation.phase).toBe('done');
      expect(observation.exact).toBe(true);
      expect(observation.version).toContain('integral-checkerboard');
    }
  });
}
