import { describe, expect, it, vi } from 'vitest';
import {
  areaForIssue,
  effortToMinutes,
  fetchOpenIssues,
  formatHumanSummary,
  summarizeIssues,
  type SonarCloudIssue,
} from './sonar-cloud-report';

const issue = (overrides: Partial<SonarCloudIssue> = {}): SonarCloudIssue => ({
  key: 'issue-1',
  rule: 'typescript:S1',
  severity: 'MAJOR',
  type: 'BUG',
  component: 'jtn0123_SatGlobe:src/satglobe/app/example.ts',
  effort: '10min',
  ...overrides,
});

describe('sonar-cloud-report', () => {
  it('converts Sonar remediation durations to minutes', () => {
    expect(effortToMinutes('1d2h30min')).toBe(630);
    expect(effortToMinutes('15min')).toBe(15);
    expect(effortToMinutes('unexpected')).toBe(0);
  });

  it('groups repository paths into product-oriented areas', () => {
    expect(areaForIssue(issue())).toBe('SatGlobe product layer');
    expect(areaForIssue(issue({ component: 'jtn0123_SatGlobe:src/engine/ootk/src/sgp4/sgp4.ts' }))).toBe('vendored OOTK');
    expect(areaForIssue(issue({ component: 'jtn0123_SatGlobe:src/plugins/example/example.test.ts' }))).toBe('tests');
  });

  it('paginates the public issues API until all results are collected', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => issue({ key: `issue-${index}` }));
    const secondPage = [issue({ key: 'issue-500', rule: 'typescript:S2' })];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 501 }, issues: firstPage })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 501 }, issues: secondPage })));

    const issues = await fetchOpenIssues(fetchMock, 'https://example.invalid', 'example_project');

    expect(issues).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('p')).toBe('2');
  });

  it('produces stable totals and a compact human summary', () => {
    const summary = summarizeIssues([
      issue(),
      issue({ key: 'issue-2', rule: 'typescript:S2', severity: 'MINOR', type: 'CODE_SMELL', effort: '5min' }),
    ]);

    expect(summary).toMatchObject({ total: 2, effortMinutes: 15 });
    expect(summary.byRule).toEqual([
      { key: 'typescript:S1', count: 1 },
      { key: 'typescript:S2', count: 1 },
    ]);
    expect(formatHumanSummary(summary)).toContain('SonarCloud unresolved issues for jtn0123_SatGlobe: 2');
  });
});
