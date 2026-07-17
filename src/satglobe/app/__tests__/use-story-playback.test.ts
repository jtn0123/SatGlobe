import { describe, expect, it } from 'vitest';
import { initialStoryPlayback, storyPlaybackReducer, type StoryPlaybackState } from '../use-story-playback';

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

  it('stop pauses and rewinds the beat but keeps the position', () => {
    const next = storyPlaybackReducer(midPlayback, { type: 'stop' });

    expect(next).toEqual({ beatIndex: 2, playing: false, progress: 0, showSources: true });
  });

  it('returns the same state for unknown actions', () => {
    const next = storyPlaybackReducer(midPlayback, { type: 'bogus' } as never);

    expect(next).toBe(midPlayback);
  });
});
