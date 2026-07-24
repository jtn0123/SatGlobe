import { useMemo, useState } from 'react';
import type { LaunchCohortView } from '../domain/types';
import { formatCalendarDate, formatNumber } from './labels';

interface LaunchExplorerProps {
  cohorts: readonly LaunchCohortView[];
  selectedCohortId?: string;
  onOpenMembers: (cohort: LaunchCohortView) => void;
  onOpenStory: (cohort: LaunchCohortView) => void;
  onSelect: (cohort: LaunchCohortView) => void;
}

/** Browses launch-derived groups without implying that catalog membership equals original deployment count. */
export function LaunchExplorer({
  cohorts,
  selectedCohortId,
  onOpenMembers,
  onOpenStory,
  onSelect,
}: Readonly<LaunchExplorerProps>) {
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('all');
  const years = useMemo(
    () => [...new Set(cohorts.map(({ id }) => id.slice(0, 4)))].sort().reverse(),
    [cohorts],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();

    return cohorts.filter((cohort) => {
      const text = `${cohort.id} ${cohort.launchDate} ${cohort.launchVehicle}`.toLocaleLowerCase();

      return (year === 'all' || cohort.id.startsWith(year)) && (!needle || text.includes(needle));
    });
  }, [cohorts, query, year]);
  const selected = cohorts.find(({ id }) => id === selectedCohortId);

  return (
    <section className="sg-launch-explorer" data-testid="launch-explorer">
      <div className="sg-launch-tools">
        <label>
          <span>FIND A LAUNCH</span>
          <input aria-label="Search Starlink launch cohorts" onChange={(event) => setQuery(event.target.value)} placeholder="Cohort, date, vehicle…" value={query} />
        </label>
        <label>
          <span>YEAR</span>
          <select aria-label="Filter Starlink launch year" className="browser-default" onChange={(event) => setYear(event.target.value)} value={year}>
            <option value="all">All</option>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="sg-launch-summary">
        <strong>{formatNumber(visible.length)}</strong>
        <span>Starlink launch cohorts retained in this installed catalog</span>
      </div>
      <div className="sg-launch-list" data-testid="launch-list">
        {visible.map((cohort) => (
          <button aria-pressed={cohort.id === selectedCohortId} key={cohort.id} onClick={() => onSelect(cohort)} type="button">
            <span className="sg-launch-index">{cohort.id}</span>
            <span><strong>{formatCalendarDate(cohort.launchDate)}</strong><small>{cohort.launchVehicle || 'Vehicle not listed'}</small></span>
            <span><b>{formatNumber(cohort.catalogMemberCount)}</b><small>members</small></span>
          </button>
        ))}
        {visible.length === 0 && <p>No launch cohorts match this view.</p>}
      </div>
      {selected && (
        <div className="sg-cohort-summary" data-testid="cohort-summary">
          <div><strong>{selected.id}</strong><span>{formatNumber(selected.activeCount)} known active of {formatNumber(selected.catalogMemberCount)} retained members</span></div>
          <p>{selected.launchVehicle || 'Launch vehicle not listed'} · newest element {formatCalendarDate(selected.newestElementEpoch)}</p>
          <div className="sg-cohort-actions">
            <button data-testid="open-cohort-members" onClick={() => onOpenMembers(selected)} type="button">Open members</button>
            {selected.featuredStory && <button data-testid="open-cohort-story" onClick={() => onOpenStory(selected)} type="button">Open sourced story beat</button>}
          </div>
        </div>
      )}
      <p className="sg-launch-caveat">Counts describe objects retained in this catalog snapshot, not the number originally deployed. Positions are GP predictions, not live telemetry or a launch replay.</p>
    </section>
  );
}
