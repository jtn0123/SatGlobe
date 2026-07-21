import { memo } from 'react';
import { useDialogFocus } from './use-dialog-focus';
import type { StoryFact, StoryManifestV1 } from '../domain/types';
import { Icon } from './icon';


/** Renders one sourced story fact and its publisher links. */
function StoryFactCard({ fact, story }: { fact: StoryFact; story: StoryManifestV1 }) {
  return (
    <div className="sg-fact">
      <p>{fact.text}</p>
      {fact.caveat && <small>{fact.caveat}</small>}
      <div>
        {fact.sourceIds.map((sourceId) => {
          const source = story.sources.find(({ id }) => id === sourceId);

          return source ? <a href={source.url} key={sourceId} rel="noreferrer" target="_blank">{source.publisher} ↗</a> : null;
        })}
      </div>
    </div>
  );
}

interface StoryDeckProps {
  beatIndex: number;
  playing: boolean;
  progress: number;
  showSources: boolean;
  story: StoryManifestV1;
  /** The full library, for the picker; ids/titles only are read. */
  stories: readonly StoryManifestV1[];
  onAuthoredView: () => void;
  onBeatChange: (index: number) => void;
  onOpenWorkshop: () => void;
  onPlayingChange: () => void;
  onSourcesChange: () => void;
  onStoryChange: (storyId: string) => void;
}

/** Renders guided playback without replacing the underlying orbital scene. */
/** Wraps the sources drawer with modal-dialog focus behavior. */
function SourcesDrawerShell({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onDismiss);

  return (
    <aside aria-label="Sources and technical facts" aria-modal="true" className="sg-source-drawer" ref={dialogRef} role="dialog">
      {children}
    </aside>
  );
}

/** Compact story transport: beats, scrubber, playback, and the sources drawer. */
function StoryDeckBase(props: StoryDeckProps) {
  const { beatIndex, playing, progress, showSources, story } = props;
  const beat = story.beats[beatIndex];
  const finalBeat = beatIndex === story.beats.length - 1;
  let playbackLabel = 'Play story';

  if (playing) {
    playbackLabel = 'Pause story';
  } else if (finalBeat) {
    playbackLabel = 'Replay story';
  }

  return (
    <section className="sg-story-deck" data-beat-id={beat.id} data-story-id={story.id} data-testid="story-deck">
      <div className="sg-story-topline">
        <span>{beat.eyebrow}</span>
        <label className="sg-story-picker">
          <span>STORY</span>
          <select className="browser-default" data-testid="story-picker" onChange={(event) => props.onStoryChange(event.target.value)} value={story.id}>
            {props.stories.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
        <div><span className={beat.reconstruction === 'reconstructed' ? 'is-reconstructed' : ''}>{beat.reconstruction === 'reconstructed' ? 'RECONSTRUCTED' : 'INSTALLED CATALOG'}</span><button onClick={props.onSourcesChange} type="button">Sources · Facts</button></div>
      </div>
      <div className="sg-story-copy"><span>{beat.dateLabel}</span><h2 data-testid="story-beat-title">{beat.title}</h2><p>{beat.narration}</p></div>
      <div className="sg-story-controls">
        <button aria-label="Previous beat" disabled={beatIndex === 0} onClick={() => props.onBeatChange(beatIndex - 1)} type="button"><Icon name="previous" /></button>
        <button aria-label={playbackLabel} className="sg-story-play" data-testid="story-play" onClick={props.onPlayingChange} type="button"><Icon name={playing ? 'pause' : 'play'} /></button>
        <button aria-label="Next beat" disabled={finalBeat} onClick={() => props.onBeatChange(beatIndex + 1)} type="button"><Icon name="next" /></button>
        <div className="sg-story-scrub">
          <div className="sg-story-progress"><span style={{ width: `${progress * 100}%` }} /></div>
          <div className="sg-story-beats">{story.beats.map((item, index) => <button aria-label={`Go to ${item.title}`} className={index <= beatIndex ? 'is-past' : ''} key={item.id} onClick={() => props.onBeatChange(index)} type="button"><span /></button>)}</div>
        </div>
        <span className="sg-story-counter" data-testid="story-beat-counter">{String(beatIndex + 1).padStart(2, '0')} / {String(story.beats.length).padStart(2, '0')}</span>
        <button className="sg-story-action" onClick={props.onAuthoredView} type="button"><Icon name="focus" size={15} /> Authored view</button>
        <button className="sg-story-action" onClick={props.onOpenWorkshop} type="button">Open workshop</button>
      </div>
      {showSources && (
        <SourcesDrawerShell onDismiss={props.onSourcesChange}>
          <div className="sg-inspector-head"><div><div className="sg-panel-kicker">SOURCES & TECHNICAL FACTS</div><h2>{beat.title}</h2></div><button aria-label="Close sources" className="sg-icon-button" onClick={props.onSourcesChange} type="button"><Icon name="close" /></button></div>
          {beat.factIds.map((factId) => {
            const fact = story.facts.find(({ id }) => id === factId);

            return fact ? <StoryFactCard fact={fact} key={fact.id} story={story} /> : null;
          })}
          <div className="sg-truth-note"><Icon name="info" /><span>Historical chapters use sourced reconstruction. Current positions are propagated from the installed public catalog.</span></div>
        </SourcesDrawerShell>
      )}
    </section>
  );
}

export const StoryDeck = memo(StoryDeckBase);
