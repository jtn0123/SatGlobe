import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';

/* eslint-disable jsdoc/require-jsdoc -- Internal refresh helpers are kept private and named for their validation role. */

export const SOCRATES_RAW_URL = 'https://celestrak.org/SOCRATES/sort-minRange.csv';
export const SOCRATES_METADATA_URL = 'https://celestrak.org/SOCRATES/jsonDir.php';
export const SOCRATES_CACHE_MAX_AGE_MS = 8 * 60 * 60 * 1_000;
export const SOCRATES_MAX_CONJUNCTIONS = 25;
export const SOCRATES_MAX_SOURCE_BYTES = 64 * 1_024 * 1_024;
export const SOCRATES_MAX_METADATA_BYTES = 256 * 1_024;
export const SOCRATES_MAX_ERROR_BODY_BYTES = 16 * 1_024;

const EXPECTED_HEADERS = [
  'NORAD_CAT_ID_1',
  'OBJECT_NAME_1',
  'DSE_1',
  'NORAD_CAT_ID_2',
  'OBJECT_NAME_2',
  'DSE_2',
  'TCA',
  'TCA_RANGE',
  'TCA_RELATIVE_SPEED',
  'MAX_PROB',
  'DILUTION',
] as const;
const CACHE_SCHEMA_VERSION = 1;

type SocratesCsvRow = Record<(typeof EXPECTED_HEADERS)[number], string>;

export interface ConjunctionObjectV1 {
  catalogId: string;
  name: string;
  dseDays: number;
}

export interface ConjunctionV1 {
  id: string;
  object1: ConjunctionObjectV1;
  object2: ConjunctionObjectV1;
  timeOfClosestApproach: string;
  missDistanceKm: number;
  relativeSpeedKmS: number;
  maximumProbability: number;
  dilutionThreshold: number;
}

export interface SocratesSourceV1 {
  provider: 'CelesTrak';
  rawUrl: typeof SOCRATES_RAW_URL;
  updatedAt: string;
  retrievedAt: string;
  checksum: string;
}

export interface SocratesFeedV1 {
  schemaVersion: 1;
  snapshotId: string;
  generatedAt: string;
  source: SocratesSourceV1;
  conjunctions: ConjunctionV1[];
}

export interface LoadedSocratesSource {
  raw: string;
  source: SocratesSourceV1;
}

interface CacheMetadata {
  schemaVersion: 1;
  rawUrl: typeof SOCRATES_RAW_URL;
  metadataUrl: typeof SOCRATES_METADATA_URL;
  updatedAt: string;
  retrievedAt: string;
  checkedAt: string;
  checksum: string;
  size: number;
}

interface ProviderMetadata {
  updatedAt: string;
  size: number;
}

interface BoundedText {
  text: string;
  byteLength: number;
}

class BoundedReadError extends Error {}

interface LoadSocratesOptions {
  input?: string;
  /** Provider FILE_MTIME for an exact saved raw input; filesystem mtime is not provenance. */
  inputUpdatedAt?: string;
  /** Original retrieval time for an exact saved raw input. */
  inputRetrievedAt?: string;
  cacheDirectory?: string;
  fetchSource?: typeof fetch;
  now?: Date;
  writeCache?: boolean;
}

interface ParseSocratesOptions {
  now: Date;
  source: SocratesSourceV1;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function sizeLimitMessage(label: string, maximumBytes: number): string {
  return `${label} exceeds ${maximumBytes.toLocaleString()} bytes.`;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new BoundedReadError(`${label} is not valid UTF-8.`);
  }
}

