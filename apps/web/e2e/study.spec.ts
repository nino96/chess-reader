/**
 * Issue #2 walking slice: open a local PDF -> navigate -> select a diagram ->
 * local recognition -> editable floating board.
 *
 * Most tests install the deterministic scripted recognizer through the
 * `window.__chessReaderTestHooks` seam (see `src/recognition/testHooks.ts`) so
 * the browser path is deterministic and fast. One test runs the real worker +
 * ONNX model against the fixture so every engine proves the true integration;
 * `pnpm eval:recognition` collects the latency distribution separately.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures';

const FIXTURES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/test-fixtures',
);
const FIXTURE_ID = 'pdf-synthetic-diagram-01';

interface FixtureEntry {
  id: string;
  path: string;
  expected: {
    locator: { format: 'pdf'; pageIndex: number };
    boardRect: { x: number; y: number; width: number; height: number };
    placement: string;
    orientation: 'white' | 'black';
    negativePages?: number[];
    negativeRect?: { x: number; y: number; width: number; height: number };
  };
}

const fixture = (() => {
  const manifest = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'manifest.json'), 'utf8')) as {
    fixtures: FixtureEntry[];
  };
  const entry = manifest.fixtures.find((candidate) => candidate.id === FIXTURE_ID);
  if (!entry) {
    throw new Error(`fixture ${FIXTURE_ID} is missing from the manifest`);
  }
  return { ...entry, absolutePath: resolve(FIXTURES_ROOT, entry.path) };
})();

const SCRIPTED_PLACEMENT = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';
const SECOND_PLACEMENT = '4k3/8/8/8/8/8/8/4K3';

interface RecognizerStep {
  delayMs?: number;
  phases?: ('loading-model' | 'recognizing')[];
  outcome: 'board' | 'no-board' | 'error' | 'never';
  placement?: string;
  confidences?: number[];
  reliable?: boolean;
  proposedOrientation?: 'white' | 'black';
  errorCode?: 'aborted' | 'timeout' | 'worker-unavailable' | 'asset-integrity' | 'runtime-failure';
}

interface RecognizerScript {
  version?: string;
  defaultDelayMs?: number;
  steps: RecognizerStep[];
}

async function installScriptedRecognizer(page: Page, script: RecognizerScript): Promise<void> {
  await page.addInitScript((installed: RecognizerScript) => {
    (window as unknown as { __chessReaderTestHooks?: unknown }).__chessReaderTestHooks = {
      recognizerScript: installed,
    };
  }, script);
}

async function openFixture(page: Page, pageIndex: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('pdf-open-input').setInputFiles(fixture.absolutePath);
  // Opening and first-rendering a real PDF can be slow when the whole suite runs in
  // parallel, so this first wait is deliberately longer than the default.
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/Page 1 of \d+/, {
    timeout: 30_000,
  });
  for (let i = 0; i < pageIndex; i += 1) {
    await page.getByTestId('pdf-page-next').click();
  }
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(
    new RegExp(`Page ${String(pageIndex + 1)} of \\d+`),
  );
  await expect(page.getByTestId('pdf-reader-status')).toHaveAttribute('data-state', 'ready');
}

async function enableSelection(page: Page): Promise<void> {
  const toggle = page.getByTestId('selection-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click();
  }
  await expect(page.getByTestId('selection-layer')).toHaveAttribute('data-active', 'true');
}

/**
 * Drags a rectangle over the displayed page using the mouse. Playwright's
 * touchscreen API only supports taps, so touch projects also drag with the
 * mouse here; real touch dragging is part of the physical-iPad record.
 */
async function dragSelection(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  margin = 0.03,
): Promise<void> {
  await enableSelection(page);
  const container = page.getByTestId('pdf-page-container');
  await container.scrollIntoViewIfNeeded();
  const box = await container.boundingBox();
  if (!box) {
    throw new Error('page container must be laid out');
  }
  const x0 = box.x + (rect.x - margin) * box.width;
  const y0 = box.y + (rect.y - margin) * box.height;
  const x1 = box.x + (rect.x + rect.width + margin) * box.width;
  const y1 = box.y + (rect.y + rect.height + margin) * box.height;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  // Fail here, rather than later on a confusing downstream assertion, if the drag never
  // produced a rectangle (for example because the page scrolled out from under it).
  await expect(page.getByTestId('selection-rect')).toBeVisible();
  await page.mouse.up();
  // A confirmed selection always switches selection mode back off; waiting for that
  // guarantees `onSelect` fired before the caller proceeds.
  await expect(page.getByTestId('selection-toggle')).toHaveAttribute('aria-pressed', 'false');
}

// Each case opens and renders a real PDF, drags a selection, and drives the board, so
// the whole journey routinely exceeds Playwright's 30 s default on a loaded machine.
test.describe.configure({ timeout: 120_000 });

