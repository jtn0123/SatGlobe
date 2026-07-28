import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/build-pipeline.yml';
const SONARCLOUD_PROPERTIES_PATH = 'sonar-project.properties';
const AUTOMATIC_ANALYSIS_PROPERTIES_PATH = '.sonarcloud.properties';

const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const fullSuiteStart = workflow.indexOf('  full-suite:');
const fullSuiteEnd = workflow.indexOf('\n  performance-ledger:', fullSuiteStart);
const fullSuiteJob = workflow.slice(fullSuiteStart, fullSuiteEnd);

describe('SonarCloud coverage pipeline', () => {
  it('scans the LCOV report in the full coverage job with complete git history', () => {
    const coverageCommand = fullSuiteJob.indexOf('./node_modules/.bin/vitest run --coverage');
    const scannerAction = fullSuiteJob.indexOf('uses: SonarSource/sonarqube-scan-action@');

    expect(fullSuiteStart).toBeGreaterThanOrEqual(0);
    expect(fullSuiteEnd).toBeGreaterThan(fullSuiteStart);
    expect(fullSuiteJob).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # v\d+\n\s+with:\n\s+fetch-depth: 0/u);
    expect(coverageCommand).toBeGreaterThanOrEqual(0);
    expect(scannerAction).toBeGreaterThan(coverageCommand);
    expect(fullSuiteJob).toMatch(/uses: SonarSource\/sonarqube-scan-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/u);
    expect(fullSuiteJob).toMatch(/SONAR_TOKEN: \$\{\{ secrets\.SONAR_TOKEN \}\}/u);
    expect(fullSuiteJob).toMatch(/github\.actor != 'dependabot\[bot\]'/u);
    expect(fullSuiteJob).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('targets the SatGlobe cloud project and imports the generated LCOV file', () => {
    expect(existsSync(SONARCLOUD_PROPERTIES_PATH)).toBe(true);

    const properties = readFileSync(SONARCLOUD_PROPERTIES_PATH, 'utf8');

    expect(properties).toContain('sonar.organization=jtn0123ismysonar');
    expect(properties).toContain('sonar.projectKey=jtn0123_SatGlobe');
    expect(properties).toContain('sonar.projectName=SatGlobe');
    expect(properties).toContain('sonar.sources=src');
    expect(properties).toContain('sonar.javascript.lcov.reportPaths=coverage/lcov.info');
    expect(properties).toContain('sonar.cpd.exclusions=src/satglobe/stories/**');
  });

  it('does not retain the automatic-analysis-only configuration', () => {
    expect(existsSync(AUTOMATIC_ANALYSIS_PROPERTIES_PATH)).toBe(false);
  });
});
