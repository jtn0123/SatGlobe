import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { SATGLOBE_CSP } from '../../../build/dev-server-response';
import { conjunctionFeedV1Schema } from '../domain/conjunctions';
import type { ConjunctionFeedV1, ConjunctionObjectRef } from '../domain/types';
import {
  COUNT_UPDATE_MEASURE,
  FILTER_APPLY_MEASURE,
  LAUNCH_TIMELAPSE_APPLY_MEASURE,
  LENS_APPLY_MEASURE,
  PLAYLIST_APPLY_MEASURE,
  RECOLOR_MEASURE,
  SATGLOBE_INTERACTION_MEASURES,
} from '../runtime/performance-measure';

interface InstalledCatalogRow {
  name?: string;
  tle1?: string;
}

interface BundledFixtureSubjects {
  known: readonly [ConjunctionObjectRef, ConjunctionObjectRef];
  unknownCatalogId: string;
}

interface WorkshopTestContext {
  externalRequests: string[];
  feed: ConjunctionFeedV1;
}

const workshopContextByPage = new WeakMap<Page, WorkshopTestContext>();
let bundledFixtureSubjectsPromise: Promise<BundledFixtureSubjects> | null = null;

interface CanvasBackingSize {
  height: number;
  width: number;
}

/** Reads the PNG header and asks Chromium to decode and sample the exported pixels. */
async function expectDecodedSnapshot(
  page: Page,
  download: Download,
  expectedContext: string,
  backingSize: CanvasBackingSize,
): Promise<void> {
  const filePath = await download.path();

  if (!filePath) {
    throw new Error('Playwright did not retain the downloaded PNG.');
  }
  const bytes = await readFile(filePath);

  expect(download.suggestedFilename()).toMatch(new RegExp(`^satglobe-${expectedContext}-\\d{8}T\\d{6}Z\\.png$`, 'u'));
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(8)).toBe(13);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(bytes.readUInt32BE(16)).toBe(backingSize.width);
  expect(bytes.readUInt32BE(20)).toBe(backingSize.height);

  const decoded = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const sample = document.createElement('canvas');

    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext('2d', { willReadFrequently: true });

    if (!context) {
      bitmap.close();
      throw new Error('Chromium could not create a 2D sampling context.');
    }
    context.drawImage(bitmap, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let luminanceTotal = 0;
    let luminanceSquaredTotal = 0;
    let opaquePixels = 0;

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const luminance = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;

      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;
      if (pixels[offset + 3] > 0) {
        opaquePixels++;
      }
    }
    const sampleCount = pixels.length / 4;
    const mean = luminanceTotal / sampleCount;
    const decodedSize = { height: bitmap.height, width: bitmap.width };

    bitmap.close();

    return {
      height: decodedSize.height,
      opaquePixels,
      variance: luminanceSquaredTotal / sampleCount - mean * mean,
      width: decodedSize.width,
    };
  }, bytes.toString('base64'));

  expect(decoded.width).toBe(backingSize.width);
  expect(decoded.height).toBe(backingSize.height);
  expect(decoded.opaquePixels).toBeGreaterThan(0);
  expect(decoded.variance).toBeGreaterThan(0.01);
}

/** Captures the current production frame and validates its backing-store dimensions. */
async function captureAndExpectSnapshot(page: Page, expectedContext: string): Promise<void> {
  const backingSize = await page.locator('#keeptrack-canvas').evaluate((canvas) => ({
    height: (canvas as HTMLCanvasElement).height,
    width: (canvas as HTMLCanvasElement).width,
  }));
  const pendingDownload = page.waitForEvent('download');

  await page.getByTestId('snapshot-export').click();
  await expectDecodedSnapshot(page, await pendingDownload, expectedContext, backingSize);
  await expect(page.getByTestId('app-notice')).toContainText('Downloaded canvas-only snapshot');
}

/** Shares one immutable catalog read across the production journeys. */
function loadBundledFixtureSubjects(): Promise<BundledFixtureSubjects> {
  if (!bundledFixtureSubjectsPromise) {
    bundledFixtureSubjectsPromise = readBundledFixtureSubjects();
  }

  return bundledFixtureSubjectsPromise;
}

