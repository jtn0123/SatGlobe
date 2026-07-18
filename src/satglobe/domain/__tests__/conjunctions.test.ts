import { describe, expect, it, vi } from 'vitest';
import {
  CONJUNCTION_STALE_AFTER_MS,
  INITIAL_CONJUNCTION_STATE,
  classifyConjunctionFeed,
  conjunctionFeedV1Schema,
  createUnavailableConjunctionState,
  findSelectedConjunction,
  refreshAvailableConjunctionState,
  resolveConjunctionFeed,
} from '../conjunctions';
import type {
  ConjunctionFeedV1,
  ConjunctionPair,
  ResolvedConjunctionPair,
  SpaceObjectView,
} from '../types';

const CHECKSUM = 'c'.repeat(64);

/** Builds one valid feed-side encounter with explicit per-test overrides. */
function pair(overrides: Partial<ConjunctionPair> = {}): ConjunctionPair {
  return {
    id: 'a'.repeat(24),
    object1: { catalogId: '100', name: 'OBJECT ONE', dseDays: 1.25 },
    object2: { catalogId: '200', name: 'OBJECT TWO', dseDays: 2.5 },
    timeOfClosestApproach: '2026-07-19T00:00:00.000Z',
    missDistanceKm: 0,
    relativeSpeedKmS: 0,
    maximumProbability: 0,
    dilutionThreshold: 0,
    ...overrides,
  };
}

/** Builds a strict v1 fixture around the supplied encounters. */
function feed(conjunctions: ConjunctionPair[] = [pair()]): ConjunctionFeedV1 {
  return {
    schemaVersion: 1,
    snapshotId: `socrates-2026-07-18-${CHECKSUM.slice(0, 12)}`,
    generatedAt: '2026-07-18T00:00:00.000Z',
    source: {
      provider: 'CelesTrak',
      rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
      updatedAt: '2026-07-18T00:00:00.000Z',
      retrievedAt: '2026-07-18T00:01:00.000Z',
      checksum: CHECKSUM,
    },
    conjunctions,
  };
}

/** Builds the smallest complete installed-catalog view used by resolver tests. */
function object(catalogId: string, name = `Catalog ${catalogId}`): SpaceObjectView {
  return {
    catalogId,
    name,
    kind: 'payload',
    active: true,
    status: 'Operational',
    internationalDesignator: '',
    launchDate: '',
    launchVehicle: '',
    owner: '',
    country: '',
    source: '',
    epoch: '2026-07-17T00:00:00.000Z',
    apogeeKm: 500,
    perigeeKm: 490,
    inclinationDeg: 51.6,
    periodMinutes: 92,
    regime: 'leo',
    isStarlink: false,
    nameText: name.toLowerCase(),
    launchText: '',
    ownershipText: '',
    searchText: name.toLowerCase(),
  };
}

/** Builds a resolved pair in either object orientation for selected-object tests. */
function resolvedPair(
  timeOfClosestApproach: string,
  object1Id = '100',
  object2Id = '200',
): ResolvedConjunctionPair {
  const source = pair({
    id: timeOfClosestApproach.includes('19T') ? 'b'.repeat(24) : 'd'.repeat(24),
    object1: { catalogId: object1Id, name: `Source ${object1Id}`, dseDays: 1 },
    object2: { catalogId: object2Id, name: `Source ${object2Id}`, dseDays: 2 },
    timeOfClosestApproach,
  });

  return {
    ...source,
    object1: { ...source.object1, object: object(object1Id) },
    object2: { ...source.object2, object: object(object2Id) },
  };
}

