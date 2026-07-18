import type { rgbaArray } from '@app/engine/core/interfaces';

const UNKNOWN_COHORT_COLOR: rgbaArray = [0.56, 0.59, 0.6, 0.62];
const UINT32_RANGE = 0x1_0000_0000;

/** Normalizes NORAD YY-NNN/YYNNN and YYYY-NNN launch designators to one YYYY-NNN cohort key. */
export function normalizeLaunchCohort(internationalDesignator: string | undefined): string | null {
  const designator = internationalDesignator?.trim().toUpperCase() ?? '';
  const longForm = (/^(?<year>\d{4})-?(?<sequence>\d{3})(?:[A-Z]{1,3})?$/u).exec(designator);

  if (longForm) {
    return `${longForm.groups!.year}-${longForm.groups!.sequence}`;
  }
  const shortForm = (/^(?<year>\d{2})-?(?<sequence>\d{3})(?:[A-Z]{1,3})?$/u).exec(designator);

  if (!shortForm) {
    return null;
  }
  const shortYear = Number(shortForm.groups!.year);
  // NORAD designators began in 1957: 57-99 are twentieth century, 00-56 are twenty-first.
  const fullYear = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;

  return `${fullYear}-${shortForm.groups!.sequence}`;
}

/** FNV-1a gives launch keys stable color identities without keeping catalog-sized state. */
function hashCohort(cohort: string): number {
  let hash = 0x811c9dc5;

  for (const character of cohort) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Converts one wrapped HSL hue component to RGB. */
function hueToRgb(p: number, q: number, hue: number): number {
  const wrappedHue = ((hue % 1) + 1) % 1;

  if (wrappedHue < 1 / 6) {
    return p + (q - p) * 6 * wrappedHue;
  }
  if (wrappedHue < 1 / 2) {
    return q;
  }
  if (wrappedHue < 2 / 3) {
    return p + (q - p) * (2 / 3 - wrappedHue) * 6;
  }

  return p;
}

/** Uses a bright, fixed-saturation palette that stays legible against SatGlobe's dark scene. */
function cohortColor(cohort: string): rgbaArray {
  // Preserve all 32 hash bits. Quantizing to integer degrees collapsed the
  // installed catalog's thousands of launches into only 360 exact colors.
  const hue = hashCohort(cohort) / UINT32_RANGE;
  const saturation = 0.68;
  const lightness = 0.66;
  const q = lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3), 0.88];
}

/** Maps every object from one actual launch (YYYY-NNN) to the same deterministic static color. */
export function launchCohortColor(internationalDesignator: string | undefined): rgbaArray {
  const cohort = normalizeLaunchCohort(internationalDesignator);

  return cohort ? cohortColor(cohort) : UNKNOWN_COHORT_COLOR;
}
