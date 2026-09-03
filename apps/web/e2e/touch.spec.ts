import { expect, readCapabilityStatuses, test, waitForDiagnosticsSettled } from './fixtures';

// Tap gestures and the 44px touch-target rule only apply to touch-capable
// projects (ipad-webkit, ipad-split-webkit, phone-chromium).
test.skip(({ hasTouch }) => !hasTouch, 'touch journey runs on touch-capable projects only');

test('Re-run responds to tap and the diagnostic re-settles', async ({ page }) => {
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  const before = await readCapabilityStatuses(page);

  await page.getByTestId('capability-rerun').tap();
  await waitForDiagnosticsSettled(page);

  const after = await readCapabilityStatuses(page);
  expect(after).toEqual(before);
});

test('every button and link inside main meets the 44px touch target minimum', async ({ page }) => {
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  const controls = page.locator('main :is(button, a)');
  const count = await controls.count();
  expect(count, 'main should contain at least one interactive control').toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const box = await control.boundingBox();
    if (!box) {
      throw new Error(`control at index ${i} must have a bounding box`);
    }
    expect(box.height, `control at index ${i} should be at least 44px tall`).toBeGreaterThanOrEqual(
      44,
    );
  }
});
