/**
 * Lightweight runtime benchmark for the built SatGlobe bundle.
 *
 * Measures cold startup, steady-state frame pacing, and quick-lens interaction
 * response against a running static server (`npm run start:satglobe:static`
 * after `npm run build:satglobe`). Techniques mirror the July 2026 Apple M4
 * baselines: trusted Playwright clicks, a longtask PerformanceObserver, a
 * MutationObserver on the visible-count readout, and rAF frame sampling in a
 * headed browser (rAF never fires in background tabs, so headless/background
 * numbers are not comparable).
 *
 * Usage: npx tsx scripts/satglobe/benchmark-runtime-lite.ts
 * Env: SATGLOBE_BENCHMARK_URL (default http://localhost:5544),
 *      SATGLOBE_BENCHMARK_SAMPLES (default 5),
 *      SATGLOBE_BENCHMARK_SOAK_MS (normal run omits the soak).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import {
  COUNT_UPDATE_MEASURE,
  FILTER_APPLY_MEASURE,
  LAUNCH_TIMELAPSE_APPLY_MEASURE,
  LENS_APPLY_MEASURE,
  PLAYLIST_APPLY_MEASURE,
  RECOLOR_MEASURE,
  SATGLOBE_INTERACTION_MEASURES,
} from '../../src/satglobe/runtime/performance-measure';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type PlaylistV1 } from '../../src/satglobe/domain/types';
import {
  PERFORMANCE_ANALYZER_VERSION,
  PERFORMANCE_GATE_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
  performancePolicySchema,
  performanceReportSchema,
} from './performance-contract';

const APP_URL = process.env.SATGLOBE_BENCHMARK_URL ?? 'http://localhost:5544';
const VIEWPORT = {
  width: Math.max(1, Number(process.env.SATGLOBE_BENCHMARK_WIDTH) || 2560),
  height: Math.max(1, Number(process.env.SATGLOBE_BENCHMARK_HEIGHT) || 1440),
};
const PROFILE_ID = process.env.SATGLOBE_BENCHMARK_PROFILE ?? 'apple-m4-1440p';
const SAMPLES = Math.max(1, Number(process.env.SATGLOBE_BENCHMARK_SAMPLES) || 5);
const SOAK_DURATION_MS = Math.max(0, Number(process.env.SATGLOBE_BENCHMARK_SOAK_MS) || 0);
const MIN_IDLE_MEDIAN_FPS = 59.8;
const MAX_CONJUNCTION_LENS_P95_MS = 100;
const MAX_PLAYLIST_STEP_P95_MS = 100;
const MAX_LAUNCH_TIMELAPSE_STEP_P95_MS = 100;
const BENCHMARK_PLAYLIST_ID = 'b41cf9a5-697d-40c8-ac1b-159a17123c5e';
const BENCHMARK_PLAYLIST: PlaylistV1 = {
  schemaVersion: 1,
  id: BENCHMARK_PLAYLIST_ID,
  name: 'Runtime benchmark sequence',
  entries: [
    {
      caption: 'Whole active catalog',
      durationMs: 6_000,
      view: {
        schemaVersion: 1,
        name: 'Whole active catalog',
        camera: DEFAULT_CAMERA,
        simulationTime: '2026-07-18T12:00:00.000Z',
        filters: structuredClone(DEFAULT_FILTERS),
        encoding: 'object-type',
        selectedObjectIds: [],
        scaleMode: 'semantic',
        presentation: { mode: 'presentation', panelsVisible: false },
      },
    },
    {
      caption: 'Starlink plane field',
      durationMs: 6_000,
      view: {
        schemaVersion: 1,
        name: 'Starlink plane field',
        camera: DEFAULT_CAMERA,
        simulationTime: '2026-07-18T12:00:00.000Z',
        filters: { ...structuredClone(DEFAULT_FILTERS), constellation: 'starlink' },
        encoding: 'orbital-plane',
        selectedObjectIds: [],
        scaleMode: 'semantic',
        presentation: { mode: 'presentation', panelsVisible: false },
      },
    },
  ],
};
const runtimeErrors: string[] = [];

interface Dist { samples: number[]; min: number; median: number; p95: number; max: number }

interface InteractionPhaseSample {
  lensApplyMs: number;
  filterApplyMs: number;
  recolorMs: number;
  countUpdateMs: number;
  filterApplyCount: number;
  recolorCount: number;
  countUpdateCount: number;
  recolorCauses: string[];
}

interface ApplyPhaseSample {
  applyMs: number;
  filterApplyCount: number;
  recolorCount: number;
  countUpdateCount: number;
  recolorCauses: string[];
}

/** Summarizes samples into the distribution shape the baseline reports use. */
function dist(samples: number[]): Dist {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];

  return { samples, min: s[0], median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}

