import { memo, useRef } from 'react';
import { downloadSavedView } from '../domain/saved-view';
import {
  DEFAULT_FILTERS,
  type FilterState,
  type ObjectKind,
  type OrbitRegime,
  type SavedViewV1,
  type SpaceObjectView,
  type VisualEncoding,
} from '../domain/types';
import { Icon } from './icon';
import { encodingLabels, formatNumber, objectKindLabels, regimeLabels } from './labels';

export type QuickLens = 'starlink' | 'geo' | 'debris';

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
function ToggleRow({ checked, label, meta, onChange }: { checked: boolean; label: string; meta?: string; onChange: () => void }) {
  return (
    <button aria-pressed={checked} className="sg-toggle-row" onClick={onChange} type="button">
      <span className={`sg-check ${checked ? 'is-on' : ''}`}><span /></span>
      <span>{label}</span>
      {meta && <small>{meta}</small>}
    </button>
  );
}

/** Groups related filters in a native collapsible disclosure. */
function FilterSection({ label, children, open = true }: { label: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="sg-filter-section" open={open}>
      <summary>{label}<Icon name="chevron" size={14} /></summary>
      <div className="sg-filter-content">{children}</div>
    </details>
  );
}

export interface DiscoverPanelProps {
  visibleCount: number;
  query: string;
  results: SpaceObjectView[];
  filters: FilterState;
  encoding: VisualEncoding;
  savedViews: SavedViewV1[];
  onQueryChange: (query: string) => void;
  onSelectResult: (catalogId: string) => void;
  onQuickLens: (lens: QuickLens) => void;
  setFilters: (filters: FilterState) => void;
  onEncodingChange: (encoding: VisualEncoding) => void;
  onSaveView: () => void;
  onApplyView: (view: SavedViewV1) => void;
  createView: () => SavedViewV1;
  onImportFile: (file?: File) => Promise<void> | void;
}

/** The workshop's search, lens, filter, encoding, and saved-view instrument panel. */
function DiscoverPanelBase({
  visibleCount, query, results, filters, encoding, savedViews,
  onQueryChange, onSelectResult, onQuickLens, setFilters, onEncodingChange,
  onSaveView, onApplyView, createView, onImportFile,
}: DiscoverPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <aside className="sg-panel sg-side-panel sg-discover" data-testid="discover-panel">
      <div className="sg-panel-title"><div><span className="sg-panel-index">01</span><h1>Discover</h1></div><span className="sg-count" data-testid="visible-count">{formatNumber(visibleCount)} visible</span></div>
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
        </div>
      </section>

      <section className="sg-filters">
        <div className="sg-section-heading"><span><Icon name="layers" size={15} /> FILTERS</span><button onClick={() => setFilters(structuredClone(DEFAULT_FILTERS))} type="button">Reset</button></div>
        <FilterSection label="Object class">
          {(Object.keys(objectKindLabels) as ObjectKind[]).slice(0, 3).map((kind) => (
            <ToggleRow checked={filters.objectKinds.includes(kind)} key={kind} label={objectKindLabels[kind]} onChange={() => {
              const objectKinds = filters.objectKinds.includes(kind) ? filters.objectKinds.filter((value) => value !== kind) : [...filters.objectKinds, kind];

              if (objectKinds.length) {
                setFilters({ ...filters, objectKinds });
              }
            }} />
          ))}
        </FilterSection>
        <FilterSection label="Operational status">
          <div className="sg-status-options" role="group" aria-label="Operational status">
            {([
              ['active', 'Known active'],
              ['inactive', 'Inactive / unknown'],
              ['all', 'All records'],
            ] as const).map(([value, label]) => (
              <button aria-pressed={filters.status === value} data-testid={`status-${value}`} key={value} onClick={() => setFilters({ ...filters, status: value })} type="button">{label}</button>
            ))}
          </div>
        </FilterSection>
        <FilterSection label="Orbital regime" open={false}>
          {(Object.keys(regimeLabels) as OrbitRegime[]).map((regime) => (
            <ToggleRow checked={filters.regimes.includes(regime)} key={regime} label={regimeLabels[regime]} onChange={() => {
              const regimes = filters.regimes.includes(regime) ? filters.regimes.filter((value) => value !== regime) : [...filters.regimes, regime];

              if (regimes.length) {
                setFilters({ ...filters, regimes });
              }
            }} />
          ))}
        </FilterSection>
        <FilterSection label="Inclination" open={false}>
          <div className="sg-range-values"><span>{filters.inclinationDeg.min}°</span><span>{filters.inclinationDeg.max}°</span></div>
          <input aria-label="Maximum inclination" max="180" min="1" onChange={(event) => setFilters({ ...filters, inclinationDeg: { ...filters.inclinationDeg, max: Number(event.target.value) } })} type="range" value={filters.inclinationDeg.max} />
        </FilterSection>
      </section>

      <section className="sg-encoding">
        <label htmlFor="sg-encoding">COLOR BY</label>
        <select data-testid="encoding-select" id="sg-encoding" onChange={(event) => onEncodingChange(event.target.value as VisualEncoding)} value={encoding}>
          {Object.entries(encodingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      <section className="sg-saved-views">
        <div className="sg-section-heading"><span><Icon name="bookmark" size={15} /> SAVED VIEWS</span><button onClick={onSaveView} type="button">+ Save current</button></div>
        {savedViews.length === 0 ? <p>Camera, time, filters, selection, scale, and presentation mode travel together.</p> : savedViews.slice(0, 2).map((view) => <button key={view.name} onClick={() => onApplyView(view)} type="button"><strong>{view.name}</strong><small>{encodingLabels[view.encoding]}</small></button>)}
        <div className="sg-portable-actions">
          <button data-testid="export-view" onClick={() => downloadSavedView(createView())} type="button"><Icon name="export" size={14} /> Export JSON</button>
          <button onClick={() => fileInput.current?.click()} type="button"><Icon name="import" size={14} /> Import</button>
          <input accept="application/json,.json" data-testid="import-view" onChange={async (event) => {
            await onImportFile(event.target.files?.[0]);
            if (fileInput.current) {
              fileInput.current.value = '';
            }
          }} ref={fileInput} type="file" />
        </div>
      </section>
      <details className="sg-legal">
        <summary>Data, source & legal</summary>
        <p>SatGlobe is a modified KeepTrack source fork. KeepTrack © Kruczek Labs LLC and contributors; earlier ThingsInSpace work © James Yoder. AGPL-3.0, without warranty.</p>
        <div><a href="https://github.com/jtn0123/SatGlobe" rel="noreferrer" target="_blank">SatGlobe source ↗</a><a href="https://github.com/thkruz/keeptrack.space" rel="noreferrer" target="_blank">Upstream ↗</a><a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noreferrer" target="_blank">License ↗</a></div>
      </details>
    </aside>
  );
}

export const DiscoverPanel = memo(DiscoverPanelBase);
