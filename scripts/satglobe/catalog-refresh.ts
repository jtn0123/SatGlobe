#!/usr/bin/env npx tsx

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';
import { convertA5to6Digit } from '../../src/engine/ootk/src/coordinate/alpha5';
import { FormatTle } from '../../src/engine/ootk/src/coordinate/FormatTle';

type CatalogRow = Record<string, unknown> & {
  tle1: string;
  tle2: string;
  name?: string;
  status?: string;
  type?: number;
  satglobeCatalogId?: string;
};

export type OmmRow = Record<string, string> & {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  NORAD_CAT_ID: string;
};

interface Rejection {
  source: string;
  catalogId: string;
  name: string;
  reason: string;
}

interface RefreshOptions {
  verifyOnly: boolean;
  output: string;
  activeInput?: string;
  starlinkInput?: string;
}

interface RefreshSummary {
  schemaVersion: 1;
  snapshotId: string;
  generatedAt: string;
  previousObjectCount: number;
  objectCount: number;
  added: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  sources: Array<{ id: string; url: string; recordCount: number; checksum: string }>;
  checksum: string;
}

const ACTIVE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=CSV';
const STARLINK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=CSV';
const SOURCE_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const SOURCE_CACHE_DIRECTORY = path.resolve('.cache/satglobe');

const USAGE = `Usage: catalog-refresh [--verify-only] [--output <file>] [--active-input <file>] [--starlink-input <file>]

  --verify-only            Validate and report without installing anything
  --output <file>          Catalog to update (default: public/tle/tle.json)
  --active-input <file>    Use a local CSV instead of downloading the active group
  --starlink-input <file>  Use a local CSV instead of downloading the Starlink group
`;

