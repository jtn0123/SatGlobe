import { memo } from 'react';
import {
  DEFAULT_FILTERS,
  type ConjunctionState,
  type FilterState,
  type LaunchCohortView,
  type ObjectKind,
  type OrbitRegime,
  type SpaceObjectView,
  type VisualEncoding,
  type VisualLegend as VisualLegendModel,
} from '../domain/types';
import { Icon } from './icon';
import { LaunchExplorer } from './launch-explorer';
import { encodingLabels, formatNumber, objectKindLabels, regimeLabels } from './labels';
import { VisualLegend } from './visual-legend';
import { ViewLibrary, type ViewLibraryProps } from './view-library';

export type QuickLens = 'starlink' | 'geo' | 'debris';

/** Keeps the fourth lens truthful across loading, freshness, and failure states. */
export function getConjunctionLensPresentation(
  conjunctions: ConjunctionState,
  conjunctionHighlightActive: boolean,
  highlightedObjectCount: number,
): { disabled: boolean; label: string } {
  if (conjunctions.status === 'loading') {
    return { disabled: true, label: 'Loading screening…' };
  }
  if (conjunctions.status === 'unavailable') {
    return { disabled: true, label: 'Screening unavailable' };
  }
  if (conjunctionHighlightActive) {
    return { disabled: false, label: `${formatNumber(highlightedObjectCount)} highlighted` };
  }
  const pairNoun = conjunctions.lensPairCount === 1 ? 'pair' : 'pairs';

  if (conjunctions.status === 'archival') {
    return { disabled: conjunctions.catalogIds.length === 0, label: `${formatNumber(conjunctions.lensPairCount)} latest past ${pairNoun}` };
  }
  if (conjunctions.status === 'stale') {
    return { disabled: conjunctions.catalogIds.length === 0, label: `${formatNumber(conjunctions.lensPairCount)} stale upcoming ${pairNoun}` };
  }

  return { disabled: conjunctions.catalogIds.length === 0, label: `${formatNumber(conjunctions.lensPairCount)} upcoming ${pairNoun}` };
}

/** Builds the filter and encoding state for a suggested workshop lens. */
export function getQuickLensState(lens: QuickLens): { filters: FilterState; encoding: VisualEncoding } {
  const filters = structuredClone(DEFAULT_FILTERS);
  let encoding: VisualEncoding = 'object-type';

  if (lens === 'starlink') {
    filters.constellation = 'starlink';
    encoding = 'orbital-plane';
  } else if (lens === 'geo') {
    filters.regimes = ['geo'];
    encoding = 'orbit-regime';
  } else {
    filters.objectKinds = ['debris'];
    filters.status = 'all';
    encoding = 'data-age';
  }

  return { filters, encoding };
}

/** Renders a filter row with an accessible pressed state. */
function ToggleRow({ checked, label, meta, onChange }: Readonly<{ checked: boolean; label: string; meta?: string; onChange: () => void }>) {
  return (
    <button aria-pressed={checked} className="sg-toggle-row" onClick={onChange} type="button">
      <span className={`sg-check ${checked ? 'is-on' : ''}`}><span /></span>
      <span>{label}</span>
      {meta && <small>{meta}</small>}
    </button>
  );
}

/** Groups related filters in a native collapsible disclosure. */
function FilterSection({ label, children, open = true }: Readonly<{ label: string; children: React.ReactNode; open?: boolean }>) {
  return (
    <details className="sg-filter-section" open={open}>
      <summary>{label}<Icon name="chevron" size={14} /></summary>
      <div className="sg-filter-content">{children}</div>
    </details>
  );
}

export type DiscoverPanelProps = Readonly<{
  /** True while another mode owns the screen: removes the hidden panel from focus order and the accessibility tree. */
  inert?: boolean;
  visibleCount: number;
  query: string;
  results: SpaceObjectView[];
  filters: FilterState;
  encoding: VisualEncoding;
  conjunctions: ConjunctionState;
  conjunctionHighlightActive: boolean;
  highlightedObjectCount: number;
  legend: VisualLegendModel;
  launchCohorts: readonly LaunchCohortView[];
  selectedCohortId?: string;
  viewLibrary: ViewLibraryProps;
  onQueryChange: (query: string) => void;
  onSelectResult: (catalogId: string) => void;
  onQuickLens: (lens: QuickLens) => void;
  onConjunctionLens: () => void;
  onSelectCohort: (cohort: LaunchCohortView) => void;
  onOpenCohortMembers: (cohort: LaunchCohortView) => void;
  onOpenCohortStory: (cohort: LaunchCohortView) => void;
  setFiltersImmediate: (filters: FilterState) => void;
  setFiltersDebounced: (filters: FilterState) => void;
  onEncodingChange: (encoding: VisualEncoding) => void;
}>;