test.describe('PDF diagram to editable board (scripted recognizer)', () => {
  test('complete workflow: open, navigate, select, recognize, edit, flip, close', async ({
    page,
  }) => {
    await installScriptedRecognizer(page, {
      steps: [{ delayMs: 50, outcome: 'board', placement: SCRIPTED_PLACEMENT, reliable: true }],
    });
    await openFixture(page, fixture.expected.locator.pageIndex);

    // Selection mode is off by default, so the reader is plainly navigable.
    await expect(page.getByTestId('selection-layer')).toHaveAttribute('data-active', 'false');

    await dragSelection(page, fixture.expected.boardRect);

    const status = page.getByTestId('recognition-status');
    await expect(status).toHaveAttribute('data-phase', 'done');

    const board = page.getByTestId('floating-board');
    await expect(board).toBeVisible();
    await expect(board).toHaveAttribute('data-placement', SCRIPTED_PLACEMENT);
    await expect(board).toHaveAttribute('data-orientation', 'white');

    // Edit: put a white knight on e4 (currently empty) via the palette.
    await page.getByTestId('palette-wN').click();
    await page.getByTestId('board-square-e4').click();
    await expect(page.getByTestId('board-square-e4')).toHaveAttribute('data-piece', 'wN');
    await expect(board).toHaveAttribute(
      'data-placement',
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1N3/5N2/PPPP1PPP/RNBQK2R',
    );

    // Erase e4 (which held a pawn before the knight replaced it).
    await page.getByTestId('palette-empty').click();
    await page.getByTestId('board-square-e4').click();
    await expect(board).toHaveAttribute(
      'data-placement',
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B5/5N2/PPPP1PPP/RNBQK2R',
    );

    // Orientation flip is a view change, not a placement change.
    await page.getByTestId('board-flip').click();
    await expect(board).toHaveAttribute('data-orientation', 'black');
    await expect(board).toHaveAttribute(
      'data-placement',
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B5/5N2/PPPP1PPP/RNBQK2R',
    );

    await page.getByTestId('board-close').click();
    await expect(board).toHaveCount(0);
  });

  test('the reader stays navigable while selection is inactive and the board is open', async ({
    page,
  }) => {
    await installScriptedRecognizer(page, {
      steps: [{ delayMs: 20, outcome: 'board', placement: SCRIPTED_PLACEMENT }],
    });
    await openFixture(page, fixture.expected.locator.pageIndex);
    await dragSelection(page, fixture.expected.boardRect);
    await expect(page.getByTestId('floating-board')).toBeVisible();

    // After recognition the selection mode turns itself off so the page can be read.
    await expect(page.getByTestId('selection-layer')).toHaveAttribute('data-active', 'false');

    await page.getByTestId('pdf-page-prev').click();
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/Page 1 of \d+/);
    await page.getByTestId('pdf-page-next').click();
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText(
      new RegExp(`Page ${String(fixture.expected.locator.pageIndex + 1)} of \\d+`),
    );
    // The board survives page navigation: it is the user's working position.
    await expect(page.getByTestId('floating-board')).toBeVisible();
  });

  test('cancel stops a pending recognition and no board appears', async ({ page }) => {
    await installScriptedRecognizer(page, { steps: [{ outcome: 'never' }] });
    await openFixture(page, fixture.expected.locator.pageIndex);
    await dragSelection(page, fixture.expected.boardRect);

    const status = page.getByTestId('recognition-status');
    await expect(status).toHaveAttribute('data-phase', /^(loading-model|recognizing)$/);
    await page.getByTestId('recognition-cancel').click();
    await expect(status).toHaveAttribute('data-phase', 'cancelled');
    await expect(page.getByTestId('floating-board')).toHaveCount(0);
  });

  test('no-board and error outcomes are reported without a board', async ({ page }) => {
    await installScriptedRecognizer(page, {
      steps: [
        { delayMs: 20, outcome: 'no-board' },
        { delayMs: 20, outcome: 'error', errorCode: 'runtime-failure' },
      ],
    });
    await openFixture(page, fixture.expected.locator.pageIndex);

    await dragSelection(page, fixture.expected.boardRect);
    const status = page.getByTestId('recognition-status');
    await expect(status).toHaveAttribute('data-phase', 'no-board');
    await expect(page.getByTestId('floating-board')).toHaveCount(0);

    await dragSelection(page, fixture.expected.boardRect);
    await expect(status).toHaveAttribute('data-phase', 'error');
    await expect(status).toContainText(/recogni/i);
    await expect(page.getByTestId('floating-board')).toHaveCount(0);
  });

  test('a result arriving after a page change is discarded', async ({ page }) => {
    await installScriptedRecognizer(page, {
      steps: [{ delayMs: 1200, outcome: 'board', placement: SCRIPTED_PLACEMENT }],
    });
    await openFixture(page, fixture.expected.locator.pageIndex);
    await dragSelection(page, fixture.expected.boardRect);
    await expect(page.getByTestId('recognition-status')).toHaveAttribute(
      'data-phase',
      /^(loading-model|recognizing)$/,
    );

    await page.getByTestId('pdf-page-prev').click();
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/Page 1 of \d+/);

    // Wait past the scripted delay; the stale result must not surface.
    await page.waitForTimeout(1800);
    await expect(page.getByTestId('floating-board')).toHaveCount(0);
    await expect(page.getByTestId('recognition-status')).not.toHaveAttribute('data-phase', 'done');
  });

  test('a newer selection wins over a slower older one, and a user edit is never overwritten', async ({
    page,
  }) => {
    await installScriptedRecognizer(page, {
      steps: [
        { delayMs: 4000, outcome: 'board', placement: SCRIPTED_PLACEMENT },
        { delayMs: 50, outcome: 'board', placement: SECOND_PLACEMENT },
      ],
    });
    await openFixture(page, fixture.expected.locator.pageIndex);

    await dragSelection(page, fixture.expected.boardRect);
    await expect(page.getByTestId('recognition-status')).toHaveAttribute(
      'data-phase',
      /^(loading-model|recognizing)$/,
    );
    // Select again before the first result arrives.
    await dragSelection(page, fixture.expected.boardRect);

    const board = page.getByTestId('floating-board');
    await expect(board).toHaveAttribute('data-placement', SECOND_PLACEMENT);

    // Edit the board, then wait past the first (stale) result's delay.
    await page.getByTestId('palette-wQ').click();
    await page.getByTestId('board-square-d1').click();
    const edited = '4k3/8/8/8/8/8/8/3QK3';
    await expect(board).toHaveAttribute('data-placement', edited);
    await page.waitForTimeout(4500);
    await expect(board).toHaveAttribute('data-placement', edited);
  });

  test('keyboard-only selection starts recognition', async ({ page, hasTouch }) => {
    test.skip(hasTouch, 'keyboard selection is a desktop journey');
    await installScriptedRecognizer(page, {
      steps: [{ delayMs: 20, outcome: 'board', placement: SCRIPTED_PLACEMENT }],
    });
    await openFixture(page, fixture.expected.locator.pageIndex);
    await enableSelection(page);

    await page.getByTestId('selection-layer').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('selection-rect')).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('recognition-status')).toHaveAttribute('data-phase', 'done');
    await expect(page.getByTestId('floating-board')).toHaveAttribute(
      'data-placement',
      SCRIPTED_PLACEMENT,
    );
  });

  test('opening a non-PDF file reports an actionable error without the file name', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('pdf-open-input').setInputFiles({
      name: 'secret-title.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('this is not a pdf'),
    });
    const error = page.getByTestId('pdf-reader-error');
    await expect(error).toBeVisible();
    await expect(error).not.toContainText('secret-title');
  });
});

