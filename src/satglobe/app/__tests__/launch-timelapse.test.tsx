import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchTimelapse, clampLaunchTimelapseIndex, LAUNCH_TIMELAPSE_STEP_MS } from '../launch-timelapse';

/** Supplies one stable media-query preference to the transport under test. */
function stubMotion(reducedMotion: boolean) {
  let matches = reducedMotion;
  const listeners = new Set<() => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  vi.spyOn(window, 'matchMedia').mockImplementation(() => mediaQuery);

  return {
    setReducedMotion(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('LaunchTimelapse', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clamps transport indexes to the installed stop list', () => {
    expect(clampLaunchTimelapseIndex(-4, 8)).toBe(0);
    expect(clampLaunchTimelapseIndex(3.9, 8)).toBe(3);
    expect(clampLaunchTimelapseIndex(20, 8)).toBe(7);
  });

  it('applies manual decade and slider stops without starting autoplay', () => {
    stubMotion(false);
    vi.useFakeTimers();
    const onYearChange = vi.fn();

    render(<LaunchTimelapse bounds={{ minYear: 1960, maxYear: 2026 }} onYearChange={onYearChange} />);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show launches through 1970' }));
    const slider = screen.getByRole('slider', { name: 'Launch history year' });

    expect(slider.getAttribute('aria-valuetext')).toBe('Through 1970');
    fireEvent.change(slider, { target: { value: 6 } });

    expect(onYearChange.mock.calls.map(([year]) => year)).toEqual([1970, 2020]);
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-playing')).toBe('false');
    expect(screen.getByTestId('launch-timelapse-year').textContent).toBe('THROUGH 2020');
    expect(slider.getAttribute('aria-valuetext')).toBe('Through 2020');
    expect(screen.getByRole('button', { name: 'Show launches through 2020' }).getAttribute('aria-current')).toBe('step');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts at the truthful opening frame, advances at two steps per second, and owns no timer after finishing', () => {
    stubMotion(false);
    vi.useFakeTimers();
    const onYearChange = vi.fn();

    render(<LaunchTimelapse bounds={{ minYear: 1960, maxYear: 1980 }} onYearChange={onYearChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play launch history' }));
    expect(onYearChange).toHaveBeenLastCalledWith(1960);

    act(() => vi.advanceTimersByTime(LAUNCH_TIMELAPSE_STEP_MS));
    expect(onYearChange).toHaveBeenLastCalledWith(1970);
    act(() => vi.advanceTimersByTime(LAUNCH_TIMELAPSE_STEP_MS));
    expect(onYearChange).toHaveBeenLastCalledWith(1980);
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-playing')).toBe('false');

    const completedCalls = onYearChange.mock.calls.length;

    act(() => vi.advanceTimersByTime(LAUNCH_TIMELAPSE_STEP_MS * 4));
    expect(onYearChange).toHaveBeenCalledTimes(completedCalls);
  });

  it('disables autoplay for reduced motion while preserving manual controls', () => {
    stubMotion(true);
    const onYearChange = vi.fn();

    render(<LaunchTimelapse bounds={{ minYear: 1960, maxYear: 2020 }} onYearChange={onYearChange} />);
    expect((screen.getByRole('button', { name: 'Play launch history' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Autoplay is disabled/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show launches through 2020' }));
    expect(onYearChange).toHaveBeenCalledOnce();
    expect(onYearChange).toHaveBeenCalledWith(2020);
  });

  it('stops an active timer when reduced motion becomes enabled', () => {
    const motion = stubMotion(false);

    vi.useFakeTimers();
    const onYearChange = vi.fn();

    render(<LaunchTimelapse bounds={{ minYear: 1960, maxYear: 1980 }} onYearChange={onYearChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play launch history' }));
    const callsBeforePreferenceChange = onYearChange.mock.calls.length;

    act(() => motion.setReducedMotion(true));
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-playing')).toBe('false');
    expect((screen.getByRole('button', { name: 'Play launch history' }) as HTMLButtonElement).disabled).toBe(true);

    act(() => vi.advanceTimersByTime(LAUNCH_TIMELAPSE_STEP_MS * 2));
    expect(onYearChange).toHaveBeenCalledTimes(callsBeforePreferenceChange);
  });

  it('stops and deactivates when an external view replaces its launch-year filter', () => {
    stubMotion(false);
    const onYearChange = vi.fn();
    const { rerender } = render(
      <LaunchTimelapse activeYear={1970} bounds={{ minYear: 1960, maxYear: 2020 }} onYearChange={onYearChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play launch history' }));
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-playing')).toBe('true');

    rerender(<LaunchTimelapse bounds={{ minYear: 1960, maxYear: 2020 }} onYearChange={onYearChange} />);

    expect(screen.getByTestId('launch-timelapse').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-playing')).toBe('false');
  });
});
