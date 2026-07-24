import { useCallback, useEffect, useReducer } from 'react';
import type { StoryBeat, StoryManifestV1 } from '../domain/types';
import { useReducedMotion } from './use-reduced-motion';

export interface StoryPlaybackState {
  beatIndex: number;
  playing: boolean;
  progress: number;
  showSources: boolean;
}

export type StoryPlaybackAction =
  | { type: 'seek'; index: number }
  | { type: 'togglePlaying' }
  | { type: 'toggleSources' }
  | { type: 'setProgress'; progress: number }
  | { type: 'stop' };

export const initialStoryPlayback: StoryPlaybackState = {
  beatIndex: 0,
  playing: false,
  progress: 0,
  showSources: false,
};

/**
 * The story state machine. The four fields are interdependent (seeking resets
 * progress, stopping pauses without losing the beat), so they change through
 * one reducer instead of four coupled useStates.
 */
export function storyPlaybackReducer(state: StoryPlaybackState, action: StoryPlaybackAction): StoryPlaybackState {
  switch (action.type) {
    case 'seek':
      return { ...state, beatIndex: action.index, progress: 0 };
    case 'togglePlaying':
      return { ...state, playing: !state.playing };
    case 'toggleSources':
      return { ...state, showSources: !state.showSources };
    case 'setProgress':
      return { ...state, progress: action.progress };
    case 'stop':
      return { ...state, playing: false, progress: 0, showSources: false };
    default:
      return state;
  }
}

/**
 * Owns story playback: beat position, play/pause, per-beat progress, and the
 * sources drawer. The caller supplies the side effects of landing on a beat
 * (camera, filters, encoding, scale) via onBeatApplied.
 */
export function useStoryPlayback(
  story: StoryManifestV1,
  isStoryMode: boolean,
  onBeatApplied: (beat: StoryBeat, index: number) => void,
): {
  playback: StoryPlaybackState;
  dispatch: React.Dispatch<StoryPlaybackAction>;
  applyBeat: (index: number) => void;
} {
  const [playback, dispatch] = useReducer(storyPlaybackReducer, initialStoryPlayback);
  const reducedMotion = useReducedMotion();
  /*
   * The beat index can momentarily exceed a newly selected story's length
   * (switching from a 5-beat story at beat 5 to a 4-beat one) - every consumer
   * sees the clamped value so that render never reads past the array.
   */
  const beatIndex = Math.min(playback.beatIndex, story.beats.length - 1);
  const { playing, progress } = playback;
  const beat = story.beats[beatIndex];

  const applyBeat = useCallback((index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), story.beats.length - 1);

    dispatch({ type: 'seek', index: nextIndex });
    onBeatApplied(story.beats[nextIndex], nextIndex);
  }, [onBeatApplied, story.beats]);

  useEffect(() => {
    if (!playing || !isStoryMode) {
      return undefined;
    }
    const advance = () => {
      if (beatIndex < story.beats.length - 1) {
        applyBeat(beatIndex + 1);
      } else {
        dispatch({ type: 'togglePlaying' });
      }
    };

    /*
     * Reduced motion keeps playback functional while advancing the scrubber in
     * discrete one-second steps. A silent hold reads as a broken play button.
     */
    /*
     * A beat never begins complete. Progress >= 1 can only be a stale
     * completion dispatch from the outgoing interval after a seek reset.
     */
    const safeProgress = progress >= 1 ? 0 : progress;
    const startedAt = performance.now() - safeProgress * beat.durationMs;
    const timer = window.setInterval(() => {
      const nextProgress = Math.min(1, (performance.now() - startedAt) / beat.durationMs);

      dispatch({ type: 'setProgress', progress: nextProgress });
      if (nextProgress >= 1) {
        advance();
      }
    }, reducedMotion ? 1_000 : 100);

    return () => window.clearInterval(timer);
  }, [applyBeat, beat.durationMs, beatIndex, isStoryMode, playing, progress, reducedMotion, story.beats.length]);

  return { playback: { ...playback, beatIndex }, dispatch, applyBeat };
}
