import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conjunctionFeedV1Schema } from '../../src/satglobe/domain/conjunctions';
import { catalogIdFromTle } from './catalog-refresh';
import {
  loadSocratesSource,
  parseSocratesCsv,
  SOCRATES_METADATA_URL,
  SOCRATES_RAW_URL,
  validateSocratesFeed,
  type SocratesSourceV1,
} from './socrates-refresh';

/* eslint-disable jsdoc/require-jsdoc -- Test fixture builders are intentionally local. */

const HEADER = 'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION';
const NOW = new Date('2026-07-18T12:00:00.000Z');
const SOURCE: SocratesSourceV1 = {
  provider: 'CelesTrak',
  rawUrl: SOCRATES_RAW_URL,
  updatedAt: '2026-07-18T01:13:28.000Z',
  retrievedAt: '2026-07-18T11:25:30.000Z',
  checksum: 'a'.repeat(64),
};
const temporaryDirectories: string[] = [];

function row(overrides: Partial<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    NORAD_CAT_ID_1: '62392',
    OBJECT_NAME_1: 'TOMORROW-S3 [+]',
    DSE_1: '4.342',
    NORAD_CAT_ID_2: '64737',
    OBJECT_NAME_2: 'STARLINK-34619 [+]',
    DSE_2: '3.985',
    TCA: '2026-07-21 07:10:32.348',
    TCA_RANGE: '0.003',
    TCA_RELATIVE_SPEED: '11.520',
    MAX_PROB: '1.000E+00',
    DILUTION: '0.000',
    ...overrides,
  };

  return HEADER.split(',').map((field) => values[field]).join(',');
}