/** Opens an isolated page so cold-start samples don't share caches or JIT state. */
async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });

  return page;
}

/** Waits until the engine adapter reports a hydrated catalog. */
async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.satGlobe?.getState()?.ready === true, undefined, { timeout: 30_000 });
}

/** Waits for the deferred screening artifact without folding it into catalog-ready timing. */
async function waitForConjunctions(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window.satGlobe?.getState()?.conjunctions;

    return state?.status !== undefined && state.status !== 'loading';
  }, undefined, { timeout: 10_000 });
}

/** Samples `count` rAF intervals on the page. */
function sampleFrames(page: Page, count: number): Promise<number[]> {
  return page.evaluate<number[]>(`new Promise((resolve) => {
    const intervals = []; let prev = performance.now();
    const tick = (now) => { intervals.push(now - prev); prev = now;
      intervals.length >= ${count} ? resolve(intervals) : requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })`);
}

/** Converts frame intervals into fps/frame-time summary numbers. */
function summarizeFrames(intervals: number[]) {
  const d = dist(intervals);

  return {
    medianFps: Math.round((1000 / d.median) * 100) / 100,
    p95FrameMs: Math.round(d.p95 * 100) / 100,
    slowestFrameMs: Math.round(d.max * 100) / 100,
  };
}

/** Cold startup: DCL, catalog-ready (adapter ready flag), visual-ready (ready + 15 settled frames). */
async function measureStartup(browser: Browser) {
  const catalogReady: number[] = [];
  const dcl: number[] = [];
  const visualReady: number[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- cold-start samples are sequential by design
    const page = await newPage(browser);

    /* eslint-disable no-await-in-loop -- sequential per-sample flow */
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

      return { dcl: nav.domContentLoadedEventEnd, ready: performance.now() };
    });

    await sampleFrames(page, 15);
    const visual = await page.evaluate(() => performance.now());

    dcl.push(t.dcl);
    catalogReady.push(t.ready);
    visualReady.push(visual);
    await page.context().close();
    /* eslint-enable no-await-in-loop */
  }

  return { domContentLoadedMs: dist(dcl), catalogReadyMs: dist(catalogReady), visualReadyMs: dist(visualReady) };
}

