import { describe, expect, it } from 'vitest';
import { assertInspectionId } from './inspection-id';

describe('assertInspectionId', () => {
  it('accepts portable identifiers used by saved inspection recipes', () => {
    expect(() => assertInspectionId('plugin-dev-SensorInfo.v2')).not.toThrow();
  });

  it.each(['../escape', 'line\nbreak', '\u001b[31mred', '', 'a'.repeat(65)])(
    'rejects unsafe identifier %j',
    (value) => {
      expect(() => assertInspectionId(value)).toThrow('spec.id must be');
    },
  );
});
