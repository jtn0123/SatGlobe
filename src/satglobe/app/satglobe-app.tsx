import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { downloadSavedView, importSavedView } from '../domain/saved-view';
import {
  DEFAULT_FILTERS,
  type AppMode,
  type EngineState,
  type FilterState,
  type ObjectKind,
  type OrbitRegime,
  type SavedViewV1,
  type ScaleMode,
  type SpaceObjectView,
  type StoryFact,
  type StoryManifestV1,
  type VisualEncoding,
} from '../domain/types';
import { starlinkBuildoutStory } from '../stories/starlink-buildout';

interface SatGlobeAppProps {
  adapter: SatGlobeEngineAdapter;
}

type IconName = 'search' | 'chevron' | 'layers' | 'clock' | 'bookmark' | 'export' | 'import' | 'close' | 'play' | 'pause' | 'previous' | 'next' | 'focus' | 'info';
type QuickLens = 'starlink' | 'geo' | 'debris';

const iconPaths: Record<IconName, string> = {
  search: 'M11 4a7 7 0 1 0 4.9 12l4 4 1.1-1.1-4-4A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  chevron: 'm9 6 6 6-6 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z',
  bookmark: 'M6 3h12v19l-6-4-6 4V3Zm2 2v13.3l4-2.7 4 2.7V5H8Z',
  export: 'M12 3 7 8l1.4 1.4 2.6-2.6V16h2V6.8l2.6 2.6L17 8l-5-5ZM5 14v6h14v-6h2v8H3v-8h2Z',
  import: 'm12 16 5-5-1.4-1.4-2.6 2.6V3h-2v9.2L8.4 9.6 7 11l5 5ZM5 14v6h14v-6h2v8H3v-8h2Z',
  close: 'm6 6 12 12M18 6 6 18',
  play: 'm8 5 11 7-11 7V5Z',
  pause: 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z',
  previous: 'M6 5h2v14H6V5Zm12 0v14l-9-7 9-7Z',
  next: 'M16 5h2v14h-2V5ZM6 5l9 7-9 7V5Z',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  info: 'M11 10h2v8h-2v-8Zm0-4h2v2h-2V6ZM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
};

/** Renders a compact inline icon from the SatGlobe visual language. */
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const strokeOnly = ['chevron', 'layers', 'close', 'focus'].includes(name);

  return (
    <svg aria-hidden="true" className="sg-icon" height={size} viewBox="0 0 24 24" width={size}>
      <path d={iconPaths[name]} fill={strokeOnly ? 'none' : 'currentColor'} stroke={strokeOnly ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

const objectKindLabels: Record<ObjectKind, string> = {
  payload: 'Payloads',
  'rocket-body': 'Rocket bodies',
  debris: 'Debris',
  other: 'Other',
};

const regimeLabels: Record<OrbitRegime, string> = {
  leo: 'LEO',
  meo: 'MEO',
  geo: 'GEO',
  heo: 'Highly elliptical',
  other: 'Other',
};

const encodingLabels: Record<VisualEncoding, string> = {
  'object-type': 'Object type',
  'orbit-regime': 'Orbital regime',
  'launch-cohort': 'Launch cohort',
  'orbital-plane': 'Plane density',
  'data-age': 'Data age',
  starlink: 'Starlink state',
};

/** Formats a finite measurement for compact workshop labels. */
function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value) : '—';
}

/** Formats an ISO timestamp as an explicit UTC presentation string. */
function formatUtc(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return 'WAITING FOR ENGINE';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'UTC', timeZoneName: 'short',
  }).format(date).toLocaleUpperCase();
}

/** Formats launch dates without exposing raw ISO timestamps in the inspector. */
function formatCalendarDate(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso || 'Not listed';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date).toLocaleUpperCase();
}

/** Returns the non-negative age of an ISO timestamp in days. */
function ageInDays(iso: string): number | null {
  const epoch = new Date(iso).getTime();

  return Number.isFinite(epoch) ? Math.max(0, (Date.now() - epoch) / 86_400_000) : null;
}

