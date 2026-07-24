const UINT32_RANGE = 0x1_0000_0000;

export type RgbaColor = [number, number, number, number];

/** Shared renderer/legend color for objects without a usable launch designator. */
export const UNKNOWN_LAUNCH_COHORT_COLOR: RgbaColor = [0.56, 0.59, 0.6, 0.62];

/** Normalizes NORAD YY-NNN/YYNNN and YYYY-NNN launch designators to one YYYY-NNN cohort key. */
export function normalizeLaunchCohort(internationalDesignator: string | null | undefined): string | null {
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
  // International designators begin in 1957: 57-99 are twentieth century, 00-56 are twenty-first.
  const fullYear = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;

  return `${fullYear}-${shortForm.groups!.sequence}`;
}

/** FNV-1a gives launch keys stable color identities without catalog-sized renderer state. */
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

/** Returns the exact stable launch-cohort color used by the renderer and live legend. */
export function launchCohortColorForKey(cohort: string): RgbaColor {
  const hue = hashCohort(cohort) / UINT32_RANGE;
  const saturation = 0.68;
  const lightness = 0.66;
  const q = lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3), 0.88];
}
