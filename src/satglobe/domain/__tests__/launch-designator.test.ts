import { describe, expect, it } from 'vitest';
import { launchCohortColorForKey, normalizeLaunchCohort } from '../launch-designator';

describe('launch designators', () => {
  it.each([
    ['2019-074B', '2019-074'],
    ['24001A', '2024-001'],
    ['99025X', '1999-025'],
    ['2024-001', '2024-001'],
    ['57001A', '1957-001'],
  ])('normalizes %s to %s', (designator, expected) => {
    expect(normalizeLaunchCohort(designator)).toBe(expected);
  });

  it.each(['', 'not-a-designator', '2019-074A/invalid', '2019-074A1', '2019-074ABCD'])(
    'rejects malformed designator %j',
    (designator) => expect(normalizeLaunchCohort(designator)).toBeNull(),
  );

  it('assigns deterministic distinct colors without renderer state', () => {
    expect(launchCohortColorForKey('2021-021')).toEqual(launchCohortColorForKey('2021-021'));
    expect(launchCohortColorForKey('2021-021')).not.toEqual(launchCohortColorForKey('2021-022'));
  });
});