/** Reads two real installed objects and proves a numeric control id is absent from the same snapshot. */
async function readBundledFixtureSubjects(): Promise<BundledFixtureSubjects> {
  const raw = await readFile(path.join(process.cwd(), 'public', 'tle', 'tle.json'), 'utf8');
  const decoded = JSON.parse(raw) as unknown;

  if (!Array.isArray(decoded)) {
    throw new Error('Installed SatGlobe catalog must be an array.');
  }
  const objects: ConjunctionObjectRef[] = [];
  const catalogIds = new Set<string>();

  for (const candidate of decoded as InstalledCatalogRow[]) {
    const fixedWidthId = candidate.tle1?.slice(2, 7).trim() ?? '';
    const catalogId = fixedWidthId.replace(/^0+(?=\d)/u, '');
    const name = candidate.name?.trim() ?? '';

    if (!(/^[1-9]\d{0,8}$/u).test(catalogId)) {
      continue;
    }
    catalogIds.add(catalogId);
    if (name && objects.length < 2 && !objects.some((object) => object.catalogId === catalogId)) {
      objects.push({ catalogId, name, dseDays: objects.length + 0.75 });
    }
  }
  if (objects.length !== 2) {
    throw new Error('Installed SatGlobe catalog must contain two named numeric objects.');
  }
  let unknownCatalogId = 999_999_999;

  while (catalogIds.has(String(unknownCatalogId)) && unknownCatalogId > 0) {
    unknownCatalogId--;
  }
  if (unknownCatalogId === 0) {
    throw new Error('Could not derive an unknown catalog id for the conjunction fixture.');
  }

  return {
    known: [objects[0], objects[1]],
    unknownCatalogId: String(unknownCatalogId),
  };
}

/** Builds a current same-origin feed with one resolvable and one deliberately dropped pair. */
function buildConjunctionFixture(subjects: BundledFixtureSubjects, now = new Date()): ConjunctionFeedV1 {
  const updatedAt = new Date(now.getTime() - 60_000).toISOString();
  const checksum = 'e'.repeat(64);
  const [object1, object2] = subjects.known;

  return {
    schemaVersion: 1,
    snapshotId: `socrates-${updatedAt.slice(0, 10)}-${checksum.slice(0, 12)}`,
    generatedAt: updatedAt,
    source: {
      provider: 'CelesTrak',
      rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
      updatedAt,
      retrievedAt: now.toISOString(),
      checksum,
    },
    conjunctions: [
      {
        id: '1'.repeat(24),
        object1,
        object2,
        timeOfClosestApproach: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        missDistanceKm: 0.321,
        relativeSpeedKmS: 12.345,
        maximumProbability: 0,
        dilutionThreshold: 0.008,
      },
      {
        id: '2'.repeat(24),
        object1,
        object2: { catalogId: subjects.unknownCatalogId, name: 'NOT IN BUNDLED CATALOG', dseDays: 1.5 },
        timeOfClosestApproach: new Date(now.getTime() + 25 * 60 * 60 * 1_000).toISOString(),
        missDistanceKm: 0.654,
        relativeSpeedKmS: 8.765,
        maximumProbability: 0,
        dilutionThreshold: 0,
      },
    ],
  };
}

