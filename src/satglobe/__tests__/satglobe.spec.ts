import { expect, test } from '@playwright/test';

test.describe('SatGlobe workshop', () => {
  test.beforeEach(async ({ page }) => {
    const externalRequests: string[] = [];

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());

      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(url.href);
        await route.abort();

        return;
      }
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByTestId('satglobe-app')).toBeVisible();
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });
    expect(externalRequests).toEqual([]);
  });

  test('filters, inspects, presents, tells a story, and exports a view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByTestId('starlink-lens').click();
    await expect(page.getByTestId('encoding-select')).toHaveValue('orbital-plane');

    const search = page.getByTestId('catalog-search');
    const cameraBeforeSelection = await page.evaluate(() => window.satGlobe?.getState().camera);

    await search.fill('STARLINK-1008');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('object-inspector')).toContainText('STARLINK');
    const cameraAfterSelection = await page.evaluate(() => window.satGlobe?.getState().camera);

    expect(cameraAfterSelection?.zoom).toBeCloseTo(cameraBeforeSelection?.zoom ?? 0, 4);
    expect(await page.evaluate(() => window.settingsManager.isFocusOnSatelliteWhenSelected)).toBe(false);
    expect(await page.evaluate(() => window.settingsManager.noMeshManager)).toBe(true);
    await expect(page.getByTestId('scale-disclosure')).toContainText('SEMANTIC SCALE');

    const download = page.waitForEvent('download');

    await page.getByTestId('export-view').click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/u);

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.getByText('A living orbital environment')).toBeVisible();
    await page.getByTestId('story-mode').click();
    await expect(page.getByTestId('story-deck')).toContainText('Before the shell');
    await page.getByRole('button', { name: 'Next beat' }).click();
    await expect(page.getByTestId('story-deck')).toContainText('A train appears');
    await page.getByTestId('story-play').click();
    await expect(page.getByTestId('story-play')).toHaveAttribute('aria-label', 'Pause story');
    await page.getByRole('button', { name: 'Open workshop' }).click();
    await expect(page.getByTestId('discover-panel')).toBeVisible();
  });

  test('keeps presentation typography legible at 4K', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.getByText('A living orbital environment')).toBeVisible();
    await expect(page.getByTestId('scale-disclosure')).toBeVisible();
  });

  test('preserves the two-panel workshop at 1440p', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect(page.getByTestId('discover-panel')).toBeVisible();
    await expect(page.getByText('Select an object')).toBeVisible();
  });

  test('uses catalog status rather than renderer activity for operational filters', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const bundledCatalog = await (await page.request.get('/tle/tle.json')).json() as unknown[];
    const indexedCount = async () => Number((await page.getByTestId('catalog-status').textContent())?.replace(/,/gu, '').match(/\d+/u)?.[0]);

    await expect.poll(indexedCount).toBeGreaterThanOrEqual(Math.floor(bundledCatalog.length * 0.95));
    await expect.poll(indexedCount).toBeLessThanOrEqual(bundledCatalog.length + 20);
    await expect(page.getByTestId('status-active')).toHaveAttribute('aria-pressed', 'true');
    const activeCount = await page.getByTestId('visible-count').textContent();

    await page.getByTestId('status-inactive').click();
    await expect(page.getByTestId('status-inactive')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('visible-count')).not.toHaveText(activeCount ?? '');

    await page.getByTestId('catalog-search').fill('Vanguard 1');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('object-inspector')).toContainText('17 MAR 1958');
    await expect(page.getByTestId('object-inspector')).toContainText('Inactive / unknown');
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1280, 720]);
  });
});

test.describe('SatGlobe failure states', () => {
  test('surfaces a catalog-load error instead of spinning forever', async ({ page }) => {
    // Outside the main suite's beforeEach on purpose: this journey breaks the
    // catalog request and must not inherit the healthy-boot assertions.
    await page.route('**/tle/tle.json', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('satglobe-app')).toBeVisible();
    // The adapter's hydrate timeout (20s after engine-ready) raises the error.
    await expect(page.getByTestId('engine-error')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('engine-error')).toContainText('failed to load');
    await expect(page.getByTestId('engine-error').getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});
