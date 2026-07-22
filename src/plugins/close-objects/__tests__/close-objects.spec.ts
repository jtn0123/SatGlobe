import { test, expect } from '@test/e2e/coverage';
import { waitForAppReady } from '@test/e2e/keeptrack-fixtures';

test.describe('CloseObjects Plugin', () => {
  test('opens the public search menu without private extension controls', async ({ page }) => {
    await waitForAppReady(page, {
      plugins: { CloseObjectsPlugin: { enabled: true } },
      settings: { isDisableLoginGate: true, isMobileModeEnabled: true },
    });

    const bottomIcon = page.locator('#conjunction-nearby-icon');
    const sideMenu = page.locator('#close-objects-menu');

    // Bottom icon should exist and NOT be disabled
    await expect(bottomIcon).toBeAttached();
    await expect(bottomIcon).not.toHaveClass(/bmenu-item-disabled/u);

    // Open drawer and find item in the EVENTS group (mode-2)
    await page.locator('#drawer-hamburger').click();

    const eventsGroup = page.locator('.drawer-group[data-group-key="mode-2"]');
    const groupItems = eventsGroup.locator('.drawer-group-items');

    if (await groupItems.isHidden()) {
      await eventsGroup.locator('.drawer-group-header').click();
      await expect(groupItems).toBeVisible({ timeout: 2_000 });
    }

    const drawerItem = page.locator('.drawer-item[data-plugin-id="conjunction-nearby-icon"]');

    await expect(drawerItem).toBeVisible();

    // Click to open side menu
    await drawerItem.click();
    await expect(bottomIcon).toHaveClass(/bmenu-item-selected/u, { timeout: 5_000 });
    await expect(sideMenu).toBeVisible({ timeout: 5_000 });

    // Verify the find button exists
    await expect(page.locator('#co-find-btn')).toBeVisible();

    // Private settings/results extensions are intentionally absent here.
    await expect(page.locator('#co-pro-settings-form, #co-pro-results-table, #co-pro-results-count')).toHaveCount(0);

    // Close via the side menu close button
    await page.locator('#close-objects-menu-close-btn').click();
    await expect(bottomIcon).not.toHaveClass(/bmenu-item-selected/u, { timeout: 5_000 });
  });
});
