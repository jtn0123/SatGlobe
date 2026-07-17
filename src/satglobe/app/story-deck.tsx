import { memo } from 'react';
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
  onAuthoredView: () => void;
  onBeatChange: (index: number) => void;
  onOpenWorkshop: () => void;
  onPlayingChange: () => void;
  onSourcesChange: () => void;
}

/** Renders guided playback without replacing the underlying orbital scene. */
function StoryDeckBase(props: StoryDeckProps) {
  const { beatIndex, playing, progress, showSources, story } = props;
  const beat = story.beats[beatIndex];

  return (
    <section className="sg-story-deck" data-testid="story-deck">
      <div className="sg-story-topline">
        <span>{beat.eyebrow}</span>
        <div><span className={beat.reconstruction === 'reconstructed' ? 'is-reconstructed' : ''}>{beat.reconstruction === 'reconstructed' ? 'RECONSTRUCTED' : 'INSTALLED CATALOG'}</span><button onClick={props.onSourcesChange} type="button">Sources · Facts</button></div>
      </div>
      <div className="sg-story-copy"><span>{beat.dateLabel}</span><h2>{beat.title}</h2><p>{beat.narration}</p></div>
      <div className="sg-story-controls">
        <button aria-label="Previous beat" onClick={() => props.onBeatChange(beatIndex - 1)} type="button"><Icon name="previous" /></button>
        <button aria-label={playing ? 'Pause story' : 'Play story'} className="sg-story-play" data-testid="story-play" onClick={props.onPlayingChange} type="button"><Icon name={playing ? 'pause' : 'play'} /></button>
        <button aria-label="Next beat" onClick={() => props.onBeatChange(beatIndex + 1)} type="button"><Icon name="next" /></button>
        <div className="sg-story-scrub">
          <div className="sg-story-progress"><span style={{ width: `${progress * 100}%` }} /></div>
          <div className="sg-story-beats">{story.beats.map((item, index) => <button aria-label={`Go to ${item.title}`} className={index <= beatIndex ? 'is-past' : ''} key={item.id} onClick={() => props.onBeatChange(index)} type="button"><span /></button>)}</div>
        </div>
        <span className="sg-story-counter">{String(beatIndex + 1).padStart(2, '0')} / {String(story.beats.length).padStart(2, '0')}</span>
        <button className="sg-story-action" onClick={props.onAuthoredView} type="button"><Icon name="focus" size={15} /> Authored view</button>
        <button className="sg-story-action" onClick={props.onOpenWorkshop} type="button">Open workshop</button>
      </div>
      {showSources && (
        <aside className="sg-source-drawer">
          <div className="sg-inspector-head"><div><div className="sg-panel-kicker">SOURCES & TECHNICAL FACTS</div><h2>{beat.title}</h2></div><button aria-label="Close sources" className="sg-icon-button" onClick={props.onSourcesChange} type="button"><Icon name="close" /></button></div>
          {beat.factIds.map((factId) => {
            const fact = story.facts.find(({ id }) => id === factId);

            return fact ? <StoryFactCard fact={fact} key={fact.id} story={story} /> : null;
          })}
          <div className="sg-truth-note"><Icon name="info" /><span>Historical chapters use sourced reconstruction. Current positions are propagated from the installed public catalog.</span></div>
        </aside>
      )}
    </section>
  );
}

export const StoryDeck = memo(StoryDeckBase);
