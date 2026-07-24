import type { rgbaArray } from '@app/engine/core/interfaces';
import {
  launchCohortColorForKey,
  normalizeLaunchCohort,
  UNKNOWN_LAUNCH_COHORT_COLOR,
} from '../domain/launch-designator';

export { normalizeLaunchCohort } from '../domain/launch-designator';

/** Maps every object from one actual launch (YYYY-NNN) to the same deterministic static color. */
export function launchCohortColor(internationalDesignator: string | undefined): rgbaArray {
  const cohort = normalizeLaunchCohort(internationalDesignator);

  return cohort ? launchCohortColorForKey(cohort) : UNKNOWN_LAUNCH_COHORT_COLOR;
}
