import { useCallback, useEffect, useMemo, useState } from 'react';
import { launchYearStops, type LaunchYearBounds } from '../domain/launch-years';
import { Icon } from './icon';
import { useReducedMotion } from './use-reduced-motion';

export const LAUNCH_TIMELAPSE_STEP_MS = 500;

interface LaunchTimelapseProps {
  bounds: LaunchYearBounds;
  activeYear?: number;
  onYearChange: (year: number) => void;
}

/** Keeps transport indexes inside the installed launch-history stops. */
export function clampLaunchTimelapseIndex(index: number, stopCount: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), Math.max(stopCount - 1, 0));
}

/** A bounded, cumulative launch-history transport for Workshop and Present. */
export function LaunchTimelapse({ bounds, activeYear, onYearChange }: Readonly<LaunchTimelapseProps>) {
  const stops = useMemo(() => launchYearStops(bounds), [bounds.maxYear, bounds.minYear]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = useReducedMotion();
  const active = activeYear !== undefined;
  const lastIndex = stops.length - 1;
  const year = activeYear ?? stops[index];

  useEffect(() => {
    if (activeYear === undefined) {
      setPlaying(false);

      return;
    }
    let matchingIndex = 0;

    for (let stopIndex = 0; stopIndex < stops.length; stopIndex += 1) {
      if (stops[stopIndex] <= activeYear) {
        matchingIndex = stopIndex;
      }
    }
    setIndex(matchingIndex);
  }, [activeYear, stops]);

  const applyIndex = useCallback((requestedIndex: number) => {
    const nextIndex = clampLaunchTimelapseIndex(requestedIndex, stops.length);

    setPlaying(false);
    setIndex(nextIndex);
    onYearChange(stops[nextIndex]);
  }, [onYearChange, stops]);

  const togglePlaying = useCallback(() => {
    if (reducedMotion) {
      return;
    }
    if (playing) {
      setPlaying(false);

      return;
    }
    if (!active || index >= lastIndex) {
      setIndex(0);
      onYearChange(stops[0]);
    }
    setPlaying(true);
  }, [active, index, lastIndex, onYearChange, playing, reducedMotion, stops]);

  useEffect(() => {
    if (reducedMotion) {
      setPlaying(false);
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (!playing || reducedMotion) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const nextIndex = clampLaunchTimelapseIndex(index + 1, stops.length);

      setIndex(nextIndex);
      onYearChange(stops[nextIndex]);
      if (nextIndex >= lastIndex) {
        setPlaying(false);
      }
    }, LAUNCH_TIMELAPSE_STEP_MS);

    return () => window.clearTimeout(timer);
  }, [index, lastIndex, onYearChange, playing, stops]);

  return (
    <section
      aria-label="Launch history time-lapse"
      className={`sg-launch-timelapse${active ? ' is-active' : ''}`}
      data-active={String(active)}
      data-playing={String(playing)}
      data-testid="launch-timelapse"
      data-year={year}
    >
      <header>
        <span>LAUNCH HISTORY / CUMULATIVE</span>
        <strong data-testid="launch-timelapse-year">THROUGH {year}</strong>
        <small>{active ? 'Installed objects with a known launch year' : 'Choose a stop or play from the opening frame'}</small>
      </header>
      <div className="sg-launch-timelapse-transport">
        <button aria-label="Previous launch decade" disabled={index === 0} onClick={() => applyIndex(index - 1)} type="button"><Icon name="previous" size={14} /></button>
        <button
          aria-describedby={reducedMotion ? 'sg-launch-timelapse-motion-note' : undefined}
          aria-label={playing ? 'Pause launch history' : 'Play launch history'}
          className="sg-launch-timelapse-play"
          disabled={reducedMotion}
          onClick={togglePlaying}
          type="button"
        ><Icon name={playing ? 'pause' : 'play'} size={15} /></button>
        <button aria-label="Next launch decade" disabled={index === lastIndex} onClick={() => applyIndex(index + 1)} type="button"><Icon name="next" size={14} /></button>
        <div className="sg-launch-timelapse-scrub">
          <input
            aria-label="Launch history year"
            aria-valuetext={`Through ${year}`}
            max={lastIndex}
            min={0}
            onChange={(event) => applyIndex(Number(event.currentTarget.value))}
            step={1}
            type="range"
            value={index}
          />
          <div aria-hidden="true" className="sg-launch-timelapse-ticks">
            {stops.map((stop, stopIndex) => <i className={stopIndex <= index && active ? 'is-past' : ''} key={stop} />)}
          </div>
        </div>
        <span className="sg-launch-timelapse-counter">{String(index + 1).padStart(2, '0')} / {String(stops.length).padStart(2, '0')}</span>
      </div>
      <div className="sg-launch-timelapse-stops">
        {stops.map((stop, stopIndex) => (
          <button
            aria-label={`Show launches through ${stop}`}
            aria-current={stopIndex === index ? 'step' : undefined}
            className={stopIndex === index ? 'is-current' : ''}
            key={stop}
            onClick={() => applyIndex(stopIndex)}
            type="button"
          >{stop}</button>
        ))}
      </div>
      {reducedMotion && <small className="sg-launch-timelapse-motion-note" id="sg-launch-timelapse-motion-note">Reduced motion is on. Autoplay is disabled; the slider and decade controls remain available.</small>}
    </section>
  );
}
