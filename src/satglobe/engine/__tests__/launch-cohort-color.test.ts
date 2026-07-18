import { describe, expect, it } from 'vitest';
import { launchCohortColor, normalizeLaunchCohort } from '../launch-cohort-color';

describe('launch cohort colors', () => {
  it('normalizes modern and legacy international designators to YYYY-NNN launch keys', () => {
    expect(normalizeLaunchCohort('2019-074B')).toBe('2019-074');
    expect(normalizeLaunchCohort('24001A')).toBe('2024-001');
    expect(normalizeLaunchCohort('99025X')).toBe('1999-025');
    expect(normalizeLaunchCohort('2024-001')).toBe('2024-001');
    expect(normalizeLaunchCohort('2024-001ABC')).toBe('2024-001');
  });

  it('gives every object from the same launch the same deterministic color', () => {
    const payload = launchCohortColor('2019-074A');
    const rocketBody = launchCohortColor('19074B');

    expect(payload).toEqual(rocketBody);
    expect(launchCohortColor('2019-074A')).toEqual(payload);
  });

  it('distinguishes different launch cohorts', () => {
    expect(launchCohortColor('2019-074A')).not.toEqual(launchCohortColor('2019-075A'));
  });

  it('does not collapse distinct launches that shared one legacy 360-degree hash bucket', () => {
    expect(launchCohortColor('1958-002B')).not.toEqual(launchCohortColor('1974-105A'));
  });

  it('retains exact color identities across a catalog-scale launch-key sample', () => {
    const colors = new Set<string>();

    for (let year = 2022; year <= 2025; year += 1) {
      for (let sequence = 1; sequence <= 999; sequence += 1) {
        const designator = `${year}-${String(sequence).padStart(3, '0')}A`;

        colors.add(launchCohortColor(designator).join(','));
      }
    }

    expect(colors.size).toBe(3_996);
  });

  it('uses one neutral color for absent and malformed designators', () => {
    expect(normalizeLaunchCohort('not-a-designator')).toBeNull();
    expect(normalizeLaunchCohort('2019-074A/invalid')).toBeNull();
    expect(normalizeLaunchCohort('2019-074A1')).toBeNull();
    expect(normalizeLaunchCohort('2019-074ABCD')).toBeNull();
    expect(launchCohortColor(undefined)).toEqual(launchCohortColor('bad'));
  });
});
