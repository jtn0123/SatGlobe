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
 *      SATGLOBE_BENCHMARK_SAMPLES (default 5).
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import {
  COUNT_UPDATE_MEASURE,
  FILTER_APPLY_MEASURE,
  LENS_APPLY_MEASURE,
  PLAYLIST_APPLY_MEASURE,
  RECOLOR_MEASURE,
  SATGLOBE_INTERACTION_MEASURES,
} from '../../src/satglobe/runtime/performance-measure';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type PlaylistV1 } from '../../src/satglobe/domain/types';

const APP_URL = process.env.SATGLOBE_BENCHMARK_URL ?? 'http://localhost:5544';
const VIEWPORT = { width: 2560, height: 1440 };
const SAMPLES = Math.max(1, Number(process.env.SATGLOBE_BENCHMARK_SAMPLES) || 5);
const MIN_IDLE_MEDIAN_FPS = 59.8;
const MAX_CONJUNCTION_LENS_P95_MS = 100;
const MAX_PLAYLIST_STEP_P95_MS = 100;
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

/** Summarizes samples into the distribution shape the baseline reports use. */
function dist(samples: number[]): Dist {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];

  return { samples, min: s[0], median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}

/** Opens an isolated page so cold-start samples don't share caches or JIT state. */
async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });

  return context.newPage();
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
  const stepSamples: Array<{
    applyMs: number;
    filterApplyCount: number;
    recolorCount: number;
    countUpdateCount: number;
    recolorCauses: string[];
  }> = [];

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
    const phase = await page.evaluate((names) => {
      const [playlistName, filterName, recolorName, countName] = names;
      const entries = performance.getEntriesByType('measure') as PerformanceMeasure[];
      let apply: PerformanceMeasure | null = null;
      let applyCount = 0;

      for (const entry of entries) {
        if (entry.name === playlistName) {
          apply = entry;
          applyCount++;
        }
      }
      if (applyCount !== 1 || apply === null) {
        throw new Error(`Expected one ${playlistName} entry, got ${applyCount}`);
      }
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
    }, [PLAYLIST_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

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

const browser = await chromium.launch({ headless: false });

try {
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

  await page.context().close();

  const freshStarlinkLens = await measureInteraction(browser, '[data-testid="starlink-lens"]', '[data-testid="visible-count"]');
  const freshConjunctionLens = await measureInteraction(
    browser,
    '[data-testid="conjunction-lens"]',
    '[data-testid="conjunction-lens-status"]',
    waitForConjunctions,
  );
  const playlistPlayback = await measurePlaylistPlayback(browser);


  const report = {
    startup,
    steadyStateFrames: { idle, filteredExploration, storySteadyState },
    interactions: { freshStarlinkLens, freshConjunctionLens, playlistPlayback },
  };

  console.log(JSON.stringify(report, null, 1));
  const failures: string[] = [];

  if (idle.medianFps < MIN_IDLE_MEDIAN_FPS) {
    failures.push(`idle median ${idle.medianFps} fps is below ${MIN_IDLE_MEDIAN_FPS} fps`);
  }
  if (freshConjunctionLens.domResponseMs.p95 > MAX_CONJUNCTION_LENS_P95_MS) {
    failures.push(
      `conjunction lens p95 ${freshConjunctionLens.domResponseMs.p95.toFixed(1)} ms exceeds ${MAX_CONJUNCTION_LENS_P95_MS} ms`,
    );
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
  if (failures.length > 0) {
    throw new Error(`SatGlobe runtime budget failed: ${failures.join('; ')}`);
  }
} finally {
  await browser.close();
}
