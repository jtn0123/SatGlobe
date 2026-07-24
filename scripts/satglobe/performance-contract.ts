/* eslint-disable jsdoc/require-jsdoc -- These internal schemas and pure policy helpers are covered by focused tests. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PERFORMANCE_SCHEMA_VERSION = 1 as const;
export const PERFORMANCE_ANALYZER_VERSION = '2.0.0';
export const PERFORMANCE_GATE_VERSION = 2;

const distributionSchema = z.object({
  samples: z.array(z.number().finite()).min(1),
  min: z.number().finite(),
  median: z.number().finite(),
  p95: z.number().finite(),
  max: z.number().finite(),
});

const frameSummarySchema = z.object({
  medianFps: z.number().finite().nonnegative(),
  p95FrameMs: z.number().finite().nonnegative(),
  slowestFrameMs: z.number().finite().nonnegative(),
});

const soakSummarySchema = z.object({
  requestedDurationMs: z.number().int().positive(),
  measuredDurationMs: z.number().finite().positive(),
  frameCount: z.number().int().positive(),
  frames: frameSummarySchema,
  slowFrameCount: z.number().int().nonnegative(),
  slowFramePercent: z.number().finite().nonnegative(),
  longTaskCount: z.number().int().nonnegative(),
  longTaskTotalMs: z.number().finite().nonnegative(),
  longTaskMaxMs: z.number().finite().nonnegative(),
  contextLossCount: z.number().int().nonnegative(),
  contextRestoreCount: z.number().int().nonnegative(),
  heap: z.object({
    available: z.boolean(),
    startBytes: z.number().finite().nonnegative().nullable(),
    endBytes: z.number().finite().nonnegative().nullable(),
    peakBytes: z.number().finite().nonnegative().nullable(),
    growthBytes: z.number().finite().nullable(),
  }),
});

export const performanceReportSchema = z.object({
  schemaVersion: z.literal(PERFORMANCE_SCHEMA_VERSION),
  analyzerVersion: z.string().min(1),
  gateVersion: z.number().int().positive(),
  run: z.object({
    id: z.string().min(1),
    generatedAt: z.string().datetime(),
    commit: z.string().min(1),
    branch: z.string().min(1),
    dirty: z.boolean(),
  }),
  environment: z.object({
    profileId: z.string().min(1),
    platform: z.string().min(1),
    platformRelease: z.string().min(1),
    architecture: z.string().min(1),
    cpuModel: z.string().min(1),
    totalMemoryBytes: z.number().int().positive(),
    hardwareConcurrency: z.number().int().positive(),
    renderer: z.string().min(1),
    browserVersion: z.string().min(1),
    userAgent: z.string().min(1),
  }),
  catalog: z.object({
    snapshotId: z.string().min(1),
    checksum: z.string().min(1),
    manifestObjectCount: z.number().int().nonnegative(),
    rendererObjectCount: z.number().int().nonnegative(),
  }),
  configuration: z.object({
    viewportWidth: z.number().int().positive(),
    viewportHeight: z.number().int().positive(),
    renderScale: z.number().finite().positive(),
    sampleCount: z.number().int().positive(),
    headless: z.boolean(),
    measurementMode: z.enum(['hardware-renderer', 'software-renderer']),
  }),
  metrics: z.object({
    startup: z.record(z.string(), distributionSchema),
    steadyStateFrames: z.record(z.string(), frameSummarySchema),
    interactions: z.record(z.string(), z.unknown()),
    soak: soakSummarySchema.optional(),
  }),
  gates: z.record(z.string(), z.boolean()),
  passed: z.boolean(),
  runtimeErrors: z.array(z.string()),
});

export type SatGlobePerformanceReport = z.infer<typeof performanceReportSchema>;
export type PerformanceDistribution = z.infer<typeof distributionSchema>;

const profileSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  renderScale: z.number().finite().positive(),
  rendererPattern: z.string().min(1),
  minimumSamples: z.number().int().min(5),
  baselineRecordId: z.string().min(1).nullable(),
});

export const performanceProfilesSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(profileSchema).min(1),
});

export type PerformanceProfile = z.infer<typeof profileSchema>;
export type PerformanceProfiles = z.infer<typeof performanceProfilesSchema>;

export const performancePolicySchema = z.object({
  schemaVersion: z.literal(1),
  policyVersion: z.number().int().positive(),
  changeJustification: z.string().min(1),
  warningPercent: z.number().finite().positive(),
  failurePercent: z.number().finite().positive(),
  confirmationRuns: z.number().int().min(2),
  catalogObjectCountTolerancePercent: z.number().finite().nonnegative(),
  absoluteBudgets: z.object({
    idleMedianFps: z.number().finite().positive(),
    steadyFrameP95Ms: z.number().finite().positive(),
    interactionP95Ms: z.number().finite().positive(),
    longTaskMaxMs: z.number().finite().positive(),
    soakFrameP95Ms: z.number().finite().positive(),
    soakSlowFramePercent: z.number().finite().nonnegative(),
    soakHeapGrowthBytes: z.number().finite().positive(),
    maximumDistBytes: z.number().int().positive(),
    maximumJavaScriptBytes: z.number().int().positive(),
    maximumJavaScriptAssetBytes: z.number().int().positive(),
  }),
});

export type PerformancePolicy = z.infer<typeof performancePolicySchema>;

export interface PerformanceFinding {
  metric: string;
  message: string;
  deltaPercent: number | null;
}

export interface PerformanceComparison {
  compatible: boolean;
  incompatibilities: string[];
  improvements: PerformanceFinding[];
  warnings: PerformanceFinding[];
  failures: PerformanceFinding[];
}

const findingSchema = z.object({
  metric: z.string(),
  message: z.string(),
  deltaPercent: z.number().finite().nullable(),
});

const comparisonSchema: z.ZodType<PerformanceComparison> = z.object({
  compatible: z.boolean(),
  incompatibilities: z.array(z.string()),
  improvements: z.array(findingSchema),
  warnings: z.array(findingSchema),
  failures: z.array(findingSchema),
});

export const acceptedPerformanceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  recordId: z.string().min(1),
  profileId: z.string().min(1),
  label: z.string().min(1),
  recordedAt: z.string().datetime(),
  testedCommit: z.string().min(1),
  analyzerVersion: z.string().min(1),
  gateVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  comparisonKey: z.string().min(1),
  sourceReportChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  baselineRecordId: z.string().min(1).nullable(),
  verdict: z.enum(['baseline', 'pass', 'warning', 'confirmed-regression']),
  justification: z.string().min(1).nullable(),
  report: performanceReportSchema,
  comparison: comparisonSchema,
});

export type AcceptedPerformanceRecord = z.infer<typeof acceptedPerformanceRecordSchema>;

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function browserMajor(version: string): string {
  return version.match(/\d+/u)?.[0] ?? version;
}

function analyzerMajor(version: string): string {
  return version.split('.')[0] ?? version;
}

export function comparisonKey(report: SatGlobePerformanceReport): string {
  const input = [
    report.environment.profileId,
    `${report.configuration.viewportWidth}x${report.configuration.viewportHeight}`,
    report.configuration.renderScale,
    report.environment.renderer,
    browserMajor(report.environment.browserVersion),
    analyzerMajor(report.analyzerVersion),
    report.gateVersion,
  ].join('|');

  return sha256(input);
}

export function profileMismatches(report: SatGlobePerformanceReport, profile: PerformanceProfile): string[] {
  const mismatches: string[] = [];

  if (report.environment.profileId !== profile.id) {
    mismatches.push(`report profile is ${report.environment.profileId}, expected ${profile.id}`);
  }
  if (report.configuration.viewportWidth !== profile.viewportWidth || report.configuration.viewportHeight !== profile.viewportHeight) {
    mismatches.push(`viewport is ${report.configuration.viewportWidth}x${report.configuration.viewportHeight}, expected ${profile.viewportWidth}x${profile.viewportHeight}`);
  }
  if (Math.abs(report.configuration.renderScale - profile.renderScale) > 0.001) {
    mismatches.push(`render scale is ${report.configuration.renderScale}, expected ${profile.renderScale}`);
  }
  if (!new RegExp(profile.rendererPattern, 'iu').test(report.environment.renderer)) {
    mismatches.push(`renderer "${report.environment.renderer}" does not match /${profile.rendererPattern}/`);
  }
  if (report.configuration.sampleCount < profile.minimumSamples) {
    mismatches.push(`sample count is ${report.configuration.sampleCount}, expected at least ${profile.minimumSamples}`);
  }

  return mismatches;
}

function finding(metric: string, actual: number, expected: number, wording: string): PerformanceFinding {
  const deltaPercent = expected === 0 ? null : ((actual - expected) / expected) * 100;

  return {
    metric,
    message: `${metric} ${actual.toFixed(2)} ${wording} ${expected.toFixed(2)}`,
    deltaPercent,
  };
}

function numericPath(value: unknown, path: readonly string[]): number | null {
  let current = value;

  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

export function evaluateAbsoluteBudgets(
  report: SatGlobePerformanceReport,
  policy: PerformancePolicy,
): PerformanceFinding[] {
  const failures: PerformanceFinding[] = [];
  const idle = report.metrics.steadyStateFrames.idle;

  if (idle && idle.medianFps < policy.absoluteBudgets.idleMedianFps) {
    failures.push(finding('steadyStateFrames.idle.medianFps', idle.medianFps, policy.absoluteBudgets.idleMedianFps, 'is below'));
  }
  for (const [scenario, frames] of Object.entries(report.metrics.steadyStateFrames)) {
    if (frames.p95FrameMs > policy.absoluteBudgets.steadyFrameP95Ms) {
      failures.push(finding(`steadyStateFrames.${scenario}.p95FrameMs`, frames.p95FrameMs, policy.absoluteBudgets.steadyFrameP95Ms, 'exceeds'));
    }
  }

  const interactionPaths = [
    ['freshStarlinkLens', 'domResponseMs', 'p95'],
    ['freshConjunctionLens', 'domResponseMs', 'p95'],
    ['playlistPlayback', 'stepApplyMs', 'p95'],
    ['launchTimelapse', 'stepApplyMs', 'p95'],
  ] as const;

  for (const path of interactionPaths) {
    const actual = numericPath(report.metrics.interactions, path);

    if (actual !== null && actual > policy.absoluteBudgets.interactionP95Ms) {
      failures.push(finding(`interactions.${path.join('.')}`, actual, policy.absoluteBudgets.interactionP95Ms, 'exceeds'));
    }
  }

  const longTaskPaths = [
    ['freshStarlinkLens', 'longTaskMaxMs', 'p95'],
    ['freshConjunctionLens', 'longTaskMaxMs', 'p95'],
  ] as const;

  for (const path of longTaskPaths) {
    const actual = numericPath(report.metrics.interactions, path);

    if (actual !== null && actual > policy.absoluteBudgets.longTaskMaxMs) {
      failures.push(finding(`interactions.${path.join('.')}`, actual, policy.absoluteBudgets.longTaskMaxMs, 'exceeds'));
    }
  }

  if (report.metrics.soak) {
    const { soak } = report.metrics;

    if (soak.frames.p95FrameMs > policy.absoluteBudgets.soakFrameP95Ms) {
      failures.push(finding('soak.frames.p95FrameMs', soak.frames.p95FrameMs, policy.absoluteBudgets.soakFrameP95Ms, 'exceeds'));
    }
    if (soak.slowFramePercent > policy.absoluteBudgets.soakSlowFramePercent) {
      failures.push(finding('soak.slowFramePercent', soak.slowFramePercent, policy.absoluteBudgets.soakSlowFramePercent, 'exceeds'));
    }
    if (soak.longTaskMaxMs > policy.absoluteBudgets.longTaskMaxMs) {
      failures.push(finding('soak.longTaskMaxMs', soak.longTaskMaxMs, policy.absoluteBudgets.longTaskMaxMs, 'exceeds'));
    }
    if ((soak.heap.growthBytes ?? 0) > policy.absoluteBudgets.soakHeapGrowthBytes) {
      failures.push(finding('soak.heap.growthBytes', soak.heap.growthBytes ?? 0, policy.absoluteBudgets.soakHeapGrowthBytes, 'exceeds'));
    }
    if (soak.contextLossCount > 0) {
      failures.push(finding('soak.contextLossCount', soak.contextLossCount, 0, 'exceeds'));
    }
  }
  if (report.runtimeErrors.length > 0) {
    failures.push({
      metric: 'runtimeErrors',
      message: `runtimeErrors contains ${report.runtimeErrors.length} error(s)`,
      deltaPercent: null,
    });
  }
  for (const [gate, passed] of Object.entries(report.gates)) {
    if (!passed) {
      failures.push({ metric: `gates.${gate}`, message: `${gate} failed`, deltaPercent: null });
    }
  }

  return failures;
}

interface ComparableMetric {
  path: string;
  candidate: number | null;
  baseline: number | null;
  lowerIsBetter: boolean;
}

function comparableMetrics(candidate: SatGlobePerformanceReport, baseline: SatGlobePerformanceReport): ComparableMetric[] {
  const metrics: ComparableMetric[] = [];

  for (const key of ['domContentLoadedMs', 'catalogReadyMs', 'visualReadyMs']) {
    metrics.push({
      path: `startup.${key}.p95`,
      candidate: candidate.metrics.startup[key]?.p95 ?? null,
      baseline: baseline.metrics.startup[key]?.p95 ?? null,
      lowerIsBetter: true,
    });
  }
  for (const scenario of Object.keys(candidate.metrics.steadyStateFrames)) {
    metrics.push({
      path: `steadyStateFrames.${scenario}.p95FrameMs`,
      candidate: candidate.metrics.steadyStateFrames[scenario]?.p95FrameMs ?? null,
      baseline: baseline.metrics.steadyStateFrames[scenario]?.p95FrameMs ?? null,
      lowerIsBetter: true,
    });
    metrics.push({
      path: `steadyStateFrames.${scenario}.medianFps`,
      candidate: candidate.metrics.steadyStateFrames[scenario]?.medianFps ?? null,
      baseline: baseline.metrics.steadyStateFrames[scenario]?.medianFps ?? null,
      lowerIsBetter: false,
    });
  }
  for (const path of [
    ['freshStarlinkLens', 'domResponseMs', 'p95'],
    ['freshConjunctionLens', 'domResponseMs', 'p95'],
    ['playlistPlayback', 'stepApplyMs', 'p95'],
    ['launchTimelapse', 'stepApplyMs', 'p95'],
  ] as const) {
    metrics.push({
      path: `interactions.${path.join('.')}`,
      candidate: numericPath(candidate.metrics.interactions, path),
      baseline: numericPath(baseline.metrics.interactions, path),
      lowerIsBetter: true,
    });
  }

  return metrics;
}

export function compareReports(
  candidate: SatGlobePerformanceReport,
  baseline: SatGlobePerformanceReport,
  policy: PerformancePolicy,
): PerformanceComparison {
  const incompatibilities: string[] = [];
  const catalogDelta = baseline.catalog.rendererObjectCount === 0
    ? 0
    : Math.abs(candidate.catalog.rendererObjectCount - baseline.catalog.rendererObjectCount) / baseline.catalog.rendererObjectCount * 100;

  if (comparisonKey(candidate) !== comparisonKey(baseline)) {
    incompatibilities.push('hardware, viewport, browser major, analyzer major, or gate version differs');
  }
  if (catalogDelta > policy.catalogObjectCountTolerancePercent) {
    incompatibilities.push(`catalog population differs by ${catalogDelta.toFixed(2)}%`);
  }
  const result: PerformanceComparison = {
    compatible: incompatibilities.length === 0,
    incompatibilities,
    improvements: [],
    warnings: [],
    failures: [],
  };

  if (!result.compatible) {
    return result;
  }

  for (const metric of comparableMetrics(candidate, baseline)) {
    if (metric.candidate === null || metric.baseline === null || metric.baseline === 0) {
      continue;
    }
    const signedDelta = (metric.candidate - metric.baseline) / metric.baseline * 100;
    const regressionPercent = metric.lowerIsBetter ? signedDelta : -signedDelta;
    const entry: PerformanceFinding = {
      metric: metric.path,
      message: `${metric.path} changed ${signedDelta >= 0 ? '+' : ''}${signedDelta.toFixed(2)}%`,
      deltaPercent: regressionPercent,
    };

    if (regressionPercent > policy.failurePercent) {
      result.failures.push(entry);
    } else if (regressionPercent > policy.warningPercent) {
      result.warnings.push(entry);
    } else if (regressionPercent < -policy.warningPercent) {
      result.improvements.push(entry);
    }
  }

  return result;
}

export function emptyComparison(): PerformanceComparison {
  return { compatible: true, incompatibilities: [], improvements: [], warnings: [], failures: [] };
}
