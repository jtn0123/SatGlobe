import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/e2e-nightly.yml', 'utf8');

describe('nightly Playwright workflow', () => {
  it('builds the public profile available in a clean checkout', () => {
    expect(workflow).toContain('run: npm run build\n');
    expect(workflow).not.toContain('run: npm run build:pro');
  });

  it('uploads the HTML report emitted by the CI reporter', () => {
    expect(workflow).toContain('path: playwright-report/');
  });
});
