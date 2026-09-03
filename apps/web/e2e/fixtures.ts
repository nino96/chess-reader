import { test as base, expect, type Page } from '@playwright/test';

/** The 8 capability rows the diagnostics panel must always render. */
export const CAPABILITY_IDS = [
  'indexeddb',
  'opfs',
  'workers',
  'webassembly',
  'storage-estimate',
  'storage-persistence',
  'touch',
  'cross-origin-isolation',
] as const;

export const CAPABILITY_STATUSES = [
  'probing',
  'supported',
  'unsupported',
  'unknown',
  'error',
] as const;

/**
 * Chess Reader never talks to the network at runtime (see AGENTS.md: "Never
 * upload book bytes... Do not add telemetry or runtime CDN dependencies").
 * Every spec in this suite imports `test`/`expect` from this module instead of
 * `@playwright/test` directly so that any request leaving the app's own origin
 * fails the test, proving the E2E journey is deterministic and offline.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (!baseURL) {
      throw new Error('baseURL must be configured for the network guard fixture to work.');
    }
    const allowedOrigin = new URL(baseURL).origin;
    const blocked: string[] = [];

    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      let origin: string;
      try {
        origin = new URL(requestUrl).origin;
      } catch {
        origin = '';
      }
      if (origin !== allowedOrigin) {
        blocked.push(`${route.request().method()} ${requestUrl}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await use(page);

    if (blocked.length > 0) {
      throw new Error(
        `Test attempted ${blocked.length} non-same-origin request(s), which is not allowed ` +
          `for this offline-first app:\n${blocked.join('\n')}`,
      );
    }
  },
});

export { expect };

/**
 * Waits until the capability diagnostics panel has finished probing: the
 * live summary no longer reads "Checking capabilities…" and none of the 8
 * capability rows are still in the `probing` state.
 */
export async function waitForDiagnosticsSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('capability-summary')).not.toContainText('Checking');
  for (const id of CAPABILITY_IDS) {
    await expect(page.getByTestId(`capability-${id}`)).not.toHaveAttribute(
      'data-status',
      'probing',
    );
  }
}

/** Reads the current `data-status` of every capability row, keyed by id. */
export async function readCapabilityStatuses(page: Page): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    CAPABILITY_IDS.map(async (id) => {
      const status = await page.getByTestId(`capability-${id}`).getAttribute('data-status');
      return [id, status] as const;
    }),
  );
  return Object.fromEntries(entries);
}
