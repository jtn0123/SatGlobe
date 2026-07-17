import type { FilterState, ObjectKind, OrbitRegime } from './types';

/** The catalog fields required to evaluate a SatGlobe workshop filter. */
export interface FilterableSpaceObject {
  kind: ObjectKind;
  active: boolean;
  regime: OrbitRegime;
  perigeeKm: number;
  apogeeKm: number;
  inclinationDeg: number;
  name: string;
  internationalDesignator: string;
  launchDate: string;
  country: string;
  owner: string;
  /*
   * Optional precomputed lowercase text. Filtering runs O(catalog) on every
   * change, so callers that sweep repeatedly precompute these once per object;
   * when absent the matcher derives them per call.
   */
  nameText?: string;
  launchText?: string;
  ownershipText?: string;
}

export type FilterMatcher = (object: FilterableSpaceObject) => boolean;

/**
 * Builds a reusable predicate with the filter terms normalized once. Use this
 * for any loop over the catalog; per-object work is then comparisons only
 * (plus lowercasing for objects without precomputed text fields).
 */
export function prepareFilterMatcher(filters: FilterState): FilterMatcher {
  const launchCohort = filters.launchCohort.trim().toLocaleLowerCase();
  const constellation = filters.constellation.trim().toLocaleLowerCase();
  const countryOrOperator = filters.countryOrOperator.trim().toLocaleLowerCase();
  const kinds = new Set(filters.objectKinds);
  const regimes = new Set(filters.regimes);
  const { status, altitudeKm, inclinationDeg } = filters;

  return (object) => {
    const statusMatches = status === 'all' || (status === 'active' ? object.active : !object.active);

    if (!kinds.has(object.kind) || !statusMatches || !regimes.has(object.regime) ||
      object.perigeeKm < altitudeKm.min || object.apogeeKm > altitudeKm.max ||
      object.inclinationDeg < inclinationDeg.min || object.inclinationDeg > inclinationDeg.max) {
      return false;
    }
    if (launchCohort) {
      const launchText = object.launchText ?? `${object.internationalDesignator} ${object.launchDate}`.toLocaleLowerCase();

      if (!launchText.includes(launchCohort)) {
        return false;
      }
    }
    if (constellation) {
      const nameText = object.nameText ?? object.name.toLocaleLowerCase();

      if (!nameText.includes(constellation)) {
        return false;
      }
    }
    if (countryOrOperator) {
      const ownershipText = object.ownershipText ?? `${object.country} ${object.owner}`.toLocaleLowerCase();

      if (!ownershipText.includes(countryOrOperator)) {
        return false;
      }
    }

    return true;
  };
}

/**
 * Applies every workshop filter to a normalized object. Both the renderer and
 * the population count use this predicate so the reported population matches
 * the scene. For loops, build the matcher once with prepareFilterMatcher.
 */
export function matchesSatGlobeFilters(object: FilterableSpaceObject, filters: FilterState): boolean {
  return prepareFilterMatcher(filters)(object);
}
