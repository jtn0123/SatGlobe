/**
 * Read-only SonarCloud issue inventory for the public SatGlobe project.
 *
 * Usage:
 *   npm run sonar:cloud-report
 *   npm run sonar:cloud-report -- --json
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_API_URL = 'https://sonarcloud.io';
const DEFAULT_PROJECT_KEY = 'jtn0123_SatGlobe';
const PAGE_SIZE = 500;
const SEARCH_CAP = 10_000;

export interface SonarCloudImpact {
  softwareQuality: string;
  severity: string;
}

export interface SonarCloudIssue {
  key: string;
  rule: string;
  severity: string;
  type: string;
  component: string;
  effort?: string;
  impacts?: SonarCloudImpact[];
}

interface SonarCloudIssuePage {
  issues?: SonarCloudIssue[];
  paging?: { total: number };
  total?: number;
}

export interface SonarCloudCount {
  key: string;
  count: number;
}

export interface SonarCloudSummary {
  projectKey: string;
  total: number;
  effortMinutes: number;
  byType: SonarCloudCount[];
  bySeverity: SonarCloudCount[];
  byArea: SonarCloudCount[];
  byRule: SonarCloudCount[];
}

/** Convert Sonar's compact debt duration into minutes using its eight-hour workday. */
export const effortToMinutes = (effort?: string): number => {
  if (!effort) {
    return 0;
  }

  const match = (/^(?:(?<days>\d+)d)?(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)min)?$/u).exec(effort);

  if (!match) {
    return 0;
  }

  return Number(match.groups?.days ?? 0) * 8 * 60 + Number(match.groups?.hours ?? 0) * 60 + Number(match.groups?.minutes ?? 0);
};

const issuePath = (issue: SonarCloudIssue): string => {
  const separator = issue.component.indexOf(':');

  return separator >= 0 ? issue.component.slice(separator + 1) : issue.component;
};

/** Map a repository path into the same product-oriented areas used by the cleanup ledger. */
export const areaForIssue = (issue: SonarCloudIssue): string => {
  const filePath = issuePath(issue);

  if ((/(?:__tests__|\.test\.|\.spec\.|^test\/)/u).test(filePath)) {
    return 'tests';
  }
  if (filePath.startsWith('src/satglobe/')) {
    return 'SatGlobe product layer';
  }
  if (filePath.startsWith('src/engine/ootk/')) {
    return 'vendored OOTK';
  }
  if (filePath.startsWith('src/engine/')) {
    return 'core engine/rendering';
  }
  if (filePath.startsWith('src/plugins/')) {
    return 'plugins';
  }
  if (filePath.startsWith('src/app/')) {
    return 'app/data/UI core';
  }
  if (filePath.startsWith('src/webworker/')) {
    return 'web workers';
  }
  if (filePath.startsWith('scripts/') || filePath.startsWith('build/')) {
    return 'tooling/build scripts';
  }
  if (filePath.startsWith('.github/')) {
    return 'CI workflows';
  }
  if (filePath.startsWith('public/') || (/\.(?:css|scss|html)$/u).test(filePath)) {
    return 'public/styles/HTML';
  }

  return 'other';
};

const countBy = (issues: SonarCloudIssue[], keyForIssue: (issue: SonarCloudIssue) => string): SonarCloudCount[] => {
  const counts = new Map<string, number>();

  for (const issue of issues) {
    const key = keyForIssue(issue);

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

/** Fetch every unresolved issue, respecting SonarCloud's documented 10k search cap. */
export const fetchOpenIssues = async (
  fetchImpl: typeof fetch = fetch,
  apiUrl = process.env.SONARCLOUD_URL ?? DEFAULT_API_URL,
  projectKey = process.env.SONARCLOUD_PROJECT_KEY ?? DEFAULT_PROJECT_KEY,
): Promise<SonarCloudIssue[]> => {
  const issues: SonarCloudIssue[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while ((page - 1) * PAGE_SIZE < Math.min(total, SEARCH_CAP)) {
    const url = new URL('/api/issues/search', apiUrl);

    url.searchParams.set('componentKeys', projectKey);
    url.searchParams.set('resolved', 'false');
    url.searchParams.set('ps', String(PAGE_SIZE));
    url.searchParams.set('p', String(page));

    // Pages must be fetched in order so the public API's total/cap contract remains stable.
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchImpl(url);

    if (!response.ok) {
      throw new Error(`SonarCloud issue request failed with HTTP ${response.status}.`);
    }

    // eslint-disable-next-line no-await-in-loop
    const body = (await response.json()) as SonarCloudIssuePage;
    const pageIssues = body.issues ?? [];

    issues.push(...pageIssues);
    total = body.paging?.total ?? body.total ?? issues.length;

    if (pageIssues.length === 0 || issues.length >= total) {
      break;
    }
    page++;
  }

  if (total > SEARCH_CAP) {
    throw new Error(`SonarCloud reports ${total} issues, exceeding the ${SEARCH_CAP} issue search cap.`);
  }

  return issues;
};

/** Build the stable, machine-readable summary used in PR before/after reports. */
export const summarizeIssues = (issues: SonarCloudIssue[], projectKey = DEFAULT_PROJECT_KEY): SonarCloudSummary => ({
  projectKey,
  total: issues.length,
  effortMinutes: issues.reduce((total, issue) => total + effortToMinutes(issue.effort), 0),
  byType: countBy(issues, (issue) => issue.type),
  bySeverity: countBy(issues, (issue) => issue.severity),
  byArea: countBy(issues, areaForIssue),
  byRule: countBy(issues, (issue) => issue.rule),
});

const formatCounts = (counts: SonarCloudCount[], limit?: number): string =>
  counts
    .slice(0, limit)
    .map(({ key, count }) => `  ${String(count).padStart(5)}  ${key}`)
    .join('\n');

/** Format a compact report for humans while keeping JSON available for automation. */
export const formatHumanSummary = (summary: SonarCloudSummary): string => [
  `SonarCloud unresolved issues for ${summary.projectKey}: ${summary.total}`,
  `Estimated remediation effort: ${summary.effortMinutes} minutes (${(summary.effortMinutes / 60).toFixed(1)} hours)`,
  '',
  'By type:',
  formatCounts(summary.byType),
  '',
  'By severity:',
  formatCounts(summary.bySeverity),
  '',
  'By area:',
  formatCounts(summary.byArea),
  '',
  'Top rules:',
  formatCounts(summary.byRule, 20),
].join('\n');

/** CLI entrypoint. */
export const runSonarCloudReport = async (): Promise<void> => {
  const projectKey = process.env.SONARCLOUD_PROJECT_KEY ?? DEFAULT_PROJECT_KEY;
  const summary = summarizeIssues(await fetchOpenIssues(), projectKey);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));

    return;
  }

  console.log(formatHumanSummary(summary));
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await runSonarCloudReport();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