function csv(rows: string[], prefix = ''): string {
  return `${prefix}${HEADER}\r\n${rows.join('\r\n')}\r\n`;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('SOCRATES refresh', () => {
  it('ships a valid 25-event artifact from the official source', async () => {
    const artifact = JSON.parse(await readFile(path.resolve('public/tle/satglobe/conjunctions.json'), 'utf8')) as unknown;

    expect(() => validateSocratesFeed(artifact)).not.toThrow();
    expect(conjunctionFeedV1Schema.safeParse(artifact)).toMatchObject({ success: true });
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      source: { provider: 'CelesTrak', rawUrl: SOCRATES_RAW_URL },
      conjunctions: expect.arrayContaining([expect.objectContaining({ maximumProbability: 1 })]),
    });
    expect((artifact as { conjunctions: unknown[] }).conjunctions).toHaveLength(25);
  });

  it('resolves every checked-in conjunction pair against the installed catalog', async () => {
    const artifact = conjunctionFeedV1Schema.parse(JSON.parse(
      await readFile(path.resolve('public/tle/satglobe/conjunctions.json'), 'utf8'),
    ));
    const catalog = JSON.parse(await readFile(path.resolve('public/tle/tle.json'), 'utf8')) as Array<{
      tle1: string;
      tle2: string;
      satglobeCatalogId?: string;
    }>;
    const catalogIds = new Set(catalog.map((catalogRow) => catalogIdFromTle(catalogRow)));
    const missing = artifact.conjunctions.flatMap((pair) => [pair.object1.catalogId, pair.object2.catalogId])
      .filter((catalogId) => !catalogIds.has(catalogId));

    expect(missing).toEqual([]);
  });

  it('keeps the checked-in feed, refresh manifest, summary, and catalog checksum coherent', async () => {
    const feed = conjunctionFeedV1Schema.parse(JSON.parse(
      await readFile(path.resolve('public/tle/satglobe/conjunctions.json'), 'utf8'),
    ));
    const manifest = JSON.parse(await readFile(path.resolve('public/tle/satglobe/manifest.json'), 'utf8')) as {
      checksum: string;
      conjunctions: {
        snapshotId: string;
        eventCount: number;
        updatedAt: string;
        retrievedAt: string;
        checksum: string;
      };
    };
    const summary = JSON.parse(await readFile(path.resolve('public/tle/satglobe/summary.json'), 'utf8')) as {
      conjunctionCount: number;
      conjunctionSnapshotId: string;
    };
    const catalogChecksum = await readFile(path.resolve('public/tle/satglobe/catalog.sha256'), 'utf8');

    expect(manifest.conjunctions).toEqual({
      snapshotId: feed.snapshotId,
      eventCount: feed.conjunctions.length,
      updatedAt: feed.source.updatedAt,
      retrievedAt: feed.source.retrievedAt,
      checksum: feed.source.checksum,
    });
    expect(summary).toMatchObject({
      conjunctionCount: feed.conjunctions.length,
      conjunctionSnapshotId: feed.snapshotId,
    });
    expect(catalogChecksum).toBe(`${manifest.checksum}  tle.json\n`);
  });

  it('strictly binds feed shape, snapshot provenance, risk order, and event IDs', async () => {
    const artifact = JSON.parse(await readFile(path.resolve('public/tle/satglobe/conjunctions.json'), 'utf8')) as Record<string, unknown>;
    const withExtraField = structuredClone(artifact);

    withExtraField.unexpected = true;
    expect(() => validateSocratesFeed(withExtraField)).toThrow(/unexpected fields/u);
    const wrongSnapshot = structuredClone(artifact);

    wrongSnapshot.snapshotId = 'socrates-2026-07-18-000000000000';
    expect(() => validateSocratesFeed(wrongSnapshot)).toThrow(/match source provenance/u);
    const wrongEventId = structuredClone(artifact) as { conjunctions: Array<{ id: string }> };

    wrongEventId.conjunctions[0].id = '0'.repeat(24);
    expect(() => validateSocratesFeed(wrongEventId)).toThrow(/unstable identifier/u);
    const wrongOrder = structuredClone(artifact) as { conjunctions: unknown[] };

    [wrongOrder.conjunctions[0], wrongOrder.conjunctions[1]] = [wrongOrder.conjunctions[1], wrongOrder.conjunctions[0]];
    expect(() => validateSocratesFeed(wrongOrder)).toThrow(/risk order/u);
    const updateAfterRetrieval = structuredClone(artifact) as {
      generatedAt: string;
      snapshotId: string;
      source: { updatedAt: string; retrievedAt: string; checksum: string };
    };

    updateAfterRetrieval.generatedAt = '2099-01-01T00:00:00.000Z';
    updateAfterRetrieval.source.updatedAt = updateAfterRetrieval.generatedAt;
    updateAfterRetrieval.snapshotId = `socrates-2099-01-01-${updateAfterRetrieval.source.checksum.slice(0, 12)}`;
    expect(() => validateSocratesFeed(updateAfterRetrieval)).toThrow(/cannot be after its retrieval/u);
  });

  it('parses the official BOM/CRLF contract, preserves zeroes, and accepts scientific notation', () => {
    const feed = parseSocratesCsv(csv([row()], '\uFEFF'), { now: NOW, source: SOURCE });

    expect(feed.snapshotId).toBe('socrates-2026-07-18-aaaaaaaaaaaa');
    expect(feed.generatedAt).toBe(SOURCE.updatedAt);
    expect(feed.conjunctions).toHaveLength(1);
    expect(feed.conjunctions[0]).toMatchObject({
      object1: { catalogId: '62392', name: 'TOMORROW-S3 [+]', dseDays: 4.342 },
      object2: { catalogId: '64737', name: 'STARLINK-34619 [+]', dseDays: 3.985 },
      timeOfClosestApproach: '2026-07-21T07:10:32.348Z',
      missDistanceKm: 0.003,
      relativeSpeedKmS: 11.52,
      maximumProbability: 1,
      dilutionThreshold: 0,
    });
  });

  it('requires explicit provider provenance for a saved local source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-socrates-input-'));
    const input = path.join(directory, 'socrates.csv');

    temporaryDirectories.push(directory);
    await writeFile(input, csv([row()]), 'utf8');
    await expect(loadSocratesSource({ input, now: NOW })).rejects.toThrow(/provider FILE_MTIME/u);
    await expect(loadSocratesSource({
      input,
      inputUpdatedAt: SOURCE.updatedAt,
      inputRetrievedAt: SOURCE.retrievedAt,
      now: NOW,
    })).resolves.toMatchObject({
      source: {
        updatedAt: SOURCE.updatedAt,
        retrievedAt: SOURCE.retrievedAt,
      },
    });
    await expect(loadSocratesSource({
      input,
      inputUpdatedAt: '2099-01-01T00:00:00.000Z',
      inputRetrievedAt: SOURCE.retrievedAt,
      now: NOW,
    })).rejects.toThrow(/cannot be after its retrieval/u);
  });

  it('filters past rows before risk sorting and caps the curated feed at 25', () => {
    const rows = [
row({
      NORAD_CAT_ID_1: '100',
      NORAD_CAT_ID_2: '200',
      TCA: '2026-07-18 11:59:59.999',
      MAX_PROB: '1',
    }),
];

    for (let index = 0; index < 30; index += 1) {
      rows.push(row({
        NORAD_CAT_ID_1: String(1_000 + index),
        NORAD_CAT_ID_2: String(2_000 + index),
        TCA: `2026-07-${String(19 + Math.floor(index / 20)).padStart(2, '0')} ${String(index % 20).padStart(2, '0')}:00:00.000`,
        MAX_PROB: String((index + 1) / 100),
        TCA_RANGE: String(30 - index),
      }));
    }
    const feed = parseSocratesCsv(csv(rows), { now: NOW, source: SOURCE });

    expect(feed.conjunctions).toHaveLength(25);
    expect(feed.conjunctions[0].maximumProbability).toBe(0.3);
    expect(feed.conjunctions.at(-1)?.maximumProbability).toBe(0.06);
    expect(feed.conjunctions.some((conjunction) => conjunction.object1.catalogId === '100')).toBe(false);
  });

  it('rejects self-pairs and duplicate unordered pair-plus-TCA rows', () => {
    expect(() => parseSocratesCsv(csv([row({ NORAD_CAT_ID_2: '62392' })]), { now: NOW, source: SOURCE }))
      .toThrow(/self-conjunction/u);
    expect(() => parseSocratesCsv(csv([
      row(),
      row({
        NORAD_CAT_ID_1: '64737',
        OBJECT_NAME_1: 'STARLINK-34619 [+]',
        NORAD_CAT_ID_2: '62392',
        OBJECT_NAME_2: 'TOMORROW-S3 [+]',
      }),
    ]), { now: NOW, source: SOURCE })).toThrow(/duplicate unordered pair and TCA/u);
  });

  it('rejects schema drift, out-of-contract IDs/names, invalid UTC, and an empty future set', () => {
    expect(() => parseSocratesCsv(csv([row()]).replace('DILUTION', 'DILUTION_NEW'), { now: NOW, source: SOURCE }))
      .toThrow(/header changed/u);
    expect(() => parseSocratesCsv(csv([row({ NORAD_CAT_ID_1: '62A92' })]), { now: NOW, source: SOURCE }))
      .toThrow(/digit string/u);
    expect(() => parseSocratesCsv(csv([row({ NORAD_CAT_ID_1: '1234567890' })]), { now: NOW, source: SOURCE }))
      .toThrow(/at most 9 digits/u);
    expect(() => parseSocratesCsv(csv([row({ OBJECT_NAME_1: 'X'.repeat(201) })]), { now: NOW, source: SOURCE }))
      .toThrow(/cannot exceed 200/u);
    expect(() => parseSocratesCsv(csv([row({ TCA: '2026-02-30 01:00:00.000' })]), { now: NOW, source: SOURCE }))
      .toThrow(/valid UTC instant/u);
    expect(() => parseSocratesCsv(csv([row({ TCA: '2026-07-18 11:59:59.999' })]), { now: NOW, source: SOURCE }))
      .toThrow(/no future conjunctions/u);
  });

  it('uses the 8-hour metadata gate and preserves retrieval provenance when bytes are unchanged', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-socrates-'));
    const raw = csv([row()]);
    const metadata = JSON.stringify([
{
      FILE_NAME: 'sort-minRange.csv',
      FILE_SIZE: Buffer.byteLength(raw),
      FILE_MTIME: '2026-07-18 01:13:28 UTC',
    },
]);
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === SOCRATES_METADATA_URL) {
        return Promise.resolve(new Response(metadata, { status: 200 }));
      }
      if (url === SOCRATES_RAW_URL) {
        return Promise.resolve(new Response(raw, { status: 200 }));
      }