/** The workshop's search, lens, filter, encoding, and saved-view instrument panel. */
function DiscoverPanelBase({
  inert, visibleCount, query, results, filters, encoding, conjunctions, conjunctionHighlightActive, highlightedObjectCount,
  legend, launchCohorts, selectedCohortId, viewLibrary,
  onQueryChange, onSelectResult, onQuickLens, onConjunctionLens, onSelectCohort, onOpenCohortMembers, onOpenCohortStory,
  setFiltersImmediate, setFiltersDebounced, onEncodingChange,
}: DiscoverPanelProps) {
  const conjunctionLens = getConjunctionLensPresentation(
    conjunctions,
    conjunctionHighlightActive,
    highlightedObjectCount,
  );

  return (
    <aside className="sg-panel sg-side-panel sg-discover" data-testid="discover-panel" inert={inert || undefined}>
      <div className="sg-panel-title"><div><span className="sg-panel-index">01</span><h1>Discover</h1></div><span className="sg-count" data-testid="visible-count">{formatNumber(visibleCount)} visible</span></div>
      {visibleCount === 0 && (
        <p className="sg-empty-hint" data-testid="empty-hint">No objects match the current filters — <button onClick={() => setFiltersImmediate(structuredClone(DEFAULT_FILTERS))} type="button">reset them</button>.</p>
      )}
      <label className="sg-search">
        <Icon name="search" />
        <input aria-label="Search catalog" data-testid="catalog-search" onChange={(event) => onQueryChange(event.target.value)} placeholder="Name, catalog ID, launch…" value={query} />
        <kbd>/</kbd>
      </label>
      {query && (
        <div className="sg-search-results" data-testid="search-results">
          {results.length === 0 ? <p>No local catalog matches.</p> : results.map((result) => (
            <button key={result.catalogId} onClick={() => onSelectResult(result.catalogId)} type="button">
              <span><strong>{result.name}</strong><small>{result.catalogId} · {regimeLabels[result.regime]}</small></span><Icon name="chevron" size={13} />
            </button>
          ))}
        </div>
      )}

      <section className="sg-lenses">
        <div className="sg-panel-kicker">QUICK LENSES</div>
        <div className="sg-lens-grid">
          <button data-testid="starlink-lens" onClick={() => onQuickLens('starlink')} type="button"><span className="sg-lens-glyph sg-lens-starlink"><i /><i /><i /></span><strong>Starlink</strong><small>Planes & shells</small></button>
          <button onClick={() => onQuickLens('geo')} type="button"><span className="sg-lens-glyph sg-lens-geo"><i /></span><strong>GEO belt</strong><small>The high ring</small></button>
          <button onClick={() => onQuickLens('debris')} type="button"><span className="sg-lens-glyph sg-lens-debris"><i /><i /><i /><i /></span><strong>Debris field</strong><small>Context layer</small></button>
          <button
            aria-pressed={conjunctionHighlightActive}
            data-conjunction-status={conjunctions.status}
            data-dropped-pair-count={conjunctions.droppedPairCount}
            data-highlighted-count={highlightedObjectCount}
            data-testid="conjunction-lens"
            disabled={conjunctionLens.disabled}
            onClick={onConjunctionLens}
            type="button"
          >
            <span className="sg-lens-glyph sg-lens-conjunction"><i /><i /></span>
            <strong>Close approaches</strong>
            <small aria-live="polite" data-testid="conjunction-lens-status" role="status">{conjunctionLens.label}</small>
          </button>
        </div>
      </section>

      <details className="sg-launch-disclosure">
        <summary>STARLINK LAUNCH COHORTS <span>{formatNumber(launchCohorts.length)}</span></summary>
        <LaunchExplorer
          cohorts={launchCohorts}
          onOpenMembers={onOpenCohortMembers}
          onOpenStory={onOpenCohortStory}
          onSelect={onSelectCohort}
          selectedCohortId={selectedCohortId}
        />
      </details>

      <section className="sg-filters">
        <div className="sg-section-heading"><span><Icon name="layers" size={15} /> FILTERS</span><button onClick={() => setFiltersImmediate(structuredClone(DEFAULT_FILTERS))} type="button">Reset</button></div>
        <FilterSection label="Object class">
          {(Object.keys(objectKindLabels) as ObjectKind[]).slice(0, 3).map((kind) => (
            <ToggleRow checked={filters.objectKinds.includes(kind)} key={kind} label={objectKindLabels[kind]} onChange={() => {
              const objectKinds = filters.objectKinds.includes(kind) ? filters.objectKinds.filter((value) => value !== kind) : [...filters.objectKinds, kind];

              if (objectKinds.length) {
                setFiltersImmediate({ ...filters, objectKinds });
              }
            }} />
          ))}
        </FilterSection>
        <FilterSection label="Operational status">
          <fieldset className="sg-status-options">
            <legend className="sg-visually-hidden">Operational status</legend>
            {([
              ['active', 'Known active'],
              ['inactive', 'Inactive / unknown'],
              ['all', 'All records'],
            ] as const).map(([value, label]) => (
              <button aria-pressed={filters.status === value} data-testid={`status-${value}`} key={value} onClick={() => setFiltersImmediate({ ...filters, status: value })} type="button">{label}</button>
            ))}
          </fieldset>
        </FilterSection>
        <FilterSection label="Orbital regime" open={false}>
          {(Object.keys(regimeLabels) as OrbitRegime[]).map((regime) => (
            <ToggleRow checked={filters.regimes.includes(regime)} key={regime} label={regimeLabels[regime]} onChange={() => {
              const regimes = filters.regimes.includes(regime) ? filters.regimes.filter((value) => value !== regime) : [...filters.regimes, regime];

              if (regimes.length) {
                setFiltersImmediate({ ...filters, regimes });
              }
            }} />
          ))}
        </FilterSection>
        <FilterSection label="Inclination" open={false}>
          <div className="sg-range-values"><span>{filters.inclinationDeg.min}°</span><span>{filters.inclinationDeg.max}°</span></div>
          <input
            aria-label="Minimum inclination"
            aria-valuetext={`${filters.inclinationDeg.min} degrees`}
            max="179"
            min="0"
            onChange={(event) => {
              const min = Math.min(Number(event.target.value), filters.inclinationDeg.max - 1);

              setFiltersDebounced({ ...filters, inclinationDeg: { ...filters.inclinationDeg, min } });
            }}
            type="range"
            value={filters.inclinationDeg.min}
          />
          <input
            aria-label="Maximum inclination"
            aria-valuetext={`${filters.inclinationDeg.max} degrees`}
            max="180"
            min="1"
            onChange={(event) => {
              const max = Math.max(Number(event.target.value), filters.inclinationDeg.min + 1);

              setFiltersDebounced({ ...filters, inclinationDeg: { ...filters.inclinationDeg, max } });
            }}
            type="range"
            value={filters.inclinationDeg.max}
          />
        </FilterSection>
      </section>

      <section className="sg-encoding">
        <label htmlFor="sg-encoding">COLOR BY</label>
        <select data-testid="encoding-select" id="sg-encoding" onChange={(event) => onEncodingChange(event.target.value as VisualEncoding)} value={encoding}>
          {Object.entries(encodingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>
      <VisualLegend legend={legend} />

      <ViewLibrary {...viewLibrary} />
      <details className="sg-legal">
        <summary>Data, source & legal</summary>
        <p>SatGlobe is a modified KeepTrack source fork. KeepTrack © Kruczek Labs LLC and contributors; earlier ThingsInSpace work © James Yoder. AGPL-3.0, without warranty.</p>
        <div><a href="https://github.com/jtn0123/SatGlobe" rel="noreferrer" target="_blank">SatGlobe source ↗</a><a href="https://github.com/thkruz/keeptrack.space" rel="noreferrer" target="_blank">Upstream ↗</a><a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noreferrer" target="_blank">License ↗</a></div>
      </details>
    </aside>
  );
}

export const DiscoverPanel = memo(DiscoverPanelBase);