export function parseArgs(argv: string[]): RefreshOptions {
  const booleanFlags = new Set(['--verify-only']);
  const valueFlags = new Set(['--output', '--active-input', '--starlink-input']);

  // A typo'd flag silently ignored could turn an intended dry run into a real
  // install, so anything unrecognized is a hard error.
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (booleanFlags.has(arg)) {
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}\n\n${USAGE}`);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }

  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag);

    return index >= 0 ? argv[index + 1] : undefined;
  };

  return {
    verifyOnly: argv.includes('--verify-only'),
    output: path.resolve(valueAfter('--output') ?? 'public/tle/tle.json'),
    activeInput: valueAfter('--active-input'),
    starlinkInput: valueAfter('--starlink-input'),
  };
}

function checksum(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseOmmCsv(raw: string, source: string): { rows: OmmRow[]; rejected: Rejection[] } {
  const parsed = Papa.parse<Record<string, string>>(raw.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLocaleUpperCase(),
  });
  const rejected: Rejection[] = parsed.errors.map((error) => ({
    source,
    catalogId: '',
    name: '',
    reason: `CSV row ${error.row ?? '?'}: ${error.message}`,
  }));
  const rows = parsed.data.filter((row) => {
    const valid = Boolean(row.NORAD_CAT_ID && row.OBJECT_NAME && row.EPOCH);

    if (!valid) {
      rejected.push({
        source,
        catalogId: row.NORAD_CAT_ID ?? '',
        name: row.OBJECT_NAME ?? '',
        reason: 'Missing NORAD_CAT_ID, OBJECT_NAME, or EPOCH',
      });
    }

    return valid;
  }) as OmmRow[];

  return { rows, rejected };
}

function normalizeId(value: string): string {
  return /^\d+$/u.test(value) ? value.replace(/^0+(?=\d)/u, '') : value;
}

export function catalogIdFromTle(row: CatalogRow): string {
  if (typeof row.satglobeCatalogId === 'string' && row.satglobeCatalogId.trim()) {
    return normalizeId(row.satglobeCatalogId.trim());
  }
  const tleCatalogId = row.tle1.slice(2, 7);
  const catalogId = convertA5to6Digit(tleCatalogId).trim();

  if (!catalogId) {
    throw new Error('TLE is missing a catalog ID');
  }

  return normalizeId(catalogId);
}

export function epochFromCatalog(row: CatalogRow): number {
  const epochYear = Number(row.tle1.slice(18, 20));
  const epochDay = Number(row.tle1.slice(20, 32));

  if (!Number.isFinite(epochYear) || !Number.isFinite(epochDay) || epochDay < 1 || epochDay >= 367) {
    throw new Error('TLE has an invalid epoch');
  }
  const year = epochYear < 57 ? 2_000 + epochYear : 1_900 + epochYear;
  const epoch = Date.UTC(year, 0, 1) + (epochDay - 1) * 86_400_000;

  return epoch;
}

function ommObjectIdToTleInternationalDesignator(objectId: string | undefined): string {
  if (!objectId) {
    return '';
  }
  const match = objectId.match(/^\d{4}-(?<rest>\d{3}[A-Z]{1,3})$/u);

  return match?.groups?.rest ? `${objectId.slice(2, 4)}${match.groups.rest}` : objectId;
}

function requiredFiniteNumber(omm: OmmRow, field: string): number {
  const value = Number(omm[field]);

  if (!Number.isFinite(value)) {
    throw new Error(`Missing or invalid OMM ${field}`);
  }

  return value;
}

function epochParts(epoch: string): { year: number; dayOfYear: number } {
  const instant = new Date(epoch);
  const epochMs = instant.getTime();

  if (!Number.isFinite(epochMs)) {
    throw new Error('Invalid OMM epoch');
  }
  const year = instant.getUTCFullYear();
  const dayOfYear = (epochMs - Date.UTC(year, 0, 0)) / 86_400_000;

  return { year, dayOfYear };
}

export function validateBaseCatalog(rows: CatalogRow[]): Map<string, CatalogRow> {
  if (rows.length < 30_000) {
    throw new Error(`Bundled catalog has only ${rows.length.toLocaleString()} rows; expected at least 30,000.`);
  }
  const byId = new Map<string, CatalogRow>();

  rows.forEach((row, index) => {
    if (typeof row.tle1 !== 'string' || typeof row.tle2 !== 'string') {
      throw new Error(`Bundled catalog row ${index} has malformed element lines.`);
    }
    const id = catalogIdFromTle(row);

    if (byId.has(id)) {
      throw new Error(`Bundled catalog contains duplicate catalog ID ${id}.`);
    }
    byId.set(id, row);
  });

  return byId;
}

export function ommToCatalogRow(omm: OmmRow, existing?: CatalogRow): CatalogRow {
  const id = normalizeId(String(omm.NORAD_CAT_ID));
  const numericId = Number(id);
  const scc = /^\d+$/u.test(id) && numericId > 339_999 ? id.slice(-5) : id;
  const { year, dayOfYear } = epochParts(omm.EPOCH);
  const { tle1, tle2 } = FormatTle.createTle({
    inc: requiredFiniteNumber(omm, 'INCLINATION'),
    meanmo: requiredFiniteNumber(omm, 'MEAN_MOTION'),
    rasc: requiredFiniteNumber(omm, 'RA_OF_ASC_NODE'),
    argPe: requiredFiniteNumber(omm, 'ARG_OF_PERICENTER'),
    meana: requiredFiniteNumber(omm, 'MEAN_ANOMALY'),
    ecen: requiredFiniteNumber(omm, 'ECCENTRICITY'),
    epochyr: year % 100,
    epochday: dayOfYear,
    intl: ommObjectIdToTleInternationalDesignator(omm.OBJECT_ID),
    scc,
    bstar: requiredFiniteNumber(omm, 'BSTAR'),
    meanMotionDot: requiredFiniteNumber(omm, 'MEAN_MOTION_DOT'),
    meanMotionDdot: requiredFiniteNumber(omm, 'MEAN_MOTION_DDOT'),
    classification: String(omm.CLASSIFICATION_TYPE || 'U').slice(0, 1),
    revAtEpoch: requiredFiniteNumber(omm, 'REV_AT_EPOCH'),
    elementSetNo: requiredFiniteNumber(omm, 'ELEMENT_SET_NO'),
    ephemerisType: requiredFiniteNumber(omm, 'EPHEMERIS_TYPE'),
  });

  return {
    ...(existing ?? {}),
    tle1,
    tle2,
    name: omm.OBJECT_NAME,
    type: existing?.type ?? 1,
    status: existing?.status ?? '+',
    satglobeCatalogId: id,
    satglobeSource: 'CelesTrak OMM-compatible GP CSV',
  };
}

export function summarizeRejections(rejections: Rejection[]): Record<string, number> {
  return Object.fromEntries([...rejections.reduce((counts, rejection) => {
    counts.set(rejection.reason, (counts.get(rejection.reason) ?? 0) + 1);

    return counts;
  }, new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)));
}

function mergeSource(
  sourceId: string,
  rows: OmmRow[],
  catalog: Map<string, CatalogRow>,
  rejections: Rejection[],
): { added: number; updated: number; unchanged: number } {
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  rows.forEach((omm) => {
    const id = normalizeId(String(omm.NORAD_CAT_ID));
    const existing = catalog.get(id);

    try {
      const incomingEpoch = new Date(omm.EPOCH).getTime();

      if (!Number.isFinite(incomingEpoch)) {
        throw new Error('Invalid OMM epoch');
      }
      if (existing && incomingEpoch < epochFromCatalog(existing)) {
        rejections.push({ source: sourceId, catalogId: id, name: omm.OBJECT_NAME, reason: 'Epoch regression' });

        return;
      }
      const merged = ommToCatalogRow(omm, existing);
      const before = existing ? JSON.stringify(existing) : '';
      const after = JSON.stringify(merged);

      catalog.set(id, merged);
      if (!existing) {
        added += 1;
      } else if (before === after) {
        unchanged += 1;
      } else {
        updated += 1;
      }
    } catch (error) {
      rejections.push({
        source: sourceId,
        catalogId: id,
        name: omm.OBJECT_NAME,
        reason: error instanceof Error ? error.message : 'Malformed OMM record',
      });
    }
  });

  return { added, updated, unchanged };
}

const SOURCE_FETCH_TIMEOUT_MS = 30_000;
const SOURCE_FETCH_RETRY_DELAY_MS = 2_000;

async function readFreshSourceCache(cacheFile: string): Promise<{ contents: string; ageMinutes: number } | null> {
  try {
    const cacheStat = await stat(cacheFile);
    const ageMs = Date.now() - cacheStat.mtimeMs;

    if (ageMs > SOURCE_CACHE_MAX_AGE_MS) {
      return null;
    }

    return { contents: await readFile(cacheFile, 'utf8'), ageMinutes: Math.max(0, Math.round(ageMs / 60_000)) };
  } catch {
    return null;
  }
}

async function fetchWithRetry(url: string, fetchSource: typeof fetch): Promise<Response> {
  const request = () => fetchSource(url, {
    headers: { 'user-agent': 'SatGlobe catalog refresh (manual local command)' },
    signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
  });

  try {
    const response = await request();

    // Retry once on server-side errors; client errors (403 rate limit text, etc.)
    // carry a provider message the caller should surface immediately.
    if (response.status >= 500) {
      await new Promise((resolveDelay) => { setTimeout(resolveDelay, SOURCE_FETCH_RETRY_DELAY_MS); });

      return await request();
    }

    return response;
  } catch (error) {
    process.stderr.write(`Catalog source request failed (${error instanceof Error ? error.message : String(error)}); retrying once...\n`);
    await new Promise((resolveDelay) => { setTimeout(resolveDelay, SOURCE_FETCH_RETRY_DELAY_MS); });

    return request();
  }
}

export async function loadSource(
  file: string | undefined,
  url: string,
  cacheFile: string,
  fetchSource: typeof fetch = fetch,
): Promise<string> {
  if (file) {
    return readFile(path.resolve(file), 'utf8');
  }
  const cached = await readFreshSourceCache(cacheFile);

  if (cached !== null) {
    process.stdout.write(`Using cached download from ${cached.ageMinutes} minute${cached.ageMinutes === 1 ? '' : 's'} ago for ${url}\n  (delete .cache/satglobe to force a fresh provider request)\n`);

    return cached.contents;
  }
  const response = await fetchWithRetry(url, fetchSource);

  if (!response.ok) {
    const providerMessage = (await response.text()).trim();

    throw new Error(`Catalog source returned HTTP ${response.status}: ${url}${providerMessage ? `\n${providerMessage}` : ''}`);
  }

  const source = await response.text();

  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeAtomic(cacheFile, source);

  return source;
}

function stableCatalogRows(catalog: Map<string, CatalogRow>): CatalogRow[] {
  return [...catalog.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([, row]) => row);
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  const temporary = `${file}.satglobe-${process.pid}.tmp`;

  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, file);
}

export async function refreshCatalog(options: RefreshOptions): Promise<RefreshSummary> {
  const baseRaw = await readFile(options.output, 'utf8');
  const baseRows = JSON.parse(baseRaw) as CatalogRow[];
  const catalog = validateBaseCatalog(baseRows);
  const previousObjectCount = catalog.size;
  const [activeRaw, starlinkRaw] = await Promise.all([
    loadSource(options.activeInput, ACTIVE_URL, path.join(SOURCE_CACHE_DIRECTORY, 'active.csv')),
    loadSource(options.starlinkInput, STARLINK_URL, path.join(SOURCE_CACHE_DIRECTORY, 'starlink.csv')),
  ]);
  const active = parseOmmCsv(activeRaw, 'celestrak-active');
  const starlink = parseOmmCsv(starlinkRaw, 'celestrak-starlink');
  const rejected = [...active.rejected, ...starlink.rejected];
  const activeStats = mergeSource('celestrak-active', active.rows, catalog, rejected);
  const starlinkStats = mergeSource('celestrak-starlink', starlink.rows, catalog, rejected);
  const rows = stableCatalogRows(catalog);
  const rejectionReasons = summarizeRejections(rejected);

  if (rows.length < previousObjectCount * 0.95) {
    throw new Error(`Suspicious object-count drop: ${previousObjectCount} → ${rows.length}. Previous snapshot retained.`);
  }

  // A stable timestamp derived from source epochs keeps identical inputs deterministic.
  const sourceEpochs = [...active.rows, ...starlink.rows].map((row) => new Date(row.EPOCH).getTime()).filter(Number.isFinite);
  const generatedAt = new Date(Math.max(...sourceEpochs)).toISOString();
  const catalogJson = `${JSON.stringify(rows)}\n`;
  const digest = checksum(catalogJson);
  const snapshotId = `satglobe-${generatedAt.slice(0, 10)}-${digest.slice(0, 12)}`;
  const summary: RefreshSummary = {
    schemaVersion: 1,
    snapshotId,
    generatedAt,
    previousObjectCount,
    objectCount: rows.length,
    added: activeStats.added + starlinkStats.added,
    updated: activeStats.updated + starlinkStats.updated,
    unchanged: activeStats.unchanged + starlinkStats.unchanged,
    rejected: rejected.length,
    rejectionReasons,
    sources: [
      { id: 'keeptrack-enriched', url: 'https://github.com/thkruz/keeptrack.space', recordCount: baseRows.length, checksum: checksum(baseRaw) },
      { id: 'celestrak-active', url: ACTIVE_URL, recordCount: active.rows.length, checksum: checksum(activeRaw) },
      { id: 'celestrak-starlink', url: STARLINK_URL, recordCount: starlink.rows.length, checksum: checksum(starlinkRaw) },
    ],
    checksum: digest,
  };

  if (!options.verifyOnly) {
    const reportDirectory = path.join(path.dirname(options.output), 'satglobe');

    await mkdir(reportDirectory, { recursive: true });
    try {
      await writeAtomic(options.output, catalogJson);
      await Promise.all([
        writeAtomic(path.join(reportDirectory, 'manifest.json'), `${JSON.stringify(summary, null, 2)}\n`),
        writeAtomic(path.join(reportDirectory, 'rejected-rows.json'), `${JSON.stringify(rejected, null, 2)}\n`),
        writeAtomic(path.join(reportDirectory, 'summary.json'), `${JSON.stringify({
          previousObjectCount,
          objectCount: rows.length,
          added: summary.added,
          updated: summary.updated,
          rejected: summary.rejected,
          rejectionReasons,
        }, null, 2)}\n`),
        writeAtomic(path.join(reportDirectory, 'catalog.sha256'), `${digest}  ${path.basename(options.output)}\n`),
      ]);
    } catch (error) {
      await rm(`${options.output}.satglobe-${process.pid}.tmp`, { force: true });
      throw error;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await refreshCatalog(options);
  const verb = options.verifyOnly ? 'verified' : 'installed';

  process.stdout.write(`SatGlobe catalog ${verb}: ${summary.snapshotId}\n`);
  process.stdout.write(`${summary.objectCount.toLocaleString()} objects · ${summary.updated.toLocaleString()} updated · ${summary.added.toLocaleString()} added · ${summary.rejected.toLocaleString()} rejected\n`);
  Object.entries(summary.rejectionReasons)
    .sort(([, a], [, b]) => b - a)
    .forEach(([reason, count]) => process.stdout.write(`  ${count.toLocaleString()} × ${reason}\n`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Catalog refresh failed; previous snapshot retained.\n${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
