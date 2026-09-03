import type { Page } from '@playwright/test';
import { expect, test, waitForDiagnosticsSettled } from './fixtures';

const WIDTHS = [320, 360, 507, 678, 768, 1024, 1440];
const HEIGHT = 900;
const SECTION_TEST_IDS = [
  'app-shell',
  'app-header',
  'library-empty',
  'install-panel',
  'capability-diagnostics',
];

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    `document.documentElement.scrollWidth (${scrollWidth}) should not exceed the viewport width`,
  ).toBeLessThanOrEqual(innerWidth + 1);
}

async function assertSectionsVisible(page: Page): Promise<void> {
  for (const testId of SECTION_TEST_IDS) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
}

for (const width of WIDTHS) {
  test(`no horizontal overflow and all sections visible at ${width}px`, async ({
    page,
    browserName,
  }, testInfo) => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    await assertNoHorizontalOverflow(page);
    await assertSectionsVisible(page);

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${browserName}-${width}px`, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
}

test('dark color scheme at 1024px', async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: HEIGHT });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  await assertNoHorizontalOverflow(page);
  await assertSectionsVisible(page);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${browserName}-dark-1024px`, {
    body: screenshot,
    contentType: 'image/png',
  });
});

test('reduced motion at 1024px', async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: HEIGHT });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  await assertNoHorizontalOverflow(page);
  await assertSectionsVisible(page);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${browserName}-reduced-motion-1024px`, {
    body: screenshot,
    contentType: 'image/png',
  });
});

test('controls remain visible at a 200% zoom approximation (720x900)', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: HEIGHT });
  await page.goto('/');
  await waitForDiagnosticsSettled(page);

  await assertNoHorizontalOverflow(page);
  await expect(page.getByTestId('capability-rerun')).toBeVisible();
  await expect(page.getByTestId('capability-request-persist')).toBeVisible();
  await expect(page.getByTestId('install-panel')).toBeVisible();
});