test.describe('PDF diagram to editable board (real recognizer)', () => {
  test('the real worker recognizes the fixture diagram offline', async ({ page }) => {
    test.setTimeout(120_000);
    await openFixture(page, fixture.expected.locator.pageIndex);
    await dragSelection(page, fixture.expected.boardRect);

    const status = page.getByTestId('recognition-status');
    await expect(status).toHaveAttribute('data-phase', 'done', { timeout: 90_000 });
    await expect(status).toHaveAttribute('data-cold-start', 'true');
    await expect(status).toHaveAttribute('data-reliable', 'true');

    const board = page.getByTestId('floating-board');
    await expect(board).toHaveAttribute('data-placement', fixture.expected.placement);
    await expect(board).toHaveAttribute('data-orientation', fixture.expected.orientation);
  });

  test('a text-only region reports no board', async ({ page }) => {
    test.setTimeout(120_000);
    const negativePage = fixture.expected.negativePages?.[0] ?? 0;
    const negativeRect = fixture.expected.negativeRect;
    if (!negativeRect) {
      throw new Error('the fixture manifest must record expected.negativeRect');
    }
    await openFixture(page, negativePage);
    // The same sparse title-line region the Node golden test uses: dense text
    // paragraphs can legitimately read as a low-confidence "board" (see
    // packages/test-fixtures/generators/lib/layout.mjs), which the UI reports honestly.
    await dragSelection(page, negativeRect, 0);

    await expect(page.getByTestId('recognition-status')).toHaveAttribute('data-phase', 'no-board', {
      timeout: 90_000,
    });
    await expect(page.getByTestId('floating-board')).toHaveCount(0);
  });
});
