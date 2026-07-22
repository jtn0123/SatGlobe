import { test, expect } from '@test/e2e/coverage';
import { expectCleanBoot, waitForAppReady } from '@test/e2e/keeptrack-fixtures';

test.describe('WatchlistPlugin', () => {
  test('initializes the configured watchlist without console errors', async ({ page }) => {
    await waitForAppReady(page, {
      plugins: { WatchlistPlugin: { enabled: true } },
      settings: { isDisableLoginGate: true },
    });

    expectCleanBoot(page);
    await expect(page.locator('#watchlist-menu')).toBeAttached();
  });
});
