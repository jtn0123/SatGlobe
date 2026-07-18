import { memo } from 'react';
import type { AppMode } from '../domain/types';
import { formatNumber } from './labels';

interface TopBarProps {
  ready: boolean;
  objectCount: number;
  mode: AppMode;
  newestElementAge: number | null;
  storyCount: number;
  onModeChange: (mode: AppMode) => void;
  onStoryOpen: () => void;
}

/** Returns the warning shown when installed element time is stale or future-dated. */
function catalogEpochNotice(newestElementAge: number | null): string | null {
  if (newestElementAge === null) {
    return null;
  }
  if (newestElementAge < 0) {
    const magnitude = Math.abs(newestElementAge);
    const days = magnitude < 1 ? '<1' : Math.floor(magnitude).toString();

    return `NEWEST ELEMENT ${days}D IN FUTURE`;
  }

  return newestElementAge >= 14 ? `NEWEST ELEMENT ${Math.floor(newestElementAge)}D OLD` : null;
}

/** Renders global mode controls and local-catalog health. */
function TopBarBase({ ready, objectCount, mode, newestElementAge, storyCount, onModeChange, onStoryOpen }: Readonly<TopBarProps>) {
  const epochNotice = catalogEpochNotice(newestElementAge);

  return (
    <header className="sg-topbar">
      <button className="sg-brand" onClick={() => onModeChange('workshop')} type="button">
        <span className="sg-brand-mark"><i /><b /></span>
        <span><strong>SATGLOBE</strong><small>ORBITAL WORKSHOP / ALPHA</small></span>
      </button>
      <div className="sg-topbar-center" data-testid="catalog-status">
        <span className={`sg-status-dot ${ready ? 'is-ready' : ''}`} />
        <span>{ready ? `${formatNumber(objectCount)} OBJECTS · LOCAL CATALOG` : 'INITIALIZING PROPAGATION ENGINE'}</span>
        {epochNotice && <strong className="sg-stale-data">{epochNotice}</strong>}
      </div>
      <nav className="sg-mode-switcher" aria-label="Display mode">
        <button className={mode === 'workshop' ? 'is-active' : ''} onClick={() => onModeChange('workshop')} type="button">Workshop</button>
        <button className={mode === 'presentation' ? 'is-active' : ''} onClick={() => onModeChange('presentation')} type="button">Present</button>
        <button className={mode === 'story' ? 'is-active' : ''} data-testid="story-mode" onClick={onStoryOpen} type="button">Story <span>{String(storyCount).padStart(2, '0')}</span></button>
      </nav>
    </header>
  );
}

export const TopBar = memo(TopBarBase);
