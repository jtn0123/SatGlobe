import { useCallback, useEffect, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { importSavedView } from '../domain/saved-view';
import {
  DEFAULT_FILTERS,
  type AppMode,
  type EngineState,
  type SavedViewV1,
  type ScaleMode,
  type SpaceObjectView,
  type StoryBeat,
} from '../domain/types';
import { starlinkBuildoutStory } from '../stories/starlink-buildout';
import { DiscoverPanel, getQuickLensState, type QuickLens } from './discover-panel';
import { Icon } from './icon';
import { Inspector } from './inspector';
import { KeyboardLegend } from './keyboard-legend';
import { ageInDays } from './labels';
import { PresentationTitle } from './presentation-title';
import { ScaleDisclosure } from './scale-disclosure';
import { StoryDeck } from './story-deck';
import { TimeDock } from './time-dock';
import { TopBar } from './top-bar';
import { useStoryPlayback } from './use-story-playback';
import { useWorkshopFilters } from './use-workshop-filters';

interface SatGlobeAppProps {
  adapter: SatGlobeEngineAdapter;
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
  const [webglMissing, setWebglMissing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const story = starlinkBuildoutStory;

  useEffect(() => adapter.subscribe(setEngine), [adapter]);

  // WebGL2 failure otherwise presents as an eternal loading state (C1).
  useEffect(() => {
    const probe = document.createElement('canvas').getContext('webgl2');

    if (!probe) {
      setWebglMissing(true);
    }
  }, []);

  useEffect(() => {
    setResults(adapter.search(query));
  }, [adapter, engine.objectCount, query]);

  const onBeatApplied = useCallback((beat: StoryBeat) => {
    const beatFilters = { ...structuredClone(DEFAULT_FILTERS), constellation: beat.constellation ?? '' };

    setFiltersState(beatFilters);
    setScaleMode(beat.scaleMode);
    adapter.setScaleMode(beat.scaleMode);
    adapter.setCamera(beat.camera);
    adapter.setFilters(beatFilters);
    adapter.setEncoding(beat.encoding);
  }, [adapter, setFiltersState]);

  const { playback, dispatch, applyBeat } = useStoryPlayback(story, mode === 'story', onBeatApplied);
  const beat = story.beats[playback.beatIndex];

  const switchMode = useCallback((nextMode: AppMode) => {
    setMode(nextMode);
    document.body.classList.toggle('sg-presentation', nextMode === 'presentation');
    document.body.classList.toggle('sg-story', nextMode === 'story');
    if (nextMode === 'story') {
      dispatch({ type: 'stop' });
    }
  }, [dispatch]);

  // Stable handlers so memoized children skip re-rendering on unrelated state changes.
  const clearSelection = useCallback(() => adapter.clearSelection(), [adapter]);
  const openWorkshop = useCallback(() => switchMode('workshop'), [switchMode]);
  const togglePlaying = useCallback(() => dispatch({ type: 'togglePlaying' }), [dispatch]);
  const toggleSources = useCallback(() => dispatch({ type: 'toggleSources' }), [dispatch]);
  const selectResult = useCallback((catalogId: string) => {
    adapter.selectObject(catalogId);
    setQuery('');
  }, [adapter]);
  const setEncoding = useCallback((encoding: Parameters<SatGlobeEngineAdapter['setEncoding']>[0]) => adapter.setEncoding(encoding), [adapter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      /*
       * The shell owns these keys. stopPropagation keeps KeepTrack's own
       * global input manager from double-handling them (C6); the handled
       * flag also gates preventDefault for keys with browser defaults.
       */
      let handled = true;

      if (event.key === '/') {
        document.querySelector<HTMLInputElement>('[data-testid="catalog-search"]')?.focus();
      } else if (event.key === '?') {
        setShowShortcuts((show) => !show);
      } else if (event.key === 'f') {
        switchMode(mode === 'presentation' ? 'workshop' : 'presentation');
      } else if (event.key === 'Escape') {
        setShowShortcuts(false);
        switchMode('workshop');
      } else if (mode === 'story' && event.key === 'ArrowRight') {
        applyBeat(playback.beatIndex + 1);
      } else if (mode === 'story' && event.key === 'ArrowLeft') {
        applyBeat(playback.beatIndex - 1);
      } else if (mode === 'story' && event.key === ' ') {
        dispatch({ type: 'togglePlaying' });
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyBeat, dispatch, mode, playback.beatIndex, switchMode]);

  const createView = useCallback((): SavedViewV1 => ({
    schemaVersion: 1,
    name: engine.selectedObject ? `${engine.selectedObject.name} study` : 'Orbital workshop view',
    camera: engine.camera,
    simulationTime: engine.simulationTime,
    filters,
    encoding: engine.encoding,
    selectedObjectIds: engine.selectedObject ? [engine.selectedObject.catalogId] : [],
    scaleMode,
    presentation: { mode, panelsVisible: mode === 'workshop', storyId: mode === 'story' ? story.id : undefined, storyBeat: mode === 'story' ? playback.beatIndex : undefined },
  }), [engine, filters, mode, playback.beatIndex, scaleMode, story.id]);

  const saveView = useCallback(() => {
    const view = createView();

    setSavedViews((views) => [view, ...views].slice(0, 12));
    setNotice(`Saved “${view.name}” locally for this session.`);
  }, [createView]);

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
  }, [adapter, applyBeat, setFiltersState, switchMode]);

  const importFile = useCallback(async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const imported = importSavedView(await file.text(), adapter.getObjects());

      applyView(imported.view);
      setNotice(imported.warnings[0] ?? `Imported “${imported.view.name}”.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import this preset.');
    }
  }, [adapter, applyView]);

  const quickLens = useCallback((lens: QuickLens) => {
    const { filters: next, encoding } = getQuickLensState(lens);

    setFilters(next);
    adapter.setEncoding(encoding);
  }, [adapter, setFilters]);

  const newestElementAge = ageInDays(engine.newestElementEpoch);
  const openStory = useCallback(() => {
    switchMode('story');
    applyBeat(playback.beatIndex);
  }, [applyBeat, playback.beatIndex, switchMode]);
  const toggleScale = useCallback(() => setScaleMode((value) => {
    const next = value === 'semantic' ? 'true' : 'semantic';

    adapter.setScaleMode(next);

    return next;
  }), [adapter]);

  return (
    <main className={`sg-app sg-mode-${mode}`} data-testid="satglobe-app">
      <TopBar mode={mode} newestElementAge={newestElementAge} objectCount={engine.objectCount} onModeChange={switchMode} onStoryOpen={openStory} ready={engine.ready} />

      <DiscoverPanel
        createView={createView}
        encoding={engine.encoding}
        filters={filters}
        inert={mode !== 'workshop'}
        onApplyView={applyView}
        onEncodingChange={setEncoding}
        onImportFile={importFile}
        onQueryChange={setQuery}
        onQuickLens={quickLens}
        onSaveView={saveView}
        onSelectResult={selectResult}
        query={query}
        results={results}
        savedViews={savedViews}
        setFilters={setFilters}
        visibleCount={engine.visibleCount}
      />

      <Inspector inert={mode !== 'workshop'} object={engine.selectedObject} onClose={clearSelection} />

      <ScaleDisclosure mode={scaleMode} onToggle={toggleScale} />

      <TimeDock adapter={adapter} simulationTime={engine.simulationTime} />

      {mode === 'presentation' && <PresentationTitle encoding={engine.encoding} objectCount={engine.visibleCount} onOpenWorkshop={openWorkshop} />}

      {mode === 'story' && <StoryDeck beatIndex={playback.beatIndex} onAuthoredView={() => adapter.setCamera(beat.camera)} onBeatChange={applyBeat} onOpenWorkshop={openWorkshop} onPlayingChange={togglePlaying} onSourcesChange={toggleSources} playing={playback.playing} progress={playback.progress} showSources={playback.showSources} story={story} />}

      {showShortcuts && <KeyboardLegend onClose={() => setShowShortcuts(false)} />}
      {notice && <button aria-live="polite" className="sg-notice" onClick={() => setNotice('')} role="status" type="button">{notice}<Icon name="close" size={14} /></button>}
      {(webglMissing || engine.error) && (
        <div className="sg-engine-loading sg-engine-error" data-testid="engine-error" role="alert">
          <Icon name="info" />
          <strong>{webglMissing ? 'This browser cannot render SatGlobe' : 'The orbital environment failed to load'}</strong>
          <small>{webglMissing ? 'SatGlobe needs WebGL 2. Enable hardware acceleration or use a current browser.' : engine.error}</small>
          <button onClick={() => window.location.reload()} type="button">Reload</button>
        </div>
      )}
      {!engine.ready && !engine.error && !webglMissing && (
        <div aria-live="polite" className="sg-engine-loading" role="status">
          <span className="sg-loader-ring" /><strong>Preparing the orbital environment</strong><small>Loading the bundled catalog and propagation workers…</small>
        </div>
      )}
    </main>
  );
}
