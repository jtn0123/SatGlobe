import { test, expect } from '@test/e2e/coverage';
import { waitForAppReady } from '@test/e2e/keeptrack-fixtures';

test.describe('NewLaunch', () => {
  test('keeps the public launch form gated until a satellite is selected', async ({ page }) => {
    await waitForAppReady(page, {
      plugins: { NewLaunch: { enabled: true } },
      settings: { isDisableLoginGate: true, isMobileModeEnabled: true },
    });

    // 1. Verify bottom icon exists (legacy pattern: "New Launch" → "new-launch-bottom-icon")
    const bottomIcon = page.locator('#new-launch-bottom-icon');

    await expect(bottomIcon).toBeAttached();
    await expect(bottomIcon).toHaveClass(/bmenu-item-disabled/u);

    // 2. Open drawer and find plugin item in Create group
    await page.locator('#drawer-hamburger').click();

    const group = page.locator('.drawer-group[data-group-key="mode-3"]');
    const groupItems = group.locator('.drawer-group-items');

    if (await groupItems.isHidden()) {
      await group.locator('.drawer-group-header').click();
      await expect(groupItems).toBeVisible({ timeout: 2_000 });
    }

    const drawerItem = page.locator('.drawer-item[data-plugin-id="new-launch-bottom-icon"]');

    await expect(drawerItem).toBeVisible();
    await expect(drawerItem).toHaveClass(/disabled/u);

    // The public form is present but must remain closed until a satellite is selected.
    const sideMenu = page.locator('#newLaunch-menu');

    await expect(sideMenu).toBeHidden();
    await expect(bottomIcon).not.toHaveClass(/bmenu-item-selected/u);

    await expect(page.locator('#nl-scc')).toBeDisabled();
    await expect(page.locator('#nl-inc')).toBeDisabled();
    await expect(page.locator('#nl-updown')).toBeAttached();
    await expect(page.locator('#nl-facility')).toBeAttached();
    await expect(page.locator('#newLaunch-menu-submit')).toBeAttached();
  });
});
