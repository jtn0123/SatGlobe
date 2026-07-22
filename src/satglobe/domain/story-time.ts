const MILLISECONDS_PER_HOUR = 3_600_000;

/** Resolves one authored beat against the fixed simulation-time anchor for its story session. */
export function storySimulationTime(anchorIso: string, offsetHours: number): string {
  const anchorMs = Date.parse(anchorIso);
  const targetMs = anchorMs + offsetHours * MILLISECONDS_PER_HOUR;

  if (!Number.isFinite(anchorMs) || !Number.isFinite(targetMs)) {
    throw new TypeError('Story simulation time must resolve to a valid date.');
  }

  return new Date(targetMs).toISOString();
}

/** Recovers a story-session anchor from an absolute saved time and the saved beat's relative offset. */
export function storySimulationAnchor(savedTimeIso: string, offsetHours: number): string {
  return storySimulationTime(savedTimeIso, -offsetHours);
}
