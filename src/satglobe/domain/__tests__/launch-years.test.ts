import { describe, expect, it } from 'vitest';
import { catalogLaunchYear, launchYearBounds, launchYearStops } from '../launch-years';

describe('catalog launch years', () => {
  it('prefers the international designator over a malformed enriched date', () => {
    expect(catalogLaunchYear({
      internationalDesignator: '2024-077B',
      launchDate: '+045405-01-01T00:00:00.000Z',
    })).toBe(2024);
  });

  it('accepts a strict ISO fallback and rejects ambiguous dates', () => {
    expect(catalogLaunchYear({ internationalDesignator: '', launchDate: '1972-07-23T00:00:00.000Z' })).toBe(1972);
    expect(catalogLaunchYear({ internationalDesignator: '', launchDate: '07/23/1972' })).toBeNull();
    expect(catalogLaunchYear({ internationalDesignator: '', launchDate: '' })).toBeNull();
  });

  it('derives cumulative bounds and decade stops from installed records', () => {
    const bounds = launchYearBounds([
      { internationalDesignator: '1958-002B', launchDate: '' },
      { internationalDesignator: '1972-058A', launchDate: '' },
      { internationalDesignator: '2026-027A', launchDate: '' },
      { internationalDesignator: 'invalid', launchDate: '' },
    ]);

    expect(bounds).toEqual({ minYear: 1960, maxYear: 2026 });
    expect(launchYearStops(bounds!)).toEqual([1960, 1970, 1980, 1990, 2000, 2010, 2020, 2026]);
  });

  it('returns no bounds when the catalog has no trustworthy launch year', () => {
    expect(launchYearBounds([{ internationalDesignator: '', launchDate: '' }])).toBeNull();
  });
});