describe('conjunctionFeedV1Schema', () => {
  it('accepts the exact v1 artifact including truthful zero-valued metrics', () => {
    expect(conjunctionFeedV1Schema.parse(feed())).toEqual(feed());
  });

  it('rejects unknown fields, invalid bounds, unnormalized ids, empty feeds, and more than 25 events', () => {
    const extra = { ...feed(), unexpected: true };
    const badProbability = feed([pair({ maximumProbability: 1.01 })]);
    const unnormalizedId = feed([pair({ object1: { catalogId: '000100', name: 'OBJECT ONE', dseDays: 1 } })]);
    const empty = feed([]);
    const oversized = feed(Array.from({ length: 26 }, (_, index) => pair({
      id: index.toString(16).padStart(24, '0'),
      timeOfClosestApproach: `2026-07-19T00:${String(index).padStart(2, '0')}:00.000Z`,
    })));

    expect(conjunctionFeedV1Schema.safeParse(extra).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(badProbability).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(unnormalizedId).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(empty).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(oversized).success).toBe(false);
  });

  it('rejects self-pairs, duplicate ids, unordered duplicate pair/TCAs, and mismatched snapshot checksums', () => {
    const selfPair = pair({ object2: { catalogId: '100', name: 'ALSO ONE', dseDays: 2 } });
    const duplicateId = pair({ timeOfClosestApproach: '2026-07-19T01:00:00.000Z' });
    const duplicateEncounter = pair({
      id: 'b'.repeat(24),
      object1: pair().object2,
      object2: pair().object1,
    });
    const wrongSnapshot = feed();
    const wrongGeneratedAt = feed();
    const updateAfterRetrieval = feed();

    wrongSnapshot.snapshotId = `socrates-2026-07-18-${'d'.repeat(12)}`;
    wrongGeneratedAt.generatedAt = '2026-07-18T00:02:00.000Z';
    updateAfterRetrieval.generatedAt = '2099-01-01T00:00:00.000Z';
    updateAfterRetrieval.source.updatedAt = updateAfterRetrieval.generatedAt;
    updateAfterRetrieval.snapshotId = `socrates-2099-01-01-${CHECKSUM.slice(0, 12)}`;

    expect(conjunctionFeedV1Schema.safeParse(feed([selfPair])).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(feed([pair(), duplicateId])).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(feed([pair(), duplicateEncounter])).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(wrongSnapshot).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(wrongGeneratedAt).success).toBe(false);
    expect(conjunctionFeedV1Schema.safeParse(updateAfterRetrieval).success).toBe(false);
  });
});

describe('conjunction freshness', () => {
  it('uses the provider update clock for current/stale and treats an all-past feed as archival', () => {
    const now = new Date('2026-07-18T12:00:00.000Z');
    const current = feed();
    const stale = feed();

    stale.source.updatedAt = new Date(now.getTime() - CONJUNCTION_STALE_AFTER_MS - 1).toISOString();
    stale.source.retrievedAt = now.toISOString();

    expect(classifyConjunctionFeed(current, now)).toBe('current');
    expect(classifyConjunctionFeed(stale, now)).toBe('stale');
    expect(classifyConjunctionFeed(current, new Date('2026-07-20T00:00:00.000Z'))).toBe('archival');
  });

  it('keeps the exact freshness boundary current and requires a valid explicit clock', () => {
    const exactBoundary = feed();
    const now = new Date(Date.parse(exactBoundary.source.updatedAt) + CONJUNCTION_STALE_AFTER_MS);

    expect(classifyConjunctionFeed(exactBoundary, now)).toBe('current');
    expect(() => classifyConjunctionFeed(exactBoundary, new Date(Number.NaN))).toThrow('valid date');
  });
});