/** Describes element age without implying the propagated position is live. */
function describeEpoch(epoch: string): string {
  if (!epoch) {
    return 'Epoch unavailable';
  }
  const ageDays = ageInDays(epoch);

  return ageDays === null ? 'Epoch unavailable' : `${ageDays.toFixed(ageDays < 10 ? 1 : 0)} days old`;
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

/** Shows identity, orbit, mission, and provenance for the selected record. */
function InspectorBase({ object, onClose }: { object: SpaceObjectView | null; onClose: () => void }) {
  if (!object) {
    return (
      <aside className="sg-panel sg-side-panel sg-inspector sg-inspector-empty">
        <div className="sg-panel-kicker">INSPECT</div>
        <div className="sg-empty-orbit" aria-hidden="true"><span /><i /></div>
        <h2>Select an object</h2>
        <p>Search by name, catalog ID, launch designator, operator, or country. The selected orbit will remain visible while you explore.</p>
        <div className="sg-truth-note"><Icon name="info" /><span>Positions are predicted from public element sets. They are not live operator telemetry.</span></div>
      </aside>
    );
  }

  const rows = [
    ['Catalog ID', object.catalogId],
    ['International designator', object.internationalDesignator || '—'],
    ['Object class', objectKindLabels[object.kind]],
    ['Status', object.status],
    ['Orbital regime', regimeLabels[object.regime]],
    ['Perigee', `${formatNumber(object.perigeeKm)} km`],
    ['Apogee', `${formatNumber(object.apogeeKm)} km`],
    ['Inclination', `${formatNumber(object.inclinationDeg, 2)}°`],
    ['Period', `${formatNumber(object.periodMinutes, 1)} min`],
  ];

  return (
    <aside className="sg-panel sg-side-panel sg-inspector" data-testid="object-inspector">
      <div className="sg-inspector-head">
        <div><div className="sg-panel-kicker">SELECTED OBJECT</div><h2>{object.name}</h2></div>
        <button aria-label="Close inspector" className="sg-icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
      </div>
      <div className="sg-object-tags"><span>{regimeLabels[object.regime]}</span><span>{objectKindLabels[object.kind]}</span><span className={object.active ? 'is-active' : 'is-inactive'}>{object.active ? 'Known active' : 'Inactive / unknown'}</span></div>
      <dl className="sg-data-list">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="sg-divider" />
      <div className="sg-panel-kicker">MISSION & PROVENANCE</div>
      <dl className="sg-data-list sg-data-list-soft">
        <div><dt>Launch</dt><dd>{formatCalendarDate(object.launchDate)}</dd></div>
        <div><dt>Vehicle</dt><dd>{object.launchVehicle || 'Not listed'}</dd></div>
        <div><dt>Operator</dt><dd>{object.owner || 'Not listed'}</dd></div>
        <div><dt>Country</dt><dd>{object.country || 'Not listed'}</dd></div>
        <div><dt>Element epoch</dt><dd>{object.epoch ? formatUtc(object.epoch) : 'Not listed'}<small>{describeEpoch(object.epoch)}</small></dd></div>
        <div><dt>Catalog source</dt><dd>{object.source}</dd></div>
      </dl>
    </aside>
  );
}

const Inspector = memo(InspectorBase);

interface TopBarProps {
  ready: boolean;
  objectCount: number;
  mode: AppMode;
  newestElementAge: number | null;
  onModeChange: (mode: AppMode) => void;
  onStoryOpen: () => void;
}

/** Renders global mode controls and local-catalog health. */
function TopBarBase({ ready, objectCount, mode, newestElementAge, onModeChange, onStoryOpen }: TopBarProps) {
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
      <nav className="sg-mode-switcher" aria-label="Display mode">
        <button className={mode === 'workshop' ? 'is-active' : ''} onClick={() => onModeChange('workshop')} type="button">Workshop</button>
        <button className={mode === 'presentation' ? 'is-active' : ''} onClick={() => onModeChange('presentation')} type="button">Present</button>
        <button className={mode === 'story' ? 'is-active' : ''} data-testid="story-mode" onClick={onStoryOpen} type="button">Story <span>01</span></button>
      </nav>
    </header>
  );
}

const TopBar = memo(TopBarBase);

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

const TimeDock = memo(TimeDockBase);

/** Renders the minimal editorial title used in presentation mode. */
function PresentationTitleBase({ encoding, objectCount, onOpenWorkshop }: { encoding: VisualEncoding; objectCount: number; onOpenWorkshop: () => void }) {
  return (
    <section className="sg-presentation-title">
      <span>EARTH ORBIT / LOCAL SNAPSHOT</span>
      <h2>A living orbital environment</h2>
      <p>{formatNumber(objectCount)} objects in the current view · {encodingLabels[encoding].toLocaleLowerCase()} encoding</p>
      <button onClick={onOpenWorkshop} type="button">Open workshop</button>
    </section>
  );
}

