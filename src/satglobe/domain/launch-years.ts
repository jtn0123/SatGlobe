/** Catalog fields used to recover a launch year without trusting local date parsing. */
export interface LaunchDatedObject {
  internationalDesignator: string;
  launchDate: string;
  launchYear?: number | null;
}

export interface LaunchYearBounds {
  /** First useful cumulative frame, rounded up to include the earliest launches. */
  minYear: number;
  /** Newest launch year represented by the installed catalog. */
  maxYear: number;
}

const FIRST_SPACE_AGE_YEAR = 1957;
const DESIGNATOR_YEAR = /^(?<year>\d{4})-\d{3}/u;
const ISO_DATE_YEAR = /^(?<year>\d{4})-\d{2}-\d{2}(?:T|$)/u;

/** Accepts only integer years from the beginning of the space age onward. */
function validLaunchYear(raw: string | undefined): number | null {
  const year = Number(raw);

  return Number.isInteger(year) && year >= FIRST_SPACE_AGE_YEAR && year <= 9_999 ? year : null;
}

/**
 * Resolves a launch year from the international designator first.
 *
 * Some enriched `launchDate` values have passed through permissive date
 * parsers, while the four-digit international-designator year remains the
 * catalog identity. A strict ISO date is a fallback for records without a
 * designator; malformed or missing values stay unknown.
 */
export function catalogLaunchYear(object: LaunchDatedObject): number | null {
  if (object.launchYear !== undefined) {
    return validLaunchYear(String(object.launchYear));
  }
  const designatorYear = validLaunchYear(DESIGNATOR_YEAR.exec(object.internationalDesignator.trim())?.groups?.year);

  if (designatorYear !== null) {
    return designatorYear;
  }

  return validLaunchYear(ISO_DATE_YEAR.exec(object.launchDate.trim())?.groups?.year);
}

/** Finds deterministic scrubber bounds from the installed catalog. */
export function launchYearBounds(objects: readonly LaunchDatedObject[]): LaunchYearBounds | null {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const object of objects) {
    const year = catalogLaunchYear(object);

    if (year !== null) {
      earliest = Math.min(earliest, year);
      latest = Math.max(latest, year);
    }
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
    return null;
  }
  // The opening frame is the first decade marker that already contains the
  // earliest installed launches (1958 becomes a truthful "through 1960").
  const decadeCeiling = Math.ceil(earliest / 10) * 10;

  return { minYear: Math.min(decadeCeiling, latest), maxYear: latest };
}

/** Decade-by-decade playback stops, plus the exact newest catalog year. */
export function launchYearStops({ minYear, maxYear }: LaunchYearBounds): number[] {
  const stops = [minYear];
  let year = Math.floor(minYear / 10) * 10 + 10;

  while (year < maxYear) {
    stops.push(year);
    year += 10;
  }
  if (stops.at(-1) !== maxYear) {
    stops.push(maxYear);
  }

  return stops;
}
