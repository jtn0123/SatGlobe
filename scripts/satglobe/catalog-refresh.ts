#!/usr/bin/env npx tsx

import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';
import { convertA5to6Digit } from '../../src/engine/ootk/src/coordinate/alpha5';
import { FormatTle } from '../../src/engine/ootk/src/coordinate/FormatTle';
import { buildSocratesFeed, validateSocratesFeed } from './socrates-refresh';

/* eslint-disable jsdoc/require-jsdoc -- Refresh helpers are private or expose self-describing typed contracts. */

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
  socratesInput?: string;
  socratesUpdatedAt?: string;
  socratesRetrievedAt?: string;
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
  conjunctions: {
    snapshotId: string;
    eventCount: number;
    updatedAt: string;
    retrievedAt: string;
    checksum: string;
  };
  checksum: string;
}

const ACTIVE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=CSV';
const STARLINK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=CSV';
const SOURCE_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const SOURCE_CACHE_DIRECTORY = path.resolve('.cache/satglobe');

const USAGE = `Usage: catalog-refresh [--verify-only] [--output <file>] [--active-input <file>] [--starlink-input <file>] [--socrates-input <file> --socrates-updated-at <ISO> --socrates-retrieved-at <ISO>]

  --verify-only            Validate and report without installing anything
  --output <file>          Catalog to update (default: public/tle/tle.json)
  --active-input <file>    Use a local CSV instead of downloading the active group
  --starlink-input <file>  Use a local CSV instead of downloading the Starlink group
  --socrates-input <file>  Use an exact saved SOCRATES CSV instead of downloading it
  --socrates-updated-at    Provider FILE_MTIME for --socrates-input as a canonical ISO timestamp
  --socrates-retrieved-at  Original retrieval time for --socrates-input as a canonical ISO timestamp
`;

export function parseArgs(argv: string[]): RefreshOptions {
  const booleanFlags = new Set(['--verify-only']);
  const valueFlags = new Set([
    '--output',
    '--active-input',
    '--starlink-input',
    '--socrates-input',
    '--socrates-updated-at',
    '--socrates-retrieved-at',
  ]);

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

  const options: RefreshOptions = {
    verifyOnly: argv.includes('--verify-only'),
    output: path.resolve(valueAfter('--output') ?? 'public/tle/tle.json'),
    activeInput: valueAfter('--active-input'),
    starlinkInput: valueAfter('--starlink-input'),
    socratesInput: valueAfter('--socrates-input'),
    socratesUpdatedAt: valueAfter('--socrates-updated-at'),
    socratesRetrievedAt: valueAfter('--socrates-retrieved-at'),
  };

  const localSocratesOptions = [options.socratesInput, options.socratesUpdatedAt, options.socratesRetrievedAt];

  if (localSocratesOptions.some(Boolean) && !localSocratesOptions.every(Boolean)) {
    throw new Error(`--socrates-input, --socrates-updated-at, and --socrates-retrieved-at must be provided together.\n\n${USAGE}`);
  }

  return options;
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

function validateOmmSource(raw: string, source: string): void {
  const parsed = parseOmmCsv(raw, source);

  if (parsed.rows.length === 0) {
    throw new Error(`${source} contains no usable OMM records; source cache and installed snapshot retained.`);
  }
}

function normalizeId(value: string): string {
  return (/^\d+$/u).test(value) ? value.replace(/^0+(?=\d)/u, '') : value;
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
  const scc = (/^\d+$/u).test(id) && numericId > 339_999 ? id.slice(-5) : id;
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
  const counts = rejections.reduce((summary, rejection) => {
    summary.set(rejection.reason, (summary.get(rejection.reason) ?? 0) + 1);

    return summary;
  }, new Map<string, number>());

  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
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
      await new Promise((resolveDelay) => {
        setTimeout(resolveDelay, SOURCE_FETCH_RETRY_DELAY_MS);
      });

      return await request();
    }

    return response;
  } catch (error) {
    process.stderr.write(`Catalog source request failed (${error instanceof Error ? error.message : String(error)}); retrying once...\n`);
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, SOURCE_FETCH_RETRY_DELAY_MS);
    });

    return request();
  }
}

