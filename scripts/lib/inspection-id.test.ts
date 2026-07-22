import { describe, expect, it } from 'vitest';
import { assertInspectionId, redactInspectionId } from './inspection-id';

describe('assertInspectionId', () => {
  it('accepts portable identifiers used by saved inspection recipes', () => {
    expect(() => assertInspectionId('plugin-dev-SensorInfo.v2')).not.toThrow();
  });

  it.each(['../escape', 'line\nbreak', '\u001b[31mred', 'Kelvin', 'ſensor', '', 'a'.repeat(65)])(
    'rejects unsafe identifier %j',
    (value) => {
      expect(() => assertInspectionId(value)).toThrow('spec.id must be');
    },
  );
});

describe('redactInspectionId', () => {
  it.each(['customer-alpha', 'private-feature.v2'])('does not expose inspection identifier %j in logs', (value) => {
    const label = redactInspectionId(value);

    expect(label).toBe('inspection');
    expect(label).not.toContain(value);
  });
});