return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const fetchSource = request as unknown as typeof fetch;

    temporaryDirectories.push(directory);
    const first = await loadSocratesSource({ cacheDirectory: directory, fetchSource, now: new Date('2026-07-18T02:00:00.000Z') });
    const cached = await loadSocratesSource({ cacheDirectory: directory, fetchSource, now: new Date('2026-07-18T09:59:59.000Z') });
    const rechecked = await loadSocratesSource({ cacheDirectory: directory, fetchSource, now: new Date('2026-07-18T10:00:01.000Z') });

    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      SOCRATES_METADATA_URL,
      SOCRATES_RAW_URL,
      SOCRATES_METADATA_URL,
    ]);
    expect(first.source.retrievedAt).toBe('2026-07-18T02:00:00.000Z');
    expect(cached.source.retrievedAt).toBe(first.source.retrievedAt);
    expect(rechecked.source.retrievedAt).toBe(first.source.retrievedAt);
    const installedMetadata = JSON.parse(await readFile(path.join(directory, 'socrates.metadata.json'), 'utf8')) as { checkedAt: string; retrievedAt: string };

    expect(installedMetadata.checkedAt).toBe('2026-07-18T10:00:01.000Z');
    expect(installedMetadata.retrievedAt).toBe('2026-07-18T02:00:00.000Z');
  });

  it('forbids provider redirects so official provenance cannot follow another origin', async () => {
    const redirected = new Response('redirected', { status: 200 });

    Object.defineProperties(redirected, {
      redirected: { value: true },
      url: { value: 'https://example.test/socrates.json' },
    });
    const request = vi.fn<typeof fetch>().mockResolvedValue(redirected);

    await expect(loadSocratesSource({
      cacheDirectory: path.join(tmpdir(), `satglobe-socrates-redirect-${process.pid}-${Date.now()}`),
      fetchSource: request,
      now: NOW,
      writeCache: false,
    })).rejects.toThrow(/left the official CelesTrak origin/u);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('performs a cache-free verification without writing source files', async () => {
    const directory = path.join(tmpdir(), `satglobe-socrates-no-write-${process.pid}-${Date.now()}`);
    const raw = csv([row()]);
    const metadata = JSON.stringify([
{
      FILE_NAME: 'sort-minRange.csv',
      FILE_SIZE: Buffer.byteLength(raw),
      FILE_MTIME: '2026-07-18 01:13:28 UTC',
    },
]);
    const request = vi.fn((input: RequestInfo | URL) => Promise.resolve(new Response(
      String(input) === SOCRATES_METADATA_URL ? metadata : raw,
      { status: 200 },
    )));

    temporaryDirectories.push(directory);
    await expect(loadSocratesSource({
      cacheDirectory: directory,
      fetchSource: request as unknown as typeof fetch,
      now: NOW,
      writeCache: false,
    })).resolves.toMatchObject({ source: { updatedAt: '2026-07-18T01:13:28.000Z' } });
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not cache a downloaded source until its CSV contract is validated', async () => {
    const directory = path.join(tmpdir(), `satglobe-socrates-invalid-${process.pid}-${Date.now()}`);
    const raw = csv([row({ NORAD_CAT_ID_2: '62392' })]);
    const metadata = JSON.stringify([
      {
        FILE_NAME: 'sort-minRange.csv',
        FILE_SIZE: Buffer.byteLength(raw),
        FILE_MTIME: '2026-07-18 01:13:28 UTC',
      },
    ]);
    const request = vi.fn((input: RequestInfo | URL) => Promise.resolve(new Response(
      String(input) === SOCRATES_METADATA_URL ? metadata : raw,
      { status: 200 },
    )));

    temporaryDirectories.push(directory);
    await expect(loadSocratesSource({
      cacheDirectory: directory,
      fetchSource: request as unknown as typeof fetch,
      now: NOW,
    })).rejects.toThrow(/self-conjunction/u);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