export async function loadSource(
  file: string | undefined,
  url: string,
  cacheFile: string,
  fetchSource: typeof fetch = fetch,
  writeCache = true,
  validateSource?: (source: string) => void,
): Promise<string> {
  if (file) {
    const source = await readFile(path.resolve(file), 'utf8');

    validateSource?.(source);

    return source;
  }
  const cached = await readFreshSourceCache(cacheFile);

  if (cached !== null) {
    validateSource?.(cached.contents);
    process.stdout.write(`Using cached download from ${cached.ageMinutes} minute${cached.ageMinutes === 1 ? '' : 's'} ago for ${url}\n  (delete .cache/satglobe to force a fresh provider request)\n`);

    return cached.contents;
  }
  const response = await fetchWithRetry(url, fetchSource);

  if (!response.ok) {
    const providerMessage = (await response.text()).trim();

    throw new Error(`Catalog source returned HTTP ${response.status}: ${url}${providerMessage ? `\n${providerMessage}` : ''}`);
  }

  const source = await response.text();

  validateSource?.(source);
  if (writeCache) {
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeAtomic(cacheFile, source);
  }

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

export interface RefreshArtifact {
  target: string;
  contents: string;
  manifest?: boolean;
}

interface StagedArtifact extends RefreshArtifact {
  staged: string;
  backup: string;
  hadInstalledVersion: boolean;
}

interface InstallLockOwner {
  pid: number;
  startedAt: string;
}

const INCOMPLETE_LOCK_STALE_AFTER_MS = 60_000;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function createInstallLock(lockFile: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;

  try {
    handle = await open(lockFile, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }

  try {
    const owner: InstallLockOwner = { pid: process.pid, startedAt: new Date().toISOString() };

    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
  } catch (error) {
    await rm(lockFile, { force: true });
    throw error;
  } finally {
    await handle.close();
  }

  return true;
}

async function inspectInstallLock(lockFile: string): Promise<'live' | 'stale' | 'missing'> {
  try {
    const owner = JSON.parse(await readFile(lockFile, 'utf8')) as Partial<InstallLockOwner>;

    if (Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0) {
      return processIsAlive(Number(owner.pid)) ? 'live' : 'stale';
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
  }

  try {
    const lockStat = await stat(lockFile);

    return Date.now() - lockStat.mtimeMs > INCOMPLETE_LOCK_STALE_AFTER_MS ? 'stale' : 'live';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
}

async function acquireInstallLock(lockFile: string, retriesRemaining = 2): Promise<void> {
  if (await createInstallLock(lockFile)) {
    return;
  }
  const state = await inspectInstallLock(lockFile);

  if (state === 'live') {
    throw new Error(`Another catalog refresh holds the install lock: ${lockFile}`);
  }
  if (retriesRemaining <= 0) {
    throw new Error(`Could not acquire the catalog refresh install lock: ${lockFile}`);
  }
  if (state === 'stale') {
    await rm(lockFile, { force: true });
  }
  await acquireInstallLock(lockFile, retriesRemaining - 1);
}

async function installedFileExists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function restoreInstalledArtifacts(installed: StagedArtifact[]): Promise<void> {
  await Promise.all(installed.map(async (artifact) => {
    if (artifact.hadInstalledVersion) {
      await copyFile(artifact.backup, artifact.target);
    } else {
      await rm(artifact.target, { force: true });
    }
  }));
}

async function installInOrder(artifacts: StagedArtifact[], installed: StagedArtifact[], index = 0): Promise<void> {
  const artifact = artifacts[index];

  if (!artifact) {
    return;
  }
  await rename(artifact.staged, artifact.target);
  installed.push(artifact);
  await installInOrder(artifacts, installed, index + 1);
}

export async function stageAndInstallArtifacts(outputDirectory: string, artifacts: RefreshArtifact[]): Promise<void> {
  const targets = new Set(artifacts.map((artifact) => artifact.target));

  if (targets.size !== artifacts.length || artifacts.filter((artifact) => artifact.manifest).length !== 1) {
    throw new Error('Refresh artifact transaction must contain unique targets and exactly one manifest.');
  }
  const lockFile = path.join(outputDirectory, '.satglobe-refresh.lock');

  await acquireInstallLock(lockFile);
  let stageDirectory: string | null = null;
  let preserveStageForRecovery = false;
  const ordered = [...artifacts].sort((left, right) => Number(Boolean(left.manifest)) - Number(Boolean(right.manifest)));

  try {
    stageDirectory = await mkdtemp(path.join(outputDirectory, '.satglobe-stage-'));
    await Promise.all(ordered.map((artifact) => mkdir(path.dirname(artifact.target), { recursive: true })));
    const staged = await Promise.all(ordered.map(async (artifact, index): Promise<StagedArtifact> => {
      const stagedFile = path.join(stageDirectory, `${index}.next`);
      const backup = path.join(stageDirectory, `${index}.backup`);

      await writeFile(stagedFile, artifact.contents, 'utf8');
      const hadInstalledVersion = await installedFileExists(artifact.target);

      if (hadInstalledVersion) {
        await copyFile(artifact.target, backup);
      }

      return { ...artifact, staged: stagedFile, backup, hadInstalledVersion };
    }));
    const installed: StagedArtifact[] = [];

    try {
      await installInOrder(staged, installed);
    } catch (error) {
      try {
        await restoreInstalledArtifacts(installed);
      } catch (rollbackError) {
        preserveStageForRecovery = true;
        throw new AggregateError(
          [error, rollbackError],
          `Catalog install and rollback both failed; backups were preserved at ${stageDirectory}`,
        );
      }
      throw error;
    }
  } finally {
    if (stageDirectory && !preserveStageForRecovery) {
      await rm(stageDirectory, { force: true, recursive: true });
    }
    await rm(lockFile, { force: true });
  }
}

function validateSerializedOutputs(catalogJson: string, conjunctionJson: string, summaryJson: string): void {
  const catalog = JSON.parse(catalogJson) as CatalogRow[];
  const conjunctions = JSON.parse(conjunctionJson) as unknown;
  const summary = JSON.parse(summaryJson) as unknown;

  validateBaseCatalog(catalog);
  validateSocratesFeed(conjunctions);
  if (typeof summary !== 'object' || summary === null || !('snapshotId' in summary) || !('checksum' in summary)) {
    throw new Error('Refresh manifest failed its serialized-output validation.');
  }
}

export async function refreshCatalog(options: RefreshOptions): Promise<RefreshSummary> {
  const baseRaw = await readFile(options.output, 'utf8');
  const baseRows = JSON.parse(baseRaw) as CatalogRow[];
  const catalog = validateBaseCatalog(baseRows);
  const previousObjectCount = catalog.size;
  const refreshTime = new Date();
  const [activeRaw, starlinkRaw, conjunctionFeed] = await Promise.all([
    loadSource(
      options.activeInput,
      ACTIVE_URL,
      path.join(SOURCE_CACHE_DIRECTORY, 'active.csv'),
      fetch,
      !options.verifyOnly,
      (raw) => validateOmmSource(raw, 'celestrak-active'),
    ),
    loadSource(
      options.starlinkInput,
      STARLINK_URL,
      path.join(SOURCE_CACHE_DIRECTORY, 'starlink.csv'),
      fetch,
      !options.verifyOnly,
      (raw) => validateOmmSource(raw, 'celestrak-starlink'),
    ),
    buildSocratesFeed({
      input: options.socratesInput,
      inputUpdatedAt: options.socratesUpdatedAt,
      inputRetrievedAt: options.socratesRetrievedAt,
      now: refreshTime,
      writeCache: !options.verifyOnly,
    }),
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
  const conjunctionJson = `${JSON.stringify(conjunctionFeed, null, 2)}\n`;
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
    conjunctions: {
      snapshotId: conjunctionFeed.snapshotId,
      eventCount: conjunctionFeed.conjunctions.length,
      updatedAt: conjunctionFeed.source.updatedAt,
      retrievedAt: conjunctionFeed.source.retrievedAt,
      checksum: conjunctionFeed.source.checksum,
    },
    checksum: digest,
  };
  const reportDirectory = path.join(path.dirname(options.output), 'satglobe');
  const manifestJson = `${JSON.stringify(summary, null, 2)}\n`;
  const rejectedJson = `${JSON.stringify(rejected, null, 2)}\n`;
  const summaryJson = `${JSON.stringify({
    previousObjectCount,
    objectCount: rows.length,
    added: summary.added,
    updated: summary.updated,
    rejected: summary.rejected,
    rejectionReasons,
    conjunctionCount: conjunctionFeed.conjunctions.length,
    conjunctionSnapshotId: conjunctionFeed.snapshotId,
  }, null, 2)}\n`;
  const checksumFile = `${digest}  ${path.basename(options.output)}\n`;

  validateSerializedOutputs(catalogJson, conjunctionJson, manifestJson);
  JSON.parse(rejectedJson);
  JSON.parse(summaryJson);
  if (checksumFile !== `${checksum(catalogJson)}  ${path.basename(options.output)}\n`) {
    throw new Error('Catalog checksum output failed validation.');
  }

  if (!options.verifyOnly) {
    await stageAndInstallArtifacts(path.dirname(options.output), [
      { target: options.output, contents: catalogJson },
      { target: path.join(reportDirectory, 'conjunctions.json'), contents: conjunctionJson },
      { target: path.join(reportDirectory, 'rejected-rows.json'), contents: rejectedJson },
      { target: path.join(reportDirectory, 'summary.json'), contents: summaryJson },
      { target: path.join(reportDirectory, 'catalog.sha256'), contents: checksumFile },
      { target: path.join(reportDirectory, 'manifest.json'), contents: manifestJson, manifest: true },
    ]);
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
