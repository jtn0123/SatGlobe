import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { starlinkBuildoutStory } from '../../stories/starlink-buildout';
import { initialStoryPlayback, storyPlaybackReducer, type StoryPlaybackState, useStoryPlayback } from '../use-story-playback';

/** Supplies the shared motion hook with a stable preference. */
function stubMotion(reducedMotion: boolean) {
  const mediaQuery = {
    matches: reducedMotion,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  vi.spyOn(window, 'matchMedia').mockImplementation(() => mediaQuery);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('storyPlaybackReducer', () => {
  const midPlayback: StoryPlaybackState = { beatIndex: 2, playing: true, progress: 0.6, showSources: true };

  it('seek moves to the beat and resets progress without touching playback', () => {
    const next = storyPlaybackReducer(midPlayback, { type: 'seek', index: 4 });

    expect(next).toEqual({ beatIndex: 4, playing: true, progress: 0, showSources: true });
  });

  it('togglePlaying flips only the playing flag', () => {
    expect(storyPlaybackReducer(midPlayback, { type: 'togglePlaying' }).playing).toBe(false);
    expect(storyPlaybackReducer(initialStoryPlayback, { type: 'togglePlaying' }).playing).toBe(true);
    expect(storyPlaybackReducer(midPlayback, { type: 'togglePlaying' }).progress).toBe(0.6);
  });

  it('toggleSources flips only the sources drawer', () => {
    const next = storyPlaybackReducer(midPlayback, { type: 'toggleSources' });

    expect(next.showSources).toBe(false);
    expect(next.beatIndex).toBe(2);
    expect(next.playing).toBe(true);
  });

  it('setProgress records per-beat progress', () => {
    expect(storyPlaybackReducer(midPlayback, { type: 'setProgress', progress: 0.9 }).progress).toBe(0.9);
  });

  it('stop pauses, rewinds, and closes the sources drawer but keeps the position', () => {
    const next = storyPlaybackReducer(midPlayback, { type: 'stop' });

    expect(next).toEqual({ beatIndex: 2, playing: false, progress: 0, showSources: false });
  });

  it('returns the same state for unknown actions', () => {
    const next = storyPlaybackReducer(midPlayback, { type: 'bogus' } as never);

    expect(next).toBe(midPlayback);
  });
});

describe('useStoryPlayback', () => {
  it('advances reduced-motion progress in visible one-second steps', () => {
    stubMotion(true);
    vi.useFakeTimers();
    const story = structuredClone(starlinkBuildoutStory);
    const onBeatApplied = vi.fn();

    story.beats[0].durationMs = 2_000;
    const { result } = renderHook(() => useStoryPlayback(story, true, onBeatApplied));

    act(() => result.current.dispatch({ type: 'togglePlaying' }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.playback.progress).toBe(0.5);
    expect(onBeatApplied).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(onBeatApplied).toHaveBeenCalledWith(story.beats[1], 1);
    expect(result.current.playback.beatIndex).toBe(1);
  });
});
