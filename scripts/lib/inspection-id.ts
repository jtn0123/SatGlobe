const INSPECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

/** Validate the identifier before it reaches filesystem paths. */
export function assertInspectionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !INSPECTION_ID.test(value)) {
    throw new Error('spec.id must be 1-64 letters, numbers, dots, underscores, or hyphens');
  }
}

/**
 * Inspection identifiers can describe private work. Keep them out of terminal
 * and CI logs while retaining a stable label for progress messages.
 */
export function redactInspectionId(_value: string): string {
  return 'inspection';
}