const PresentationTitle = memo(PresentationTitleBase);

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

const StoryDeck = memo(StoryDeckBase);

/** Shows and toggles the visual scale disclosure shared by all modes. */
function ScaleDisclosure({ mode, onToggle }: { mode: ScaleMode; onToggle: () => void }) {
  return (
    <div className="sg-scale-disclosure" data-testid="scale-disclosure">
      <Icon name="info" size={15} />
      <span><strong>{mode === 'semantic' ? 'SEMANTIC SCALE' : 'TRUE SCALE'}</strong>{mode === 'semantic' ? ' Marks are enlarged for legibility.' : ' Physical scale comparison; most objects become sub-pixel.'}</span>
      <button onClick={onToggle} type="button">{mode === 'semantic' ? 'Compare true scale' : 'Restore readable marks'}</button>
    </div>
  );
}

/** Builds the filter and encoding state for a suggested workshop lens. */
function getQuickLensState(lens: QuickLens): { filters: FilterState; encoding: VisualEncoding } {
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

/*
 * Owns workshop filter state. UI state updates immediately; the engine
 * application (a full-catalog recolor) coalesces to the trailing value, so
 * dragging a slider costs one recolor instead of one per input event.
 */
function useWorkshopFilters(adapter: SatGlobeEngineAdapter): {
  filters: FilterState;
  setFilters: (next: FilterState) => void;
  setFiltersState: React.Dispatch<React.SetStateAction<FilterState>>;
} {
  const [filters, setFiltersState] = useState<FilterState>(structuredClone(DEFAULT_FILTERS));
  const pending = useRef<number | null>(null);
  const setFilters = useCallback((next: FilterState) => {
    setFiltersState(next);
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
    }
    pending.current = window.setTimeout(() => {
      pending.current = null;
      adapter.setFilters(next);
    }, 120);
  }, [adapter]);

  useEffect(() => () => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
    }
  }, []);

  return { filters, setFilters, setFiltersState };
}

