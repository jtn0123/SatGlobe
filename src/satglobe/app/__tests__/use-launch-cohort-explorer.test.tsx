import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FILTERS,
  type EngineState,
  type SpaceObjectView,
} from '../../domain/types';
import { useLaunchCohortExplorer } from '../use-launch-cohort-explorer';
import { makeAdapter } from './test-adapter';

const object = (catalogId: string, internationalDesignator: string): SpaceObjectView => ({
  catalogId,
  name: `STARLINK ${catalogId}`,
  kind: 'payload',
  active: true,
  status: 'Operational',
  internationalDesignator,
  launchDate: `${internationalDesignator.slice(0, 4)}-01-01`,
  launchVehicle: 'Falcon 9',
  owner: 'SpaceX',
  country: 'US',
  source: 'CelesTrak',
  epoch: '2026-07-21T00:00:00.000Z',
  apogeeKm: 560,
  perigeeKm: 540,
  inclinationDeg: 53.2,
  periodMinutes: 95,
  regime: 'leo',
  isStarlink: true,
  nameText: `starlink ${catalogId}`,
  launchText: internationalDesignator.toLowerCase(),
  ownershipText: 'us spacex',
  searchText: `starlink ${catalogId} ${internationalDesignator.toLowerCase()}`,
});

describe('useLaunchCohortExplorer', () => {
  it('adds a highlight key without rescanning an unchanged catalog legend', () => {
    const objects = [object('1', '2021-021A')];
    let catalogReads = 0;

    Object.defineProperty(objects[0], 'active', {
      get: () => {
        catalogReads += 1;

        return true;
      },
    });
    const { adapter, state } = makeAdapter({
      objects,
      state: {
        encoding: 'object-type',
        filters: { ...structuredClone(DEFAULT_FILTERS), status: 'all' },
      },
    });
    const options = {
      adapter,
      filters: state.filters,
      stories: [] as const,
      onNotice: vi.fn(),
      onOpenStory: vi.fn(),
      setFiltersWithEncodingImmediate: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ engine }: { engine: EngineState }) => useLaunchCohortExplorer({ ...options, engine }),
      { initialProps: { engine: state } },
    );

    expect(catalogReads).toBeGreaterThan(0);
    catalogReads = 0;
    rerender({
      engine: {
        ...state,
        conjunctionHighlightActive: true,
        highlightedObjectCount: 1,
      },
    });

    expect(catalogReads).toBe(0);
    expect(result.current.legend.items[0]).toMatchObject({
      id: 'close-approach-highlight',
      count: 1,
    });
  });

  it('rebuilds cohorts and the live legend when a same-count catalog snapshot changes', () => {
    const firstObjects = [object('1', '2021-021A')];
    const secondObjects = [object('2', '2022-001A')];
    const { adapter, methods, state } = makeAdapter({
      objects: firstObjects,
      state: {
        encoding: 'launch-cohort',
        filters: { ...structuredClone(DEFAULT_FILTERS), status: 'all' },
      },
    });
    const stories = [] as const;
    const onNotice = vi.fn();
    const onOpenStory = vi.fn();
    const setFiltersWithEncodingImmediate = vi.fn();
    let objects: readonly SpaceObjectView[] = firstObjects;

    methods.getObjects.mockImplementation(() => objects);
    const { result, rerender } = renderHook(
      ({ engine }: { engine: EngineState }) => useLaunchCohortExplorer({
        adapter,
        engine,
        filters: engine.filters,
        stories,
        onNotice,
        onOpenStory,
        setFiltersWithEncodingImmediate,
      }),
      { initialProps: { engine: state } },
    );

    expect(result.current.cohorts.map(({ id }) => id)).toEqual(['2021-021']);
    expect(result.current.legend.items.map(({ id }) => id)).toContain('2021-021');

    objects = secondObjects;
    rerender({ engine: { ...state, simulationTime: '2026-07-17T12:00:01.000Z' } });

    expect(result.current.cohorts.map(({ id }) => id)).toEqual(['2022-001']);
    expect(result.current.legend.items.map(({ id }) => id)).toContain('2022-001');
    expect(result.current.legend.items.map(({ id }) => id)).not.toContain('2021-021');
  });
});