/** Trusted click; long tasks + DOM-response latency observed until the readout changes + 500 ms settle. */
async function measureInteraction(browser: Browser, trigger: string, response: string, prepare?: (page: Page) => Promise<void>) {
  const domResponses: number[] = [];
  const longMaxes: number[] = [];
  const longTotals: number[] = [];
  const phaseSamples: InteractionPhaseSample[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    /* eslint-disable no-await-in-loop -- sequential per-sample flow */
    const page = await newPage(browser);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await prepare?.(page);
    await sampleFrames(page, 15);
    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    await page.evaluate(`(() => {
      const response = document.querySelector(${JSON.stringify(response)});
      const trace = { clickAt: null, responseAt: null, beforeText: response.textContent, longTasks: [] };
      new MutationObserver(() => {
        if (trace.responseAt === null && response.textContent !== trace.beforeText) trace.responseAt = performance.now();
      }).observe(response, { childList: true, characterData: true, subtree: true });
      document.addEventListener('click', () => { if (trace.clickAt === null) trace.clickAt = performance.now(); }, true);
      new PerformanceObserver((list) => list.getEntries().forEach((e) => trace.longTasks.push(e.duration)))
        .observe({ type: 'longtask', buffered: false });
      window.__benchTrace = trace;
    })()`);
    await page.locator(trigger).click();
    await page.waitForFunction(() => (window as unknown as { __benchTrace?: { responseAt: number | null } }).__benchTrace?.responseAt !== null, undefined, { timeout: 10_000 });
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => (window as unknown as { __benchTrace: { clickAt: number; responseAt: number; longTasks: number[] } }).__benchTrace);
    const phaseSample = await page.evaluate((names) => {
      const [lensName, filterName, recolorName, countName] = names;
      const entries = performance.getEntriesByType('measure') as PerformanceMeasure[];
      let lens: PerformanceMeasure | null = null;
      let lensCount = 0;

      for (const entry of entries) {
        if (entry.name === lensName) {
          lens = entry;
          lensCount++;
        }
      }
      if (lensCount !== 1 || lens === null) {
        throw new Error(`Expected one ${lensName} entry, got ${lensCount}`);
      }
      const lensEnd = lens.startTime + lens.duration;
      let filterApplyMs = 0;
      let recolorMs = 0;
      let countUpdateMs = 0;
      let filterApplyCount = 0;
      let recolorCount = 0;
      let countUpdateCount = 0;
      const recolorCauses: string[] = [];

      for (const entry of entries) {
        const insideLens = entry.startTime >= lens.startTime && entry.startTime + entry.duration <= lensEnd;

        if (!insideLens) {
          continue;
        }
        if (entry.name === filterName) {
          filterApplyMs += entry.duration;
          filterApplyCount++;
        } else if (entry.name === recolorName) {
          recolorMs += entry.duration;
          recolorCount++;
          const cause = (entry.detail as { cause?: unknown } | null)?.cause;

          recolorCauses.push(typeof cause === 'string' ? cause : 'unknown');
        } else if (entry.name === countName) {
          countUpdateMs += entry.duration;
          countUpdateCount++;
        }
      }

      return {
        lensApplyMs: lens.duration,
        filterApplyMs,
        recolorMs,
        countUpdateMs,
        filterApplyCount,
        recolorCount,
        countUpdateCount,
        recolorCauses,
      };
    }, [LENS_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

    longTotals.push(t.longTasks.reduce((a, b) => a + b, 0));
    longMaxes.push(t.longTasks.length ? Math.max(...t.longTasks) : 0);
    domResponses.push(t.responseAt - t.clickAt);
    phaseSamples.push(phaseSample);
    await page.context().close();
    /* eslint-enable no-await-in-loop */
  }

  return {
    longTaskTotalMs: dist(longTotals),
    longTaskMaxMs: dist(longMaxes),
    domResponseMs: dist(domResponses),
    phaseMs: {
      lensApply: dist(phaseSamples.map(({ lensApplyMs }) => lensApplyMs)),
      filterApply: dist(phaseSamples.map(({ filterApplyMs }) => filterApplyMs)),
      recolor: dist(phaseSamples.map(({ recolorMs }) => recolorMs)),
      countUpdate: dist(phaseSamples.map(({ countUpdateMs }) => countUpdateMs)),
    },
    recolorPasses: dist(phaseSamples.map(({ recolorCount }) => recolorCount)),
    filterApplyPasses: dist(phaseSamples.map(({ filterApplyCount }) => filterApplyCount)),
    countUpdatePasses: dist(phaseSamples.map(({ countUpdateCount }) => countUpdateCount)),
    recolorCauses: phaseSamples.map(({ recolorCauses }) => recolorCauses),
  };
}

/** Seeds a portable sequence before boot so storage hydration is included in the real shell path. */
async function seedBenchmarkPlaylist(page: Page): Promise<void> {
  await page.addInitScript((playlist) => {
    localStorage.setItem('satglobe.playlists.v1', JSON.stringify([playlist]));
  }, BENCHMARK_PLAYLIST);
}

/** Reads one outer apply measure and the visual phases nested inside it. */
function readApplyPhase(page: Page, applyMeasureName: string): Promise<ApplyPhaseSample> {
  return page.evaluate((names) => {
    const [applyName, filterName, recolorName, countName] = names;
    const entries = performance.getEntriesByType('measure') as PerformanceMeasure[];
    const applies = entries.filter(({ name }) => name === applyName);

    if (applies.length !== 1) {
      throw new Error(`Expected one ${applyName} entry, got ${applies.length}`);
    }
    const apply = applies[0];
    const applyEnd = apply.startTime + apply.duration;
    let filterApplyCount = 0;
    let recolorCount = 0;
    let countUpdateCount = 0;
    const recolorCauses: string[] = [];

    for (const entry of entries) {
      const insideApply = entry.startTime >= apply.startTime && entry.startTime + entry.duration <= applyEnd;

      if (!insideApply) {
        continue;
      }
      if (entry.name === filterName) {
        filterApplyCount++;
      } else if (entry.name === recolorName) {
        recolorCount++;
        const cause = (entry.detail as { cause?: unknown } | null)?.cause;

        recolorCauses.push(typeof cause === 'string' ? cause : 'unknown');
      } else if (entry.name === countName) {
        countUpdateCount++;
      }
    }

    return { applyMs: apply.duration, filterApplyCount, recolorCount, countUpdateCount, recolorCauses };
  }, [applyMeasureName, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE]);
}

/** Proves paused playback is inert and a manual step owns exactly one visual pass. */
async function measurePlaylistPlayback(browser: Browser) {
  const pausedPage = await newPage(browser);

  await seedBenchmarkPlaylist(pausedPage);
  await pausedPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForReady(pausedPage);
  await pausedPage.getByTestId(`play-playlist-${BENCHMARK_PLAYLIST_ID}`).click();
  await pausedPage.waitForSelector('[data-testid="playlist-deck"][data-playing="false"]');
  await pausedPage.evaluate((names) => {
    for (const name of names) {
      performance.clearMeasures(name);
    }
  }, SATGLOBE_INTERACTION_MEASURES);
  const pausedFrames = summarizeFrames(await sampleFrames(pausedPage, 120));
  const pausedMeasureCounts = await pausedPage.evaluate((names) => {
    const counts: Record<string, number> = {};

    for (const name of names) {
      counts[name] = performance.getEntriesByName(name).length;
    }

    return counts;
  }, [PLAYLIST_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

  await pausedPage.context().close();
  const stepSamples: ApplyPhaseSample[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    /* eslint-disable no-await-in-loop -- interaction samples must not overlap */
    const page = await newPage(browser);

    await seedBenchmarkPlaylist(page);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await page.getByTestId(`play-playlist-${BENCHMARK_PLAYLIST_ID}`).click();
    await page.waitForSelector('[data-testid="playlist-deck"][data-entry-index="0"]');
    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    await page.getByTestId('playlist-next').click();
    await page.waitForSelector('[data-testid="playlist-deck"][data-entry-index="1"]');
    const phase = await readApplyPhase(page, PLAYLIST_APPLY_MEASURE);

    stepSamples.push(phase);
    await page.context().close();
    /* eslint-enable no-await-in-loop */
  }

  return {
    pausedFrames,
    pausedMeasureCounts,
    stepApplyMs: dist(stepSamples.map(({ applyMs }) => applyMs)),
    filterApplyPasses: dist(stepSamples.map(({ filterApplyCount }) => filterApplyCount)),
    recolorPasses: dist(stepSamples.map(({ recolorCount }) => recolorCount)),
    countUpdatePasses: dist(stepSamples.map(({ countUpdateCount }) => countUpdateCount)),
    recolorCauses: stepSamples.map(({ recolorCauses }) => recolorCauses),
  };
}

/** Proves the paused launch scrubber is inert and every decade step is one visual pass. */
async function measureLaunchTimelapse(browser: Browser) {
  const pausedPage = await newPage(browser);

  await pausedPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForReady(pausedPage);
  await pausedPage.getByRole('button', { name: 'Show launches through 1970' }).click();
  await pausedPage.evaluate((names) => {
    for (const name of names) {
      performance.clearMeasures(name);
    }
  }, SATGLOBE_INTERACTION_MEASURES);
  const pausedFrames = summarizeFrames(await sampleFrames(pausedPage, 120));
  const pausedMeasureCounts = await pausedPage.evaluate((names) => {
    const counts: Record<string, number> = {};

    for (const name of names) {
      counts[name] = performance.getEntriesByName(name).length;
    }

    return counts;
  }, [LAUNCH_TIMELAPSE_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

  await pausedPage.context().close();
  const stepSamples: ApplyPhaseSample[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    /* eslint-disable no-await-in-loop -- interaction samples must not overlap */
    const page = await newPage(browser);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    await page.getByRole('button', { name: 'Show launches through 1970' }).click();
    await page.waitForSelector('[data-testid="launch-timelapse"][data-year="1970"]');
    stepSamples.push(await readApplyPhase(page, LAUNCH_TIMELAPSE_APPLY_MEASURE));
    await page.context().close();
    /* eslint-enable no-await-in-loop */
  }

  return {
    pausedFrames,
    pausedMeasureCounts,
    stepApplyMs: dist(stepSamples.map(({ applyMs }) => applyMs)),
    filterApplyPasses: dist(stepSamples.map(({ filterApplyCount }) => filterApplyCount)),
    recolorPasses: dist(stepSamples.map(({ recolorCount }) => recolorCount)),
    countUpdatePasses: dist(stepSamples.map(({ countUpdateCount }) => countUpdateCount)),
    recolorCauses: stepSamples.map(({ recolorCauses }) => recolorCauses),
  };
}

interface BrowserEnvironment {
  renderer: string;
  userAgent: string;
  hardwareConcurrency: number;
  rendererObjectCount: number;
  renderScale: number;
}

interface CatalogManifest {
  snapshotId: string;
  checksum: string;
  objectCount: number;
}

/** Collects comparison-critical browser and renderer identity from the measured page. */
function readBrowserEnvironment(page: Page): Promise<BrowserEnvironment> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    let renderer = 'unknown renderer';

    if (gl) {
      const extension = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;

      renderer = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    }

    return {
      renderer,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      rendererObjectCount: window.satGlobe?.getState().objectCount ?? 0,
      renderScale: canvas?.clientWidth ? Math.round(canvas.width / canvas.clientWidth * 100) / 100 : 0,
    };
  });
}

/** Runs the optional sustained story-state watch in one headed hardware page. */
async function measureSoak(browser: Browser, requestedDurationMs: number) {
  const page = await newPage(browser);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  await page.getByTestId('story-mode').click();
  await page.waitForTimeout(1_000);
  const result = await page.evaluate(async (durationMs) => {
    const frameIntervals: number[] = [];
    const longTasks: number[] = [];
    const canvas = document.querySelector('canvas');
    let contextLossCount = 0;
    let contextRestoreCount = 0;
    const onLost = () => contextLossCount++;
    const onRestored = () => contextRestoreCount++;

    canvas?.addEventListener('webglcontextlost', onLost);
    canvas?.addEventListener('webglcontextrestored', onRestored);
    const observer = typeof PerformanceObserver === 'undefined'
      ? null
      : new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(entry.duration)));

    observer?.observe({ type: 'longtask', buffered: false });
    const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    const startHeap = memory.memory?.usedJSHeapSize ?? null;
    let peakHeap = startHeap;
    const heapTimer = window.setInterval(() => {
      const current = memory.memory?.usedJSHeapSize;

      if (current !== undefined) {
        peakHeap = Math.max(peakHeap ?? current, current);
      }
    }, 1_000);
    const startedAt = performance.now();
    let previous = startedAt;

    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        frameIntervals.push(now - previous);
        previous = now;
        if (now - startedAt >= durationMs) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };

      requestAnimationFrame(tick);
    });
    const measuredDurationMs = performance.now() - startedAt;
    const endHeap = memory.memory?.usedJSHeapSize ?? null;

    window.clearInterval(heapTimer);
    observer?.disconnect();
    canvas?.removeEventListener('webglcontextlost', onLost);
    canvas?.removeEventListener('webglcontextrestored', onRestored);

    return {
      frameIntervals,
      longTasks,
      measuredDurationMs,
      contextLossCount,
      contextRestoreCount,
      startHeap,
      endHeap,
      peakHeap,
    };
  }, requestedDurationMs);
  const frames = summarizeFrames(result.frameIntervals);
  const slowFrameCount = result.frameIntervals.filter((interval) => interval > 22).length;
  const summary = {
    requestedDurationMs,
    measuredDurationMs: result.measuredDurationMs,
    frameCount: result.frameIntervals.length,
    frames,
    slowFrameCount,
    slowFramePercent: slowFrameCount / result.frameIntervals.length * 100,
    longTaskCount: result.longTasks.length,
    longTaskTotalMs: result.longTasks.reduce((sum, value) => sum + value, 0),
    longTaskMaxMs: result.longTasks.length > 0 ? Math.max(...result.longTasks) : 0,
    contextLossCount: result.contextLossCount,
    contextRestoreCount: result.contextRestoreCount,
    heap: {
      available: result.startHeap !== null && result.endHeap !== null,
      startBytes: result.startHeap,
      endBytes: result.endHeap,
      peakBytes: result.peakHeap,
      growthBytes: result.startHeap === null || result.endHeap === null ? null : result.endHeap - result.startHeap,
    },
  };

  await page.context().close();

  return summary;
}

