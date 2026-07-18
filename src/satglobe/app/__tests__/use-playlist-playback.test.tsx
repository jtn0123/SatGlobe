import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type PlaylistV1 } from '../../domain/types';
import {
  initialPlaylistPlayback,
  playlistPlaybackReducer,
  usePlaylistPlayback,
  type PlaylistPlaybackState,
} from '../use-playlist-playback';

const playlist: PlaylistV1 = {
  schemaVersion: 1,
  id: 'caa3cb2f-bd97-4f76-b3a9-55e6b07cad41',
  name: 'Two orbit sequence',
  entries: ['Low orbit', 'High ring'].map((name) => ({
    caption: name,
    durationMs: 1_000,
    view: {
      schemaVersion: 1,
      name,
      camera: DEFAULT_CAMERA,
      simulationTime: '2026-07-18T12:00:00.000Z',
      filters: structuredClone(DEFAULT_FILTERS),
      encoding: 'object-type' as const,
      selectedObjectIds: [],
      scaleMode: 'semantic' as const,
      presentation: { mode: 'presentation' as const, panelsVisible: false },
    },
  })),
};

/** Supplies one stable media-query preference to the hook under test. */
function stubMotion(reducedMotion: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: reducedMotion,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('playlistPlaybackReducer', () => {
  const running: PlaylistPlaybackState = { entryIndex: 1, playing: true, progress: 0.6 };

  it('loads paused at the first entry and never restores transport state', () => {
    expect(playlistPlaybackReducer(running, { type: 'load' })).toEqual(initialPlaylistPlayback);
  });

  it('seeks, toggles, stops, and finishes as one state machine', () => {
    expect(playlistPlaybackReducer(running, { type: 'seek', index: 0 })).toEqual({ entryIndex: 0, playing: true, progress: 0 });
    expect(playlistPlaybackReducer(running, { type: 'togglePlaying' }).playing).toBe(false);
    expect(playlistPlaybackReducer(running, { type: 'stop' })).toEqual({ entryIndex: 1, playing: false, progress: 0 });
    expect(playlistPlaybackReducer(running, { type: 'finish' })).toEqual({ entryIndex: 1, playing: false, progress: 1 });
  });
});

describe('usePlaylistPlayback', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('owns no interval while paused and applies manual steps directly', () => {
    stubMotion(false);
    const interval = vi.spyOn(window, 'setInterval');
    const onEntryApplied = vi.fn();
    const { result } = renderHook(() => usePlaylistPlayback(playlist, true, onEntryApplied));

    expect(result.current.playback.playing).toBe(false);
    expect(interval).not.toHaveBeenCalled();
    act(() => result.current.applyEntry(1));
    expect(onEntryApplied).toHaveBeenCalledWith(playlist.entries[1], 1);
    expect(result.current.playback.entryIndex).toBe(1);
    expect(interval).not.toHaveBeenCalled();
  });

  it('advances while playing, then stops at the final entry', () => {
    stubMotion(false);
    vi.useFakeTimers();
    const onEntryApplied = vi.fn();
    const { result } = renderHook(() => usePlaylistPlayback(playlist, true, onEntryApplied));

    act(() => result.current.togglePlaying());
    expect(result.current.playback.playing).toBe(true);
    act(() => vi.advanceTimersByTime(1_100));
    expect(onEntryApplied).toHaveBeenCalledWith(playlist.entries[1], 1);
    expect(result.current.playback.entryIndex).toBe(1);
    act(() => vi.advanceTimersByTime(1_100));
    expect(result.current.playback.playing).toBe(false);
    expect(result.current.playback.progress).toBe(1);
  });

  it('uses one discrete timeout instead of progress intervals for reduced motion', () => {
    stubMotion(true);
    vi.useFakeTimers();
    const interval = vi.spyOn(window, 'setInterval');
    const timeout = vi.spyOn(window, 'setTimeout');
    const onEntryApplied = vi.fn();
    const { result } = renderHook(() => usePlaylistPlayback(playlist, true, onEntryApplied));

    expect(result.current.reducedMotion).toBe(true);
    act(() => result.current.togglePlaying());
    expect(result.current.playback.playing).toBe(true);
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onEntryApplied).toHaveBeenCalledWith(playlist.entries[1], 1);
  });

  it('remounts paused instead of resuming autoplay', () => {
    stubMotion(false);
    const first = renderHook(() => usePlaylistPlayback(playlist, true, vi.fn()));

    act(() => first.result.current.togglePlaying());
    expect(first.result.current.playback.playing).toBe(true);
    first.unmount();
    const reloaded = renderHook(() => usePlaylistPlayback(playlist, true, vi.fn()));

    expect(reloaded.result.current).toMatchObject({ playback: { entryIndex: 0, playing: false, progress: 0 } });
  });

  it('explicitly restarts the same playlist id from entry zero', () => {
    stubMotion(false);
    const { result } = renderHook(() => usePlaylistPlayback(playlist, true, vi.fn()));

    act(() => result.current.applyEntry(1));
    act(() => result.current.togglePlaying());
    expect(result.current.playback).toMatchObject({ entryIndex: 1, playing: true });

    act(() => result.current.restart());

    expect(result.current.playback).toEqual(initialPlaylistPlayback);
  });
});
