import { useCallback, useEffect, useRef, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { loadPersistedViews, persistViews } from '../domain/saved-view';
import {
  DEFAULT_FILTERS,
  type AppMode,
  type EngineState,
  type FilterState,
  type SavedViewV1,
  type ScaleMode,
  type SpaceObjectView,
  type StoryBeat,
  type VisualEncoding,
} from '../domain/types';
import { LENS_APPLY_MEASURE, measureSync } from '../runtime/performance-measure';
import { storySimulationAnchor, storySimulationTime } from '../domain/story-time';
import { storyLibrary } from '../stories';
import { DiscoverPanel, getQuickLensState, type QuickLens } from './discover-panel';
import { Icon } from './icon';
import { Inspector } from './inspector';
import { KeyboardLegend } from './keyboard-legend';
import { LaunchTimelapse } from './launch-timelapse';
import { ageInDays } from './labels';
import { PresentationTitle } from './presentation-title';
import { PlaylistDeck } from './playlist-deck';
import { ScaleDisclosure } from './scale-disclosure';
import { StoryDeck } from './story-deck';
import { TimeDock } from './time-dock';
import { TopBar } from './top-bar';
import { useStoryPlayback } from './use-story-playback';
import { useLaunchTimelapse } from './use-launch-timelapse';
import { usePlaylistLibrary } from './use-playlist-library';
import { useWorkshopFilters } from './use-workshop-filters';

interface SatGlobeAppProps {
  adapter: SatGlobeEngineAdapter;
}

/** Resolves portable story metadata without substituting an unrelated installed story. */
function resolveSavedStory(view: SavedViewV1) {
  const requestedStory = view.presentation.mode === 'story';
  const story = requestedStory ? storyLibrary.find(({ id }) => id === view.presentation.storyId) ?? null : null;
  const requestedBeatIndex = view.presentation.storyBeat ?? 0;
  const beatAvailable = story !== null && requestedBeatIndex < story.beats.length;
  const beatIndex = beatAvailable ? requestedBeatIndex : null;
  const beat = story && beatIndex !== null ? story.beats[beatIndex] : null;
  const unavailable = requestedStory && (!story || !beatAvailable);
  let reason = 'This saved view does not identify an installed story.';

  if (view.presentation.storyId && !story) {
    reason = `Story “${view.presentation.storyId}” is not installed.`;
  } else if (story && !beatAvailable) {
    reason = `Beat ${requestedBeatIndex + 1} of story “${story.title}” is not installed.`;
  }

  return {
    beat,
    beatIndex,
    mode: unavailable ? 'workshop' as const : view.presentation.mode,
    notice: unavailable ? `${reason} Restored its absolute view in Workshop instead.` : null,
    story: unavailable ? null : story,
  };
}

/** Builds a complete filter state and applies the optional sparse-subject orbit cue. */
function applyStoryBeatVisuals(adapter: SatGlobeEngineAdapter, beat: StoryBeat): FilterState {
  adapter.clearOrbits();
  const orbitCatalogIds = new Set([
    ...(beat.orbitCatalogId ? [beat.orbitCatalogId] : []),
    ...(beat.orbitCatalogIds ?? []),
  ]);

  for (const catalogId of orbitCatalogIds) {
    adapter.drawOrbit(catalogId);
  }

  return { ...structuredClone(DEFAULT_FILTERS), constellation: beat.constellation ?? '', launchCohort: beat.launchCohort ?? '', ...beat.filterOverrides };
}

/** Recovers the retained beat's fixed anchor when Story is reopened. */
function recoverRetainedStoryAnchor(adapter: SatGlobeEngineAdapter, beats: readonly StoryBeat[], beatIndex: number): string {
  const retainedBeat = beats[beatIndex] ?? beats[0];

  return storySimulationAnchor(adapter.getState().simulationTime, retainedBeat?.simulationTimeOffsetHours ?? 0);
}

/** Keeps ordinary filter lenses and the static conjunction highlight on separate mutation paths. */
function useQuickLensHandlers(
  adapter: SatGlobeEngineAdapter,
  setFiltersWithEncodingImmediate: (filters: FilterState, encoding: VisualEncoding) => void,
  conjunctionCatalogIds: readonly string[],
  conjunctionHighlightActive: boolean,
) {
  const quickLens = useCallback((lens: QuickLens) => {
    const { filters: next, encoding } = getQuickLensState(lens);

    measureSync(LENS_APPLY_MEASURE, { lens }, () => {
      setFiltersWithEncodingImmediate(next, encoding);
    });
  }, [setFiltersWithEncodingImmediate]);
  const conjunctionLens = useCallback(
    () => measureSync(LENS_APPLY_MEASURE, { lens: 'conjunction' }, () => {
      adapter.setHighlight(conjunctionHighlightActive ? [] : conjunctionCatalogIds);
    }),
    [adapter, conjunctionCatalogIds, conjunctionHighlightActive],
  );

  return { conjunctionLens, quickLens };
}

/** Coordinates SatGlobe's workshop, presentation, and story states. */
export function SatGlobeApp({ adapter }: SatGlobeAppProps) {
  const [engine, setEngine] = useState<EngineState>(adapter.getState());
  const [mode, setMode] = useState<AppMode>('workshop');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('semantic');
  const [query, setQuery] = useState('');
  const { filters, setFiltersImmediate, setFiltersWithEncodingImmediate, setFiltersDebounced } = useWorkshopFilters(adapter);
  const [results, setResults] = useState<SpaceObjectView[]>([]);
  const [savedViews, setSavedViews] = useState<SavedViewV1[]>(() => loadPersistedViews());
  const [notice, setNotice] = useState('');
  const [webglMissing, setWebglMissing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [storyId, setStoryId] = useState(storyLibrary[0].id);
  const story = storyLibrary.find(({ id }) => id === storyId) ?? storyLibrary[0];
  const storyTimeAnchorRef = useRef(engine.simulationTime);
  const { conjunctionLens, quickLens } = useQuickLensHandlers(adapter, setFiltersWithEncodingImmediate, engine.conjunctions.catalogIds, engine.conjunctionHighlightActive);
  const { applyLaunchYear, launchBounds } = useLaunchTimelapse(adapter, setFiltersWithEncodingImmediate);

  useEffect(() => adapter.subscribe(setEngine), [adapter]);
  // Replacing the engine boundary starts a fresh time reference for the next story beat.
  useEffect(() => {
    storyTimeAnchorRef.current = adapter.getState().simulationTime;
  }, [adapter]);
  // Saved views survive reloads; persistence failures degrade to session-only.
  useEffect(() => persistViews(savedViews), [savedViews]);
  // WebGL2 failure otherwise presents as an eternal loading state (C1).
  useEffect(() => {
    const probe = document.createElement('canvas').getContext('webgl2');

    if (!probe) {
      setWebglMissing(true);
    }
  }, []);
  useEffect(() => {
    // Pre-ready searches would query an unbuilt catalog and flash empty results.
    setResults(engine.ready ? adapter.search(query) : []);
  }, [adapter, engine.objectCount, engine.ready, query]);

  const onBeatApplied = useCallback((beat: StoryBeat) => {
    const beatFilters = applyStoryBeatVisuals(adapter, beat);

    if (beat.simulationTimeOffsetHours !== undefined) {
      adapter.setSimulationTime(storySimulationTime(storyTimeAnchorRef.current, beat.simulationTimeOffsetHours));
    }
    setFiltersImmediate(beatFilters);
    setScaleMode(beat.scaleMode);
    adapter.setScaleMode(beat.scaleMode);
    adapter.setCamera(beat.camera);
    adapter.setEncoding(beat.encoding);
  }, [adapter, setFiltersImmediate]);

  const { playback, dispatch, applyBeat } = useStoryPlayback(story, mode === 'story', onBeatApplied);
  const changeStory = useCallback((id: string) => {
    if (id !== storyId) {
      storyTimeAnchorRef.current = adapter.getState().simulationTime;
      setStoryId(id);
    }
  }, [adapter, storyId]);
  /*
   * Applying the new story's opening beat must wait for the re-render, when
   * applyBeat's closure holds the new manifest; the ref keeps this from firing
   * on unrelated dependency changes.
   */
  const prevStoryIdRef = useRef(storyId);
  const pendingStoryBeatRef = useRef<{ storyId: string; beatIndex: number } | null>(null);

  useEffect(() => {
    if (prevStoryIdRef.current !== storyId) {
      prevStoryIdRef.current = storyId;
      if (mode === 'story') {
        const pending = pendingStoryBeatRef.current;
        const beatIndex = pending?.storyId === storyId ? pending.beatIndex : 0;

        pendingStoryBeatRef.current = null;
        applyBeat(beatIndex);
      }
    }
  }, [applyBeat, mode, storyId]);
  const beat = story.beats[playback.beatIndex];

  const switchMode = useCallback((nextMode: AppMode) => {
    setMode(nextMode);
    document.body.classList.toggle('sg-presentation', nextMode === 'presentation');
    document.body.classList.toggle('sg-story', nextMode === 'story');
    if (nextMode === 'story') {
      dispatch({ type: 'stop' });
    } else {
      adapter.clearOrbits();
    }
  }, [adapter, dispatch]);

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
      if (event.target instanceof window.HTMLInputElement || event.target instanceof window.HTMLSelectElement) {
        return;
      }
      /* The shell stops handled keys before KeepTrack can double-handle them; the flag also gates browser defaults. */
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
    setNotice(`Saved “${view.name}” on this device.`);
  }, [createView]);

  const applyView = useCallback((view: SavedViewV1) => {
    const { beat: restoredBeat, beatIndex: restoredBeatIndex, mode: restoredMode, notice: unavailableStoryNotice, story: restoredStory } = resolveSavedStory(view);

    if (restoredBeat) {
      storyTimeAnchorRef.current = storySimulationAnchor(view.simulationTime, restoredBeat.simulationTimeOffsetHours ?? 0);
    }
    setFiltersWithEncodingImmediate(view.filters, view.encoding);
    setScaleMode(view.scaleMode);
    adapter.setScaleMode(view.scaleMode);
    adapter.setCamera(view.camera);
    if (!restoredBeat || restoredBeat.simulationTimeOffsetHours === undefined) {
      adapter.setSimulationTime(view.simulationTime);
    }
    adapter.clearSelection();
    if (view.selectedObjectIds[0]) {
      adapter.selectObject(view.selectedObjectIds[0]);
    }
    switchMode(restoredMode);
    if (restoredStory && restoredBeatIndex !== null) {
      if (restoredStory.id === story.id) {
        applyBeat(restoredBeatIndex);
      } else {
        pendingStoryBeatRef.current = { storyId: restoredStory.id, beatIndex: restoredBeatIndex };
        setStoryId(restoredStory.id);
      }
    }
    if (unavailableStoryNotice) {
      pendingStoryBeatRef.current = null;
      setNotice(unavailableStoryNotice);
    }

    return unavailableStoryNotice;
  }, [adapter, applyBeat, setFiltersWithEncodingImmediate, story, switchMode]);

  const playlistLibrary = usePlaylistLibrary({
    adapter,
    mode,
    savedViews,
    createView,
    onApplyView: applyView,
    onNotice: setNotice,
    onSaveView: saveView,
    setFiltersWithEncodingImmediate,
    setScaleMode,
    switchMode,
  });

  const newestElementAge = ageInDays(engine.newestElementEpoch);
  const openStory = useCallback(() => {
    if (mode !== 'story') {
      // Recover the retained session anchor so relative beats do not compound on re-entry.
      storyTimeAnchorRef.current = recoverRetainedStoryAnchor(adapter, story.beats, playback.beatIndex);
    }
    switchMode('story');
    applyBeat(playback.beatIndex);
  }, [adapter, applyBeat, mode, playback.beatIndex, story.beats, switchMode]);
  const toggleScale = useCallback(() => setScaleMode((value) => {
    const next = value === 'semantic' ? 'true' : 'semantic';

    adapter.setScaleMode(next);

    return next;
  }), [adapter]);
  const launchTimelapseVisible = engine.ready && launchBounds !== null && mode !== 'story' && !(mode === 'presentation' && playlistLibrary.activePlaylist);

  return (
    <main className={`sg-app sg-mode-${mode}${mode === 'presentation' && playlistLibrary.activePlaylist ? ' sg-playlist-active' : ''}`} data-testid="satglobe-app">
      <div className="sg-small-screen-note" role="note">SatGlobe is designed for larger screens — panels are limited at this size.</div>
      {/* display:contents wrapper; keeps the booting shell out of the tab order behind the loading overlay */}
      <div className="sg-boot-guard" inert={!engine.ready || undefined}>
      <TopBar mode={mode} newestElementAge={newestElementAge} objectCount={engine.objectCount} onModeChange={switchMode} onStoryOpen={openStory} ready={engine.ready} storyCount={storyLibrary.length} />

      {launchTimelapseVisible && launchBounds && <LaunchTimelapse activeYear={filters.launchYearMax} bounds={launchBounds} onYearChange={applyLaunchYear} />}

      <DiscoverPanel
        conjunctions={engine.conjunctions}
        conjunctionHighlightActive={engine.conjunctionHighlightActive}
        encoding={engine.encoding}
        filters={filters}
        highlightedObjectCount={engine.highlightedObjectCount}
        inert={mode !== 'workshop'}
        onConjunctionLens={conjunctionLens}
        onEncodingChange={setEncoding}
        onQueryChange={setQuery}
        onQuickLens={quickLens}
        onSelectResult={selectResult}
        query={query}
        results={results}
        setFiltersDebounced={setFiltersDebounced}
        setFiltersImmediate={setFiltersImmediate}
        visibleCount={engine.visibleCount}
        viewLibrary={playlistLibrary.viewLibrary}
      />

      <Inspector conjunctions={engine.conjunctions} inert={mode !== 'workshop'} object={engine.selectedObject} onClose={clearSelection} />

      <ScaleDisclosure mode={scaleMode} onToggle={toggleScale} />

      <TimeDock adapter={adapter} simulationTime={engine.simulationTime} />

      {mode === 'presentation' && !playlistLibrary.activePlaylist && <PresentationTitle encoding={engine.encoding} objectCount={engine.visibleCount} onOpenWorkshop={openWorkshop} />}

      {mode === 'presentation' && playlistLibrary.activePlaylist && <PlaylistDeck
        entryIndex={playlistLibrary.player.playback.entryIndex}
        onEntryChange={playlistLibrary.player.applyEntry}
        onOpenWorkshop={openWorkshop}
        onPlayingChange={playlistLibrary.player.togglePlaying}
        playing={playlistLibrary.player.playback.playing}
        playlist={playlistLibrary.activePlaylist}
        progress={playlistLibrary.player.playback.progress}
        reducedMotion={playlistLibrary.player.reducedMotion}
      />}

      {mode === 'story' && <StoryDeck beatIndex={playback.beatIndex} onAuthoredView={() => adapter.setCamera(beat.camera)} onBeatChange={applyBeat} onOpenWorkshop={openWorkshop} onPlayingChange={togglePlaying} onSourcesChange={toggleSources} onStoryChange={changeStory} playing={playback.playing} progress={playback.progress} showSources={playback.showSources} stories={storyLibrary} story={story} />}

      {showShortcuts && <KeyboardLegend onClose={() => setShowShortcuts(false)} />}
      </div>
      {notice && (
        <div className="sg-notice" data-testid="app-notice">
          <span aria-live="polite" role="status">{notice}</span>
          <button aria-label="Dismiss notice" className="sg-icon-button" onClick={() => setNotice('')} type="button">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
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
