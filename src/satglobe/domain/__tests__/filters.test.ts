import { describe, expect, it } from 'vitest';
import { matchesSatGlobeFilters, type FilterableSpaceObject } from '../filters';
import { DEFAULT_FILTERS, type FilterState } from '../types';

const object: FilterableSpaceObject = {
  kind: 'payload',
  active: true,
  regime: 'leo',
  perigeeKm: 535,
  apogeeKm: 552,
  inclinationDeg: 53.2,
  name: 'STARLINK-1008',
  internationalDesignator: '2019-029B',
  launchDate: '2019-05-24',
  country: 'US',
  owner: 'SpaceX',
};

const withFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
  ...structuredClone(DEFAULT_FILTERS),
  ...overrides,
});

const rejectedFilters: Array<[string, Partial<FilterState>]> = [
  ['object kind', { objectKinds: ['debris'] }],
  ['status', { status: 'inactive' }],
  ['regime', { regimes: ['geo'] }],
  ['minimum altitude', { altitudeKm: { min: 536, max: 100_000 } }],
  ['maximum altitude', { altitudeKm: { min: 0, max: 551 } }],
  ['inclination', { inclinationDeg: { min: 54, max: 180 } }],
  ['launch cohort', { launchCohort: '2024-001' }],
  ['constellation', { constellation: 'oneweb' }],
  ['country or operator', { countryOrOperator: 'esa' }],
];

describe('matchesSatGlobeFilters', () => {
  it('matches all normalized searchable fields', () => {
    expect(matchesSatGlobeFilters(object, withFilters({
      launchCohort: '2019-029',
      constellation: 'starlink',
      countryOrOperator: 'spacex',
    }))).toBe(true);
  });

  it.each(rejectedFilters)('rejects a nonmatching %s filter', (_label, overrides) => {
    expect(matchesSatGlobeFilters(object, withFilters(overrides))).toBe(false);
  });

  it('supports explicit inactive and all-status views', () => {
    const inactive = { ...object, active: false };

    expect(matchesSatGlobeFilters(inactive, withFilters({ status: 'inactive' }))).toBe(true);
    expect(matchesSatGlobeFilters(inactive, withFilters({ status: 'all' }))).toBe(true);
  });
});
