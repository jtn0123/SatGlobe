import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type SpaceObjectView } from '../types';
import { buildVisualLegend, rgbaToCss, CONJUNCTION_HIGHLIGHT_COLOR } from '../encodings';
import { launchCohortColorForKey, UNKNOWN_LAUNCH_COHORT_COLOR } from '../launch-designator';

const object = (cohort: string, catalogId: string): SpaceObjectView => ({
  catalogId,
  name: `STARLINK-${catalogId}`,
  kind: 'payload',
  active: true,
  status: 'Operational',
  internationalDesignator: `${cohort}A`,
  launchDate: `${cohort.slice(0, 4)}-01-01`,
  launchVehicle: 'Falcon 9',
  owner: 'SpaceX',
  country: 'US',
  source: 'CelesTrak',
  epoch: '2026-07-20T00:00:00.000Z',
  apogeeKm: 560,
  perigeeKm: 540,
  inclinationDeg: 53.2,
  periodMinutes: 95,
  regime: 'leo',
  isStarlink: true,
  nameText: `starlink-${catalogId}`,
  launchText: `${cohort}a ${cohort.slice(0, 4)}-01-01`,
  ownershipText: 'us spacex',
  searchText: `starlink-${catalogId} ${catalogId} ${cohort}a`,
});

describe('live visual legend', () => {
  it('ranks visible launch cohorts by count and uses the exact renderer color', () => {
    const legend = buildVisualLegend('launch-cohort', [
      object('2021-021', '1'),
      object('2021-021', '2'),
      object('2022-001', '3'),
    ], { ...structuredClone(DEFAULT_FILTERS), status: 'all' });

    expect(legend.items.map(({ id, count }) => [id, count])).toEqual([
      ['2021-021', 2],
      ['2022-001', 1],
    ]);
    expect(legend.items[0]?.color).toBe(rgbaToCss(launchCohortColorForKey('2021-021')));
  });

  it('accounts for visible objects whose launch designator has no cohort color key', () => {
    const unknown = {
      ...object('2021-021', '4'),
      internationalDesignator: '',
      launchText: '',
    };
    const legend = buildVisualLegend(
      'launch-cohort',
      [object('2021-021', '1'), unknown],
      { ...structuredClone(DEFAULT_FILTERS), status: 'all' },
    );

    expect(legend.items.find(({ id }) => id === 'unknown-cohort')).toMatchObject({
      count: 1,
      color: rgbaToCss(UNKNOWN_LAUNCH_COHORT_COLOR),
      label: 'Unknown designator',
    });
  });

  it('adds and removes the temporary close-approach key with highlight ownership', () => {
    const active = buildVisualLegend('object-type', [], DEFAULT_FILTERS, true, 2);
    const inactive = buildVisualLegend('object-type', [], DEFAULT_FILTERS, false, 2);

    expect(active.items[0]).toMatchObject({
      id: 'close-approach-highlight',
      count: 2,
      color: rgbaToCss(CONJUNCTION_HIGHLIGHT_COLOR),
      temporary: true,
    });
    expect(inactive.items.some(({ id }) => id === 'close-approach-highlight')).toBe(false);
  });

  it('does not rescan catalog objects for threshold-only legends', () => {
    const unreadable = {} as SpaceObjectView;

    Object.defineProperty(unreadable, 'active', {
      get: () => {
        throw new Error('threshold legends must not inspect catalog fields');
      },
    });

    expect(() => buildVisualLegend('orbital-plane', [unreadable], DEFAULT_FILTERS)).not.toThrow();
    expect(() => buildVisualLegend('data-age', [unreadable], DEFAULT_FILTERS)).not.toThrow();
  });
});
