import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatTle } from '../../src/engine/ootk/src/coordinate/FormatTle';
import {
  catalogIdFromTle,
  epochFromCatalog,
  loadSource,
  ommToCatalogRow,
  summarizeRejections,
  type OmmRow,
} from './catalog-refresh';

const temporaryDirectories: string[] = [];

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
    const fetchSource = vi.fn(async () => new Response('fresh source', { status: 200 }));

    temporaryDirectories.push(directory);
    await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).resolves.toBe('fresh source');
    await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).resolves.toBe('fresh source');
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('surfaces the provider response when a download is rejected and no cache exists', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'satglobe-catalog-'));
    const cacheFile = path.join(directory, 'active.csv');
    const fetchSource = vi.fn(async () => new Response('Data is updated once every 2 hours.', { status: 403 }));

    temporaryDirectories.push(directory);
    await expect(loadSource(undefined, 'https://example.test/active.csv', cacheFile, fetchSource)).rejects.toThrow('Data is updated once every 2 hours.');
  });
});
