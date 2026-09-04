import { expect, test } from './fixtures';

interface ManifestIcon {
  src: string;
  type?: string;
  sizes?: string;
}

interface WebManifest {
  name: string;
  display: string;
  icons: ManifestIcon[];
}

test.describe('app shell', () => {
  test('loads with no console or page errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const response = await page.goto('/');
    await expect(page.getByTestId('app-shell')).toBeVisible();

    // No message is ignored silently. If a benign message is ever observed
    // here, it must be filtered explicitly with a comment explaining why,
    // not by weakening this assertion wholesale.
    expect(consoleErrors, `unexpected console errors: ${JSON.stringify(consoleErrors)}`).toEqual(
      [],
    );
    expect(pageErrors, `unexpected page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);

    if (!response) {
      throw new Error('navigation must produce a response');
    }
    const headers = response.headers();
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  });

  test('has the expected title, heading, and landmarks', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Chess Reader');

    const headings = page.getByRole('heading', { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText('Chess Reader');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.locator('main#main')).toHaveCount(1);
  });

  test('shows the book reader and install panel', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('pdf-reader')).toBeVisible();
    await expect(page.getByTestId('install-panel')).toBeVisible();
  });

  test('the web app manifest resolves and its icons load', async ({ page }) => {
    await page.goto('/');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    if (!manifestHref) {
      throw new Error('a link[rel=manifest] must be present');
    }

    const manifestUrl = new URL(manifestHref, page.url());
    const manifestResponse = await page.request.get(manifestUrl.toString());
    expect(manifestResponse.status()).toBe(200);

    const manifest = (await manifestResponse.json()) as WebManifest;
    expect(manifest.name).toBe('Chess Reader');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    for (const icon of manifest.icons) {
      const iconUrl = new URL(icon.src, manifestUrl);
      const iconResponse = await page.request.get(iconUrl.toString());
      expect(iconResponse.status(), `icon ${icon.src} must resolve`).toBe(200);
      const contentType = iconResponse.headers()['content-type'] ?? '';
      expect(
        contentType.startsWith('image/'),
        `icon ${icon.src} must be an image, got ${contentType}`,
      ).toBe(true);
    }
  });
});