function assertBoundedContentLength(response: Response, maximumBytes: number, label: string): void {
  const rawLength = response.headers.get('content-length');

  if (rawLength === null) {
    return;
  }
  const normalized = rawLength.trim();

  if (!(/^\d+$/u).test(normalized) || !Number.isSafeInteger(Number(normalized))) {
    throw new BoundedReadError(`${label} has an invalid Content-Length header.`);
  }
  if (Number(normalized) > maximumBytes) {
    throw new BoundedReadError(sizeLimitMessage(label, maximumBytes));
  }
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<BoundedText> {
  assertBoundedContentLength(response, maximumBytes, label);
  const reader = response.body?.getReader();

  if (!reader) {
    return { text: '', byteLength: 0 };
  }
  const bytes = new Uint8Array(maximumBytes);
  let byteLength = 0;

  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;

      try {
        // eslint-disable-next-line no-await-in-loop -- response chunks must be consumed in wire order.
        result = await reader.read();
      } catch (error) {
        throw new BoundedReadError(`${label} could not be read completely: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (result.done) {
        break;
      }
      const nextByteLength = byteLength + result.value.byteLength;

      if (nextByteLength > maximumBytes) {
        try {
          // eslint-disable-next-line no-await-in-loop -- cancel immediately once the byte ceiling is crossed.
          await reader.cancel();
        } catch {
          // Preserve the size-limit failure if the transport also rejects cancellation.
        }
        throw new BoundedReadError(sizeLimitMessage(label, maximumBytes));
      }
      bytes.set(result.value, byteLength);
      byteLength = nextByteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return { text: decodeUtf8(bytes.subarray(0, byteLength), label), byteLength };
}

async function readBoundedFileText(file: string, maximumBytes: number, label: string): Promise<BoundedText> {
  const fileStatus = await stat(file);

  if (!fileStatus.isFile()) {
    throw new Error(`${label} is not a regular file.`);
  }
  if (!Number.isSafeInteger(fileStatus.size) || fileStatus.size < 0) {
    throw new Error(`${label} has an invalid file size.`);
  }
  if (fileStatus.size > maximumBytes) {
    throw new BoundedReadError(sizeLimitMessage(label, maximumBytes));
  }
  const stream = createReadStream(file, { highWaterMark: 64 * 1_024 });
  const contents = new Uint8Array(fileStatus.size);
  let byteLength = 0;

  try {
    for await (const chunk of stream) {
      const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk), 'utf8');
      const nextByteLength = byteLength + bytes.byteLength;

      if (nextByteLength > maximumBytes) {
        stream.destroy();
        throw new BoundedReadError(sizeLimitMessage(label, maximumBytes));
      }
      if (nextByteLength > fileStatus.size) {
        stream.destroy();
        throw new Error(`${label} grew beyond its initial ${fileStatus.size.toLocaleString()}-byte size while being read.`);
      }
      contents.set(bytes, byteLength);
      byteLength = nextByteLength;
    }
  } catch (error) {
    if (error instanceof BoundedReadError) {
      throw error;
    }
    throw new Error(`${label} could not be read completely: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (byteLength !== fileStatus.size) {
    throw new Error(`${label} changed size while being read (${fileStatus.size.toLocaleString()} to ${byteLength.toLocaleString()} bytes).`);
  }

  return { text: decodeUtf8(contents, label), byteLength };
}

function isoTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be an ISO timestamp.`);
  }
  const instant = new Date(value);

  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp.`);
  }

  return value;
}

function normalizeCatalogId(value: string, field: string): string {
  const trimmed = value.trim();

  if (!(/^\d+$/u).test(trimmed)) {
    throw new Error(`${field} must be a digit string.`);
  }
  const normalized = trimmed.replace(/^0+(?=\d)/u, '');

  if (!(/^[1-9]\d{0,8}$/u).test(normalized)) {
    throw new Error(`${field} must identify a catalog object with at most 9 digits.`);
  }

  return normalized;
}

