import { leapSecondData } from '../LeapSecondData';

describe('LeapSecondData', () => {
  describe('getLeapSeconds', () => {
    it.each([
      ['at the last known boundary', 2457754.5, 37],
      ['after the last known boundary', 2460000.0, 37],
      ['at the first known boundary', 2441317.5, 10],
      ['before the first known boundary', 2440000.0, 10],
      ['between the first two boundaries', 2441400.0, 10],
      ['at a leap-second transition', 2441499.5, 11],
      ['in the middle of the table', 2450000.0, 29],
      ['just before a transition', 2441499.4, 10],
      ['for a recent date', 2457300.0, 36],
    ])('returns the correct offset %s', (_label, julianDate, expectedOffset) => {
      expect(leapSecondData.getLeapSeconds(julianDate)).toBe(expectedOffset);
    });
  });
});
