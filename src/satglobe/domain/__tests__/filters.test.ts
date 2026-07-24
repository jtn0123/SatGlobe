import { describe, expect, it } from 'vitest';
import { matchesSatGlobeFilters, prepareFilterMatcher, type FilterableSpaceObject } from '../filters';
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
  ['maximum launch year', { launchYearMax: 2018 }],
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

  it('treats a four-digit cohort as a year-prefix match', () => {
    expect(matchesSatGlobeFilters(object, withFilters({ launchCohort: '2019' }))).toBe(true);
  });

  it('matches a canonical cohort filter against a short-form designator', () => {
    expect(matchesSatGlobeFilters({
      ...object,
      internationalDesignator: '19029B',
      launchText: '19029b 2019-05-24',
    }, withFilters({ launchCohort: '2019-029' }))).toBe(true);
  });

  it('applies a cumulative launch-year boundary and rejects unknown years', () => {
    expect(matchesSatGlobeFilters(object, withFilters({ launchYearMax: 2019 }))).toBe(true);
    expect(matchesSatGlobeFilters({ ...object, launchDate: '', internationalDesignator: '' }, withFilters({ launchYearMax: 2026 }))).toBe(false);
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

describe('prepareFilterMatcher', () => {
  it('returns a reusable predicate equivalent to matchesSatGlobeFilters', () => {
    const filters = withFilters({ constellation: 'starlink' });
    const matcher = prepareFilterMatcher(filters);

    expect(matcher(object)).toBe(true);
    expect(matcher({ ...object, name: 'ONEWEB-0001' })).toBe(false);
    expect(matcher(object)).toBe(matchesSatGlobeFilters(object, filters));
  });

  it('prefers precomputed lowercase fields over deriving them per call', () => {
    const matcher = prepareFilterMatcher(withFilters({
      launchCohort: '2019-029',
      constellation: 'starlink',
      countryOrOperator: 'spacex',
    }));
    // Raw fields deliberately contradict the precomputed text: matches prove
    // the precomputed path is used, so callers can rely on the fast path.
    const precomputed: FilterableSpaceObject = {
      ...object,
      name: 'RAW NAME IGNORED',
      internationalDesignator: 'ignored',
      launchDate: 'ignored',
      launchYear: 2019,
      country: 'ignored',
      owner: 'ignored',
      nameText: 'starlink-1008',
      launchText: '2019-029b 2019-05-24',
      ownershipText: 'us spacex',
    };

    expect(matcher(precomputed)).toBe(true);
  });
});