test.describe('SatGlobe production-static script policy', () => {
  test.skip(!process.env.CI, 'Strict CSP acceptance requires the prebuilt production-static server.'); // NOSONAR: S1607 - local E2E serves a watch build, not audited static output.

  test('boots workers, lenses, and a story with the exact CSP and no violations', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const workerUrls: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('worker', (worker) => workerUrls.push(worker.url()));
    await page.addInitScript(() => {
      const state = window as Window & { __satGlobeCspViolations?: string[] };

      state.__satGlobeCspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        state.__satGlobeCspViolations?.push(`${event.effectiveDirective}: ${event.blockedURI}`);
      });
    });

    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'];

    expect(response?.ok()).toBe(true);
    expect(csp).toBe(SATGLOBE_CSP);
    expect(csp).not.toContain('\'unsafe-eval\'');
    expect((await page.request.get('/__reload-client.js')).status()).toBe(404);
    await expect(page.getByTestId('satglobe-app')).toBeVisible();
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });
    await page.waitForFunction(() => window.keepTrack?.isReady === true, undefined, { timeout: 45_000 });
    await expect.poll(() => workerUrls.length).toBeGreaterThan(0);
    const registeredThreads = await page.evaluate(() => window.keepTrack.threads
      .map(({ WEB_WORKER_CODE, isReady }) => ({ WEB_WORKER_CODE, isReady })));

    expect(registeredThreads.length).toBeGreaterThan(0);
    expect(registeredThreads.every(({ WEB_WORKER_CODE, isReady }) => WEB_WORKER_CODE.length > 0 && isReady)).toBe(true);

    await page.getByTestId('starlink-lens').click();
    await expect(page.getByTestId('encoding-select')).toHaveValue('orbital-plane');
    const conjunctionLens = page.getByTestId('conjunction-lens');

    await expect(conjunctionLens).toBeEnabled({ timeout: 45_000 });
    await conjunctionLens.click();
    await expect(conjunctionLens).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('story-mode').click();
    await expect(page.getByTestId('story-deck')).toBeVisible();
    await page.getByRole('button', { name: 'Next beat' }).click();
    await expect(page.getByTestId('story-deck')).toContainText('One launch, one catalog cohort');

    const cspViolations = await page.evaluate(() =>
      (window as Window & { __satGlobeCspViolations?: string[] }).__satGlobeCspViolations ?? [],
    );

    expect(workerUrls).not.toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('SatGlobe workshop', () => {
  test.beforeEach(async ({ page }) => {
    const externalRequests: string[] = [];
    const localeChunkRequests: string[] = [];
    const feed = buildConjunctionFixture(await loadBundledFixtureSubjects());

    workshopContextByPage.set(page, { externalRequests, feed });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());

      if (url.pathname === '/tle/satglobe/conjunctions.json') {
        await route.fulfill({
          body: JSON.stringify(feed),
          contentType: 'application/json',
          status: 200,
        });

        return;
      }
      if (url.pathname.includes('/js/locale-')) {
        localeChunkRequests.push(url.href);
      }
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(url.href);
        await route.abort();

        return;
      }
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByTestId('satglobe-app')).toBeVisible();
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });
    expect(externalRequests).toEqual([]);
    expect(localeChunkRequests).toEqual([]);
  });

  test('loads the local conjunction lens, drops unknown pairs, and explains public screening', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const context = workshopContextByPage.get(page);

    expect(context).toBeDefined();
    const lens = page.getByTestId('conjunction-lens');

    await expect(lens).toBeEnabled({ timeout: 45_000 });
    await expect(lens).toHaveAttribute('data-conjunction-status', 'current');
    await expect(lens).toHaveAttribute('data-dropped-pair-count', '1');
    await expect(page.getByTestId('conjunction-lens-status')).toContainText('1 upcoming pair');

    const parseDurations = await page.evaluate(() => performance
      .getEntriesByName('satglobe:conjunction-parse')
      .map(({ duration }) => duration));

    expect(parseDurations.length).toBeGreaterThan(0);
    expect(Math.max(...parseDurations)).toBeLessThan(50);

    await lens.click();
    await expect.poll(async () => Number(await lens.getAttribute('data-highlighted-count'))).toBeGreaterThan(0);
    await expect(lens).toHaveAttribute('aria-pressed', 'true');

    const firstConjunction = context!.feed.conjunctions[0];

    if (!firstConjunction) {
      throw new Error('Conjunction fixture must contain its known pair.');
    }
    const [selected, partner] = [firstConjunction.object1, firstConjunction.object2];
    const search = page.getByTestId('catalog-search');

    await search.fill(selected.name);
    await page.getByTestId('search-results').getByText(selected.name, { exact: true }).click();
    const detail = page.getByTestId('conjunction-detail');

    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute('data-temporal-label', 'next');
    await expect(detail).toContainText('Next close approach');
    await expect(detail).toContainText(partner.name);
    await expect(detail).toContainText(`Catalog ${partner.catalogId}`);
    await expect(detail).toContainText('0.321 km');
    await expect(detail).toContainText('12.345 km/s');
    await expect(detail).toContainText('Maximum modeled probability');
    await expect(detail).toContainText('0');
    await expect(detail).toContainText('0.008 km');
    await expect(detail).toContainText('SOCRATES screening · current');
    await expect(detail).toContainText('Source updated');
    await expect(detail).toContainText('Retrieved');
    await expect(detail).toContainText('Public screening is not live telemetry or an operator alert');
    await expect(detail).toContainText('Do not use it alone for operational decisions');
    expect(context!.externalRequests).toEqual([]);
  });

  test('packages a strict same-origin conjunction artifact in the production tree', async ({ request }) => {
    const response = await request.get('/tle/satglobe/conjunctions.json');

    expect(response.ok()).toBe(true);
    expect(conjunctionFeedV1Schema.parse(await response.json()).conjunctions.length).toBeGreaterThan(0);
  });

  test('exports decoded full-resolution PNG frames without retaining the drawing buffer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const contextSettings = await page.locator('#keeptrack-canvas').evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2');

      return {
        actual: gl?.getContextAttributes()?.preserveDrawingBuffer,
        configured: window.settingsManager.isPreserveDrawingBuffer,
      };
    });

    expect(contextSettings).toEqual({ actual: false, configured: false });

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.getByText('A living orbital environment')).toBeVisible();
    await captureAndExpectSnapshot(page, 'view');

    await page.getByTestId('story-mode').click();
    await expect(page.getByTestId('story-deck')).toContainText('Before the shell');
    await page.getByRole('button', { name: 'Next beat' }).click();
    await expect(page.getByTestId('story-deck')).toContainText('One launch, one catalog cohort');
    const storyId = await page.getByTestId('story-picker').inputValue();

    await captureAndExpectSnapshot(page, storyId);
  });

  test('filters, inspects, presents, tells a story, and exports a view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    await page.getByTestId('starlink-lens').click();
    await expect(page.getByTestId('encoding-select')).toHaveValue('orbital-plane');
    const visualMeasures = await page.evaluate((names) => {
      const result: Record<string, unknown[]> = {};

      for (const name of names) {
        const details: unknown[] = [];

        for (const entry of performance.getEntriesByName(name) as PerformanceMeasure[]) {
          details.push(entry.detail);
        }
        result[name] = details;
      }

      return result;
    }, [LENS_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

    expect(visualMeasures[LENS_APPLY_MEASURE]).toEqual([{ lens: 'starlink' }]);
    expect(visualMeasures[FILTER_APPLY_MEASURE]).toEqual([{ cause: 'combined' }]);
    expect(visualMeasures[RECOLOR_MEASURE]).toEqual([{ cause: 'combined' }]);
    expect(visualMeasures[COUNT_UPDATE_MEASURE]).toEqual([{ cause: 'combined' }]);

    const search = page.getByTestId('catalog-search');
    const readZoom = () => page.evaluate(() => window.satGlobe?.getState().camera.zoom ?? Number.NaN);
    const readAnimationFrameZoomDelta = () => page.evaluate(() => new Promise<number>((resolve) => {
      const first = window.satGlobe?.getState().camera.zoom ?? Number.NaN;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const second = window.satGlobe?.getState().camera.zoom ?? Number.NaN;

          resolve(Math.abs(second - first));
        });
      });
    }));

    await expect.poll(readAnimationFrameZoomDelta).toBeLessThan(0.00005);
    const cameraBeforeSelection = await page.evaluate(() => window.satGlobe?.getState().camera);

    await search.fill('STARLINK-1008');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('object-inspector')).toContainText('STARLINK');
    // Selection must not start a focus zoom. Let the preceding authored-camera
    // easing finish, then compare at a product-relevant tolerance instead of
    // racing sub-pixel floating-point drift on the current frame.
    await expect.poll(readAnimationFrameZoomDelta).toBeLessThan(0.00005);
    expect(await readZoom()).toBeCloseTo(cameraBeforeSelection?.zoom ?? 0, 3);
    expect(await page.evaluate(() => window.settingsManager.isFocusOnSatelliteWhenSelected)).toBe(false);
    expect(await page.evaluate(() => window.settingsManager.noMeshManager)).toBe(true);
    await expect(page.getByTestId('scale-disclosure')).toContainText('SEMANTIC SCALE');

    const download = page.waitForEvent('download');

    await page.getByTestId('export-view').click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/u);

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.getByText('A living orbital environment')).toBeVisible();
    await page.getByTestId('story-mode').click();
    await expect(page.getByTestId('story-deck')).toContainText('Before the shell');
    await page.getByRole('button', { name: 'Next beat' }).click();
    await expect(page.getByTestId('story-deck')).toContainText('One launch, one catalog cohort');
    await page.getByTestId('story-play').click();
    await expect(page.getByTestId('story-play')).toHaveAttribute('aria-label', 'Pause story');
    await page.getByRole('button', { name: 'Open workshop' }).click();
    await expect(page.getByTestId('discover-panel')).toBeVisible();
  });

  test('authors, reloads, and plays a two-view mission sequence with one recolor per step', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.getByRole('button', { name: '+ Save current' }).click();
    await expect(page.getByTestId('app-notice')).toContainText('Saved');
    await page.getByText('GEO belt', { exact: true }).click();
    await expect(page.getByTestId('encoding-select')).toHaveValue('orbit-regime');
    await page.getByRole('button', { name: '+ Save current' }).click();

    await page.getByTestId('open-playlist-editor').click();
    await page.getByTestId('playlist-name').fill('Two-stop orbit briefing');
    await page.getByTestId('add-playlist-view-0').click();
    await page.getByTestId('add-playlist-view-1').click();
    await page.getByTestId('playlist-caption-0').fill('Begin at the high ring.');
    await page.getByTestId('playlist-caption-1').fill('Return to the active catalog.');
    await page.getByTestId('playlist-duration-0').fill('1');
    await page.getByTestId('playlist-duration-1').fill('1');
    await page.getByTestId('save-playlist').click();
    await expect(page.getByTestId('app-notice')).toContainText('Saved playlist');

    await page.reload();
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });
    await page.getByTestId('playlist-record').filter({ hasText: 'Two-stop orbit briefing' }).locator(':scope > button').click();
    const deck = page.getByTestId('playlist-deck');

    await expect(deck).toHaveAttribute('data-playing', 'false');
    await expect(deck).toHaveAttribute('data-entry-index', '0');
    await expect(page.getByTestId('playlist-caption')).toHaveText('Begin at the high ring.');
    await expect(page.getByTestId('encoding-select')).toHaveValue('orbit-regime');
    await expect(page.getByTestId('story-deck')).toHaveCount(0);
    await expect(page.getByText('Sources · Facts')).toHaveCount(0);
    await expect(page.getByTestId('discover-panel')).toBeHidden();
    await expect(page.getByTestId('object-inspector')).toBeHidden();
    await expect(page.locator('.sg-time-dock')).toBeHidden();
    await expect(page.locator('.sg-presentation-title')).toHaveCount(0);

    // The presentation time dock must not intercept the transport at desktop scale.
    await page.getByTestId('playlist-next').click();
    await expect(deck).toHaveAttribute('data-entry-index', '1');
    await page.getByRole('button', { name: 'Previous playlist view' }).click();
    await expect(deck).toHaveAttribute('data-entry-index', '0');

    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    await page.getByTestId('playlist-play').click();
    await expect(deck).toHaveAttribute('data-entry-index', '1', { timeout: 5_000 });
    await expect(deck).toHaveAttribute('data-playing', 'false');
    await expect(page.getByTestId('playlist-caption')).toHaveText('Return to the active catalog.');
    await expect(page.getByTestId('encoding-select')).toHaveValue('object-type');
    const stepMeasures = await page.evaluate((names) => {
      const result: Record<string, unknown[]> = {};

      for (const name of names) {
        const details: unknown[] = [];

        for (const entry of performance.getEntriesByName(name) as PerformanceMeasure[]) {
          details.push(entry.detail);
        }
        result[name] = details;
      }

      return result;
    }, [PLAYLIST_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

    expect(stepMeasures[PLAYLIST_APPLY_MEASURE]).toEqual([expect.objectContaining({ entryIndex: 1 })]);
    expect(stepMeasures[FILTER_APPLY_MEASURE]).toEqual([{ cause: 'combined' }]);
    expect(stepMeasures[RECOLOR_MEASURE]).toEqual([{ cause: 'combined' }]);
    expect(stepMeasures[COUNT_UPDATE_MEASURE]).toEqual([{ cause: 'combined' }]);
  });

  test('scrubs cumulative launch history monotonically with one visual pass and no paused churn', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    const visibleCount = async () => Number((await page.getByTestId('visible-count').textContent())?.replace(/,/gu, '').match(/\d+/u)?.[0]);
    const timeline = page.getByTestId('launch-timelapse');

    await expect(timeline).toBeVisible();
    await page.getByRole('button', { name: 'Show launches through 1960' }).click();
    const count1960 = await visibleCount();

    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    await page.getByRole('button', { name: 'Show launches through 1970' }).click();
    const count1970 = await visibleCount();
    const stepMeasures = await page.evaluate((names) => {
      const result: Record<string, unknown[]> = {};

      for (const name of names) {
        result[name] = (performance.getEntriesByName(name) as PerformanceMeasure[]).map(({ detail }) => detail);
      }

      return result;
    }, [LAUNCH_TIMELAPSE_APPLY_MEASURE, FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE] as const);

    expect(count1970).toBeGreaterThan(count1960);
    expect(stepMeasures[LAUNCH_TIMELAPSE_APPLY_MEASURE]).toEqual([{ year: 1970 }]);
    expect(stepMeasures[FILTER_APPLY_MEASURE]).toEqual([{ cause: 'combined' }]);
    expect(stepMeasures[RECOLOR_MEASURE]).toEqual([{ cause: 'combined' }]);
    expect(stepMeasures[COUNT_UPDATE_MEASURE]).toEqual([{ cause: 'combined' }]);

    await page.getByRole('button', { name: 'Show launches through 2020' }).click();
    expect(await visibleCount()).toBeGreaterThan(count1970);
    await expect(page.getByTestId('encoding-select')).toHaveValue('launch-cohort');

    await page.evaluate((names) => {
      for (const name of names) {
        performance.clearMeasures(name);
      }
    }, SATGLOBE_INTERACTION_MEASURES);
    // Absence is the behavior under test: observe longer than the 500 ms autoplay tick,
    // because there is no positive condition for Playwright to await while paused.
    await page.waitForTimeout(750); // NOSONAR -- intentional no-churn observation window.
    expect(await page.evaluate((names) => names.every((name) => performance.getEntriesByName(name).length === 0), SATGLOBE_INTERACTION_MEASURES)).toBe(true);

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(timeline).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByRole('button', { name: 'Play launch history' })).toBeDisabled();
    await page.getByRole('button', { name: 'Show launches through 1970' }).click();
    await expect(timeline).toHaveAttribute('data-year', '1970');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Workshop', exact: true }).click();
    const expectTimelineClearOfDiscover = async (width: number) => {
      await page.setViewportSize({ width, height: 720 });
      const timelineBox = await timeline.boundingBox();
      const discoverBox = await page.getByTestId('discover-panel').boundingBox();

      expect(timelineBox).not.toBeNull();
      expect(discoverBox).not.toBeNull();
      expect(timelineBox!.x).toBeGreaterThanOrEqual(discoverBox!.x + discoverBox!.width + 12);
    };

    await expectTimelineClearOfDiscover(800);
    await expectTimelineClearOfDiscover(1_000);
    await page.getByTestId('catalog-search').click();
    await expect(page.getByTestId('catalog-search')).toBeFocused();
  });

  test('keeps presentation typography legible at 4K', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.getByText('A living orbital environment')).toBeVisible();
    await expect(page.getByTestId('scale-disclosure')).toBeVisible();
  });

  test('preserves the two-panel workshop at 1440p', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect(page.getByTestId('discover-panel')).toBeVisible();
    await expect(page.getByText('Select an object')).toBeVisible();
  });

  test('uses catalog status rather than renderer activity for operational filters', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const bundledCatalog = await (await page.request.get('/tle/tle.json')).json() as unknown[];
    const indexedCount = async () => Number((await page.getByTestId('catalog-status').textContent())?.replace(/,/gu, '').match(/\d+/u)?.[0]);

    await expect.poll(indexedCount).toBeGreaterThanOrEqual(Math.floor(bundledCatalog.length * 0.95));
    await expect.poll(indexedCount).toBeLessThanOrEqual(bundledCatalog.length + 20);
    await expect(page.getByTestId('status-active')).toHaveAttribute('aria-pressed', 'true');
    const activeCount = await page.getByTestId('visible-count').textContent();

    await page.getByTestId('status-inactive').click();
    await expect(page.getByTestId('status-inactive')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('visible-count')).not.toHaveText(activeCount ?? '');

    await page.getByTestId('catalog-search').fill('Vanguard 1');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('object-inspector')).toContainText('17 MAR 1958');
    await expect(page.getByTestId('object-inspector')).toContainText('Inactive / unknown');
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1280, 720]);
  });
});

