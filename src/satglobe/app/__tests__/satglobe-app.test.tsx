import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type AvailableConjunctionState, type PlaylistV1, type SavedViewV1, type SpaceObjectView } from '../../domain/types';
import { storyLibrary } from '../../stories';
import { SatGlobeApp } from '../satglobe-app';
import { makeAdapter } from './test-adapter';

const mutatingMethodNames = [
  'selectObject',
  'clearSelection',
  'setSimulationTime',
  'setPlaybackRate',
  'setCamera',
  'setFilters',
  'setEncoding',
  'setVisualState',
  'setHighlight',
  'setScaleMode',
  'drawOrbit',
  'clearOrbits',
  'dispose',
] as const;

const AVAILABLE_CONJUNCTIONS: AvailableConjunctionState = {
  status: 'current',
  conjunctions: [],
  lensPairCount: 0,
  catalogIds: ['25544', '43013'],
  droppedPairCount: 0,
  source: {
    provider: 'CelesTrak',
    rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
    updatedAt: '2026-07-18T08:00:00.000Z',
    retrievedAt: '2026-07-18T08:05:00.000Z',
    checksum: 'a'.repeat(64),
  },
  error: null,
};

const selectedObject: SpaceObjectView = {
  catalogId: '25544',
  name: 'ISS (ZARYA)',
  kind: 'payload',
  active: true,
  status: 'Operational',
  internationalDesignator: '1998-067A',
  launchDate: '1998-11-20',
  launchVehicle: 'Proton-K',
  owner: 'NASA',
  country: 'US',
  source: 'CelesTrak',
  epoch: '2026-07-17T00:00:00.000Z',
  apogeeKm: 420,
  perigeeKm: 410,
  inclinationDeg: 51.6,
  periodMinutes: 92.9,
  regime: 'leo',
  isStarlink: false,
  nameText: 'iss (zarya)',
  launchText: '1998-067a 1998-11-20',
  ownershipText: 'us nasa',
  searchText: 'iss (zarya) 25544 1998-067a',
};

/** Controls the shell's explicit WebGL 2 capability probe. */
function stubWebGl(available = true) {
  return vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => (available ? {} as WebGL2RenderingContext : null),
  );
}

/** Renders a ready shell with a constructor-free adapter by default. */
function renderApp(options: Parameters<typeof makeAdapter>[0] = {}) {
  stubWebGl();
  const testAdapter = makeAdapter(options);

  render(<SatGlobeApp adapter={testAdapter.adapter} />);

  return testAdapter;
}

/** Proves a rejected import did not partially cross any mutable adapter boundary. */
function expectNoAdapterMutations(methods: ReturnType<typeof makeAdapter>['methods']) {
  for (const methodName of mutatingMethodNames) {
    expect(methods[methodName]).not.toHaveBeenCalled();
  }
}

/** Reads user-visible shell state that an unsafe partial import could change. */
function readWorkshopBaseline() {
  const app = screen.getByTestId('satglobe-app');

  return {
    workshopMode: app.classList.contains('sg-mode-workshop'),
    presentationMode: app.classList.contains('sg-mode-presentation'),
    storyMode: app.classList.contains('sg-mode-story'),
    activeStatusPressed: screen.getByTestId('status-active').getAttribute('aria-pressed'),
    allStatusPressed: screen.getByTestId('status-all').getAttribute('aria-pressed'),
    encoding: (screen.getByTestId('encoding-select') as HTMLSelectElement).value,
    scale: screen.getByTestId('scale-disclosure').querySelector('strong')?.textContent,
  };
}

/** Selects a portable-view file and waits for its user-visible import result. */
async function importPreset(raw: string) {
  const file = new File([raw], 'preset.json', { type: 'application/json' });

  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(raw) });
  fireEvent.change(screen.getByTestId('import-view'), { target: { files: [file] } });
  await vi.waitFor(() => {
    screen.getByTestId('app-notice');
  });

  return screen.getByTestId('app-notice');
}

