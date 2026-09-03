import {
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
  expect,
  readCapabilityStatuses,
  test,
  waitForDiagnosticsSettled,
} from './fixtures';

// Capabilities that must be supported in every Playwright engine (Chromium,
// Firefox, WebKit) regardless of touch/viewport project, because they are
// plain web-platform features with no touch or environment dependency.
//
// `storage-estimate` and `opfs` are deliberately not in this list: the
// Playwright WebKit build used here exposes no `navigator.storage` at all,
// unlike shipping Safari 17+/iPadOS (see docs/platform-limitations.md §7).
// Those rows are instead checked against the engine's real API surface below,
// and real-iPad evidence (docs/device-evidence/) remains the gate.
const ALWAYS_SUPPORTED = ['indexeddb', 'workers', 'webassembly'] as const;

test.describe('capability diagnostics', () => {
  test('renders all 8 rows with a valid status after settling', async ({ page }) => {
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    for (const id of CAPABILITY_IDS) {
      const row = page.getByTestId(`capability-${id}`);
      await expect(row).toBeVisible();
      const status = await row.getAttribute('data-status');
      expect(status, `capability-${id} must have a data-status attribute`).not.toBeNull();
      expect(
        CAPABILITY_STATUSES as readonly string[],
        `capability-${id} has an unexpected status: ${String(status)}`,
      ).toContain(status);
      // Each row must show a human-readable status word, not just the
      // machine-readable attribute.
      await expect(row).not.toBeEmpty();
    }

    await expect(page.getByTestId('capability-summary')).toHaveText(
      /\d+ of 8 capabilities supported/,
    );
  });

  test('baseline capabilities are supported in every browser engine', async ({ page }) => {
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    for (const id of ALWAYS_SUPPORTED) {
      await expect(
        page.getByTestId(`capability-${id}`),
        `capability-${id} is expected to be supported in every Playwright engine`,
      ).toHaveAttribute('data-status', 'supported');
    }
  });

  test('cross-origin-isolation row reports the real crossOriginIsolated value', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    const actuallyIsolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    const expectedStatus = actuallyIsolated ? 'supported' : 'unsupported';

    await expect(page.getByTestId('capability-cross-origin-isolation')).toHaveAttribute(
      'data-status',
      expectedStatus,
    );
  });

  test('storage rows report the real navigator.storage API surface', async ({ page }) => {
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    const surface = await page.evaluate(() => {
      const storage: unknown = (navigator as { storage?: unknown }).storage;
      const has = (method: string): boolean =>
        typeof storage === 'object' &&
        storage !== null &&
        typeof (storage as Record<string, unknown>)[method] === 'function';
      return { estimate: has('estimate'), getDirectory: has('getDirectory') };
    });

    // When the API exists it must actually work in these engines; when it is
    // absent the diagnostic must say so instead of guessing.
    await expect(page.getByTestId('capability-storage-estimate')).toHaveAttribute(
      'data-status',
      surface.estimate ? 'supported' : 'unsupported',
    );
    await expect(page.getByTestId('capability-opfs')).toHaveAttribute(
      'data-status',
      surface.getDirectory ? 'supported' : 'unsupported',
    );
  });

  test('touch row matches the project touch capability', async ({ page, hasTouch }) => {
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    const expectedStatus = hasTouch ? 'supported' : 'unsupported';
    await expect(page.getByTestId('capability-touch')).toHaveAttribute(
      'data-status',
      expectedStatus,
    );
  });

  test('Re-run returns rows to a settled state with the same statuses', async ({ page }) => {
    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    const before = await readCapabilityStatuses(page);

    await page.getByTestId('capability-rerun').click();
    await waitForDiagnosticsSettled(page);

    const after = await readCapabilityStatuses(page);
    expect(after).toEqual(before);
  });

  test('persist button either is disabled or settles the persistence row without page errors', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await waitForDiagnosticsSettled(page);

    const persistButton = page.getByTestId('capability-request-persist');
    await expect(persistButton).toBeVisible();

    const isDisabled = await persistButton.isDisabled();
    if (!isDisabled) {
      await persistButton.click();
      await expect(page.getByTestId('capability-storage-persistence')).not.toHaveAttribute(
        'data-status',
        'probing',
      );
    }

    expect(pageErrors, `unexpected page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
  });
});