test.describe('SatGlobe packaged conjunction integration', () => {
  test('loads, resolves, highlights, and inspects the real bundled screening artifact', async ({ page, request }) => {
    const externalRequests: string[] = [];
    const response = await request.get('/tle/satglobe/conjunctions.json');
    const feed = conjunctionFeedV1Schema.parse(await response.json());
    const encounter = feed.conjunctions[0];

    expect(response.ok()).toBe(true);
    if (!encounter) {
      throw new Error('The packaged conjunction artifact must contain at least one event.');
    }
    page.on('request', (browserRequest) => {
      const url = new URL(browserRequest.url());

      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(url.href);
      }
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const lens = page.getByTestId('conjunction-lens');

    await expect(lens).toBeEnabled({ timeout: 45_000 });
    await expect(lens).toHaveAttribute('data-conjunction-status', /^(?:current|stale|archival)$/u);
    await expect(lens).toHaveAttribute('data-dropped-pair-count', '0');
    await lens.click();
    await expect.poll(async () => Number(await lens.getAttribute('data-highlighted-count'))).toBeGreaterThan(0);

    await page.evaluate((catalogId) => window.satGlobe?.selectObject(catalogId), encounter.object1.catalogId);
    const detail = page.getByTestId('conjunction-detail');

    await expect(detail).toBeVisible();
    await expect(detail).toContainText(encounter.object2.name);
    await expect(detail).toContainText('SOCRATES screening');
    await expect(detail).toContainText('Source updated');
    await expect(detail).toContainText('not live telemetry or an operator alert');
    expect(externalRequests).toEqual([]);
  });
});

test.describe('SatGlobe failure states', () => {
  test('surfaces a catalog-load error instead of spinning forever', async ({ page }) => {
    // Outside the main suite's beforeEach on purpose: this journey breaks the
    // catalog request and must not inherit the healthy-boot assertions.
    await page.route('**/tle/tle.json', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('satglobe-app')).toBeVisible();
    // The adapter's hydrate timeout (20s after engine-ready) raises the error.
    await expect(page.getByTestId('engine-error')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('engine-error')).toContainText('failed to load');
    await expect(page.getByTestId('engine-error').getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});

test.describe('SatGlobe localization chunks', () => {
  test('loads the selected non-English locale from the same origin before boot', async ({ page }) => {
    const externalRequests: string[] = [];
    const localeChunkRequests: string[] = [];
    let releaseItalianChunk: () => void = () => undefined;
    const italianChunkGate = new Promise<void>((resolve) => {
      releaseItalianChunk = resolve;
    });

    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'it'));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());

      if (url.pathname.includes('/js/locale-')) {
        localeChunkRequests.push(url.href);
      }
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(url.href);
        await route.abort();

        return;
      }
      if ((/\/js\/locale-it\.[^/]+\.js$/u).test(url.pathname)) {
        await italianChunkGate;
      }
      await route.continue();
    });

    const catalogRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/tle/tle.json');
    const italianChunk = page.waitForResponse((response) => (/\/js\/locale-it\.[^/]+\.js$/u).test(new URL(response.url()).pathname));
    const navigation = page.goto('/');

    await catalogRequest;
    await expect(page.getByTestId('satglobe-app')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.keepTrack)).toBe('undefined');
    releaseItalianChunk();

    const [response] = await Promise.all([italianChunk, navigation]);

    await expect(page.getByTestId('satglobe-app')).toBeVisible();
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });

    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
    expect(localeChunkRequests).toHaveLength(1);
    expect(new URL(localeChunkRequests[0]).pathname).toMatch(/\/js\/locale-it\.[^/]+\.js$/u);
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe('it');
    expect(await page.evaluate(() => typeof window.keepTrack)).toBe('object');
    expect(externalRequests).toEqual([]);
  });

  test('falls back to bundled English and completes boot when a locale chunk fails', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'it'));
    await page.route(/\/js\/locale-it\.[^/]+\.js$/u, (route) => route.abort());

    await page.goto('/');
    await expect(page.getByTestId('satglobe-app')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe('en');
  });
});