describe('conjunction catalog resolution', () => {
  it('drops unknown-id pairs, returns unique known ids, and resolves each id once', () => {
    const unknown = pair({
      id: 'b'.repeat(24),
      object1: { catalogId: '999', name: 'UNKNOWN', dseDays: 1 },
      timeOfClosestApproach: '2026-07-19T01:00:00.000Z',
    });
    const objects = new Map([
      ['100', object('100')],
      ['200', object('200')],
    ]);
    const lookup = vi.fn((catalogId: string) => objects.get(catalogId));
    const state = resolveConjunctionFeed(feed([pair(), unknown]), lookup, new Date('2026-07-18T12:00:00.000Z'));

    expect(state).toMatchObject({ status: 'current', droppedPairCount: 1, error: null });
    expect(state.conjunctions).toHaveLength(1);
    expect(state.catalogIds).toEqual(['100', '200']);
    expect(state.conjunctions[0].object1.object).toBe(objects.get('100'));
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('keeps past pairs for inspection but only puts future pairs in a current lens', () => {
    const past = pair({
      id: 'b'.repeat(24),
      timeOfClosestApproach: '2026-07-17T12:00:00.000Z',
    });
    const future = pair({
      id: 'd'.repeat(24),
      timeOfClosestApproach: '2026-07-19T12:00:00.000Z',
    });
    const objects = new Map([
      ['100', object('100')],
      ['200', object('200')],
    ]);
    const current = resolveConjunctionFeed(
      feed([past, future]),
      (catalogId) => objects.get(catalogId),
      new Date('2026-07-18T12:00:00.000Z'),
    );
    const archival = resolveConjunctionFeed(
      feed([past, future]),
      (catalogId) => objects.get(catalogId),
      new Date('2026-07-20T12:00:00.000Z'),
    );

    expect(current).toMatchObject({ status: 'current', lensPairCount: 1, catalogIds: ['100', '200'] });
    expect(current.conjunctions).toHaveLength(2);
    expect(archival).toMatchObject({ status: 'archival', lensPairCount: 2, catalogIds: ['100', '200'] });
  });

  it('classifies after unknown pairs are dropped and ages an available state without reloading', () => {
    const knownPast = pair({ timeOfClosestApproach: '2026-07-17T12:00:00.000Z' });
    const unknownFuture = pair({
      id: 'b'.repeat(24),
      object2: { catalogId: '999', name: 'UNKNOWN', dseDays: 1 },
      timeOfClosestApproach: '2026-07-20T12:00:00.000Z',
    });
    const objects = new Map([
      ['100', object('100')],
      ['200', object('200')],
    ]);
    const resolved = resolveConjunctionFeed(
      feed([knownPast, unknownFuture]),
      (catalogId) => objects.get(catalogId),
      new Date('2026-07-18T12:00:00.000Z'),
    );

    expect(resolved).toMatchObject({
      status: 'archival',
      droppedPairCount: 1,
      lensPairCount: 1,
      catalogIds: ['100', '200'],
    });

    const knownFuture = resolveConjunctionFeed(
      feed([pair({ timeOfClosestApproach: '2026-07-20T12:00:00.000Z' })]),
      (catalogId) => objects.get(catalogId),
      new Date('2026-07-18T12:00:00.000Z'),
    );
    const stale = refreshAvailableConjunctionState(knownFuture, new Date('2026-07-19T12:00:00.001Z'));
    const archival = refreshAvailableConjunctionState(stale, new Date('2026-07-20T12:00:00.001Z'));

    expect(refreshAvailableConjunctionState(knownFuture, new Date('2026-07-18T12:00:00.000Z'))).toBe(knownFuture);
    expect(stale.status).toBe('stale');
    expect(archival).toMatchObject({ status: 'archival', lensPairCount: 1, catalogIds: ['100', '200'] });
  });
});

describe('selected-object conjunction lookup', () => {
  it('is side-neutral and chooses the nearest future encounter over any past event', () => {
    const past = resolvedPair('2026-07-17T12:00:00.000Z', '100', '300');
    const later = resolvedPair('2026-07-20T12:00:00.000Z', '100', '400');
    const next = resolvedPair('2026-07-19T12:00:00.000Z', '200', '100');
    const selected = findSelectedConjunction([past, later, next], '100', new Date('2026-07-18T12:00:00.000Z'));

    expect(selected?.temporalLabel).toBe('next');
    expect(selected?.pair).toBe(next);
    expect(selected?.selectedObject.catalogId).toBe('100');
    expect(selected?.otherObject.catalogId).toBe('200');
  });

  it('falls back to the latest past event and returns null for an unrelated object', () => {
    const older = resolvedPair('2026-07-16T12:00:00.000Z');
    const latest = resolvedPair('2026-07-17T12:00:00.000Z', '300', '100');
    const now = new Date('2026-07-18T12:00:00.000Z');

    expect(findSelectedConjunction([older, latest], '100', now)).toMatchObject({
      pair: latest,
      temporalLabel: 'latest',
      selectedObject: { catalogId: '100' },
      otherObject: { catalogId: '300' },
    });
    expect(findSelectedConjunction([older, latest], '999', now)).toBeNull();
  });
});

describe('conjunction boundary states', () => {
  it('provides an immutable loading state and one normalized unavailable shape', () => {
    expect(INITIAL_CONJUNCTION_STATE).toEqual({
      status: 'loading',
      conjunctions: [],
      lensPairCount: 0,
      catalogIds: [],
      droppedPairCount: 0,
      source: null,
      error: null,
    });
    expect(Object.isFrozen(INITIAL_CONJUNCTION_STATE)).toBe(true);
    expect(Object.isFrozen(INITIAL_CONJUNCTION_STATE.conjunctions)).toBe(true);
    expect(createUnavailableConjunctionState('  network unavailable  ')).toMatchObject({
      status: 'unavailable',
      lensPairCount: 0,
      droppedPairCount: 0,
      source: null,
      error: 'network unavailable',
    });
    expect(createUnavailableConjunctionState('')).toMatchObject({ error: 'Conjunction data is unavailable.' });
  });
});
