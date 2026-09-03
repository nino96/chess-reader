import AxeBuilder from '@axe-core/playwright';
import { expect, test, waitForDiagnosticsSettled } from './fixtures';

const COLOR_SCHEMES = ['light', 'dark'] as const;

for (const colorScheme of COLOR_SCHEMES) {
  test(`no automated accessibility violations (${colorScheme} color scheme)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    if (results.violations.length > 0) {
      // Printed only on failure, so the violation detail is visible in CI logs.
      console.error(JSON.stringify(results.violations, null, 2));
    }
    expect(results.violations).toEqual([]);
  });
}
