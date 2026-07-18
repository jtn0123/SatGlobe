import { memo } from 'react';
import type { AppMode } from '../domain/types';
import { Icon } from './icon';
import { formatNumber } from './labels';

interface TopBarProps {
  ready: boolean;
  objectCount: number;
  mode: AppMode;
  newestElementAge: number | null;
  storyCount: number;
  snapshotBusy: boolean;
  onModeChange: (mode: AppMode) => void;
  onSnapshot: () => void;
  onStoryOpen: () => void;
}

/** Renders global mode controls and local-catalog health. */
function TopBarBase({ ready, objectCount, mode, newestElementAge, storyCount, snapshotBusy, onModeChange, onSnapshot, onStoryOpen }: Readonly<TopBarProps>) {
  return (
    <header className="sg-topbar">
      <button className="sg-brand" onClick={() => onModeChange('workshop')} type="button">
        <span className="sg-brand-mark"><i /><b /></span>
        <span><strong>SATGLOBE</strong><small>ORBITAL WORKSHOP / ALPHA</small></span>
      </button>
      <div className="sg-topbar-center" data-testid="catalog-status">
        <span className={`sg-status-dot ${ready ? 'is-ready' : ''}`} />
        <span>{ready ? `${formatNumber(objectCount)} OBJECTS · LOCAL CATALOG` : 'INITIALIZING PROPAGATION ENGINE'}</span>
        {newestElementAge !== null && newestElementAge >= 14 && <strong className="sg-stale-data">NEWEST ELEMENT {Math.floor(newestElementAge)}D OLD</strong>}
      </div>
      <div className="sg-topbar-actions">
        <span className="sg-visually-hidden" id="sg-snapshot-help">Downloads only the rendered canvas. Interface panels and story captions are not included.</span>
        <button
          aria-busy={snapshotBusy || undefined}
          aria-describedby="sg-snapshot-help"
          aria-label={snapshotBusy ? 'Preparing canvas snapshot' : 'Download canvas snapshot'}
          className="sg-snapshot-button"
          data-testid="snapshot-export"
          disabled={!ready || snapshotBusy}
          onClick={onSnapshot}
          title="Download the rendered canvas only; interface panels and story captions are not included."
          type="button"
        >
          <Icon name="camera" size={16} />
        </button>
        <nav className="sg-mode-switcher" aria-label="Display mode">
          <button className={mode === 'workshop' ? 'is-active' : ''} onClick={() => onModeChange('workshop')} type="button">Workshop</button>
          <button className={mode === 'presentation' ? 'is-active' : ''} onClick={() => onModeChange('presentation')} type="button">Present</button>
          <button className={mode === 'story' ? 'is-active' : ''} data-testid="story-mode" onClick={onStoryOpen} type="button">Story <span>{String(storyCount).padStart(2, '0')}</span></button>
        </nav>
      </div>
    </header>
  );
}

export const TopBar = memo(TopBarBase);