function finiteNumber(value: string, field: string, maximum = Number.POSITIVE_INFINITY): number {
  const trimmed = value.trim();

  if (trimmed === '') {
    throw new Error(`${field} is required.`);
  }
  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${field} must be a finite number between 0 and ${maximum}.`);
  }

  return parsed;
}

function parseTca(value: string): string {
  const match = (/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})\.(?<millisecond>\d{3})$/u)
    .exec(value.trim());

  if (!match?.groups) {
    throw new Error('TCA must use the CelesTrak UTC format YYYY-MM-DD HH:mm:ss.sss.');
  }
  const { year: yearPart, month: monthPart, day: dayPart, hour: hourPart, minute: minutePart, second: secondPart, millisecond: millisecondPart } = match.groups;
  const parts = [yearPart, monthPart, dayPart, hourPart, minutePart, secondPart, millisecondPart].map(Number);
  const [year, month, day, hour, minute, second, millisecond] = parts;
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day ||
    instant.getUTCHours() !== hour ||
    instant.getUTCMinutes() !== minute ||
    instant.getUTCSeconds() !== second ||
    instant.getUTCMilliseconds() !== millisecond
  ) {
    throw new Error('TCA is not a valid UTC instant.');
  }

  return instant.toISOString();
}

function canonicalPairKey(firstId: string, secondId: string, tca: string): string {
  const [lowerId, higherId] = [firstId, secondId].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

  return `${lowerId}:${higherId}:${tca}`;
}

function conjunctionFromRow(row: SocratesCsvRow, rowNumber: number): { conjunction: ConjunctionV1; pairKey: string } {
  try {
    const firstId = normalizeCatalogId(row.NORAD_CAT_ID_1, 'NORAD_CAT_ID_1');
    const secondId = normalizeCatalogId(row.NORAD_CAT_ID_2, 'NORAD_CAT_ID_2');

    if (firstId === secondId) {
      throw new Error(`self-conjunction for catalog ID ${firstId}`);
    }
    const firstName = row.OBJECT_NAME_1.trim();
    const secondName = row.OBJECT_NAME_2.trim();

    if (!firstName || !secondName || firstName.length > 200 || secondName.length > 200) {
      throw new Error('object names are required and cannot exceed 200 characters');
    }
    const tca = parseTca(row.TCA);
    const pairKey = canonicalPairKey(firstId, secondId, tca);

    return {
      pairKey,
      conjunction: {
        id: sha256(pairKey).slice(0, 24),
        object1: {
          catalogId: firstId,
          name: firstName,
          dseDays: finiteNumber(row.DSE_1, 'DSE_1'),
        },
        object2: {
          catalogId: secondId,
          name: secondName,
          dseDays: finiteNumber(row.DSE_2, 'DSE_2'),
        },
        timeOfClosestApproach: tca,
        missDistanceKm: finiteNumber(row.TCA_RANGE, 'TCA_RANGE'),
        relativeSpeedKmS: finiteNumber(row.TCA_RELATIVE_SPEED, 'TCA_RELATIVE_SPEED'),
        maximumProbability: finiteNumber(row.MAX_PROB, 'MAX_PROB', 1),
        dilutionThreshold: finiteNumber(row.DILUTION, 'DILUTION'),
      },
    };
  } catch (error) {
    throw new Error(`SOCRATES row ${rowNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function compareRisk(left: ConjunctionV1, right: ConjunctionV1): number {
  return right.maximumProbability - left.maximumProbability ||
    left.missDistanceKm - right.missDistanceKm ||
    left.timeOfClosestApproach.localeCompare(right.timeOfClosestApproach) ||
    left.id.localeCompare(right.id);
}

function assertExpectedHeaders(fields: string[] | undefined): void {
  const normalized = fields?.map((field, index) => (index === 0 ? field.replace(/^\uFEFF/u, '') : field).trim()) ?? [];

  if (normalized.length !== EXPECTED_HEADERS.length || normalized.some((field, index) => field !== EXPECTED_HEADERS[index])) {
    throw new Error(`SOCRATES CSV header changed. Expected: ${EXPECTED_HEADERS.join(',')}. Received: ${normalized.join(',')}.`);
  }
}

export function parseSocratesCsv(raw: string, options: ParseSocratesOptions): SocratesFeedV1 {
  if (!Number.isFinite(options.now.getTime())) {
    throw new TypeError('SOCRATES refresh time is invalid.');
  }
  const parsed = Papa.parse<SocratesCsvRow>(raw, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header, index) => (index === 0 ? header.replace(/^\uFEFF/u, '') : header).trim(),
  });

  assertExpectedHeaders(parsed.meta.fields);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];

    throw new Error(`SOCRATES CSV row ${first.row ?? '?'}: ${first.message}`);
  }
  const pairKeys = new Set<string>();
  const futureConjunctions = parsed.data.map((row, index) => conjunctionFromRow(row, index + 2)).filter(({ conjunction, pairKey }) => {
    if (pairKeys.has(pairKey)) {
      throw new Error(`SOCRATES CSV contains duplicate unordered pair and TCA: ${pairKey}.`);
    }
    pairKeys.add(pairKey);

    return new Date(conjunction.timeOfClosestApproach).getTime() > options.now.getTime();
  }).map(({ conjunction }) => conjunction);

  if (futureConjunctions.length === 0) {
    throw new Error('SOCRATES source contains no future conjunctions; previous snapshot retained.');
  }
  const conjunctions = futureConjunctions.sort(compareRisk).slice(0, SOCRATES_MAX_CONJUNCTIONS);
  const snapshotId = `socrates-${options.source.updatedAt.slice(0, 10)}-${options.source.checksum.slice(0, 12)}`;
  const feed: SocratesFeedV1 = {
    schemaVersion: 1,
    snapshotId,
    generatedAt: options.source.updatedAt,
    source: options.source,
    conjunctions,
  };

  validateSocratesFeed(feed);

  return feed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], field: string): void {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'));
  const canonical = [...expected].sort((left, right) => left.localeCompare(right, 'en'));

  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${field} has unexpected fields. Expected: ${canonical.join(',')}. Received: ${actual.join(',')}.`);
  }
}

function validateConjunctionObject(value: unknown, field: string): asserts value is ConjunctionObjectV1 {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object.`);
  }
  assertExactKeys(value, ['catalogId', 'name', 'dseDays'], field);
  if (typeof value.catalogId !== 'string' || normalizeCatalogId(value.catalogId, `${field}.catalogId`) !== value.catalogId) {
    throw new Error(`${field}.catalogId must be a normalized digit string.`);
  }
  if (
    typeof value.name !== 'string' ||
    value.name.trim() === '' ||
    value.name !== value.name.trim() ||
    value.name.length > 200
  ) {
    throw new Error(`${field}.name must be a trimmed string of at most 200 characters.`);
  }
  if (typeof value.dseDays !== 'number' || !Number.isFinite(value.dseDays) || value.dseDays < 0) {
    throw new Error(`${field}.dseDays must be a nonnegative finite number.`);
  }
}

