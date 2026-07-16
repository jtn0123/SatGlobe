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
}

/**
 * Applies every workshop filter to a normalized object. Both the renderer and
 * React count use this predicate so the reported population matches the scene.
 */
export function matchesSatGlobeFilters(object: FilterableSpaceObject, filters: FilterState): boolean {
  const launchCohort = filters.launchCohort.trim().toLocaleLowerCase();
  const constellation = filters.constellation.trim().toLocaleLowerCase();
  const countryOrOperator = filters.countryOrOperator.trim().toLocaleLowerCase();
  const statusMatches = filters.status === 'all' || (filters.status === 'active' ? object.active : !object.active);
  const launchText = `${object.internationalDesignator} ${object.launchDate}`.toLocaleLowerCase();
  const ownershipText = `${object.country} ${object.owner}`.toLocaleLowerCase();

  return filters.objectKinds.includes(object.kind) &&
    statusMatches &&
    filters.regimes.includes(object.regime) &&
    object.perigeeKm >= filters.altitudeKm.min &&
    object.apogeeKm <= filters.altitudeKm.max &&
    object.inclinationDeg >= filters.inclinationDeg.min &&
    object.inclinationDeg <= filters.inclinationDeg.max &&
    (!launchCohort || launchText.includes(launchCohort)) &&
    (!constellation || object.name.toLocaleLowerCase().includes(constellation)) &&
    (!countryOrOperator || ownershipText.includes(countryOrOperator));
}