/** Selects a portable-playlist file and waits for its user-visible result. */
async function importPlaylistFile(raw: string) {
  const file = new File([raw], 'playlist.json', { type: 'application/json' });

  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(raw) });
  fireEvent.change(screen.getByTestId('import-playlist'), { target: { files: [file] } });
  await vi.waitFor(() => {
    screen.getByTestId('app-notice');
  });

  return screen.getByTestId('app-notice');
}

describe('SatGlobeApp', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.body.classList.remove('sg-presentation', 'sg-story');
    vi.restoreAllMocks();
  });

  it('surfaces an actionable fallback when WebGL 2 is unavailable', () => {
    stubWebGl(false);
    const { adapter } = makeAdapter();

    render(<SatGlobeApp adapter={adapter} />);

    expect(screen.getByTestId('engine-error').textContent).toContain('This browser cannot render SatGlobe');
    expect(screen.getByTestId('engine-error').textContent).toContain('SatGlobe needs WebGL 2');
  });

  it('surfaces an engine boot error even when WebGL 2 is available', () => {
    renderApp({ state: { error: 'Catalog hydration failed.', ready: false } });

    expect(screen.getByTestId('engine-error').textContent).toContain('The orbital environment failed to load');
    expect(screen.getByTestId('engine-error').textContent).toContain('Catalog hydration failed.');
  });

  it('renders the ready shell without a fallback or loading overlay', () => {
    renderApp();

    expect(screen.getByTestId('satglobe-app')).toBeTruthy();
    expect(screen.queryByTestId('engine-error')).toBeNull();
    expect(screen.queryByText('Preparing the orbital environment')).toBeNull();
  });

  it('applies cumulative launch history through one combined visual update in Workshop and Present', () => {
    const firstLaunch = { ...selectedObject, catalogId: '5', internationalDesignator: '1958-002B', launchDate: '1958-03-17' };
    const newestLaunch = { ...selectedObject, catalogId: '99999', internationalDesignator: '2026-027A', launchDate: '2026-02-03' };
    const { methods } = renderApp({ objects: [firstLaunch, newestLaunch] });

    fireEvent.click(screen.getByRole('button', { name: 'Show launches through 1970' }));
    expect(methods.setVisualState).toHaveBeenCalledOnce();
    expect(methods.setVisualState).toHaveBeenCalledWith({
      encoding: 'launch-cohort',
      filters: expect.objectContaining({
        launchYearMax: 1970,
        objectKinds: ['payload', 'rocket-body', 'debris', 'other'],
        status: 'all',
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(screen.getByTestId('launch-timelapse')).toBeTruthy();
    fireEvent.click(screen.getByTestId('story-mode'));
    expect(screen.queryByTestId('launch-timelapse')).toBeNull();
  });

  it('deactivates launch history when a quick lens replaces its cumulative filter', () => {
    const firstLaunch = { ...selectedObject, catalogId: '5', internationalDesignator: '1958-002B', launchDate: '1958-03-17' };
    const newestLaunch = { ...selectedObject, catalogId: '99999', internationalDesignator: '2026-027A', launchDate: '2026-02-03' };

    renderApp({ objects: [firstLaunch, newestLaunch] });
    fireEvent.click(screen.getByRole('button', { name: 'Show launches through 1970' }));
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-active')).toBe('true');

    fireEvent.click(screen.getByTestId('starlink-lens'));

    expect(screen.getByTestId('launch-timelapse').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('launch-timelapse').getAttribute('data-playing')).toBe('false');
  });

  it('announces notices without replacing the dismiss button semantics', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '+ Save current' }));
    const notice = screen.getByTestId('app-notice');
    const status = within(notice).getByRole('status');
    const dismiss = within(notice).getByRole('button', { name: 'Dismiss notice' });

    expect(notice.contains(status)).toBe(true);
    expect(status.textContent).toContain('Saved “Orbital workshop view” on this device.');
    expect(dismiss.getAttribute('role')).toBeNull();

    fireEvent.click(dismiss);
    expect(screen.queryByTestId('app-notice')).toBeNull();
  });

  it('handles the global search, legend, presentation, and escape shortcuts', () => {
    renderApp();
    const app = screen.getByTestId('satglobe-app');

    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(screen.getByTestId('catalog-search'));

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keyboard-legend')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'f' });
    expect(app.classList.contains('sg-mode-presentation')).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(app.classList.contains('sg-mode-workshop')).toBe(true);
    expect(screen.queryByTestId('keyboard-legend')).toBeNull();
  });

  it('uses arrow and space shortcuts to navigate and play a story', () => {
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('story-mode'));
    expect(screen.getByTestId('story-deck').textContent).toContain('Before the shell');
    methods.setFilters.mockClear();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('story-deck').textContent).toContain('One launch, one catalog cohort');
    expect(methods.setFilters).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('story-deck').textContent).toContain('Before the shell');

    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByTestId('story-play').getAttribute('aria-label')).toBe('Pause story');
  });

  it('does not change simulation time for existing beats without a relative offset', () => {
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('story-mode'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(methods.setSimulationTime).not.toHaveBeenCalled();
  });

  it('resolves zero and repeated time offsets from one stable story-session anchor', () => {
    const timeStory = storyLibrary.find(({ id }) => id === 'one-day-in-orbit')!;
    const openingBeat = timeStory.beats[0];
    const sixHourBeat = timeStory.beats.find(({ simulationTimeOffsetHours }) => simulationTimeOffsetHours === 6)!;
    const { methods, state } = renderApp({ state: { simulationTime: '2026-07-17T12:00:00.000Z' } });

    methods.setSimulationTime.mockImplementation((iso) => {
      state.simulationTime = iso;
    });
    fireEvent.click(screen.getByTestId('story-mode'));
    fireEvent.change(screen.getByTestId('story-picker'), { target: { value: timeStory.id } });
    expect(methods.setSimulationTime).toHaveBeenLastCalledWith('2026-07-17T12:00:00.000Z');
    methods.setSimulationTime.mockClear();

    fireEvent.click(screen.getByRole('button', { name: `Go to ${sixHourBeat.title}` }));
    fireEvent.click(screen.getByRole('button', { name: `Go to ${openingBeat.title}` }));
    fireEvent.click(screen.getByRole('button', { name: `Go to ${sixHourBeat.title}` }));

    expect(methods.setSimulationTime.mock.calls.map(([iso]) => iso)).toEqual([
      '2026-07-17T18:00:00.000Z',
      '2026-07-17T12:00:00.000Z',
      '2026-07-17T18:00:00.000Z',
    ]);
  });

  it('captures a fresh simulation-time anchor when the selected story changes', () => {
    const timeStory = storyLibrary.find(({ id }) => id === 'one-day-in-orbit')!;
    const sixHourBeat = timeStory.beats.find(({ simulationTimeOffsetHours }) => simulationTimeOffsetHours === 6)!;
    const { methods, state } = renderApp({ state: { simulationTime: '2026-07-17T12:00:00.000Z' } });

    methods.setSimulationTime.mockImplementation((iso) => {
      state.simulationTime = iso;
    });
    fireEvent.click(screen.getByTestId('story-mode'));
    state.simulationTime = '2026-07-17T15:00:00.000Z';
    fireEvent.change(screen.getByTestId('story-picker'), { target: { value: timeStory.id } });
    fireEvent.click(screen.getByRole('button', { name: `Go to ${sixHourBeat.title}` }));

    expect(methods.setSimulationTime).toHaveBeenLastCalledWith('2026-07-17T21:00:00.000Z');
  });

  it('does not compound a retained time offset when reopening Story', () => {
    const timeStory = storyLibrary.find(({ id }) => id === 'one-day-in-orbit')!;
    const finalBeat = timeStory.beats.find(({ simulationTimeOffsetHours }) => simulationTimeOffsetHours === 24)!;
    const { methods, state } = renderApp({ state: { simulationTime: '2026-07-17T12:00:00.000Z' } });

    methods.setSimulationTime.mockImplementation((iso) => {
      state.simulationTime = iso;
    });
    fireEvent.click(screen.getByTestId('story-mode'));
    fireEvent.change(screen.getByTestId('story-picker'), { target: { value: timeStory.id } });
    fireEvent.click(screen.getByRole('button', { name: `Go to ${finalBeat.title}` }));
    expect(state.simulationTime).toBe('2026-07-18T12:00:00.000Z');

    fireEvent.keyDown(window, { key: 'Escape' });
    methods.setSimulationTime.mockClear();
    fireEvent.click(screen.getByTestId('story-mode'));

    expect(methods.setSimulationTime).toHaveBeenCalledOnce();
    expect(methods.setSimulationTime).toHaveBeenLastCalledWith('2026-07-18T12:00:00.000Z');
  });

  it('applies an authored launch-cohort filter through the immediate story path', () => {
    const cohortStory = storyLibrary.find(({ id }) => id === 'launch-to-orbit')!;
    const cohortBeat = cohortStory.beats.find(({ launchCohort }) => launchCohort)!;
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('story-mode'));
    fireEvent.change(screen.getByTestId('story-picker'), { target: { value: cohortStory.id } });

    expect(methods.setFilters).toHaveBeenCalledWith(expect.objectContaining({ launchCohort: cohortBeat.launchCohort }));
  });

  it('clears the preceding orbit and draws the sparse subject authored for an ISS beat', () => {
    const issStory = storyLibrary.find(({ id }) => id === 'iss-assembly')!;
    const zaryaBeat = issStory.beats.find(({ id }) => id === 'zarya')!;
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('story-mode'));
    fireEvent.change(screen.getByTestId('story-picker'), { target: { value: issStory.id } });
    methods.clearOrbits.mockClear();
    methods.drawOrbit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: `Go to ${zaryaBeat.title}` }));

    expect(methods.clearOrbits).toHaveBeenCalledTimes(1);
    expect(methods.drawOrbit).toHaveBeenCalledTimes(1);
    expect(methods.drawOrbit).toHaveBeenCalledWith(zaryaBeat.orbitCatalogId);
  });

  it('clears the preceding orbits and draws every representative path authored for a GPS beat', () => {
    const gpsStory = storyLibrary.find(({ id }) => id === 'gps-constellation')!;
    const sixPlanesBeat = gpsStory.beats.find(({ id }) => id === 'six-planes-beat')!;
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('story-mode'));
    fireEvent.change(screen.getByTestId('story-picker'), { target: { value: gpsStory.id } });
    methods.clearOrbits.mockClear();
    methods.drawOrbit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: `Go to ${sixPlanesBeat.title}` }));

    expect(methods.clearOrbits).toHaveBeenCalledTimes(1);
    expect(methods.drawOrbit.mock.calls.map(([catalogId]) => catalogId)).toEqual(sixPlanesBeat.orbitCatalogIds);
  });

  it('restores a saved story id and absolute offset-beat time without applying the offset twice', async () => {
    const targetStory = storyLibrary.find(({ id }) => id === 'one-day-in-orbit')!;
    const firstBeat = targetStory.beats[0];
    const secondBeat = targetStory.beats.find(({ simulationTimeOffsetHours }) => simulationTimeOffsetHours === 6)!;
    const secondBeatIndex = targetStory.beats.indexOf(secondBeat);
    const savedView: SavedViewV1 = {
      schemaVersion: 1,
      name: 'Saved offset story',
      camera: DEFAULT_CAMERA,
      simulationTime: '2026-07-17T18:00:00.000Z',
      filters: structuredClone(DEFAULT_FILTERS),
      encoding: 'orbit-regime',
      selectedObjectIds: [],
      scaleMode: 'semantic',
      presentation: { mode: 'story', panelsVisible: false, storyId: targetStory.id, storyBeat: secondBeatIndex },
    };

    localStorage.setItem('satglobe.savedViews.v1', JSON.stringify([savedView]));
    const { methods } = renderApp({ state: { simulationTime: '2026-07-20T00:00:00.000Z' } });

    fireEvent.click(screen.getByText(savedView.name));
    await vi.waitFor(() => {
      expect((screen.getByTestId('story-picker') as HTMLSelectElement).value).toBe(targetStory.id);
      expect(screen.getByTestId('story-deck').textContent).toContain(secondBeat.title);
    });

    expect(methods.setSimulationTime).toHaveBeenCalledTimes(1);
    expect(methods.setSimulationTime).toHaveBeenLastCalledWith(savedView.simulationTime);
    methods.setSimulationTime.mockClear();

    fireEvent.click(screen.getByRole('button', { name: `Go to ${firstBeat.title}` }));
    expect(methods.setSimulationTime).toHaveBeenCalledWith('2026-07-17T12:00:00.000Z');
  });

  it.each([
    ['missing', undefined, 2],
    ['unknown', 'removed-story', 2],
    ['removed beat', storyLibrary[0].id, storyLibrary[0].beats.length + 3],
  ])('restores a saved view with a %s story reference as an absolute Workshop view', (_kind, storyId, storyBeat) => {
    const savedView: SavedViewV1 = {
      schemaVersion: 1,
      name: 'Unavailable story view',
      camera: { pitch: 0.22, yaw: 1.1, zoom: 0.44 },
      simulationTime: '2026-07-17T18:00:00.000Z',
      filters: { ...structuredClone(DEFAULT_FILTERS), status: 'all' },
      encoding: 'data-age',
      selectedObjectIds: [],
      scaleMode: 'true',
      presentation: { mode: 'story', panelsVisible: false, storyId, storyBeat },
    };

    localStorage.setItem('satglobe.savedViews.v1', JSON.stringify([savedView]));
    const { methods } = renderApp({ state: { selectedObject } });

    fireEvent.click(screen.getByText(savedView.name));

    expect(screen.getByTestId('satglobe-app').classList.contains('sg-mode-workshop')).toBe(true);
    expect(screen.queryByTestId('story-deck')).toBeNull();
    expect(methods.setSimulationTime).toHaveBeenCalledTimes(1);
    expect(methods.setSimulationTime).toHaveBeenCalledWith(savedView.simulationTime);
    expect(methods.setVisualState).toHaveBeenCalledTimes(1);
    expect(methods.setVisualState).toHaveBeenCalledWith({ filters: savedView.filters, encoding: savedView.encoding });
    expect(methods.setCamera).toHaveBeenCalledTimes(1);
    expect(methods.setCamera).toHaveBeenCalledWith(savedView.camera);
    expect(methods.setFilters).not.toHaveBeenCalled();
    expect(methods.setEncoding).not.toHaveBeenCalled();
    expect(methods.setScaleMode).toHaveBeenCalledTimes(1);
    expect(methods.setScaleMode).toHaveBeenCalledWith(savedView.scaleMode);
    expect(methods.clearSelection).toHaveBeenCalledTimes(1);
    expect(methods.selectObject).not.toHaveBeenCalled();
    expect(screen.getByTestId('app-notice').textContent).toContain('Restored its absolute view in Workshop');
  });

  it.each([
    ['input', 'catalog-search'],
    ['select', 'encoding-select'],
  ])('does not run global shortcuts from a %s control', (_kind, testId) => {
    renderApp();
    const app = screen.getByTestId('satglobe-app');

    fireEvent.keyDown(screen.getByTestId(testId), { key: 'f' });

    expect(app.classList.contains('sg-mode-workshop')).toBe(true);
    expect(app.classList.contains('sg-mode-presentation')).toBe(false);
  });

  it('applies a quick lens through one combined visual-state update', () => {
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('starlink-lens'));

    expect(methods.setVisualState).toHaveBeenCalledOnce();
    expect(methods.setVisualState).toHaveBeenCalledWith({
      filters: expect.objectContaining({ constellation: 'starlink' }),
      encoding: 'orbital-plane',
    });
    expect(methods.setFilters).not.toHaveBeenCalled();
    expect(methods.setEncoding).not.toHaveBeenCalled();
  });

  it('plays persisted views as a paused Presentation sequence with one visual update per step', () => {
    const firstView: SavedViewV1 = {
      schemaVersion: 1,
      name: 'Opening field',
      camera: DEFAULT_CAMERA,
      simulationTime: '2026-07-18T12:00:00.000Z',
      filters: { ...structuredClone(DEFAULT_FILTERS), status: 'all' },
      encoding: 'object-type',
      selectedObjectIds: [],
      scaleMode: 'semantic',
      presentation: { mode: 'story', panelsVisible: false, storyId: storyLibrary[0].id, storyBeat: 1 },
    };
    const secondView: SavedViewV1 = {
      ...firstView,
      name: 'Closing ring',
      filters: { ...structuredClone(DEFAULT_FILTERS), regimes: ['geo'] },
      encoding: 'orbit-regime',
      scaleMode: 'true',
    };
    const playlist: PlaylistV1 = {
      schemaVersion: 1,
      id: '870bb249-6c6d-4771-8505-da74b2f393f2',
      name: 'Two-view briefing',
      entries: [
        { view: firstView, caption: 'Begin in the whole field.', durationMs: 6_000 },
        { view: secondView, caption: 'Finish at geosynchronous altitude.', durationMs: 7_000 },
      ],
    };

    localStorage.setItem('satglobe.playlists.v1', JSON.stringify([playlist]));
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId(`play-playlist-${playlist.id}`));

    expect(screen.getByTestId('satglobe-app').classList.contains('sg-mode-presentation')).toBe(true);
    expect(screen.getByTestId('satglobe-app').classList.contains('sg-playlist-active')).toBe(true);
    expect(screen.getByTestId('playlist-deck').getAttribute('data-playing')).toBe('false');
    expect(screen.getByTestId('playlist-caption').textContent).toBe('Begin in the whole field.');
    expect(screen.queryByTestId('story-deck')).toBeNull();
    expect(document.querySelector('.sg-presentation-title')).toBeNull();
    expect(screen.queryByText('Sources · Facts')).toBeNull();
    expect(methods.setVisualState).toHaveBeenCalledTimes(1);
    expect(methods.setVisualState).toHaveBeenLastCalledWith({ filters: firstView.filters, encoding: firstView.encoding });

    fireEvent.click(screen.getByTestId('playlist-next'));

    expect(screen.getByTestId('playlist-caption').textContent).toBe('Finish at geosynchronous altitude.');
    expect(methods.setVisualState).toHaveBeenCalledTimes(2);
    expect(methods.setVisualState).toHaveBeenLastCalledWith({ filters: secondView.filters, encoding: secondView.encoding });
    expect(methods.setFilters).not.toHaveBeenCalled();
    expect(methods.setEncoding).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByTestId('playlist-deck')).getByRole('button', { name: 'Open workshop' }));
    expect(screen.getByTestId('satglobe-app').classList.contains('sg-playlist-active')).toBe(false);
    fireEvent.click(screen.getByTestId(`play-playlist-${playlist.id}`));

    expect(screen.getByTestId('playlist-deck').getAttribute('data-entry-index')).toBe('0');
    expect(screen.getByTestId('playlist-caption').textContent).toBe('Begin in the whole field.');
    expect(methods.setVisualState).toHaveBeenCalledTimes(3);
    expect(methods.setVisualState).toHaveBeenLastCalledWith({ filters: firstView.filters, encoding: firstView.encoding });
  });

  it('loads a persisted playlist after remount without resuming playback', () => {
    const savedView: SavedViewV1 = {
      schemaVersion: 1,
      name: 'Portable view',
      camera: DEFAULT_CAMERA,
      simulationTime: '2026-07-18T12:00:00.000Z',
      filters: structuredClone(DEFAULT_FILTERS),
      encoding: 'object-type',
      selectedObjectIds: [],
      scaleMode: 'semantic',
      presentation: { mode: 'presentation', panelsVisible: false },
    };
    const playlist: PlaylistV1 = {
      schemaVersion: 1,
      id: 'b340ac9e-8fa5-412f-94aa-58645dc9b341',
      name: 'Reload-safe briefing',
      entries: [
        { view: savedView, caption: 'One', durationMs: 6_000 },
        { view: savedView, caption: 'Two', durationMs: 6_000 },
      ],
    };

    localStorage.setItem('satglobe.playlists.v1', JSON.stringify([playlist]));
    renderApp();
    expect(screen.getByText(playlist.name)).toBeTruthy();
    expect(screen.queryByTestId('playlist-deck')).toBeNull();

    cleanup();
    renderApp();
    expect(screen.getByText(playlist.name)).toBeTruthy();
    expect(screen.queryByTestId('playlist-deck')).toBeNull();
  });

  it('rejects a hostile playlist atomically with a notice', async () => {
    const existingView: SavedViewV1 = {
      schemaVersion: 1,
      name: 'Trusted view',
      camera: DEFAULT_CAMERA,
      simulationTime: '2026-07-18T12:00:00.000Z',
      filters: structuredClone(DEFAULT_FILTERS),
      encoding: 'object-type',
      selectedObjectIds: [],
      scaleMode: 'semantic',
      presentation: { mode: 'presentation', panelsVisible: false },
    };
    const existingPlaylist: PlaylistV1 = {
      schemaVersion: 1,
      id: '0a46f600-7cce-4a84-8305-7fd7737a1afd',
      name: 'Trusted sequence',
      entries: [
        { view: existingView, caption: 'Trusted opening', durationMs: 6_000 },
        { view: existingView, caption: 'Trusted close', durationMs: 6_000 },
      ],
    };

    localStorage.setItem('satglobe.playlists.v1', JSON.stringify([existingPlaylist]));
    const { methods } = renderApp();
    const persistedBeforeImport = localStorage.getItem('satglobe.playlists.v1');
    const notice = await importPlaylistFile(JSON.stringify({
      schemaVersion: 1,
      id: 'fd4a58d9-6605-4cd8-b4c3-844dc2942257',
      name: 'Hostile',
      entries: [{ script: 'alert(1)' }, { script: 'alert(2)' }],
    }));

    expect(notice.textContent).toContain('This playlist is invalid');
    expect(notice.textContent).toContain('No application state was changed.');
    expect(screen.getByText(existingPlaylist.name)).toBeTruthy();
    expect(screen.queryByText('Hostile')).toBeNull();
    expect(localStorage.getItem('satglobe.playlists.v1')).toBe(persistedBeforeImport);
    expectNoAdapterMutations(methods);
  });

  it('toggles the conjunction lens on and off while preserving filters and encoding', () => {
    const { methods } = renderApp({ state: { conjunctions: AVAILABLE_CONJUNCTIONS } });
    const lens = screen.getByTestId('conjunction-lens');

    expect(lens.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(lens);

    expect(methods.setHighlight).toHaveBeenCalledOnce();
    expect(methods.setHighlight).toHaveBeenCalledWith(AVAILABLE_CONJUNCTIONS.catalogIds);
    expect(lens.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(lens);

    expect(methods.setHighlight).toHaveBeenCalledTimes(2);
    expect(methods.setHighlight).toHaveBeenLastCalledWith([]);
    expect(lens.getAttribute('aria-pressed')).toBe('false');
    expect(methods.setFilters).not.toHaveBeenCalled();
    expect(methods.setEncoding).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without mutating application state', async () => {
    const { methods } = renderApp();
    const baseline = readWorkshopBaseline();

    expect(baseline).toEqual({
      workshopMode: true,
      presentationMode: false,
      storyMode: false,
      activeStatusPressed: 'true',
      allStatusPressed: 'false',
      encoding: 'object-type',
      scale: 'SEMANTIC SCALE',
    });
    const notice = await importPreset('{not-json');

    expect(notice.textContent).toContain('This preset is not valid JSON. No application state was changed.');
    expect(readWorkshopBaseline()).toEqual(baseline);
    expectNoAdapterMutations(methods);
  });

  it('rejects a schema-invalid preset without partially applying it', async () => {
    const { methods } = renderApp();
    const baseline = readWorkshopBaseline();
    const invalidView = {
      schemaVersion: 1,
      name: 'Unsafe zoom',
      camera: { ...DEFAULT_CAMERA, zoom: 2 },
      simulationTime: '2026-07-17T12:00:00.000Z',
      filters: {
        ...structuredClone(DEFAULT_FILTERS),
        objectKinds: ['debris'],
        status: 'all',
        constellation: 'starlink',
      },
      encoding: 'data-age',
      selectedObjectIds: [],
      scaleMode: 'true',
      presentation: { mode: 'presentation', panelsVisible: false },
    };

    const notice = await importPreset(JSON.stringify(invalidView));

    expect(notice.textContent).toContain('camera.zoom');
    expect(notice.textContent).toContain('No application state was changed.');
    expect(readWorkshopBaseline()).toEqual(baseline);
    expectNoAdapterMutations(methods);
  });
});