function validateConjunction(value: unknown, index: number): asserts value is ConjunctionV1 {
  if (!isRecord(value)) {
    throw new Error(`conjunctions[${index}] must be an object.`);
  }
  assertExactKeys(value, [
    'id',
    'object1',
    'object2',
    'timeOfClosestApproach',
    'missDistanceKm',
    'relativeSpeedKmS',
    'maximumProbability',
    'dilutionThreshold',
  ], `conjunctions[${index}]`);
  if (typeof value.id !== 'string' || !(/^[a-f0-9]{24}$/u).test(value.id)) {
    throw new Error(`conjunctions[${index}].id must be a 24-character lowercase hex identifier.`);
  }
  validateConjunctionObject(value.object1, `conjunctions[${index}].object1`);
  validateConjunctionObject(value.object2, `conjunctions[${index}].object2`);
  if (value.object1.catalogId === value.object2.catalogId) {
    throw new Error(`conjunctions[${index}] cannot pair an object with itself.`);
  }
  isoTimestamp(value.timeOfClosestApproach, `conjunctions[${index}].timeOfClosestApproach`);
  const metrics = ['missDistanceKm', 'relativeSpeedKmS', 'maximumProbability', 'dilutionThreshold'] as const;

  metrics.forEach((metric) => {
    const number = value[metric];

    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || (metric === 'maximumProbability' && number > 1)) {
      throw new Error(`conjunctions[${index}].${metric} is outside its valid range.`);
    }
  });
}

