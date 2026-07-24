import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

type PlaywrightEnvironment = Readonly<Record<string, string | undefined>>;

/** Keep the dedicated SatGlobe journey out of the generic public application lane. */
export function testIgnoreForEnvironment(environment: PlaywrightEnvironment): string[] {
  return environment.SATGLOBE_E2E === '1' ? [] : ['**/satglobe.spec.ts'];
}

/** Preserve GitHub annotations while also producing the HTML artifact uploaded by CI. */
export function reportersForEnvironment(environment: PlaywrightEnvironment): ReporterDescription[] {
  return environment.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['html']];
}

/** Reusing an arbitrary local server is opt-in because its build profile may not match the requested suite. */
export const shouldReuseServer = (environment: PlaywrightEnvironment): boolean =>
  environment.PLAYWRIGHT_REUSE_SERVER === '1';

/** Select the server command that matches the test lane's build profile. */
export const webServerCommandForEnvironment = (environment: PlaywrightEnvironment): string => {
  if (environment.SATGLOBE_E2E !== '1') {
    return 'npm run start:ci';
  }

  return environment.CI ? 'npm run start:satglobe:static' : 'npm run start:satglobe';
};

// Use SwiftShader software GL in CI (no GPU available); real GPU locally for headed mode
const chromiumArgs = process.env.CI
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
  : ['--enable-webgl'];

export default defineConfig({
  testDir: './src',
  testMatch: '**/__tests__/*.spec.ts',
  testIgnore: testIgnoreForEnvironment(process.env),
  // Keep disposable Playwright traces/screenshots away from durable SatGlobe
  // story evidence stored in the sibling test-results/satglobe-story-shots/.
  outputDir: './test-results/playwright',
  // No-op unless E2E_COVERAGE=1; clears/generates the monocart V8 coverage report.
  globalSetup: './test/e2e/coverage-setup.ts',
  globalTeardown: './test/e2e/coverage-teardown.ts',
  fullyParallel: !process.env.CI,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 6,
  reporter: reportersForEnvironment(process.env),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:5544',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: chromiumArgs,
        },
      },
    },
  ],
  webServer: {
    /*
     * In CI the satglobe journey serves a prebuilt production bundle statically
     * (the workflow builds first). start:satglobe's watch build reports the port
     * ready before the first cold build finishes, so tests race an empty dist —
     * always on a fresh runner, reproducibly locally after a clean checkout.
     */
    command: webServerCommandForEnvironment(process.env),
    url: 'http://localhost:5544',
    // Opt in with PLAYWRIGHT_REUSE_SERVER=1 only after starting the matching
    // profile yourself. The safe default fails clearly if port 5544 is busy.
    reuseExistingServer: shouldReuseServer(process.env),
    timeout: 30_000,
  },
});
