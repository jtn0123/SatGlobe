/* eslint-disable jsdoc/require-jsdoc -- Focused fixtures are local to this policy test. */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareReports,
  comparisonKey,
  evaluateAbsoluteBudgets,
  performancePolicySchema,
  performanceReportSchema,
  profileMismatches,
  type SatGlobePerformanceReport,
} from './performance-contract';
import {
  openPerformanceReportFile,
  PERFORMANCE_REPORT_ROOT,
} from './performance-report-path';

const execFileAsync = promisify(execFile);

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

const temporaryDirectories: string[] = [];

async function reportPathFixture() {
  const parent = await mkdtemp(path.join(tmpdir(), 'satglobe-performance-path-'));
  const reportRoot = path.join(parent, 'benchmark-results', 'satglobe');
  const reportPath = path.join(reportRoot, 'sample.raw.json');

  temporaryDirectories.push(parent);
  await mkdir(reportRoot, { recursive: true });
  await writeFile(reportPath, '{}\n');

  return { parent, reportPath, reportRoot };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('performance report path policy', () => {
  it('accepts a regular raw report inside the declared benchmark directory', async () => {
    const { parent, reportPath, reportRoot } = await reportPathFixture();
    const opened = await openPerformanceReportFile(reportPath, reportRoot, parent);

    try {
      expect(opened.filePath).toBe(await realpath(reportPath));
      await expect(opened.handle.readFile('utf8')).resolves.toBe('{}\n');
    } finally {
      await opened.handle.close();
    }
  });

  it('rejects traversal and non-raw filenames before reading them', async () => {
    const { parent, reportRoot } = await reportPathFixture();
    const outside = path.join(parent, 'outside.raw.json');
    const wrongExtension = path.join(reportRoot, 'sample.json');

    await Promise.all([writeFile(outside, '{}\n'), writeFile(wrongExtension, '{}\n')]);

    await expect(openPerformanceReportFile(outside, reportRoot, parent)).rejects.toThrow(/inside/u);
    await expect(openPerformanceReportFile(wrongExtension, reportRoot, parent)).rejects.toThrow(/\.raw\.json/u);
  });

  it('rejects a report root redirected outside the trusted repository root', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'satglobe-performance-root-link-'));
    const trustedRoot = path.join(parent, 'workspace');
    const reportRoot = path.join(trustedRoot, 'benchmark-results', 'satglobe');
    const outsideRoot = path.join(parent, 'outside');
    const reportPath = path.join(reportRoot, 'escaped.raw.json');

    temporaryDirectories.push(parent);
    await Promise.all([
      mkdir(path.dirname(reportRoot), { recursive: true }),
      mkdir(outsideRoot, { recursive: true }),
    ]);
    await writeFile(path.join(outsideRoot, 'escaped.raw.json'), '{}\n');
    await symlink(outsideRoot, reportRoot, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(openPerformanceReportFile(reportPath, reportRoot, trustedRoot)).rejects.toThrow(/root.*symlink|junction/iu);
  });

  it('rejects a nested directory link that escapes the benchmark directory', async () => {
    const { parent, reportRoot } = await reportPathFixture();
    const outsideRoot = path.join(parent, 'outside');
    const escapedDirectory = path.join(reportRoot, 'escaped');
    const escapedReport = path.join(escapedDirectory, 'sample.raw.json');

    await mkdir(outsideRoot);
    await writeFile(path.join(outsideRoot, 'sample.raw.json'), '{}\n');
    await symlink(outsideRoot, escapedDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(openPerformanceReportFile(escapedReport, reportRoot, parent)).rejects.toThrow(/symlink|junction/u);
  });

  it.skipIf(process.platform === 'win32')('rejects a raw-name symlink to a differently named in-root file', async () => {
    const { parent, reportRoot } = await reportPathFixture();
    const payload = path.join(reportRoot, 'payload.json');
    const alias = path.join(reportRoot, 'alias.raw.json');

    await writeFile(payload, '{}\n');
    await symlink(payload, alias);

    await expect(openPerformanceReportFile(alias, reportRoot, parent)).rejects.toThrow(/symlink|junction/u);
  });

  it.skipIf(process.platform === 'win32')('keeps an opened report bound to its original file across a root-link race', async () => {
    const { parent, reportPath, reportRoot } = await reportPathFixture();
    const originalRoot = `${reportRoot}-original`;
    const outsideRoot = path.join(parent, 'outside');

    await writeFile(reportPath, '{"source":"inside"}\n');
    await mkdir(outsideRoot);
    await writeFile(path.join(outsideRoot, path.basename(reportPath)), '{"source":"outside"}\n');
    const opened = await openPerformanceReportFile(reportPath, reportRoot, parent);

    try {
      await rename(reportRoot, originalRoot);
      await symlink(outsideRoot, reportRoot, 'dir');
      await expect(opened.handle.readFile('utf8')).resolves.toBe('{"source":"inside"}\n');
    } finally {
      await opened.handle.close();
    }
  });

  it.skipIf(process.platform === 'win32')('rejects a raw-name FIFO without blocking the CLI', async () => {
    await mkdir(PERFORMANCE_REPORT_ROOT, { recursive: true });
    const insideDirectory = await mkdtemp(path.join(PERFORMANCE_REPORT_ROOT, 'path-policy-fifo-'));
    const fifoReport = path.join(insideDirectory, 'blocked.raw.json');

    temporaryDirectories.push(insideDirectory);
    await execFileAsync('/usr/bin/mkfifo', [fifoReport]);
    const [result] = await Promise.allSettled([
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'scripts/satglobe/performance-ledger.ts',
        'compare',
        '--input',
        fifoReport,
        '--profile',
        'apple-m4-1440p',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        killSignal: 'SIGKILL',
        timeout: 2_000,
      }),
    ]);

    expect(result).toMatchObject({
      status: 'rejected',
      reason: {
        killed: false,
        stderr: expect.stringContaining('Performance report must resolve to a regular file.'),
      },
    });
  });

  it('wires both CLI input and confirmation reports through the path policy', async () => {
    await mkdir(PERFORMANCE_REPORT_ROOT, { recursive: true });
    const insideDirectory = await mkdtemp(path.join(PERFORMANCE_REPORT_ROOT, 'path-policy-cli-'));
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'satglobe-performance-cli-outside-'));
    const insideReport = path.join(insideDirectory, 'inside.raw.json');
    const outsideReport = path.join(outsideDirectory, 'outside.raw.json');
    const candidate = report();

    temporaryDirectories.push(insideDirectory, outsideDirectory);
    candidate.run.commit = '0'.repeat(40);
    candidate.run.dirty = true;
    await Promise.all([
      writeFile(insideReport, `${JSON.stringify(candidate)}\n`),
      writeFile(outsideReport, `${JSON.stringify(candidate)}\n`),
    ]);

    const [inputResult, confirmationResult] = await Promise.allSettled([
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'scripts/satglobe/performance-ledger.ts',
        'compare',
        '--input',
        outsideReport,
        '--profile',
        'apple-m4-1440p',
      ], { cwd: process.cwd(), encoding: 'utf8' }),
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'scripts/satglobe/performance-ledger.ts',
        'record',
        '--input',
        insideReport,
        '--profile',
        'apple-m4-1440p',
        '--label',
        'path policy test',
        '--confirmation',
        outsideReport,
        '--justification',
        'path policy test',
      ], { cwd: process.cwd(), encoding: 'utf8' }),
    ]);

    expect(inputResult).toMatchObject({
      status: 'rejected',
      reason: {
        stderr: expect.stringContaining('Performance report must be a .raw.json file inside'),
      },
    });
    expect(confirmationResult).toMatchObject({
      status: 'rejected',
      reason: {
        stderr: expect.stringContaining('Performance report must be a .raw.json file inside'),
      },
    });
  });
});
