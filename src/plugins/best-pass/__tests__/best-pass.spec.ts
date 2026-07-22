import { test, expect } from '@test/e2e/coverage';
import { waitForAppReady } from '@test/e2e/keeptrack-fixtures';

test.describe('BestPassPlugin', () => {
  test('requires a sensor before its public form can open', async ({ page }) => {
    await waitForAppReady(page, {
      plugins: { BestPassPlugin: { enabled: true } },
      settings: { isMobileModeEnabled: true },
    });

    const bottomIcon = page.locator('#best-pass-icon');
    const sideMenu = page.locator('#best-pass-menu');

    // The public plugin needs a sensor selected before it can calculate passes.
    await expect(bottomIcon).toBeAttached();
    await expect(bottomIcon).toHaveClass(/bmenu-item-disabled/u);

    // Side menu HTML should exist in DOM but be hidden
    await expect(sideMenu).toBeAttached();
    await expect(sideMenu).toBeHidden();

    // Open drawer and find the BestPass item in the EVENTS group (mode-2)
    await page.locator('#drawer-hamburger').click();

    const eventsGroup = page.locator('.drawer-group[data-group-key="mode-2"]');
    const groupItems = eventsGroup.locator('.drawer-group-items');

    if (await groupItems.isHidden()) {
      await eventsGroup.locator('.drawer-group-header').click();
      await expect(groupItems).toBeVisible({ timeout: 2_000 });
    }

    const drawerItem = page.locator('.drawer-item[data-plugin-id="best-pass-icon"]');

    await expect(drawerItem).toBeVisible();
    await expect(drawerItem).toHaveClass(/disabled/u);
    await expect(sideMenu).toBeHidden({ timeout: 2_000 });
    await expect(bottomIcon).not.toHaveClass(/bmenu-item-selected/u);

    // The public form is still present so selecting a sensor can enable it later.
    await expect(page.locator('form#best-pass-menu-form')).toBeAttached();
    await expect(page.locator('#bp-sats')).toHaveValue('25544,00005');
    await expect(page.locator('#bp-submit')).toBeAttached();
  });
});
