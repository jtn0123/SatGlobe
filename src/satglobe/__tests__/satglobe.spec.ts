import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { conjunctionFeedV1Schema } from '../domain/conjunctions';
import type { ConjunctionFeedV1, ConjunctionObjectRef } from '../domain/types';
import {
  COUNT_UPDATE_MEASURE,
  FILTER_APPLY_MEASURE,
  LENS_APPLY_MEASURE,
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
    const readCamera = () => page.evaluate(() => {
      const camera = window.keepTrack.api.getMainCamera();

      return {
        cameraType: camera.cameraType,
        camZoomSnappedOnSat: camera.state.camZoomSnappedOnSat,
        zoomLevel: camera.state.zoomLevel,
        zoomTarget: camera.state.zoomTarget,
      };
    });

    await expect.poll(async () => {
      const camera = await readCamera();

      return Math.abs(camera.zoomLevel - camera.zoomTarget);
    }).toBeLessThan(0.00005);
    // Rendered zoom continues converging by sub-pixel fractions even after the
    // view looks settled. The actual no-auto-focus contract is that selection
    // leaves the camera mode and authored zoom target unchanged.
    const { cameraType, camZoomSnappedOnSat, zoomTarget } = await readCamera();
    const cameraBeforeSelection = { cameraType, camZoomSnappedOnSat, zoomTarget };

    await search.fill('STARLINK-1008');
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('object-inspector')).toContainText('STARLINK');
    const cameraAfterSelection = await readCamera();

    expect({
      cameraType: cameraAfterSelection.cameraType,
      camZoomSnappedOnSat: cameraAfterSelection.camZoomSnappedOnSat,
      zoomTarget: cameraAfterSelection.zoomTarget,
    }).toEqual(cameraBeforeSelection);
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
  test('resolves and loads the selected regional locale from the same origin before boot', async ({ page }) => {
    const externalRequests: string[] = [];
    const localeChunkRequests: string[] = [];
    let releaseItalianChunk: () => void = () => undefined;
    const italianChunkGate = new Promise<void>((resolve) => {
      releaseItalianChunk = resolve;
    });

    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'it-IT'));
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
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe('it-IT');
    expect(await page.evaluate(() => typeof window.keepTrack)).toBe('object');
    expect(externalRequests).toEqual([]);
  });

  test('falls back to bundled English when the selected regional locale chunk fails', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'it-IT'));
    await page.route(/\/js\/locale-it\.[^/]+\.js$/u, (route) => route.abort());

    await page.goto('/');
    await expect(page.getByTestId('satglobe-app')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('catalog-status')).toContainText('OBJECTS · LOCAL CATALOG', { timeout: 45_000 });
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe('en');
  });
});