/** Reads Git identity without letting a raw report silently claim a clean tree. */
function gitRun(args: string[]): string {
  try {
    return execFileSync('/usr/bin/git', args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Writes the versioned raw report under the ignored benchmark artifact tree. */
async function writeRawReport(report: unknown, runId: string): Promise<string> {
  const directory = path.resolve('benchmark-results/satglobe');
  const outputPath = path.join(directory, `${runId}.raw.json`);

  await mkdir(directory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });

  return outputPath;
}

const browser = await chromium.launch({ headless: false });

try {
  const generatedAt = new Date().toISOString();
  const runId = generatedAt.replaceAll(':', '-').replace((/\.\d{3}Z$/u), 'Z');
  const manifest = JSON.parse(await readFile('public/tle/satglobe/manifest.json', 'utf8')) as CatalogManifest;
  const policy = performancePolicySchema.parse(
    JSON.parse(await readFile('docs/performance/policy.json', 'utf8')) as unknown,
  );
  const startup = await measureStartup(browser);

  // Frame scenarios share one warm page; each waits out the transition first.
  const page = await newPage(browser);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  await waitForConjunctions(page);
  await sampleFrames(page, 15);
  const idle = summarizeFrames(await sampleFrames(page, 120));

  await page.getByTestId('starlink-lens').click();
  await page.waitForTimeout(300);
  const filteredExploration = summarizeFrames(await sampleFrames(page, 120));

  await page.getByTestId('story-mode').click();
  await page.waitForTimeout(1000);
  const storySteadyState = summarizeFrames(await sampleFrames(page, 120));
  const browserEnvironment = await readBrowserEnvironment(page);

  await page.context().close();

  const freshStarlinkLens = await measureInteraction(browser, '[data-testid="starlink-lens"]', '[data-testid="visible-count"]');
  const freshConjunctionLens = await measureInteraction(
    browser,
    '[data-testid="conjunction-lens"]',
    '[data-testid="conjunction-lens-status"]',
    waitForConjunctions,
  );
  const playlistPlayback = await measurePlaylistPlayback(browser);
  const launchTimelapse = await measureLaunchTimelapse(browser);
  const soak = SOAK_DURATION_MS > 0 ? await measureSoak(browser, SOAK_DURATION_MS) : undefined;

  const metrics = {
    startup,
    steadyStateFrames: { idle, filteredExploration, storySteadyState },
    interactions: { freshStarlinkLens, freshConjunctionLens, playlistPlayback, launchTimelapse },
    ...(soak ? { soak } : {}),
  };

  const failures: string[] = [];

  if (idle.medianFps < MIN_IDLE_MEDIAN_FPS) {
    failures.push(`idle median ${idle.medianFps} fps is below ${MIN_IDLE_MEDIAN_FPS} fps`);
  }
  if (freshConjunctionLens.domResponseMs.p95 > MAX_CONJUNCTION_LENS_P95_MS) {
    failures.push(
      `conjunction lens p95 ${freshConjunctionLens.domResponseMs.p95.toFixed(1)} ms exceeds ${MAX_CONJUNCTION_LENS_P95_MS} ms`,
    );
  }
  for (const [label, interaction] of [
    ['Starlink lens', freshStarlinkLens],
    ['conjunction lens', freshConjunctionLens],
  ] as const) {
    if (interaction.longTaskMaxMs.p95 > policy.absoluteBudgets.longTaskMaxMs) {
      failures.push(
        `${label} longest-task p95 ${interaction.longTaskMaxMs.p95.toFixed(1)} ms exceeds ${policy.absoluteBudgets.longTaskMaxMs} ms`,
      );
    }
  }
  if (playlistPlayback.pausedFrames.medianFps < MIN_IDLE_MEDIAN_FPS) {
    failures.push(`paused playlist median ${playlistPlayback.pausedFrames.medianFps} fps is below ${MIN_IDLE_MEDIAN_FPS} fps`);
  }
  const pausedChurn = Object.entries(playlistPlayback.pausedMeasureCounts).filter(([, count]) => count !== 0);

  if (pausedChurn.length > 0) {
    failures.push(`paused playlist recorded interaction churn: ${JSON.stringify(Object.fromEntries(pausedChurn))}`);
  }
  if (playlistPlayback.stepApplyMs.p95 > MAX_PLAYLIST_STEP_P95_MS) {
    failures.push(`playlist step p95 ${playlistPlayback.stepApplyMs.p95.toFixed(1)} ms exceeds ${MAX_PLAYLIST_STEP_P95_MS} ms`);
  }
  if (playlistPlayback.recolorPasses.samples.some((count) => count !== 1)) {
    failures.push(`playlist steps expected one recolor per sample, got ${playlistPlayback.recolorPasses.samples.join(', ')}`);
  }
  if (playlistPlayback.filterApplyPasses.samples.some((count) => count !== 1)) {
    failures.push(`playlist steps expected one filter apply per sample, got ${playlistPlayback.filterApplyPasses.samples.join(', ')}`);
  }
  if (playlistPlayback.countUpdatePasses.samples.some((count) => count !== 1)) {
    failures.push(`playlist steps expected one count update per sample, got ${playlistPlayback.countUpdatePasses.samples.join(', ')}`);
  }
  if (playlistPlayback.recolorCauses.some((causes) => causes.length !== 1 || causes[0] !== 'combined')) {
    failures.push(`playlist steps recorded unexpected recolor causes: ${JSON.stringify(playlistPlayback.recolorCauses)}`);
  }
  if (launchTimelapse.pausedFrames.medianFps < MIN_IDLE_MEDIAN_FPS) {
    failures.push(`paused launch timelapse median ${launchTimelapse.pausedFrames.medianFps} fps is below ${MIN_IDLE_MEDIAN_FPS} fps`);
  }
  const launchPausedChurn = Object.entries(launchTimelapse.pausedMeasureCounts).filter(([, count]) => count !== 0);

  if (launchPausedChurn.length > 0) {
    failures.push(`paused launch timelapse recorded interaction churn: ${JSON.stringify(Object.fromEntries(launchPausedChurn))}`);
  }
  if (launchTimelapse.stepApplyMs.p95 > MAX_LAUNCH_TIMELAPSE_STEP_P95_MS) {
    failures.push(`launch timelapse step p95 ${launchTimelapse.stepApplyMs.p95.toFixed(1)} ms exceeds ${MAX_LAUNCH_TIMELAPSE_STEP_P95_MS} ms`);
  }
  if (launchTimelapse.recolorPasses.samples.some((count) => count !== 1)) {
    failures.push(`launch timelapse steps expected one recolor per sample, got ${launchTimelapse.recolorPasses.samples.join(', ')}`);
  }
  if (launchTimelapse.filterApplyPasses.samples.some((count) => count !== 1)) {
    failures.push(`launch timelapse steps expected one filter apply per sample, got ${launchTimelapse.filterApplyPasses.samples.join(', ')}`);
  }
  if (launchTimelapse.countUpdatePasses.samples.some((count) => count !== 1)) {
    failures.push(`launch timelapse steps expected one count update per sample, got ${launchTimelapse.countUpdatePasses.samples.join(', ')}`);
  }
  if (launchTimelapse.recolorCauses.some((causes) => causes.length !== 1 || causes[0] !== 'combined')) {
    failures.push(`launch timelapse steps recorded unexpected recolor causes: ${JSON.stringify(launchTimelapse.recolorCauses)}`);
  }
  if (freshStarlinkLens.recolorPasses.samples.some((count) => count !== 1)) {
    failures.push(`Starlink lens expected one recolor per sample, got ${freshStarlinkLens.recolorPasses.samples.join(', ')}`);
  }
  if (freshStarlinkLens.filterApplyPasses.samples.some((count) => count !== 1)) {
    failures.push(`Starlink lens expected one filter apply per sample, got ${freshStarlinkLens.filterApplyPasses.samples.join(', ')}`);
  }
  if (freshStarlinkLens.countUpdatePasses.samples.some((count) => count !== 1)) {
    failures.push(`Starlink lens expected one count update per sample, got ${freshStarlinkLens.countUpdatePasses.samples.join(', ')}`);
  }
  if (freshStarlinkLens.recolorCauses.some((causes) => causes.length !== 1 || causes[0] !== 'combined')) {
    failures.push(`Starlink lens recorded unexpected recolor causes: ${JSON.stringify(freshStarlinkLens.recolorCauses)}`);
  }
  if (SAMPLES < 5) {
    failures.push(`benchmark requires at least five fresh-page samples; received ${SAMPLES}`);
  }
  if (soak && soak.measuredDurationMs < SOAK_DURATION_MS) {
    failures.push(`soak measured ${soak.measuredDurationMs.toFixed(0)} ms; requested ${SOAK_DURATION_MS} ms`);
  }
  if (soak && soak.contextLossCount > 0) {
    failures.push(`soak observed ${soak.contextLossCount} WebGL context loss event(s)`);
  }
  if (soak && soak.frames.p95FrameMs > policy.absoluteBudgets.soakFrameP95Ms) {
    failures.push(`soak frame p95 ${soak.frames.p95FrameMs.toFixed(2)} ms exceeds ${policy.absoluteBudgets.soakFrameP95Ms} ms`);
  }
  if (soak && soak.slowFramePercent > policy.absoluteBudgets.soakSlowFramePercent) {
    failures.push(`soak slow-frame share ${soak.slowFramePercent.toFixed(2)}% exceeds ${policy.absoluteBudgets.soakSlowFramePercent}%`);
  }
  if (soak && soak.longTaskMaxMs > policy.absoluteBudgets.longTaskMaxMs) {
    failures.push(`soak longest task ${soak.longTaskMaxMs.toFixed(2)} ms exceeds ${policy.absoluteBudgets.longTaskMaxMs} ms`);
  }
  if (soak && (soak.heap.growthBytes ?? 0) > policy.absoluteBudgets.soakHeapGrowthBytes) {
    failures.push(`soak heap growth ${soak.heap.growthBytes} bytes exceeds ${policy.absoluteBudgets.soakHeapGrowthBytes} bytes`);
  }
  if (runtimeErrors.length > 0) {
    failures.push(`runtime emitted ${runtimeErrors.length} error(s)`);
  }
  const rendererLooksSoftware = (/swiftshader|llvmpipe|software/iu).test(browserEnvironment.renderer);
  const gates = {
    runtimeBudgets: failures.length === 0,
    minimumFreshSamples: SAMPLES >= 5,
    runtimeErrors: runtimeErrors.length === 0,
    ...(soak ? {
      soakDuration: soak.measuredDurationMs >= SOAK_DURATION_MS,
      soakContextStable: soak.contextLossCount === 0,
    } : {}),
  };
  const report = performanceReportSchema.parse({
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    analyzerVersion: PERFORMANCE_ANALYZER_VERSION,
    gateVersion: PERFORMANCE_GATE_VERSION,
    run: {
      id: runId,
      generatedAt,
      commit: process.env.SATGLOBE_BENCHMARK_COMMIT ?? gitRun(['rev-parse', 'HEAD']),
      branch: process.env.SATGLOBE_BENCHMARK_BRANCH ?? gitRun(['branch', '--show-current']),
      dirty: gitRun(['status', '--porcelain']).length > 0,
    },
    environment: {
      profileId: PROFILE_ID,
      platform: os.platform(),
      platformRelease: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? 'unknown CPU',
      totalMemoryBytes: os.totalmem(),
      hardwareConcurrency: browserEnvironment.hardwareConcurrency,
      renderer: browserEnvironment.renderer,
      browserVersion: browser.version(),
      userAgent: browserEnvironment.userAgent,
    },
    catalog: {
      snapshotId: manifest.snapshotId,
      checksum: manifest.checksum,
      manifestObjectCount: manifest.objectCount,
      rendererObjectCount: browserEnvironment.rendererObjectCount,
    },
    configuration: {
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      renderScale: browserEnvironment.renderScale,
      sampleCount: SAMPLES,
      headless: false,
      measurementMode: rendererLooksSoftware ? 'software-renderer' : 'hardware-renderer',
    },
    metrics,
    gates,
    passed: failures.length === 0,
    runtimeErrors,
  });
  const outputPath = await writeRawReport(report, runId);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Raw report: ${path.relative(process.cwd(), outputPath)}\n`);
  if (failures.length > 0) {
    throw new Error(`SatGlobe runtime budget failed: ${failures.join('; ')}`);
  }
} finally {
  await browser.close();
}
