import { z } from 'zod';
import type {
  AvailableConjunctionState,
  ConjunctionFeedV1,
  ConjunctionLoadingState,
  ConjunctionObjectRef,
  ConjunctionSource,
  ConjunctionUnavailableState,
  ResolvedConjunctionObject,
  ResolvedConjunctionPair,
  SpaceObjectView,
} from './types';

const catalogIdSchema = z.string().regex(/^[1-9]\d{0,8}$/u, 'Expected a normalized numeric catalog id');
const objectRefSchema = z.object({
  catalogId: catalogIdSchema,
  name: z.string().trim().min(1).max(200),
  dseDays: z.number().finite().nonnegative(),
}).strict();
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 checksum');

const conjunctionPairSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/u, 'Expected a stable 24-character hex id'),
  object1: objectRefSchema,
  object2: objectRefSchema,
  timeOfClosestApproach: z.iso.datetime(),
  missDistanceKm: z.number().finite().nonnegative(),
  relativeSpeedKmS: z.number().finite().nonnegative(),
  maximumProbability: z.number().finite().min(0).max(1),
  dilutionThreshold: z.number().finite().nonnegative(),
}).strict();

const conjunctionSourceSchema = z.object({
  provider: z.literal('CelesTrak'),
  rawUrl: z.literal('https://celestrak.org/SOCRATES/sort-minRange.csv'),
  updatedAt: z.iso.datetime(),
  retrievedAt: z.iso.datetime(),
  checksum: checksumSchema,
}).strict();

