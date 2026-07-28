import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureSync } from '../performance-measure';

const TEST_MEASURE = 'satglobe:test:sync-measure';

describe('measureSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records details, clears unique marks, and preserves the task error', () => {
    const measure = vi.spyOn(performance, 'measure').mockImplementation(() => {
      throw new Error('instrumentation failure');
    });
    const clearMarks = vi.spyOn(performance, 'clearMarks');

    expect(() => measureSync(TEST_MEASURE, { cause: 'test' }, () => {
      throw new Error('measured failure');
    })).toThrow('measured failure');

    expect(measure).toHaveBeenCalledOnce();
    expect(measure).toHaveBeenCalledWith(TEST_MEASURE, expect.objectContaining({ detail: { cause: 'test' } }));
    expect(clearMarks).toHaveBeenCalledTimes(2);
    expect(clearMarks.mock.calls.every(([name]) => typeof name === 'string' && name.startsWith(`${TEST_MEASURE}:`))).toBe(true);
  });
});
