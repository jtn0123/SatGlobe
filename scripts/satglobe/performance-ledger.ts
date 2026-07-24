#!/usr/bin/env npx tsx

/* eslint-disable jsdoc/require-jsdoc -- CLI plumbing delegates policy decisions to covered pure helpers. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  acceptedPerformanceRecordSchema,
  compareReports,
  comparisonKey,
  emptyComparison,
  evaluateAbsoluteBudgets,
  performancePolicySchema,
  performanceProfilesSchema,
  performanceReportSchema,
  profileMismatches,
  sha256,
  type AcceptedPerformanceRecord,
  type PerformanceComparison,
  type PerformancePolicy,
  type PerformanceProfiles,
  type SatGlobePerformanceReport,
} from './performance-contract';

const ROOT = path.resolve('docs/performance');
const POLICY_PATH = path.join(ROOT, 'policy.json');
const PROFILES_PATH = path.join(ROOT, 'profiles.json');
const RECORDS_PATH = path.join(ROOT, 'records');
const HISTORY_PATH = path.join(ROOT, 'history.md');

interface Options {
  input?: string;
  profile?: string;
  label?: string;
  confirmation?: string;
  justification?: string;
}

async function parseJson<T>(filePath: string, parser: (value: unknown) => T): Promise<T> {
  const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;

  return parser(value);
}

function loadPolicy(): Promise<PerformancePolicy> {
  return parseJson(POLICY_PATH, (value) => performancePolicySchema.parse(value));
}

function loadProfiles(): Promise<PerformanceProfiles> {
  return parseJson(PROFILES_PATH, (value) => performanceProfilesSchema.parse(value));
}

async function recordFiles(directory = RECORDS_PATH): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return (await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return recordFiles(entryPath);
    }

    return entry.name.endsWith('.json') ? [entryPath] : [];
  }))).flat().sort();
}

async function loadRecords(): Promise<AcceptedPerformanceRecord[]> {
  return Promise.all((await recordFiles()).map((filePath) => parseJson(
    filePath,
    (value) => acceptedPerformanceRecordSchema.parse(value),
  )));
}

async function loadReport(filePath: string): Promise<{ report: SatGlobePerformanceReport; checksum: string }> {
  const source = await readFile(filePath, 'utf8');

  return { report: performanceReportSchema.parse(JSON.parse(source) as unknown), checksum: sha256(source) };
}

function profileFor(id: string, profiles: PerformanceProfiles) {
  const profile = profiles.profiles.find((entry) => entry.id === id);

  if (!profile) {
    throw new Error(`Unknown performance profile: ${id}`);
  }

  return profile;
}

function assertAcceptableReport(report: SatGlobePerformanceReport, profileId: string, profiles: PerformanceProfiles): void {
  const profile = profileFor(profileId, profiles);
  const mismatches = profileMismatches(report, profile);

  if (mismatches.length > 0) {
    throw new Error(`Report does not match ${profileId}:\n- ${mismatches.join('\n- ')}`);
  }
  if (report.run.dirty) {
    throw new Error('Accepted records require a clean tested commit.');
  }
  if (!(/^[a-f0-9]{40}$/iu).test(report.run.commit)) {
    throw new Error('Accepted records require the full tested Git commit SHA.');
  }
  if (report.configuration.headless || report.configuration.measurementMode !== 'hardware-renderer') {
    throw new Error('Accepted records require headed Chromium on a hardware renderer.');
  }
  if (!report.passed || report.runtimeErrors.length > 0) {
    throw new Error('Accepted records require a passing report with zero runtime errors.');
  }
}

function summarize(comparison: PerformanceComparison, budgets: ReturnType<typeof evaluateAbsoluteBudgets>): string {
  const lines = [
    `Compatible with baseline: ${comparison.compatible ? 'yes' : 'no'}`,
    `Improvements: ${comparison.improvements.length}`,
    `Warnings: ${comparison.warnings.length}`,
    `Relative regressions: ${comparison.failures.length}`,
    `Absolute failures: ${budgets.length}`,
  ];

  for (const entry of [
    ...comparison.incompatibilities,
    ...comparison.improvements.map(({ message }) => message),
    ...comparison.warnings.map(({ message }) => message),
    ...comparison.failures.map(({ message }) => message),
    ...budgets.map(({ message }) => message),
  ]) {
    lines.push(`- ${entry}`);
  }

  return `${lines.join('\n')}\n`;
}

export function renderPerformanceHistory(records: readonly AcceptedPerformanceRecord[]): string {
  const lines = [
    '# SatGlobe performance history',
    '',
    'Generated from immutable records. See [README.md](README.md) for the acceptance rules.',
    '',
    '| Recorded | Profile | Commit | Change | Verdict | Idle FPS | Idle frame p95 | Soak frame p95 |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: |',
  ];

  for (const record of [...records].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))) {
    const idle = record.report.metrics.steadyStateFrames.idle;
    const soak = record.report.metrics.soak;

    lines.push(`| ${record.recordedAt.slice(0, 10)} | ${record.profileId} | ${record.testedCommit.slice(0, 8)} | ${record.label.replaceAll('|', '\\|')} | ${record.verdict} | ${idle?.medianFps.toFixed(2) ?? 'n/a'} | ${idle?.p95FrameMs.toFixed(2) ?? 'n/a'} | ${soak?.frames.p95FrameMs.toFixed(2) ?? 'n/a'} |`);
  }
  if (records.length === 0) {
    lines.push('| _No accepted current-app records yet_ |  |  |  |  |  |  |  |');
  }

  return `${lines.join('\n')}\n`;
}

function baselineFor(profileId: string, profiles: PerformanceProfiles, records: AcceptedPerformanceRecord[]) {
  const baselineId = profileFor(profileId, profiles).baselineRecordId;

  return baselineId ? records.find(({ recordId }) => recordId === baselineId) : undefined;
}

async function compare(options: Options): Promise<void> {
  if (!options.input || !options.profile) {
    throw new Error('compare requires --input and --profile.');
  }
  const [{ report }, policy, profiles, records] = await Promise.all([
    loadReport(options.input),
    loadPolicy(),
    loadProfiles(),
    loadRecords(),
  ]);
  const profile = profileFor(options.profile, profiles);
  const mismatches = profileMismatches(report, profile);

  if (mismatches.length > 0) {
    throw new Error(`Report does not match ${profile.id}:\n- ${mismatches.join('\n- ')}`);
  }
  const baseline = baselineFor(profile.id, profiles, records);
  const comparison = baseline ? compareReports(report, baseline.report, policy) : emptyComparison();
  const budgets = evaluateAbsoluteBudgets(report, policy);

  process.stdout.write(baseline ? `Baseline: ${baseline.recordId}\n` : 'Baseline: none; this report starts a new current-app epoch.\n');
  process.stdout.write(summarize(comparison, budgets));
  if (budgets.length > 0 || comparison.failures.length > 0) {
    process.exitCode = 1;
  }
}

function confirmationMatches(candidate: SatGlobePerformanceReport, confirmation: SatGlobePerformanceReport): boolean {
  return candidate.run.commit === confirmation.run.commit &&
    comparisonKey(candidate) === comparisonKey(confirmation) &&
    candidate.catalog.snapshotId === confirmation.catalog.snapshotId;
}

function recordVerdict(
  hasBaseline: boolean,
  comparison: PerformanceComparison,
): AcceptedPerformanceRecord['verdict'] {
  if (!hasBaseline) {
    return 'baseline';
  }
  if (comparison.failures.length > 0) {
    return 'confirmed-regression';
  }
  if (comparison.warnings.length > 0) {
    return 'warning';
  }

  return 'pass';
}

async function record(options: Options): Promise<void> {
  if (!options.input || !options.profile || !options.label) {
    throw new Error('record requires --input, --profile, and --label.');
  }
  const [{ report, checksum }, policy, profiles, records] = await Promise.all([
    loadReport(options.input),
    loadPolicy(),
    loadProfiles(),
    loadRecords(),
  ]);

  assertAcceptableReport(report, options.profile, profiles);
  const absoluteFailures = evaluateAbsoluteBudgets(report, policy);

  if (absoluteFailures.length > 0) {
    throw new Error(`Report exceeds absolute budgets:\n- ${absoluteFailures.map(({ message }) => message).join('\n- ')}`);
  }
  const profile = profileFor(options.profile, profiles);
  const baseline = baselineFor(profile.id, profiles, records);
  const comparison = baseline ? compareReports(report, baseline.report, policy) : emptyComparison();

  if (!comparison.compatible) {
    throw new Error(`Report is not comparable with the current baseline:\n- ${comparison.incompatibilities.join('\n- ')}`);
  }
  if (comparison.failures.length > 0) {
    if (!options.confirmation || !options.justification) {
      throw new Error('A >20% regression requires --confirmation and --justification.');
    }
    const { report: confirmation } = await loadReport(options.confirmation);

    assertAcceptableReport(confirmation, options.profile, profiles);
    if (!confirmationMatches(report, confirmation)) {
      throw new Error('Confirmation must use the same clean commit, comparison key, and catalog snapshot.');
    }
    const confirmationComparison = baseline ? compareReports(confirmation, baseline.report, policy) : emptyComparison();

    if (confirmationComparison.failures.length === 0) {
      throw new Error('The independent confirmation did not reproduce the >20% regression.');
    }
  }

  const recordedAt = new Date().toISOString();
  const recordId = `${recordedAt.replaceAll(':', '-').replace((/\.\d{3}Z$/u), 'Z')}-${profile.id}`;
  const verdict = recordVerdict(baseline !== undefined, comparison);
  const accepted = acceptedPerformanceRecordSchema.parse({
    schemaVersion: 1,
    recordId,
    profileId: profile.id,
    label: options.label,
    recordedAt,
    testedCommit: report.run.commit,
    analyzerVersion: report.analyzerVersion,
    gateVersion: report.gateVersion,
    policyVersion: policy.policyVersion,
    comparisonKey: comparisonKey(report),
    sourceReportChecksum: checksum,
    baselineRecordId: profile.baselineRecordId,
    verdict,
    justification: options.justification ?? null,
    report,
    comparison,
  });
  const outputDirectory = path.join(RECORDS_PATH, recordedAt.slice(0, 4));
  const outputPath = path.join(outputDirectory, `${recordId}.json`);

  await mkdir(outputDirectory, { recursive: true });
  try {
    await stat(outputPath);
    throw new Error(`Immutable record already exists: ${outputPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await writeFile(outputPath, `${JSON.stringify(accepted, null, 2)}\n`, { flag: 'wx' });
  profile.baselineRecordId = recordId;
  await writeFile(PROFILES_PATH, `${JSON.stringify(profiles, null, 2)}\n`);
  await writeFile(HISTORY_PATH, renderPerformanceHistory([...records, accepted]));
  process.stdout.write(`Recorded ${recordId} and advanced ${profile.id}.\n`);
}

function immutableRecordErrors(baseRef: string): string[] {
  const names = execFileSync('/usr/bin/git', ['ls-tree', '-r', '--name-only', baseRef, '--', 'docs/performance/records'], {
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);
  const errors: string[] = [];

  for (const name of names) {
    let baseContent: string;
    let currentContent: string;

    try {
      baseContent = execFileSync('/usr/bin/git', ['show', `${baseRef}:${name}`], { encoding: 'utf8' });
      currentContent = execFileSync('/usr/bin/git', ['show', `HEAD:${name}`], { encoding: 'utf8' });
    } catch {
      errors.push(`${name} was deleted after acceptance`);
      continue;
    }
    if (baseContent !== currentContent) {
      errors.push(`${name} was changed after acceptance`);
    }
  }

  return errors;
}

async function validate(): Promise<void> {
  const [policy, profiles, records] = await Promise.all([loadPolicy(), loadProfiles(), loadRecords()]);
  const ids = new Set<string>();
  const errors: string[] = [];

  for (const record of records) {
    if (ids.has(record.recordId)) {
      errors.push(`duplicate record id ${record.recordId}`);
    }
    ids.add(record.recordId);
    if (record.policyVersion > policy.policyVersion) {
      errors.push(`${record.recordId} uses future policy version ${record.policyVersion}`);
    }
    if (record.testedCommit !== record.report.run.commit) {
      errors.push(`${record.recordId} testedCommit does not match its report`);
    }
  }
  for (const profile of profiles.profiles) {
    if (profile.baselineRecordId && !ids.has(profile.baselineRecordId)) {
      errors.push(`${profile.id} points to missing baseline ${profile.baselineRecordId}`);
    }
  }
  const expectedHistory = renderPerformanceHistory(records);

  if (await readFile(HISTORY_PATH, 'utf8') !== expectedHistory) {
    errors.push('history.md is stale; run npm run performance:history');
  }
  const baseRef = process.env.PERFORMANCE_BASE_REF;

  if (baseRef) {
    errors.push(...immutableRecordErrors(baseRef));
  }
  if (errors.length > 0) {
    throw new Error(`Performance ledger validation failed:\n- ${errors.join('\n- ')}`);
  }
  process.stdout.write(`Performance ledger valid: ${records.length} immutable record(s), ${profiles.profiles.length} profile(s).\n`);
}

async function history(): Promise<void> {
  const records = await loadRecords();

  await writeFile(HISTORY_PATH, renderPerformanceHistory(records));
  process.stdout.write(`Updated ${path.relative(process.cwd(), HISTORY_PATH)} from ${records.length} record(s).\n`);
}

const command = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    input: { type: 'string' },
    profile: { type: 'string' },
    label: { type: 'string' },
    confirmation: { type: 'string' },
    justification: { type: 'string' },
  },
  strict: true,
});

switch (command) {
  case 'compare':
    await compare(values);
    break;
  case 'record':
    await record(values);
    break;
  case 'validate':
    await validate();
    break;
  case 'history':
    await history();
    break;
  default:
    throw new Error('Use performance-ledger.ts compare|record|validate|history.');
}