export function validateSocratesFeed(value: unknown): asserts value is SocratesFeedV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('SOCRATES feed must use schemaVersion 1.');
  }
  assertExactKeys(value, ['schemaVersion', 'snapshotId', 'generatedAt', 'source', 'conjunctions'], 'SOCRATES feed');
  if (typeof value.snapshotId !== 'string' || !(/^socrates-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/u).test(value.snapshotId)) {
    throw new Error('SOCRATES feed has an invalid snapshotId.');
  }
  const generatedAt = isoTimestamp(value.generatedAt, 'generatedAt');

  if (!isRecord(value.source)) {
    throw new Error('SOCRATES feed source is required.');
  }
  assertExactKeys(value.source, ['provider', 'rawUrl', 'updatedAt', 'retrievedAt', 'checksum'], 'source');
  if (value.source.provider !== 'CelesTrak' || value.source.rawUrl !== SOCRATES_RAW_URL) {
    throw new Error('SOCRATES feed must identify the official CelesTrak raw source.');
  }
  const updatedAt = isoTimestamp(value.source.updatedAt, 'source.updatedAt');

  isoTimestamp(value.source.retrievedAt, 'source.retrievedAt');
  if (Date.parse(updatedAt) > Date.parse(value.source.retrievedAt)) {
    throw new Error('SOCRATES provider update time cannot be after its retrieval time.');
  }
  if (typeof value.source.checksum !== 'string' || !(/^[a-f0-9]{64}$/u).test(value.source.checksum)) {
    throw new Error('SOCRATES source checksum must be a lowercase SHA-256 digest.');
  }
  if (generatedAt !== updatedAt) {
    throw new Error('SOCRATES generatedAt must match the provider update timestamp.');
  }
  const expectedSnapshotId = `socrates-${updatedAt.slice(0, 10)}-${value.source.checksum.slice(0, 12)}`;

  if (value.snapshotId !== expectedSnapshotId) {
    throw new Error(`SOCRATES snapshotId must match source provenance (${expectedSnapshotId}).`);
  }
  if (!Array.isArray(value.conjunctions) || value.conjunctions.length < 1 || value.conjunctions.length > SOCRATES_MAX_CONJUNCTIONS) {
    throw new Error(`SOCRATES feed must contain between 1 and ${SOCRATES_MAX_CONJUNCTIONS} conjunctions.`);
  }
  const identifiers = new Set<string>();
  const pairKeys = new Set<string>();

  value.conjunctions.forEach((conjunction, index) => {
    validateConjunction(conjunction, index);
    const pairKey = canonicalPairKey(
      conjunction.object1.catalogId,
      conjunction.object2.catalogId,
      conjunction.timeOfClosestApproach,
    );
    const expectedId = sha256(pairKey).slice(0, 24);

    if (identifiers.has(conjunction.id) || pairKeys.has(pairKey)) {
      throw new Error(`SOCRATES feed contains a duplicate conjunction at index ${index}.`);
    }
    if (conjunction.id !== expectedId) {
      throw new Error(`SOCRATES conjunction at index ${index} has an unstable identifier.`);
    }
    if (index > 0 && compareRisk(value.conjunctions[index - 1], conjunction) > 0) {
      throw new Error(`SOCRATES conjunctions are not in risk order at index ${index}.`);
    }
    identifiers.add(conjunction.id);
    pairKeys.add(pairKey);
  });
}

function providerTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('SOCRATES FILE_MTIME is missing.');
  }
  const match = (/^(?<date>\d{4}-\d{2}-\d{2}) (?<time>\d{2}:\d{2}:\d{2}) UTC$/u).exec(value);

  if (!match?.groups) {
    throw new Error(`SOCRATES FILE_MTIME has an unexpected format: ${value}.`);
  }
  const canonical = `${match.groups.date}T${match.groups.time}.000Z`;
  const timestamp = new Date(canonical);

  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== canonical) {
    throw new Error(`SOCRATES FILE_MTIME is invalid: ${value}.`);
  }

  return timestamp.toISOString();
}

function parseProviderMetadata(raw: string): ProviderMetadata {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('SOCRATES metadata is not valid JSON.');
  }
  if (!Array.isArray(decoded)) {
    throw new TypeError('SOCRATES metadata must be an array.');
  }
  const entry = decoded.find((candidate) => isRecord(candidate) && candidate.FILE_NAME === 'sort-minRange.csv');

  if (!isRecord(entry) || typeof entry.FILE_SIZE !== 'number' || !Number.isSafeInteger(entry.FILE_SIZE) || entry.FILE_SIZE <= 0) {
    throw new Error('SOCRATES metadata does not contain a valid sort-minRange.csv entry.');
  }

  return { updatedAt: providerTimestamp(entry.FILE_MTIME), size: entry.FILE_SIZE };
}