/** Strict browser artifact schema. The refresh pipeline refuses empty feeds and caps output at 25 events. */
export const conjunctionFeedV1Schema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string().regex(
    /^socrates-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/u,
    'Expected a stable SOCRATES snapshot id',
  ),
  generatedAt: z.iso.datetime(),
  source: conjunctionSourceSchema,
  conjunctions: z.array(conjunctionPairSchema).min(1).max(25),
}).strict().superRefine((feed, context) => {
  const expectedSnapshotId = `socrates-${feed.source.updatedAt.slice(0, 10)}-${feed.source.checksum.slice(0, 12)}`;

  if (feed.snapshotId !== expectedSnapshotId) {
    context.addIssue({
      code: 'custom',
      message: 'Snapshot id must identify the provider update date and source checksum',
      path: ['snapshotId'],
    });
  }
  if (feed.generatedAt !== feed.source.updatedAt) {
    context.addIssue({
      code: 'custom',
      message: 'Generated time must match the provider update time',
      path: ['generatedAt'],
    });
  }
  if (Date.parse(feed.source.updatedAt) > Date.parse(feed.source.retrievedAt)) {
    context.addIssue({
      code: 'custom',
      message: 'Provider update time cannot be after retrieval time',
      path: ['source', 'updatedAt'],
    });
  }

  const ids = new Set<string>();
  const encounters = new Set<string>();

  feed.conjunctions.forEach((pair, index) => {
    if (pair.object1.catalogId === pair.object2.catalogId) {
      context.addIssue({ code: 'custom', message: 'A conjunction cannot pair an object with itself', path: ['conjunctions', index] });
    }
    if (ids.has(pair.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate conjunction id ${pair.id}`, path: ['conjunctions', index, 'id'] });
    }
    ids.add(pair.id);

    const unorderedIds = [pair.object1.catalogId, pair.object2.catalogId].sort().join(':');
    const encounter = `${unorderedIds}:${pair.timeOfClosestApproach}`;

    if (encounters.has(encounter)) {
      context.addIssue({ code: 'custom', message: 'Duplicate object pair and TCA', path: ['conjunctions', index] });
    }
    encounters.add(encounter);
  });
});

/** Provider update age allowed before a still-upcoming feed is described as stale. */
export const CONJUNCTION_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

const EMPTY_CONJUNCTIONS = Object.freeze([]) as readonly ResolvedConjunctionPair[];
const EMPTY_CATALOG_IDS = Object.freeze([]) as readonly string[];

/** Safe immutable engine state before the deferred same-origin load settles. */
export const INITIAL_CONJUNCTION_STATE: ConjunctionLoadingState = Object.freeze({
  status: 'loading',
  conjunctions: EMPTY_CONJUNCTIONS,
  lensPairCount: 0,
  catalogIds: EMPTY_CATALOG_IDS,
  droppedPairCount: 0,
  source: null,
  error: null,
});

export type AvailableConjunctionStatus = AvailableConjunctionState['status'];

/** Converts an injected wall clock to milliseconds and rejects invalid test/consumer input. */
function clockMs(now: Date): number {
  const value = now.getTime();

  if (!Number.isFinite(value)) {
    throw new RangeError('Conjunction clock must be a valid date.');
  }

  return value;
}

/** Classifies freshness from provider `updatedAt`; retrieval time never makes old source data current. */
export function classifyConjunctionFeed(feed: ConjunctionFeedV1, now: Date): AvailableConjunctionStatus {
  const nowMs = clockMs(now);
  const hasUpcoming = feed.conjunctions.some(({ timeOfClosestApproach }) => Date.parse(timeOfClosestApproach) >= nowMs);

  if (!hasUpcoming) {
    return 'archival';
  }

  return nowMs - Date.parse(feed.source.updatedAt) > CONJUNCTION_STALE_AFTER_MS ? 'stale' : 'current';
}

/** Reclassifies resolved data and rebuilds its lens population at temporal boundaries. */
export function refreshAvailableConjunctionState(
  state: AvailableConjunctionState,
  now: Date,
): AvailableConjunctionState {
  const nowMs = clockMs(now);
  const upcoming = state.conjunctions.filter(
    ({ timeOfClosestApproach }) => Date.parse(timeOfClosestApproach) >= nowMs,
  );
  let status: AvailableConjunctionStatus = 'archival';

  if (upcoming.length > 0) {
    status = nowMs - Date.parse(state.source.updatedAt) > CONJUNCTION_STALE_AFTER_MS ? 'stale' : 'current';
  }
  const lensPairs = status === 'archival' ? state.conjunctions : upcoming;
  const catalogIds = [...new Set(lensPairs.flatMap(({ object1, object2 }) => [object1.catalogId, object2.catalogId]))];
  const unchanged = status === state.status &&
    lensPairs.length === state.lensPairCount &&
    catalogIds.length === state.catalogIds.length &&
    catalogIds.every((catalogId, index) => catalogId === state.catalogIds[index]);

  return unchanged ? state : {
    ...state,
    status,
    lensPairCount: lensPairs.length,
    catalogIds,
  };
}

/** Resolves and memoizes one feed reference without trusting a mismatched lookup result. */
function resolveObject(
  ref: ConjunctionObjectRef,
  lookup: (catalogId: string) => SpaceObjectView | undefined,
  cache: Map<string, SpaceObjectView | null>,
): ResolvedConjunctionObject | null {
  if (!cache.has(ref.catalogId)) {
    const object = lookup(ref.catalogId);

    cache.set(ref.catalogId, object?.catalogId === ref.catalogId ? object : null);
  }
  const object = cache.get(ref.catalogId);

  return object ? { ...ref, object } : null;
}

/** Resolves feed ids once against the installed catalog and drops incomplete pairs as one unit. */
export function resolveConjunctionFeed(
  feed: ConjunctionFeedV1,
  lookup: (catalogId: string) => SpaceObjectView | undefined,
  now: Date,
): AvailableConjunctionState {
  clockMs(now);
  const objectCache = new Map<string, SpaceObjectView | null>();
  const conjunctions: ResolvedConjunctionPair[] = [];
  let droppedPairCount = 0;

  for (const pair of feed.conjunctions) {
    const object1 = resolveObject(pair.object1, lookup, objectCache);
    const object2 = resolveObject(pair.object2, lookup, objectCache);

    if (!object1 || !object2) {
      droppedPairCount++;
      continue;
    }
    conjunctions.push({ ...pair, object1, object2 });
  }

  return refreshAvailableConjunctionState({
    status: 'archival',
    conjunctions,
    lensPairCount: 0,
    catalogIds: EMPTY_CATALOG_IDS,
    droppedPairCount,
    source: feed.source,
    error: null,
  }, now);
}

/** Builds the only nonfatal loader-error state accepted at the engine/UI boundary. */
export function createUnavailableConjunctionState(
  error: string,
  source: ConjunctionSource | null = null,
): ConjunctionUnavailableState {
  return {
    status: 'unavailable',
    conjunctions: EMPTY_CONJUNCTIONS,
    lensPairCount: 0,
    catalogIds: EMPTY_CATALOG_IDS,
    droppedPairCount: 0,
    source,
    error: error.trim() || 'Conjunction data is unavailable.',
  };
}

export interface SelectedConjunction {
  pair: ResolvedConjunctionPair;
  selectedObject: ResolvedConjunctionObject;
  otherObject: ResolvedConjunctionObject;
  temporalLabel: 'next' | 'latest';
}

/** Finds the selected object's next future encounter, or its latest past encounter, without assigning pair roles. */
export function findSelectedConjunction(
  conjunctions: readonly ResolvedConjunctionPair[],
  selectedCatalogId: string,
  now: Date,
): SelectedConjunction | null {
  const nowMs = clockMs(now);
  let next: SelectedConjunction | null = null;
  let nextMs = Number.POSITIVE_INFINITY;
  let latest: SelectedConjunction | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const pair of conjunctions) {
    const selectedIsObject1 = pair.object1.catalogId === selectedCatalogId;
    const selectedIsObject2 = pair.object2.catalogId === selectedCatalogId;

    if (!selectedIsObject1 && !selectedIsObject2) {
      continue;
    }
    const tcaMs = Date.parse(pair.timeOfClosestApproach);
    const oriented = {
      pair,
      selectedObject: selectedIsObject1 ? pair.object1 : pair.object2,
      otherObject: selectedIsObject1 ? pair.object2 : pair.object1,
    };

    if (tcaMs >= nowMs && tcaMs < nextMs) {
      next = { ...oriented, temporalLabel: 'next' };
      nextMs = tcaMs;
    } else if (tcaMs < nowMs && tcaMs > latestMs) {
      latest = { ...oriented, temporalLabel: 'latest' };
      latestMs = tcaMs;
    }
  }

  return next ?? latest;
}
