import { describe, expect, it } from 'vitest';
import {
  reportersForEnvironment,
  shouldReuseServer,
  testIgnoreForEnvironment,
  webServerCommandForEnvironment,
} from '../../playwright.config';

describe('Playwright suite boundaries', () => {
  it('keeps SatGlobe in its dedicated profile lane', () => {
    expect(testIgnoreForEnvironment({})).toEqual(['**/satglobe.spec.ts']);
    expect(testIgnoreForEnvironment({ SATGLOBE_E2E: '1' })).toEqual([]);
  });

  it('writes an uploadable HTML report alongside CI annotations', () => {
    expect(reportersForEnvironment({ CI: 'true' })).toEqual([
      ['github'],
      ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ]);
  });

  it('requires an explicit opt-in before reusing a local server', () => {
    expect(shouldReuseServer({})).toBe(false);
    expect(shouldReuseServer({ PLAYWRIGHT_REUSE_SERVER: '1' })).toBe(true);
  });

  it('starts a server built for the selected test lane', () => {
    expect(webServerCommandForEnvironment({})).toBe('npm run start:ci');
    expect(webServerCommandForEnvironment({ SATGLOBE_E2E: '1' })).toBe('npm run start:satglobe');
    expect(webServerCommandForEnvironment({ CI: 'true', SATGLOBE_E2E: '1' })).toBe('npm run start:satglobe:static');
  });
});