function cacheMetadata(value: unknown): CacheMetadata | null {
  if (!isRecord(value) ||
    value.schemaVersion !== CACHE_SCHEMA_VERSION ||
    value.rawUrl !== SOCRATES_RAW_URL ||
    value.metadataUrl !== SOCRATES_METADATA_URL ||
    typeof value.updatedAt !== 'string' ||
    typeof value.retrievedAt !== 'string' ||
    typeof value.checkedAt !== 'string' ||
    typeof value.checksum !== 'string' ||
    !(/^[a-f0-9]{64}$/u).test(value.checksum) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0) {
    return null;
  }

  try {
    isoTimestamp(value.updatedAt, 'cache.updatedAt');
    isoTimestamp(value.retrievedAt, 'cache.retrievedAt');
    isoTimestamp(value.checkedAt, 'cache.checkedAt');
  } catch {
    return null;
  }

  return value as unknown as CacheMetadata;
}

async function readCache(directory: string): Promise<{ raw: string; metadata: CacheMetadata } | null> {
  try {
    const [rawSource, metadataSource] = await Promise.all([
      readBoundedFileText(path.join(directory, 'socrates.csv'), SOCRATES_MAX_SOURCE_BYTES, 'SOCRATES cached source'),
      readBoundedFileText(path.join(directory, 'socrates.metadata.json'), SOCRATES_MAX_METADATA_BYTES, 'SOCRATES cache metadata'),
    ]);
    const metadata = cacheMetadata(JSON.parse(metadataSource.text));

    if (metadata?.size !== rawSource.byteLength || sha256(rawSource.text) !== metadata.checksum) {
      return null;
    }

    return { raw: rawSource.text, metadata };
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  const temporary = `${file}.satglobe-${process.pid}.tmp`;

  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, file);
}

