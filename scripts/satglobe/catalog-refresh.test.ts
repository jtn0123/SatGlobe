import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, link, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormatTle } from '../../src/engine/ootk/src/coordinate/FormatTle';
import {
  catalogIdFromTle,
  acquireInstallLock,
  epochFromCatalog,
  loadSource,
  newestElementEpochFromCatalog,
  ommToCatalogRow,
  parseArgs,
  parseOmmEpochUtc,
  refreshCatalog,
  releaseInstallLock,
  stageAndInstallArtifacts,
  summarizeRejections,
  validateBaseCatalog,
  validateCatalogConjunctionCoherence,
  validateCatalogManifest,
  type OmmRow,
} from './catalog-refresh';
import type { SocratesFeedV1 } from './socrates-refresh';

/* eslint-disable jsdoc/require-jsdoc -- Test fixture builders are intentionally local. */

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const CATALOG_REFRESH_TEST_TIME = new Date('2026-07-18T12:00:00.000Z');

async function createTestInstallLock(lockFile: string, pid: number, token: string): Promise<void> {
  const ownerFile = `${lockFile}.${token}.owner`;

  await writeFile(ownerFile, `${JSON.stringify({ token, pid, startedAt: '2026-07-18T00:00:00.000Z' })}\n`, 'utf8');
  await link(ownerFile, lockFile);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(CATALOG_REFRESH_TEST_TIME);
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

const omm: OmmRow = {
  OBJECT_NAME: 'SATGLOBE TEST',
  OBJECT_ID: '2026-001A',
  EPOCH: '2026-07-15T12:30:15.250000',
  MEAN_MOTION: '15.5',
  ECCENTRICITY: '0.0002',
  INCLINATION: '53.1',
  RA_OF_ASC_NODE: '120.25',
  ARG_OF_PERICENTER: '45.5',
  MEAN_ANOMALY: '280.75',
  EPHEMERIS_TYPE: '0',
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: '25544',
  ELEMENT_SET_NO: '42',
  REV_AT_EPOCH: '1234',
  BSTAR: '0.0000125',
  MEAN_MOTION_DOT: '0.000001',
  MEAN_MOTION_DDOT: '0',
};

const SOCRATES_HEADER = 'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION';

function ommCsv(rows: OmmRow[] = [omm]): string {
  const fields = Object.keys(omm);

  return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => row[field]).join(',')).join('\n')}\n`;
}

function socratesCsv(secondCatalogId = '64737'): string {
  return `${SOCRATES_HEADER}\r\n62392,TOMORROW-S3 [+],0,${secondCatalogId},STARLINK-34619 [+],0,2099-07-21 07:10:32.348,0.003,11.520,1.000E+00,0.000\r\n`;
}

function candidateConjunctionFeed(secondCatalogId = '64737'): SocratesFeedV1 {
  const timeOfClosestApproach = '2099-07-21T07:10:32.348Z';
  const pairKey = ['62392', secondCatalogId]
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
    .join(':');
  const checksum = 'a'.repeat(64);

  return {
    schemaVersion: 1,
    snapshotId: `socrates-2026-07-18-${checksum.slice(0, 12)}`,
    generatedAt: '2026-07-18T01:13:28.000Z',
    source: {
      provider: 'CelesTrak',
      rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
      updatedAt: '2026-07-18T01:13:28.000Z',
      retrievedAt: '2026-07-18T11:25:30.000Z',
      checksum,
    },
    conjunctions: [
      {
        id: createHash('sha256').update(`${pairKey}:${timeOfClosestApproach}`).digest('hex').slice(0, 24),
        object1: { catalogId: '62392', name: 'TOMORROW-S3 [+]', dseDays: 0 },
        object2: { catalogId: secondCatalogId, name: 'STARLINK-34619 [+]', dseDays: 0 },
        timeOfClosestApproach,
        missDistanceKm: 0.003,
        relativeSpeedKmS: 11.52,
        maximumProbability: 1,
        dilutionThreshold: 0,
      },
    ],
  };
}

function conjunctionSummary(feed: SocratesFeedV1) {
  return {
    snapshotId: feed.snapshotId,
    eventCount: feed.conjunctions.length,
    updatedAt: feed.source.updatedAt,
    retrievedAt: feed.source.retrievedAt,
    checksum: feed.source.checksum,
  };
}

describe('SatGlobe catalog refresh', () => {
  it('converts OMM records into valid, checksummed TLE rows', () => {
    const row = ommToCatalogRow(omm);

    expect(row.tle1).toHaveLength(69);
    expect(row.tle2).toHaveLength(69);
    expect(Number(row.tle1.at(-1))).toBe(FormatTle.tleChecksum(row.tle1));
    expect(Number(row.tle2.at(-1))).toBe(FormatTle.tleChecksum(row.tle2));
    expect(catalogIdFromTle(row)).toBe('25544');
    expect(new Date(epochFromCatalog(row)).toISOString()).toBe('2026-07-15T12:30:15.250Z');
  });

  it('treats a timezone-less CelesTrak epoch as UTC at sub-millisecond precision', () => {
    const row = ommToCatalogRow({
      ...omm,
      OBJECT_NAME: 'CXO',
      EPOCH: '2026-07-20T02:43:32.333088',
    });

    expect(row.tle1.slice(18, 32)).toBe('26201.11356867');
    expect(new Date(epochFromCatalog(row)).toISOString()).toBe('2026-07-20T02:43:32.333Z');
  });

  it('rejects an empty catalog before deriving snapshot provenance', () => {
    expect(() => newestElementEpochFromCatalog([])).toThrow(TypeError);
    expect(() => newestElementEpochFromCatalog([])).toThrow('Catalog does not contain a valid newest element epoch.');
  });

  it('rejects manifest provenance that does not describe the candidate conjunction feed', () => {
    const feed = candidateConjunctionFeed();
    const catalogIds = new Set(['62392', '64737']);
    const coherentSummary = conjunctionSummary(feed);

    expect(() => validateCatalogConjunctionCoherence(catalogIds, feed, coherentSummary)).not.toThrow();
    expect(() => validateCatalogConjunctionCoherence(catalogIds, feed, {
      ...coherentSummary,
      checksum: 'b'.repeat(64),
    })).toThrow(/conjunctions\.checksum/u);
  });

  it('rejects candidate conjunctions whose objects are absent from the candidate catalog', () => {
    const feed = candidateConjunctionFeed();

    expect(() => validateCatalogConjunctionCoherence(
      new Set(['62392']),
      feed,
      conjunctionSummary(feed),
    )).toThrow(/64737/u);
  });

  it.each([
    '2026-02-30T02:43:32.333088',
    '2026-07-20 02:43:32.333088',
    '2026-07-20T02:43:32.333088-07:00',
    '2026-07-20T02:43:32.333088 trailing',
    'not-a-date',
  ])('rejects malformed or offset OMM epoch %s', (epoch) => {
    expect(() => ommToCatalogRow({ ...omm, EPOCH: epoch })).toThrow(/Invalid OMM epoch/u);
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('rejects non-finite OMM numeric field %s', (value) => {
    expect(() => ommToCatalogRow({ ...omm, MEAN_MOTION: value })).toThrow(/invalid OMM MEAN_MOTION/u);
  });

  it('emits byte-identical TLE epoch and snapshot inputs across host timezones', async () => {
    const fixture = JSON.stringify({
      ...omm,
      OBJECT_NAME: 'CXO',
      EPOCH: '2026-07-20T02:43:32.333088',
    });
    const script = [
      'import { createHash } from "node:crypto";',
      'import { catalogSnapshotId, epochFromCatalog, ommToCatalogRow } from "./scripts/satglobe/catalog-refresh.ts";',
      `const row = ommToCatalogRow(${fixture});`,
      'const catalog = JSON.stringify([row]) + "\\n";',
      'const digest = createHash("sha256").update(catalog).digest("hex");',
      'const newestElementEpoch = new Date(epochFromCatalog(row)).toISOString();',
      'const snapshotId = catalogSnapshotId(newestElementEpoch, digest);',
      'process.stdout.write(JSON.stringify({ epoch: row.tle1.slice(18, 32), newestElementEpoch, snapshotId, catalog }));',
    ].join('\n');
    const outputs = await Promise.all(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map(async (timezone) => {
      const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
        cwd: process.cwd(),
        env: { ...process.env, TZ: timezone },
      });

      return stdout;
    }));

    expect(new Set(outputs)).toHaveLength(1);
    expect(JSON.parse(outputs[0] ?? '{}')).toMatchObject({
      epoch: '26201.11356867',
      newestElementEpoch: '2026-07-20T02:43:32.333Z',
    });
  });

  it('preserves extended catalog identifiers outside legacy TLE columns', () => {
    const row = ommToCatalogRow({ ...omm, NORAD_CAT_ID: '799500766' });

    expect(row.tle1.slice(2, 7)).toBe('00766');
    expect(row.satglobeCatalogId).toBe('799500766');
    expect(catalogIdFromTle(row)).toBe('799500766');
  });

  it('produces a deterministic rejection reason summary', () => {
    expect(summarizeRejections([
      { source: 'a', catalogId: '1', name: 'One', reason: 'Epoch regression' },
      { source: 'b', catalogId: '2', name: 'Two', reason: 'Malformed OMM record' },
      { source: 'a', catalogId: '3', name: 'Three', reason: 'Epoch regression' },
    ])).toEqual({ 'Epoch regression': 2, 'Malformed OMM record': 1 });
  });

  it('reuses a verified source download instead of requesting the same group twice', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-'));
    const cacheFile = path.join(directory, 'active.csv');
    const fetchSource = vi.fn(() => Promise.resolve(new Response('fresh source', { status: 200 })));

    temporaryDirectories.push(directory);
    await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).resolves.toBe('fresh source');
    await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).resolves.toBe('fresh source');
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('surfaces the provider response when a download is rejected and no cache exists', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-'));
    const cacheFile = path.join(directory, 'active.csv');
    const fetchSource = vi.fn(() => Promise.resolve(new Response('Data is updated once every 2 hours.', { status: 403 })));

    temporaryDirectories.push(directory);
    await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).rejects.toThrow('Data is updated once every 2 hours.');
  });

  it('validates a downloaded OMM source before it can enter the cache', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-invalid-cache-'));
    const cacheFile = path.join(directory, 'active.csv');
    const fetchSource = vi.fn(() => Promise.resolve(new Response('bad source', { status: 200 })));
    const rejectInvalidSource = () => {
      throw new Error('invalid OMM contract');
    };

    temporaryDirectories.push(directory);
    await expect(loadSource(
      undefined,
      'https://example.test/active.csv',
      cacheFile,
      fetchSource,
      true,
      rejectInvalidSource,
    )).rejects.toThrow('invalid OMM contract');
    await expect(access(cacheFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries once when the provider request fails outright', async () => {
    // The retry delay uses a real setTimeout; the suite's fake clock would park it forever.
    vi.useRealTimers();
    try {
      const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-'));
      const cacheFile = path.join(directory, 'active.csv');
      const fetchSource = vi.fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(new Response('fresh after retry', { status: 200 }));

      temporaryDirectories.push(directory);
      await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).resolves.toBe('fresh after retry');
      expect(fetchSource).toHaveBeenCalledTimes(2);
    } finally {
      vi.useFakeTimers();
    }
  });

  it('rejects unknown CLI flags instead of silently ignoring them', () => {
    expect(() => parseArgs(['--verify-onIy'])).toThrow(/Unknown argument: --verify-onIy/u);
    expect(() => parseArgs(['--output'])).toThrow(/Missing value for --output/u);
    expect(parseArgs(['--verify-only']).verifyOnly).toBe(true);
    expect(() => parseArgs(['--socrates-input', 's.csv'])).toThrow(/must be provided together/u);
    expect(parseArgs([
      '--output', 'out.json',
      '--active-input', 'a.csv',
      '--socrates-input', 's.csv',
      '--socrates-updated-at', '2026-07-18T01:13:28.000Z',
      '--socrates-retrieved-at', '2026-07-18T11:25:30.000Z',
    ])).toMatchObject({
      activeInput: 'a.csv',
      socratesInput: 's.csv',
      socratesUpdatedAt: '2026-07-18T01:13:28.000Z',
      socratesRetrievedAt: '2026-07-18T11:25:30.000Z',
    });
  });

  it('identifies malformed catalog and OMM fields as caller type errors', () => {
    expect(() => validateBaseCatalog(Array.from({ length: 30_000 }, () => ({}) as never))).toThrow(TypeError);
    expect(() => ommToCatalogRow({ ...omm, EPOCH: 'not-a-date' })).toThrow(TypeError);
    expect(() => ommToCatalogRow({ ...omm, INCLINATION: 'not-a-number' })).toThrow(TypeError);
  });

  it('validates a complete dry run without writing catalog, feed, report, or cache artifacts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-verify-'));
    const output = path.join(directory, 'tle.json');
    const activeInput = path.join(directory, 'active.csv');
    const starlinkInput = path.join(directory, 'starlink.csv');
    const socratesInput = path.join(directory, 'socrates.csv');

    temporaryDirectories.push(directory);
    await Promise.all([
      copyFile(path.resolve('public/tle/tle.json'), output),
      writeFile(activeInput, ommCsv(), 'utf8'),
      writeFile(starlinkInput, ommCsv(), 'utf8'),
      writeFile(socratesInput, socratesCsv(), 'utf8'),
    ]);
    const before = await readFile(output, 'utf8');
    const summary = await refreshCatalog(parseArgs([
      '--verify-only',
      '--output', output,
      '--active-input', activeInput,
      '--starlink-input', starlinkInput,
      '--socrates-input', socratesInput,
      '--socrates-updated-at', '2026-07-18T01:13:28.000Z',
      '--socrates-retrieved-at', '2026-07-18T11:25:30.000Z',
    ]));

    expect(summary.conjunctions.eventCount).toBe(1);
    await expect(readFile(output, 'utf8')).resolves.toBe(before);
    await expect(access(path.join(directory, 'satglobe'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an epoch regression smaller than the historical seven-hour timezone shift', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-regression-'));
    const output = path.join(directory, 'tle.json');
    const activeInput = path.join(directory, 'active.csv');
    const starlinkInput = path.join(directory, 'starlink.csv');
    const socratesInput = path.join(directory, 'socrates.csv');
    const regression = {
      ...omm,
      OBJECT_NAME: 'CXO',
      OBJECT_ID: '1999-040B',
      NORAD_CAT_ID: '25867',
      EPOCH: '2026-07-20T02:44:32.333000',
    };

    temporaryDirectories.push(directory);
    await copyFile(path.resolve('public/tle/tle.json'), output);
    const installed = JSON.parse(await readFile(output, 'utf8')) as Array<Parameters<typeof epochFromCatalog>[0]>;
    const installedCxoIndex = installed.findIndex((row) => catalogIdFromTle(row) === '25867');

    expect(installedCxoIndex).toBeGreaterThanOrEqual(0);
    const seededExisting = ommToCatalogRow({
      ...regression,
      EPOCH: '2026-07-20T06:44:32.333000',
    }, installed[installedCxoIndex]);

    installed[installedCxoIndex] = seededExisting;
    await Promise.all([
      writeFile(output, `${JSON.stringify(installed)}\n`, 'utf8'),
      writeFile(activeInput, ommCsv([regression]), 'utf8'),
      writeFile(starlinkInput, ommCsv([regression]), 'utf8'),
      writeFile(socratesInput, socratesCsv(), 'utf8'),
    ]);
    const regressionMs = epochFromCatalog(seededExisting) - parseOmmEpochUtc(regression.EPOCH).epochMs;

    expect(regressionMs).toBeGreaterThan(0);
    expect(regressionMs).toBeLessThan(7 * 60 * 60 * 1_000);
    const summary = await refreshCatalog(parseArgs([
      '--verify-only',
      '--output', output,
      '--active-input', activeInput,
      '--starlink-input', starlinkInput,
      '--socrates-input', socratesInput,
      '--socrates-updated-at', '2026-07-18T01:13:28.000Z',
      '--socrates-retrieved-at', '2026-07-18T11:25:30.000Z',
    ]));

    expect(summary.rejectionReasons).toMatchObject({ 'Epoch regression': 2 });
    expect(summary.updated).toBe(0);
  });

  it('accepts duplicate high-precision OMM epochs after canonical TLE rounding', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-rounding-'));
    const output = path.join(directory, 'tle.json');
    const activeInput = path.join(directory, 'active.csv');
    const starlinkInput = path.join(directory, 'starlink.csv');
    const socratesInput = path.join(directory, 'socrates.csv');
    const duplicate = {
      ...omm,
      NORAD_CAT_ID: '799500777',
      EPOCH: '2026-07-20T02:43:32.000016',
    };

    temporaryDirectories.push(directory);
    await Promise.all([
      copyFile(path.resolve('public/tle/tle.json'), output),
      writeFile(activeInput, ommCsv([duplicate]), 'utf8'),
      writeFile(starlinkInput, ommCsv([duplicate]), 'utf8'),
      writeFile(socratesInput, socratesCsv(), 'utf8'),
    ]);
    const summary = await refreshCatalog(parseArgs([
      '--verify-only',
      '--output', output,
      '--active-input', activeInput,
      '--starlink-input', starlinkInput,
      '--socrates-input', socratesInput,
      '--socrates-updated-at', '2026-07-18T01:13:28.000Z',
      '--socrates-retrieved-at', '2026-07-18T11:25:30.000Z',
    ]));

    expect(summary).toMatchObject({
      added: 1,
      unchanged: 1,
      rejected: 0,
      rejectionReasons: {},
    });
  });

  it('installs a strict v2 manifest whose provenance is coherent with accepted catalog bytes', async () => {
    vi.setSystemTime(CATALOG_REFRESH_TEST_TIME);
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-manifest-'));
    const output = path.join(directory, 'tle.json');
    const activeInput = path.join(directory, 'active.csv');
    const starlinkInput = path.join(directory, 'starlink.csv');
    const socratesInput = path.join(directory, 'socrates.csv');
    const validAdded = { ...omm, NORAD_CAT_ID: '799500766' };
    const rejectedFuture = { ...omm, NORAD_CAT_ID: '999999999', EPOCH: '2099-01-01T00:00:00.000000', MEAN_MOTION: 'not-finite' };

    temporaryDirectories.push(directory);
    await Promise.all([
      copyFile(path.resolve('public/tle/tle.json'), output),
      writeFile(activeInput, ommCsv([validAdded, rejectedFuture]), 'utf8'),
      writeFile(starlinkInput, ommCsv([rejectedFuture]), 'utf8'),
      writeFile(socratesInput, socratesCsv(), 'utf8'),
    ]);
    const baseRows = JSON.parse(await readFile(output, 'utf8')) as Array<Parameters<typeof epochFromCatalog>[0]>;
    const expectedNewestElementEpoch = newestElementEpochFromCatalog(baseRows);
    const refreshStartedAt = Date.now();
    const summary = await refreshCatalog(parseArgs([
      '--output', output,
      '--active-input', activeInput,
      '--starlink-input', starlinkInput,
      '--socrates-input', socratesInput,
      '--socrates-updated-at', '2026-07-18T01:13:28.000Z',
      '--socrates-retrieved-at', '2026-07-18T11:25:30.000Z',
    ]));
    const refreshCompletedAt = Date.now();
    const catalogJson = await readFile(output, 'utf8');
    const manifestFile = path.join(directory, 'satglobe', 'manifest.json');
    const manifestJson = await readFile(manifestFile, 'utf8');
    const manifest = validateCatalogManifest(catalogJson, manifestJson);

    expect(manifest).toEqual(summary);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      newestElementEpoch: expectedNewestElementEpoch,
      rejected: 2,
    });
    expect(new Date(manifest.refreshedAt).getTime()).toBeGreaterThanOrEqual(refreshStartedAt);
    expect(new Date(manifest.refreshedAt).getTime()).toBeLessThanOrEqual(refreshCompletedAt);
    expect(manifest.snapshotId).toMatch(new RegExp(`^satglobe-${expectedNewestElementEpoch.slice(0, 10)}-[a-f0-9]{12}$`, 'u'));

    const wrongEpoch = { ...manifest, newestElementEpoch: '2099-01-01T00:00:00.000Z' };
    const wrongSnapshot = { ...manifest, snapshotId: `satglobe-${expectedNewestElementEpoch.slice(0, 10)}-${'0'.repeat(12)}` };
    const wrongChecksum = { ...manifest, checksum: '0'.repeat(64) };
    const duplicateSources = { ...manifest, sources: [manifest.sources[0], manifest.sources[0], manifest.sources[2]] };
    const wrongRejectedTotal = { ...manifest, rejected: manifest.rejected + 1 };
    const impossibleObjectDelta = { ...manifest, previousObjectCount: manifest.previousObjectCount - 1 };
    const legacyShape = {
      ...manifest,
      schemaVersion: 1,
      generatedAt: manifest.newestElementEpoch,
      refreshedAt: undefined,
      newestElementEpoch: undefined,
    };

    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(wrongEpoch)}\n`)).toThrow(/newestElementEpoch/u);
    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(wrongSnapshot)}\n`)).toThrow(/snapshotId/u);
    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(wrongChecksum)}\n`)).toThrow(/checksum/u);
    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(duplicateSources)}\n`)).toThrow(/source ID/u);
    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(wrongRejectedTotal)}\n`)).toThrow(/rejected must equal/u);
    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(impossibleObjectDelta)}\n`)).toThrow(/objectCount must equal/u);
    expect(() => validateCatalogManifest(catalogJson, `${JSON.stringify(legacyShape)}\n`)).toThrow();
  }, 30_000);

  it('leaves every installed output unchanged when SOCRATES validation fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-failure-'));
    const output = path.join(directory, 'tle.json');
    const reportDirectory = path.join(directory, 'satglobe');
    const activeInput = path.join(directory, 'active.csv');
    const starlinkInput = path.join(directory, 'starlink.csv');
    const socratesInput = path.join(directory, 'socrates.csv');
    const installedFeed = '{"sentinel":"feed"}\n';
    const installedManifest = '{"sentinel":"manifest"}\n';

    temporaryDirectories.push(directory);
    await mkdir(reportDirectory, { recursive: true });
    await Promise.all([
      copyFile(path.resolve('public/tle/tle.json'), output),
      writeFile(activeInput, ommCsv(), 'utf8'),
      writeFile(starlinkInput, ommCsv(), 'utf8'),
      writeFile(socratesInput, socratesCsv('62392'), 'utf8'),
      writeFile(path.join(reportDirectory, 'conjunctions.json'), installedFeed, 'utf8'),
      writeFile(path.join(reportDirectory, 'manifest.json'), installedManifest, 'utf8'),
    ]);
    const before = await readFile(output, 'utf8');

    await expect(refreshCatalog(parseArgs([
      '--output', output,
      '--active-input', activeInput,
      '--starlink-input', starlinkInput,
      '--socrates-input', socratesInput,
      '--socrates-updated-at', '2026-07-18T01:13:28.000Z',
      '--socrates-retrieved-at', '2026-07-18T11:25:30.000Z',
    ]))).rejects.toThrow(/self-conjunction/u);
    await expect(readFile(output, 'utf8')).resolves.toBe(before);
    await expect(readFile(path.join(reportDirectory, 'conjunctions.json'), 'utf8')).resolves.toBe(installedFeed);
    await expect(readFile(path.join(reportDirectory, 'manifest.json'), 'utf8')).resolves.toBe(installedManifest);
  });

  it('refuses a concurrent artifact install while the output lock is held', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-lock-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');
    const heldLock = await acquireInstallLock(lockFile);

    temporaryDirectories.push(directory);
    try {
      await expect(stageAndInstallArtifacts(directory, [
        { target: path.join(directory, 'candidate.json'), contents: '{}\n' },
        { target: path.join(directory, 'manifest.json'), contents: '{}\n', manifest: true },
      ])).rejects.toThrow(/holds the install lock/u);
      await expect(access(path.join(directory, 'candidate.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await releaseInstallLock(heldLock);
    }
  });

  it('reclaims a lock whose recorded owner process is no longer alive', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-stale-lock-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');
    const candidate = path.join(directory, 'candidate.json');
    const manifest = path.join(directory, 'manifest.json');

    temporaryDirectories.push(directory);
    await createTestInstallLock(lockFile, 99_999_999, '00000000-0000-4000-8000-000000000001');
    await stageAndInstallArtifacts(directory, [
      { target: candidate, contents: '{"candidate":true}\n' },
      { target: manifest, contents: '{"manifest":true}\n', manifest: true },
    ]);

    await expect(readFile(candidate, 'utf8')).resolves.toBe('{"candidate":true}\n');
    await expect(readFile(manifest, 'utf8')).resolves.toBe('{"manifest":true}\n');
    await expect(access(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows only one of two contenders to reclaim the same stale lock', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-lock-race-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');

    temporaryDirectories.push(directory);
    await createTestInstallLock(lockFile, 99_999_999, '00000000-0000-4000-8000-000000000002');
    const results = await Promise.allSettled([
      acquireInstallLock(lockFile),
      acquireInstallLock(lockFile),
    ]);
    const acquired = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');

    expect(acquired).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const winner = acquired[0];

    expect(winner?.status).toBe('fulfilled');
    if (winner?.status === 'fulfilled') {
      expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: winner.value.token });
      await releaseInstallLock(winner.value);
    }
    await expect(access(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks a second reclaimer while the first is verified but has not unlinked the stale generation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-lock-barrier-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');
    let markProofVerified: (() => void) | undefined;
    let continueFirstReclaimer: (() => void) | undefined;
    const proofVerified = new Promise<void>((resolve) => {
      markProofVerified = resolve;
    });
    const allowFirstReclaimerToUnlink = new Promise<void>((resolve) => {
      continueFirstReclaimer = resolve;
    });

    temporaryDirectories.push(directory);
    await createTestInstallLock(lockFile, 99_999_999, '00000000-0000-4000-8000-000000000004');
    const firstAcquisition = acquireInstallLock(lockFile, {
      afterProofVerified: async () => {
        markProofVerified?.();
        await allowFirstReclaimerToUnlink;
      },
    });

    await proofVerified;
    try {
      await expect(acquireInstallLock(lockFile)).rejects.toThrow(/holds the install lock/u);
    } finally {
      continueFirstReclaimer?.();
    }
    const firstLock = await firstAcquisition;

    expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: firstLock.token });
    await releaseInstallLock(firstLock);
  });

  it('immediately recovers a stale proof abandoned by a failed acquisition in the same process', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-lock-abandoned-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');

    temporaryDirectories.push(directory);
    await createTestInstallLock(lockFile, 99_999_999, '00000000-0000-4000-8000-000000000007');
    await expect(acquireInstallLock(lockFile, {
      afterProofVerified: () => Promise.reject(new Error('injected post-verification failure')),
    })).rejects.toThrow(/injected post-verification failure/u);

    const recovered = await acquireInstallLock(lockFile);

    expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: recovered.token });
    await releaseInstallLock(recovered);
    await expect(access(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers an ownership proof left by a reclaimer that exited', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-lock-dead-reclaimer-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');
    const ownerToken = '00000000-0000-4000-8000-000000000005';
    const deadClaimantToken = '00000000-0000-4000-8000-000000000006';

    temporaryDirectories.push(directory);
    await createTestInstallLock(lockFile, 99_999_999, ownerToken);
    await rename(
      `${lockFile}.${ownerToken}.owner`,
      `${lockFile}.${ownerToken}.reclaim-99999998-${deadClaimantToken}`,
    );
    const recovered = await acquireInstallLock(lockFile);

    expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: recovered.token });
    await releaseInstallLock(recovered);
  });

  it('does not release a replacement lock owned by another refresh', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-lock-release-'));
    const lockFile = path.join(directory, '.satglobe-refresh.lock');
    const first = await acquireInstallLock(lockFile);
    const replacementToken = '00000000-0000-4000-8000-000000000003';

    temporaryDirectories.push(directory);
    await unlink(lockFile);
    await createTestInstallLock(lockFile, process.pid, replacementToken);
    await releaseInstallLock(first);

    expect(JSON.parse(await readFile(lockFile, 'utf8'))).toMatchObject({ token: replacementToken });
  });
});
