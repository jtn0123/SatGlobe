import { test, expect } from '@test/e2e/coverage';
import { waitForAppReady } from '@test/e2e/keeptrack-fixtures';

test.describe('NaturalEventsPlugin', () => {
  test('does not expose the private plugin in a public build', async ({ page }) => {
    await waitForAppReady(page, {
      plugins: { NaturalEventsPlugin: { enabled: true } },
      settings: { isMobileModeEnabled: true },
    });

    await page.locator('#drawer-hamburger').click();
    await expect(page.locator('#menu-natural-events, #NaturalEventsPlugin-menu')).toHaveCount(0);
    await expect(page.locator('.drawer-item[data-plugin-id="menu-natural-events"]')).toHaveCount(0);
  });
});