async function writeCache(directory: string, raw: string, metadata: CacheMetadata, writeRaw: boolean): Promise<void> {
  await mkdir(directory, { recursive: true });
  if (writeRaw) {
    await writeAtomic(path.join(directory, 'socrates.csv'), raw);
  }
  await writeAtomic(path.join(directory, 'socrates.metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function fetchResponse(url: string, fetchSource: typeof fetch): Promise<Response> {
  const response = await fetchSource(url, {
    headers: { 'user-agent': 'SatGlobe SOCRATES refresh (manual local command)' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const requestedUrl = new URL(url);

  if (response.redirected || (response.url && new URL(response.url).origin !== requestedUrl.origin)) {
    throw new Error(`SOCRATES source response left the official CelesTrak origin: ${url}`);
  }

  if (!response.ok) {
    let providerMessage: string;

    try {
      providerMessage = (await readBoundedResponseText(
        response,
        SOCRATES_MAX_ERROR_BODY_BYTES,
        `SOCRATES HTTP ${response.status} error body`,
      )).text.trim();
    } catch (error) {
      throw new Error(
        `SOCRATES source returned HTTP ${response.status}: ${url}\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const providerDetails = providerMessage ? `\n${providerMessage}` : '';

    throw new Error(`SOCRATES source returned HTTP ${response.status}: ${url}${providerDetails}`);
  }

  return response;
}

function loadedFromCache(cache: { raw: string; metadata: CacheMetadata }): LoadedSocratesSource {
  return {
    raw: cache.raw,
    source: {
      provider: 'CelesTrak',
      rawUrl: SOCRATES_RAW_URL,
      updatedAt: cache.metadata.updatedAt,
      retrievedAt: cache.metadata.retrievedAt,
      checksum: cache.metadata.checksum,
    },
  };
}

function validatedLoadedSource(loaded: LoadedSocratesSource, now: Date): LoadedSocratesSource {
  parseSocratesCsv(loaded.raw, { now, source: loaded.source });

  return loaded;
}

async function loadLocalSource(
  input: string,
  inputUpdatedAt: string | undefined,
  inputRetrievedAt: string | undefined,
  now: Date,
): Promise<LoadedSocratesSource> {
  const file = path.resolve(input);
  const raw = (await readBoundedFileText(file, SOCRATES_MAX_SOURCE_BYTES, 'SOCRATES input')).text;

  if (!inputUpdatedAt) {
    throw new Error('A local SOCRATES input requires its provider FILE_MTIME via --socrates-updated-at.');
  }
  if (!inputRetrievedAt) {
    throw new Error('A local SOCRATES input requires its original retrieval time via --socrates-retrieved-at.');
  }
  const updatedAt = isoTimestamp(inputUpdatedAt, 'SOCRATES input provider update time');
  const retrievedAt = isoTimestamp(inputRetrievedAt, 'SOCRATES input retrieval time');

  if (Date.parse(updatedAt) > Date.parse(retrievedAt)) {
    throw new Error('SOCRATES input provider update time cannot be after its retrieval time.');
  }
  if (Date.parse(retrievedAt) > now.getTime()) {
    throw new Error('SOCRATES input retrieval time cannot be in the future.');
  }

  return {
    raw,
    source: {
      provider: 'CelesTrak',
      rawUrl: SOCRATES_RAW_URL,
      updatedAt,
      retrievedAt,
      checksum: sha256(raw),
    },
  };
}

export async function loadSocratesSource(options: LoadSocratesOptions = {}): Promise<LoadedSocratesSource> {
  const now = options.now ?? new Date();

  if (!Number.isFinite(now.getTime())) {
    throw new TypeError('SOCRATES retrieval time is invalid.');
  }
  if (options.input) {
    return validatedLoadedSource(await loadLocalSource(
      options.input,
      options.inputUpdatedAt,
      options.inputRetrievedAt,
      now,
    ), now);
  }
  const directory = options.cacheDirectory ?? path.resolve('.cache/satglobe');
  const fetchSource = options.fetchSource ?? fetch;
  const cached = await readCache(directory);
  const cachedAge = cached ? now.getTime() - new Date(cached.metadata.checkedAt).getTime() : Number.POSITIVE_INFINITY;

  if (cached && cachedAge >= 0 && cachedAge <= SOCRATES_CACHE_MAX_AGE_MS) {
    return validatedLoadedSource(loadedFromCache(cached), now);
  }
  const metadataResponse = await fetchResponse(SOCRATES_METADATA_URL, fetchSource);
  const provider = parseProviderMetadata((await readBoundedResponseText(
    metadataResponse,
    SOCRATES_MAX_METADATA_BYTES,
    'SOCRATES metadata response',
  )).text);

  if (cached?.metadata.updatedAt === provider.updatedAt && cached.metadata.size === provider.size) {
    const loaded = validatedLoadedSource(loadedFromCache(cached), now);

    if (options.writeCache !== false) {
      await writeCache(directory, cached.raw, { ...cached.metadata, checkedAt: now.toISOString() }, false);
    }

    return loaded;
  }
  if (provider.size > SOCRATES_MAX_SOURCE_BYTES) {
    throw new Error(`SOCRATES metadata reports ${provider.size.toLocaleString()} bytes; safety limit is ${SOCRATES_MAX_SOURCE_BYTES.toLocaleString()}.`);
  }
  const rawResponse = await fetchResponse(SOCRATES_RAW_URL, fetchSource);
  const rawSource = await readBoundedResponseText(rawResponse, provider.size, 'SOCRATES raw response');
  const raw = rawSource.text;
  const size = rawSource.byteLength;

  if (size !== provider.size) {
    throw new Error(`SOCRATES download size ${size.toLocaleString()} does not match provider metadata ${provider.size.toLocaleString()}.`);
  }
  const retrievedAt = now.toISOString();
  const metadata: CacheMetadata = {
    schemaVersion: 1,
    rawUrl: SOCRATES_RAW_URL,
    metadataUrl: SOCRATES_METADATA_URL,
    updatedAt: provider.updatedAt,
    retrievedAt,
    checkedAt: retrievedAt,
    checksum: sha256(raw),
    size,
  };
  const loaded = validatedLoadedSource(loadedFromCache({ raw, metadata }), now);

  if (options.writeCache !== false) {
    await writeCache(directory, raw, metadata, true);
  }

  return loaded;
}

export async function buildSocratesFeed(options: LoadSocratesOptions = {}): Promise<SocratesFeedV1> {
  const now = options.now ?? new Date();
  const loaded = await loadSocratesSource({ ...options, now });

  return parseSocratesCsv(loaded.raw, { now, source: loaded.source });
}
