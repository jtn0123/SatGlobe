import { describe, expect, it } from 'vitest';
import { classifyOrbit, tleEpochToIso } from '../orbits';

describe('orbital classification', () => {
  it.each([
    [500, 550, 95, 'leo'],
    [20_100, 20_300, 720, 'meo'],
    [35_770, 35_800, 1_436, 'geo'],
    [500, 39_000, 720, 'heo'],
    [50_000, 51_000, 2_000, 'other'],
  ] as const)('classifies perigee %s and apogee %s as %s', (perigee, apogee, period, expected) => {
    expect(classifyOrbit(perigee, apogee, period)).toBe(expected);
  });

  it('converts modern and legacy two-digit epochs', () => {
    expect(tleEpochToIso(26, 1)).toBe('2026-01-01T00:00:00.000Z');
    expect(tleEpochToIso(99, 1)).toBe('1999-01-01T00:00:00.000Z');
  });
});
