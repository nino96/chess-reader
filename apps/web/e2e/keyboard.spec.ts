import { expect, test, waitForDiagnosticsSettled } from './fixtures';

// The skip-link -> main -> diagnostics keyboard journey is a desktop/pointer
// concept; touch projects have no keyboard to drive it. This is a documented,
// conditional project scope, not an unconditional skip.
test.skip(({ hasTouch }) => hasTouch, 'keyboard journey runs on desktop projects');

test('skip link is the first Tab stop and focuses main content on activation', async ({ page }) => {
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });

  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();

  await page.keyboard.press('Enter');

  const focusIsInMain = await page.evaluate(() => {
    const main = document.getElementById('main');
    const active = document.activeElement;
    return active !== null && (active === main || (main?.contains(active) ?? false));
  });
  expect(
    focusIsInMain,
    'activeElement should be main or a descendant of main after activating the skip link',
  ).toBe(true);
});

test('keyboard can reach and activate the Re-run button', async ({ page }) => {
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Enter'); // activate it, focus moves into main

  const rerunButton = page.getByTestId('capability-rerun');
  let reachedRerun = false;
  const maxTabStops = 40;
  for (let i = 0; i < maxTabStops && !reachedRerun; i += 1) {
    reachedRerun = await rerunButton.evaluate((el) => el === document.activeElement);
    if (!reachedRerun) {
      await page.keyboard.press('Tab');
    }
  }
  expect(reachedRerun, `Re-run button was not reachable within ${maxTabStops} Tab stops`).toBe(
    true,
  );

  const summary = page.getByTestId('capability-summary');
  await expect(summary).toHaveText(/\d+ of 8 capabilities supported/);

  await page.keyboard.press('Enter');

  // The live summary transitions through the re-run and settles again.
  await waitForDiagnosticsSettled(page);
  await expect(summary).toHaveText(/\d+ of 8 capabilities supported/);
});
