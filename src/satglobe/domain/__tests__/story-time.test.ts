import { describe, expect, it } from 'vitest';
import { storySimulationAnchor, storySimulationTime } from '../story-time';

describe('story simulation time', () => {
  const anchor = '2026-07-17T12:00:00.000Z';

  it('resolves every offset from the same anchor instead of accumulating prior beats', () => {
    expect(storySimulationTime(anchor, 6)).toBe('2026-07-17T18:00:00.000Z');
    expect(storySimulationTime(anchor, 12)).toBe('2026-07-18T00:00:00.000Z');
    expect(storySimulationTime(anchor, 6)).toBe('2026-07-17T18:00:00.000Z');
  });

  it('treats a zero-hour offset as an authored return to the anchor', () => {
    expect(storySimulationTime(anchor, 0)).toBe(anchor);
  });

  it('derives the original anchor from an absolute saved beat time', () => {
    expect(storySimulationAnchor('2026-07-18T00:00:00.000Z', 12)).toBe(anchor);
  });

  it('rejects invalid or overflowing dates', () => {
    expect(() => storySimulationTime('not-a-date', 1)).toThrow(TypeError);
    expect(() => storySimulationTime('not-a-date', 1)).toThrow('valid date');
    expect(() => storySimulationTime(anchor, Number.MAX_VALUE)).toThrow(TypeError);
    expect(() => storySimulationTime(anchor, Number.MAX_VALUE)).toThrow('valid date');
  });
});
