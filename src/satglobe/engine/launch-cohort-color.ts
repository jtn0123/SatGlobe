import type { rgbaArray } from '@app/engine/core/interfaces';
import { launchCohortColorForKey, normalizeLaunchCohort } from '../domain/launch-designator';

const UNKNOWN_COHORT_COLOR: rgbaArray = [0.56, 0.59, 0.6, 0.62];

export { normalizeLaunchCohort } from '../domain/launch-designator';

/** Maps every object from one actual launch (YYYY-NNN) to the same deterministic static color. */
export function launchCohortColor(internationalDesignator: string | undefined): rgbaArray {
  const cohort = normalizeLaunchCohort(internationalDesignator);

  return cohort ? launchCohortColorForKey(cohort) : UNKNOWN_COHORT_COLOR;
}
