/* eslint-disable jsdoc/require-jsdoc -- Focused fixtures are local to this policy test. */
import { describe, expect, it } from 'vitest';
import {
  compareReports,
  comparisonKey,
  evaluateAbsoluteBudgets,
  performancePolicySchema,
  performanceReportSchema,
  profileMismatches,
  type SatGlobePerformanceReport,
} from './performance-contract';

const distribution = {
  samples: [10, 11, 12, 13, 14],
  min: 10,
  median: 12,
  p95: 14,
  max: 14,
};

const policy = performancePolicySchema.parse({
  schemaVersion: 1,
  policyVersion: 1,
  changeJustification: 'Test policy.',
  warningPercent: 10,
  failurePercent: 20,
  confirmationRuns: 2,
  catalogObjectCountTolerancePercent: 5,
  absoluteBudgets: {
    idleMedianFps: 55,
    steadyFrameP95Ms: 22,
    interactionP95Ms: 100,
    longTaskMaxMs: 50,
    soakFrameP95Ms: 22,
    soakSlowFramePercent: 5,
    soakHeapGrowthBytes: 67_108_864,
    maximumDistBytes: 402_653_184,
    maximumJavaScriptBytes: 16_777_216,
    maximumJavaScriptAssetBytes: 6_815_744,
  },
});

function report(): SatGlobePerformanceReport {
  return performanceReportSchema.parse({
    schemaVersion: 1,
    analyzerVersion: '2.0.0',
    gateVersion: 2,
    run: {
      id: 'run-1',
      generatedAt: '2026-07-23T12:00:00.000Z',
      commit: '0123456789abcdef',
      branch: 'main',
      dirty: false,
    },
    environment: {
      profileId: 'apple-m4-1440p',
      platform: 'darwin',
      platformRelease: '25.0.0',
      architecture: 'arm64',
      cpuModel: 'Apple M4',
      totalMemoryBytes: 17_179_869_184,
      hardwareConcurrency: 10,
      renderer: 'ANGLE Metal Renderer: Apple M4',
      browserVersion: 'Chromium 140.0.0.0',
      userAgent: 'test',
    },
    catalog: {
      snapshotId: 'satglobe-2026-07-23-abcdef',
      checksum: 'abcdef',
      manifestObjectCount: 30_000,
      rendererObjectCount: 30_000,
    },
    configuration: {
      viewportWidth: 2560,
      viewportHeight: 1440,
      renderScale: 1,
      sampleCount: 5,
      headless: false,
      measurementMode: 'hardware-renderer',
    },
    metrics: {
      startup: {
        domContentLoadedMs: distribution,
        catalogReadyMs: distribution,
        visualReadyMs: distribution,
      },
      steadyStateFrames: {
        idle: { medianFps: 60, p95FrameMs: 18, slowestFrameMs: 20 },
        storySteadyState: { medianFps: 60, p95FrameMs: 19, slowestFrameMs: 21 },
      },
      interactions: {
        freshStarlinkLens: { domResponseMs: distribution, longTaskMaxMs: distribution },
        freshConjunctionLens: { domResponseMs: distribution, longTaskMaxMs: distribution },
        playlistPlayback: { stepApplyMs: distribution },
        launchTimelapse: { stepApplyMs: distribution },
      },
    },
    gates: {
      runtimeBudgets: true,
    },
    passed: true,
    runtimeErrors: [],
  });
}

describe('performance report contract', () => {
  it('binds compatibility to hardware, browser major, analyzer major, and viewport', () => {
    const baseline = report();
    const candidate = structuredClone(baseline);

    expect(comparisonKey(candidate)).toBe(comparisonKey(baseline));
    candidate.environment.browserVersion = 'Chromium 141.0.0.0';

    expect(comparisonKey(candidate)).not.toBe(comparisonKey(baseline));
    expect(compareReports(candidate, baseline, policy)).toMatchObject({
      compatible: false,
      incompatibilities: [expect.stringContaining('browser major')],
    });
  });

  it('rejects a report that does not match its declared acceptance profile', () => {
    const candidate = report();

    candidate.configuration.sampleCount = 4;
    candidate.configuration.viewportWidth = 1920;

    expect(profileMismatches(candidate, {
      id: 'apple-m4-1440p',
      title: 'Apple M4 1440p',
      viewportWidth: 2560,
      viewportHeight: 1440,
      renderScale: 1,
      rendererPattern: 'Apple M4',
      minimumSamples: 5,
      baselineRecordId: null,
    })).toEqual([
      expect.stringContaining('viewport'),
      expect.stringContaining('sample count'),
    ]);
  });

  it('classifies like-for-like warnings and confirmed-regression candidates', () => {
    const baseline = report();
    const warning = structuredClone(baseline);
    const failure = structuredClone(baseline);

    warning.metrics.interactions.freshStarlinkLens = {
      domResponseMs: { ...distribution, p95: 15.5 },
      longTaskMaxMs: distribution,
    };
    failure.metrics.interactions.freshStarlinkLens = {
      domResponseMs: { ...distribution, p95: 18 },
      longTaskMaxMs: distribution,
    };

    expect(compareReports(warning, baseline, policy).warnings).toEqual(
      [expect.objectContaining({ metric: 'interactions.freshStarlinkLens.domResponseMs.p95' })],
    );
    expect(compareReports(failure, baseline, policy).failures).toEqual(
      [expect.objectContaining({ metric: 'interactions.freshStarlinkLens.domResponseMs.p95' })],
    );
  });

  it('fails absolute runtime, soak, context-loss, and deterministic report gates', () => {
    const candidate = report();

    candidate.metrics.steadyStateFrames.idle = { medianFps: 50, p95FrameMs: 30, slowestFrameMs: 40 };
    candidate.metrics.interactions.freshStarlinkLens!.longTaskMaxMs = {
      ...distribution,
      p95: 75,
      max: 75,
    };
    candidate.metrics.soak = {
      requestedDurationMs: 120_000,
      measuredDurationMs: 120_010,
      frameCount: 6_000,
      frames: { medianFps: 50, p95FrameMs: 30, slowestFrameMs: 80 },
      slowFrameCount: 600,
      slowFramePercent: 10,
      longTaskCount: 1,
      longTaskTotalMs: 75,
      longTaskMaxMs: 75,
      contextLossCount: 1,
      contextRestoreCount: 1,
      heap: {
        available: true,
        startBytes: 10,
        endBytes: 80_000_010,
        peakBytes: 80_000_010,
        growthBytes: 80_000_000,
      },
    };
    candidate.runtimeErrors.push('pageerror: test');
    candidate.gates.runtimeBudgets = false;

    expect(evaluateAbsoluteBudgets(candidate, policy).map(({ metric }) => metric)).toEqual(expect.arrayContaining([
      'steadyStateFrames.idle.medianFps',
      'steadyStateFrames.idle.p95FrameMs',
      'interactions.freshStarlinkLens.longTaskMaxMs.p95',
      'soak.frames.p95FrameMs',
      'soak.slowFramePercent',
      'soak.longTaskMaxMs',
      'soak.heap.growthBytes',
      'soak.contextLossCount',
      'runtimeErrors',
      'gates.runtimeBudgets',
    ]));
  });
});
