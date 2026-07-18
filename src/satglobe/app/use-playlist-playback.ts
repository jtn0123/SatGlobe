import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { PlaylistEntryV1, PlaylistV1 } from '../domain/types';

export interface PlaylistPlaybackState {
  entryIndex: number;
  playing: boolean;
  progress: number;
}

export type PlaylistPlaybackAction =
  | { type: 'load' }
  | { type: 'seek'; index: number }
  | { type: 'togglePlaying' }
  | { type: 'setProgress'; progress: number }
  | { type: 'finish' }
  | { type: 'stop' };

export const initialPlaylistPlayback: PlaylistPlaybackState = {
  entryIndex: 0,
  playing: false,
  progress: 0,
};

/** Changes the coupled transport fields without persisting any playback state. */
export function playlistPlaybackReducer(
  state: PlaylistPlaybackState,
  action: PlaylistPlaybackAction,
): PlaylistPlaybackState {
  switch (action.type) {
    case 'load':
      return initialPlaylistPlayback;
    case 'seek':
      return { ...state, entryIndex: action.index, progress: 0 };
    case 'togglePlaying':
      return { ...state, playing: !state.playing };
    case 'setProgress':
      return { ...state, progress: action.progress };
    case 'finish':
      return { ...state, playing: false, progress: 1 };
    case 'stop':
      return { ...state, playing: false, progress: 0 };
    default:
      return state;
  }
}

/** Tracks the accessibility preference so the player can expose manual-only transport. */
function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);

    query.addEventListener?.('change', update);

    return () => query.removeEventListener?.('change', update);
  }, []);

  return reducedMotion;
}

/**
 * Owns playlist transport. Paused states allocate no timer, and a new
 * playlist always loads at entry zero while paused.
 */
export function usePlaylistPlayback(
  playlist: PlaylistV1 | null,
  enabled: boolean,
  onEntryApplied: (entry: PlaylistEntryV1, index: number) => void,
): {
  playback: PlaylistPlaybackState;
  reducedMotion: boolean;
  applyEntry: (index: number) => void;
  restart: () => void;
  togglePlaying: () => void;
  stop: () => void;
} {
  const [playback, dispatch] = useReducer(playlistPlaybackReducer, initialPlaylistPlayback);
  const reducedMotion = useReducedMotion();
  const loadedPlaylistId = useRef<string | null>(null);
  const entryCount = playlist?.entries.length ?? 0;
  const entryIndex = entryCount > 0 ? Math.min(playback.entryIndex, entryCount - 1) : 0;

  useEffect(() => {
    const nextId = playlist?.id ?? null;

    if (loadedPlaylistId.current !== nextId) {
      loadedPlaylistId.current = nextId;
      dispatch({ type: 'load' });
    }
  }, [playlist?.id]);

  useEffect(() => {
    if (!enabled && playback.playing) {
      dispatch({ type: 'stop' });
    }
  }, [enabled, playback.playing]);

  const applyEntry = useCallback((index: number) => {
    if (!playlist) {
      return;
    }
    const nextIndex = Math.min(Math.max(index, 0), playlist.entries.length - 1);

    dispatch({ type: 'seek', index: nextIndex });
    onEntryApplied(playlist.entries[nextIndex], nextIndex);
  }, [onEntryApplied, playlist]);
  const togglePlaying = useCallback(() => {
    if (playlist && enabled) {
      dispatch({ type: 'togglePlaying' });
    }
  }, [enabled, playlist]);
  const restart = useCallback(() => dispatch({ type: 'load' }), []);
  const stop = useCallback(() => dispatch({ type: 'stop' }), []);

  useEffect(() => {
    if (!playlist || !enabled || !playback.playing) {
      return undefined;
    }
    const entry = playlist.entries[entryIndex];
    const startedAt = performance.now() - playback.progress * entry.durationMs;
    const advance = () => {
      if (entryIndex < playlist.entries.length - 1) {
        applyEntry(entryIndex + 1);
      } else {
        dispatch({ type: 'finish' });
      }
    };

    if (reducedMotion) {
      const timer = window.setTimeout(advance, Math.max(0, (1 - playback.progress) * entry.durationMs));

      return () => window.clearTimeout(timer);
    }
    const timer = window.setInterval(() => {
      const nextProgress = Math.min(1, (performance.now() - startedAt) / entry.durationMs);

      if (nextProgress < 1) {
        dispatch({ type: 'setProgress', progress: nextProgress });

        return;
      }
      advance();
    }, 100);

    return () => window.clearInterval(timer);
  }, [applyEntry, enabled, entryIndex, playback.playing, playback.progress, playlist, reducedMotion]);

  return {
    playback: { ...playback, entryIndex },
    reducedMotion,
    applyEntry,
    restart,
    togglePlaying,
    stop,
  };
}
