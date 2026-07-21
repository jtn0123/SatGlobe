import { memo } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { Icon } from './icon';
import { formatUtc } from './labels';

interface TimeDockProps {
  adapter: SatGlobeEngineAdapter;
  simulationTime: string;
  storyLocked?: boolean;
}

const STORY_TIME_HINT = 'Story beats control simulation time. Open Workshop to adjust it.';

/** Renders shared simulation-time controls, locking manual time changes during authored stories. */
function TimeDockBase({ adapter, simulationTime, storyLocked = false }: TimeDockProps) {
  const moveTime = (hours: number) => adapter.setSimulationTime(new Date(new Date(simulationTime).getTime() + hours * 3_600_000).toISOString());

  return (
    <footer className="sg-time-dock">
      <div className="sg-time-tools"><Icon name="clock" /><span>SIMULATION TIME</span></div>
      <button aria-label="Move back one hour" disabled={storyLocked} onClick={() => moveTime(-1)} title={storyLocked ? STORY_TIME_HINT : undefined} type="button">− 1H</button>
      <div className="sg-time-value"><strong>{formatUtc(simulationTime)}</strong><small>{storyLocked ? 'STORY-AUTHORED TIME · OPEN WORKSHOP TO ADJUST' : 'SGP4 PROPAGATION · PUBLIC GP ELEMENTS'}</small></div>
      <button aria-label="Move forward one hour" disabled={storyLocked} onClick={() => moveTime(1)} title={storyLocked ? STORY_TIME_HINT : undefined} type="button">+ 1H</button>
      <button className="sg-now" disabled={storyLocked} onClick={() => adapter.setSimulationTime(new Date().toISOString())} title={storyLocked ? STORY_TIME_HINT : undefined} type="button">NOW</button>
    </footer>
  );
}

export const TimeDock = memo(TimeDockBase);
