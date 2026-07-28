import { memo } from 'react';
import type { PlaylistV1 } from '../domain/types';
import { Icon } from './icon';

interface PlaylistDeckProps {
  entryIndex: number;
  playing: boolean;
  playlist: PlaylistV1;
  progress: number;
  reducedMotion: boolean;
  onEntryChange: (index: number) => void;
  onOpenWorkshop: () => void;
  onPlayingChange: () => void;
}

/** A compact mission-sequence transport over the live orbital scene. */
function PlaylistDeckBase({
  entryIndex,
  playing,
  playlist,
  progress,
  reducedMotion,
  onEntryChange,
  onOpenWorkshop,
  onPlayingChange,
}: Readonly<PlaylistDeckProps>) {
  const entry = playlist.entries[entryIndex];

  return (
    <section
      className="sg-playlist-deck"
      data-entry-index={entryIndex}
      data-playing={playing}
      data-playlist-id={playlist.id}
      data-testid="playlist-deck"
    >
      <div className="sg-playlist-rail" aria-hidden="true"><span /><span /><span /></div>
      <div aria-live="polite" className="sg-playlist-copy">
        <span>MISSION SEQUENCE · {playlist.name}</span>
        <h2 data-testid="playlist-caption">{entry.caption}</h2>
        <p>{entry.view.name}</p>
      </div>
      <div className="sg-playlist-controls">
        <button aria-label="Previous playlist view" disabled={entryIndex === 0} onClick={() => onEntryChange(entryIndex - 1)} type="button"><Icon name="previous" /></button>
        <button
          aria-describedby={reducedMotion ? 'sg-playlist-motion-note' : undefined}
          aria-label={playing ? 'Pause playlist' : 'Play playlist'}
          className="sg-playlist-play"
          data-testid="playlist-play"
          onClick={onPlayingChange}
          type="button"
        ><Icon name={playing ? 'pause' : 'play'} /></button>
        <button aria-label="Next playlist view" data-testid="playlist-next" disabled={entryIndex === playlist.entries.length - 1} onClick={() => onEntryChange(entryIndex + 1)} type="button"><Icon name="next" /></button>
        <div className="sg-playlist-scrub">
          <div aria-hidden="true" className="sg-playlist-progress"><span style={{ width: `${progress * 100}%` }} /></div>
          <div className="sg-playlist-stops">
            {playlist.entries.map((item, index) => (
              <button
                aria-current={index === entryIndex ? 'step' : undefined}
                aria-label={`Go to ${item.caption}`}
                className={index <= entryIndex ? 'is-past' : ''}
                key={`${item.view.name}-${index}`}
                onClick={() => onEntryChange(index)}
                type="button"
              ><span /></button>
            ))}
          </div>
        </div>
        <span className="sg-playlist-counter" data-testid="playlist-counter">{String(entryIndex + 1).padStart(2, '0')} / {String(playlist.entries.length).padStart(2, '0')}</span>
        <button className="sg-playlist-action" onClick={onOpenWorkshop} type="button">Open workshop</button>
      </div>
      {reducedMotion && <small className="sg-playlist-motion-note" id="sg-playlist-motion-note">Reduced motion is on. Playback holds each view, then jumps without animated progress.</small>}
    </section>
  );
}

export const PlaylistDeck = memo(PlaylistDeckBase);