/** Coordinates SatGlobe's workshop, presentation, and story states. */
export function SatGlobeApp({ adapter }: SatGlobeAppProps) {
  const [engine, setEngine] = useState<EngineState>(adapter.getState());
  const [mode, setMode] = useState<AppMode>('workshop');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('semantic');
  const [query, setQuery] = useState('');
  const { filters, setFilters, setFiltersState } = useWorkshopFilters(adapter);
  const [results, setResults] = useState<SpaceObjectView[]>([]);
  const [savedViews, setSavedViews] = useState<SavedViewV1[]>([]);
  const [notice, setNotice] = useState('');
  const [storyBeat, setStoryBeat] = useState(0);
  const [storyPlaying, setStoryPlaying] = useState(false);
  const [storyProgress, setStoryProgress] = useState(0);
  const [showSources, setShowSources] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const story = starlinkBuildoutStory;
  const beat = story.beats[storyBeat];

  useEffect(() => adapter.subscribe(setEngine), [adapter]);

  useEffect(() => {
    setResults(adapter.search(query));
  }, [adapter, engine.objectCount, query]);

  const switchMode = useCallback((nextMode: AppMode) => {
    setMode(nextMode);
    document.body.classList.toggle('sg-presentation', nextMode === 'presentation');
    document.body.classList.toggle('sg-story', nextMode === 'story');
    if (nextMode === 'story') {
      setStoryPlaying(false);
      setStoryProgress(0);
    }
  }, []);

  // Stable handlers so memoized children skip re-rendering on unrelated state changes.
  const clearSelection = useCallback(() => adapter.clearSelection(), [adapter]);
  const openWorkshop = useCallback(() => switchMode('workshop'), [switchMode]);
  const togglePlaying = useCallback(() => setStoryPlaying((playing) => !playing), []);
  const toggleSources = useCallback(() => setShowSources((show) => !show), []);

  const applyBeat = useCallback((index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), story.beats.length - 1);
    const nextBeat = story.beats[nextIndex];
    const nextFilters: FilterState = {
      ...structuredClone(DEFAULT_FILTERS),
      constellation: nextBeat.constellation ?? '',
    };

    setStoryBeat(nextIndex);
    setStoryProgress(0);
    setFiltersState(nextFilters);
    setScaleMode(nextBeat.scaleMode);
    adapter.setScaleMode(nextBeat.scaleMode);
    adapter.setCamera(nextBeat.camera);
    adapter.setFilters(nextFilters);
    adapter.setEncoding(nextBeat.encoding);
  }, [adapter, story.beats]);

  useEffect(() => {
    if (!storyPlaying || mode !== 'story') {
      return undefined;
    }
    const startedAt = performance.now() - storyProgress * beat.durationMs;
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / beat.durationMs);

      setStoryProgress(progress);
      if (progress >= 1) {
        if (storyBeat < story.beats.length - 1) {
          applyBeat(storyBeat + 1);
        } else {
          setStoryPlaying(false);
        }
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [applyBeat, beat.durationMs, mode, story.beats.length, storyBeat, storyPlaying, storyProgress]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      if (event.key === 'f') {
        switchMode(mode === 'presentation' ? 'workshop' : 'presentation');
      } else if (event.key === 'Escape') {
        switchMode('workshop');
      } else if (mode === 'story' && event.key === 'ArrowRight') {
        applyBeat(storyBeat + 1);
      } else if (mode === 'story' && event.key === 'ArrowLeft') {
        applyBeat(storyBeat - 1);
      } else if (mode === 'story' && event.key === ' ') {
        event.preventDefault();
        setStoryPlaying((playing) => !playing);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyBeat, mode, storyBeat, switchMode]);

  const createView = useCallback((): SavedViewV1 => ({
    schemaVersion: 1,
    name: engine.selectedObject ? `${engine.selectedObject.name} study` : 'Orbital workshop view',
    camera: engine.camera,
    simulationTime: engine.simulationTime,
    filters,
    encoding: engine.encoding,
    selectedObjectIds: engine.selectedObject ? [engine.selectedObject.catalogId] : [],
    scaleMode,
    presentation: { mode, panelsVisible: mode === 'workshop', storyId: mode === 'story' ? story.id : undefined, storyBeat: mode === 'story' ? storyBeat : undefined },
  }), [engine, filters, mode, scaleMode, story.id, storyBeat]);

  const saveView = () => {
    const view = createView();

    setSavedViews((views) => [view, ...views].slice(0, 12));
    setNotice(`Saved “${view.name}” locally for this session.`);
  };

  const applyView = useCallback((view: SavedViewV1) => {
    setFiltersState(view.filters);
    setScaleMode(view.scaleMode);
    adapter.setScaleMode(view.scaleMode);
    adapter.setCamera(view.camera);
    adapter.setSimulationTime(view.simulationTime);
    adapter.setFilters(view.filters);
    adapter.setEncoding(view.encoding);
    if (view.selectedObjectIds[0]) {
      adapter.selectObject(view.selectedObjectIds[0]);
    }
    switchMode(view.presentation.mode);
    if (view.presentation.storyBeat !== undefined) {
      applyBeat(view.presentation.storyBeat);
    }
  }, [adapter, applyBeat, switchMode]);

  const importFile = async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const imported = importSavedView(await file.text(), adapter.getObjects());

      applyView(imported.view);
      setNotice(imported.warnings[0] ?? `Imported “${imported.view.name}”.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import this preset.');
    } finally {
      if (fileInput.current) {
        fileInput.current.value = '';
      }
    }
  };

  const quickLens = (lens: QuickLens) => {
    const { filters: next, encoding } = getQuickLensState(lens);

    setFilters(next);
    adapter.setEncoding(encoding);
  };

  // Maintained by the adapter as a byproduct of filter application; the UI never sweeps the catalog.
  const visibleEstimate = engine.visibleCount;
  const newestElementAge = ageInDays(engine.newestElementEpoch);
  const openStory = useCallback(() => {
    switchMode('story');
    applyBeat(storyBeat);
  }, [applyBeat, storyBeat, switchMode]);
  const toggleScale = () => setScaleMode((value) => {
    const next = value === 'semantic' ? 'true' : 'semantic';

    adapter.setScaleMode(next);

    return next;
  });

  return (
    <main className={`sg-app sg-mode-${mode}`} data-testid="satglobe-app">
      <TopBar mode={mode} newestElementAge={newestElementAge} objectCount={engine.objectCount} onModeChange={switchMode} onStoryOpen={openStory} ready={engine.ready} />

      <aside className="sg-panel sg-side-panel sg-discover" data-testid="discover-panel">
        <div className="sg-panel-title"><div><span className="sg-panel-index">01</span><h1>Discover</h1></div><span className="sg-count" data-testid="visible-count">{formatNumber(visibleEstimate)} visible</span></div>
        <label className="sg-search">
          <Icon name="search" />
          <input aria-label="Search catalog" data-testid="catalog-search" onChange={(event) => setQuery(event.target.value)} placeholder="Name, catalog ID, launch…" value={query} />
          <kbd>/</kbd>
        </label>
        {query && (
          <div className="sg-search-results" data-testid="search-results">
            {results.length === 0 ? <p>No local catalog matches.</p> : results.map((result) => (
              <button key={result.catalogId} onClick={() => {
                adapter.selectObject(result.catalogId);
                setQuery('');
              }} type="button">
                <span><strong>{result.name}</strong><small>{result.catalogId} · {regimeLabels[result.regime]}</small></span><Icon name="chevron" size={13} />
              </button>
            ))}
          </div>
        )}

        <section className="sg-lenses">
          <div className="sg-panel-kicker">QUICK LENSES</div>
          <div className="sg-lens-grid">
            <button data-testid="starlink-lens" onClick={() => quickLens('starlink')} type="button"><span className="sg-lens-glyph sg-lens-starlink"><i /><i /><i /></span><strong>Starlink</strong><small>Planes & shells</small></button>
            <button onClick={() => quickLens('geo')} type="button"><span className="sg-lens-glyph sg-lens-geo"><i /></span><strong>GEO belt</strong><small>The high ring</small></button>
            <button onClick={() => quickLens('debris')} type="button"><span className="sg-lens-glyph sg-lens-debris"><i /><i /><i /><i /></span><strong>Debris field</strong><small>Context layer</small></button>
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
          <select data-testid="encoding-select" id="sg-encoding" onChange={(event) => adapter.setEncoding(event.target.value as VisualEncoding)} value={engine.encoding}>
            {Object.entries(encodingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </section>

        <section className="sg-saved-views">
          <div className="sg-section-heading"><span><Icon name="bookmark" size={15} /> SAVED VIEWS</span><button onClick={saveView} type="button">+ Save current</button></div>
          {savedViews.length === 0 ? <p>Camera, time, filters, selection, scale, and presentation mode travel together.</p> : savedViews.slice(0, 2).map((view) => <button key={view.name} onClick={() => applyView(view)} type="button"><strong>{view.name}</strong><small>{encodingLabels[view.encoding]}</small></button>)}
          <div className="sg-portable-actions">
            <button data-testid="export-view" onClick={() => downloadSavedView(createView())} type="button"><Icon name="export" size={14} /> Export JSON</button>
            <button onClick={() => fileInput.current?.click()} type="button"><Icon name="import" size={14} /> Import</button>
            <input accept="application/json,.json" data-testid="import-view" onChange={(event) => importFile(event.target.files?.[0])} ref={fileInput} type="file" />
          </div>
        </section>
        <details className="sg-legal">
          <summary>Data, source & legal</summary>
          <p>SatGlobe is a modified KeepTrack source fork. KeepTrack © Kruczek Labs LLC and contributors; earlier ThingsInSpace work © James Yoder. AGPL-3.0, without warranty.</p>
          <div><a href="https://github.com/jtn0123/SatGlobe" rel="noreferrer" target="_blank">SatGlobe source ↗</a><a href="https://github.com/thkruz/keeptrack.space" rel="noreferrer" target="_blank">Upstream ↗</a><a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noreferrer" target="_blank">License ↗</a></div>
        </details>
      </aside>

      <Inspector object={engine.selectedObject} onClose={clearSelection} />

      <ScaleDisclosure mode={scaleMode} onToggle={toggleScale} />

      <TimeDock adapter={adapter} simulationTime={engine.simulationTime} />

      {mode === 'presentation' && <PresentationTitle encoding={engine.encoding} objectCount={visibleEstimate} onOpenWorkshop={openWorkshop} />}

      {mode === 'story' && <StoryDeck beatIndex={storyBeat} onAuthoredView={() => adapter.setCamera(beat.camera)} onBeatChange={applyBeat} onOpenWorkshop={openWorkshop} onPlayingChange={togglePlaying} onSourcesChange={toggleSources} playing={storyPlaying} progress={storyProgress} showSources={showSources} story={story} />}

      {notice && <button className="sg-notice" onClick={() => setNotice('')} type="button">{notice}<Icon name="close" size={14} /></button>}
      {!engine.ready && <div className="sg-engine-loading"><span className="sg-loader-ring" /><strong>Preparing the orbital environment</strong><small>Loading the bundled catalog and propagation workers…</small></div>}
    </main>
  );
}
