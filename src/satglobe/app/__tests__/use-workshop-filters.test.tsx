import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS, type FilterState } from '../../domain/types';
import { useWorkshopFilters } from '../use-workshop-filters';
import { makeAdapter } from './test-adapter';

const makeFilters = (status: FilterState['status']): FilterState => ({
  ...structuredClone(DEFAULT_FILTERS),
  status,
});

describe('useWorkshopFilters', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('coalesces staggered slider changes 120 ms after the final value', () => {
    vi.useFakeTimers();
    const { adapter, methods } = makeAdapter();
    const { result } = renderHook(() => useWorkshopFilters(adapter));
    const first = makeFilters('active');
    const second = makeFilters('inactive');
    const final = makeFilters('all');

    act(() => result.current.setFiltersDebounced(first));
    act(() => vi.advanceTimersByTime(40));
    act(() => result.current.setFiltersDebounced(second));
    act(() => vi.advanceTimersByTime(40));
    act(() => result.current.setFiltersDebounced(final));

    expect(result.current.filters).toBe(final);
    expect(methods.setFilters).not.toHaveBeenCalled();

    // The original timers would have fired at t=120 and t=160. The trailing
    // timer must instead wait until t=200, exactly 120 ms after the final call.
    act(() => vi.advanceTimersByTime(119));
    expect(methods.setFilters).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(methods.setFilters).toHaveBeenCalledTimes(1);
    expect(methods.setFilters).toHaveBeenCalledWith(final);
  });

  it('applies an immediate change synchronously', () => {
    vi.useFakeTimers();
    const { adapter, methods } = makeAdapter();
    const { result } = renderHook(() => useWorkshopFilters(adapter));
    const next = makeFilters('inactive');

    act(() => result.current.setFiltersImmediate(next));

    expect(result.current.filters).toBe(next);
    expect(methods.setFilters).toHaveBeenCalledTimes(1);
    expect(methods.setFilters).toHaveBeenCalledWith(next);
  });

  it('cancels a pending slider change before applying an immediate change', () => {
    vi.useFakeTimers();
    const { adapter, methods } = makeAdapter();
    const { result } = renderHook(() => useWorkshopFilters(adapter));
    const stale = makeFilters('inactive');
    const immediate = makeFilters('all');

    act(() => {
      result.current.setFiltersDebounced(stale);
      result.current.setFiltersImmediate(immediate);
    });
    act(() => vi.advanceTimersByTime(120));

    expect(result.current.filters).toBe(immediate);
    expect(methods.setFilters).toHaveBeenCalledTimes(1);
    expect(methods.setFilters).toHaveBeenCalledWith(immediate);
  });

  it('cancels a pending slider change on unmount', () => {
    vi.useFakeTimers();
    const { adapter, methods } = makeAdapter();
    const { result, unmount } = renderHook(() => useWorkshopFilters(adapter));

    act(() => result.current.setFiltersDebounced(makeFilters('inactive')));
    unmount();
    act(() => vi.advanceTimersByTime(120));

    expect(methods.setFilters).not.toHaveBeenCalled();
  });

  it('cancels a pending slider change when the adapter changes', () => {
    vi.useFakeTimers();
    const first = makeAdapter();
    const second = makeAdapter();
    const { result, rerender } = renderHook(
      ({ adapter }) => useWorkshopFilters(adapter),
      { initialProps: { adapter: first.adapter } },
    );

    act(() => result.current.setFiltersDebounced(makeFilters('inactive')));
    rerender({ adapter: second.adapter });
    act(() => vi.advanceTimersByTime(120));

    expect(first.methods.setFilters).not.toHaveBeenCalled();
    expect(second.methods.setFilters).not.toHaveBeenCalled();
  });
});
