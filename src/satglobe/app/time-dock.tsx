import { memo } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { Icon } from './icon';
import { formatUtc } from './labels';

/** Renders shared simulation-time controls for every scene mode. */
function TimeDockBase({ adapter, simulationTime }: { adapter: SatGlobeEngineAdapter; simulationTime: string }) {
  const moveTime = (hours: number) => adapter.setSimulationTime(new Date(new Date(simulationTime).getTime() + hours * 3_600_000).toISOString());

  return (
    <footer className="sg-time-dock">
      <div className="sg-time-tools"><Icon name="clock" /><span>SIMULATION TIME</span></div>
      <button aria-label="Move back one hour" onClick={() => moveTime(-1)} type="button">− 1H</button>
      <div className="sg-time-value"><strong>{formatUtc(simulationTime)}</strong><small>SGP4 PROPAGATION · PUBLIC GP ELEMENTS</small></div>
      <button aria-label="Move forward one hour" onClick={() => moveTime(1)} type="button">+ 1H</button>
      <button className="sg-now" onClick={() => adapter.setSimulationTime(new Date().toISOString())} type="button">NOW</button>
    </footer>
  );
}

export const TimeDock = memo(TimeDockBase);
