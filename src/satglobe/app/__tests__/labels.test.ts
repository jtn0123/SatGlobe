import { describe, expect, it } from 'vitest';
import { ageInDays, describeEpoch, formatCalendarDate, formatNumber, formatUtc } from '../labels';

// The suite-wide fake clock is pinned to 2022-01-01T00:00:00Z (test/polyfills.js).
describe('labels', () => {
  it('formatNumber groups thousands and falls back to an em dash', () => {
    expect(formatNumber(33421)).toBe('33,421');
    expect(formatNumber(1234.567, 1)).toBe('1,234.6');
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('formatUtc renders an explicit UTC string and flags unparseable input', () => {
    expect(formatUtc('2021-12-25T18:30:45Z')).toBe('25 DEC 2021, 18:30:45 UTC');
    expect(formatUtc('not-a-date')).toBe('WAITING FOR ENGINE');
  });

  it('formatCalendarDate hides raw ISO but passes through unparseable text', () => {
    expect(formatCalendarDate('2019-05-24T00:00:00Z')).toBe('24 MAY 2019');
    expect(formatCalendarDate('')).toBe('Not listed');
    expect(formatCalendarDate('TBD')).toBe('TBD');
  });

  it('ageInDays measures against the pinned clock and clamps at zero', () => {
    expect(ageInDays('2021-12-31T00:00:00Z')).toBeCloseTo(1, 5);
    expect(ageInDays('2022-06-01T00:00:00Z')).toBe(0);
    expect(ageInDays('garbage')).toBeNull();
  });

  it('describeEpoch picks precision by magnitude and handles missing epochs', () => {
    expect(describeEpoch('2021-12-31T00:00:00Z')).toBe('1.0 days old');
    expect(describeEpoch('2021-11-01T00:00:00Z')).toBe('61 days old');
    expect(describeEpoch('')).toBe('Epoch unavailable');
    expect(describeEpoch('garbage')).toBe('Epoch unavailable');
  });
});
