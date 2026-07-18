import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type SavedViewV1, type SpaceObjectView } from '../../domain/types';
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
  'setScaleMode',
  'drawOrbit',
  'clearOrbits',
  'dispose',
] as const;

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
    screen.getByRole('status');
  });

  return screen.getByRole('status');
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
    expect(methods.setFilters).toHaveBeenCalledTimes(1);
    expect(methods.setFilters).toHaveBeenCalledWith(savedView.filters);
    expect(methods.setCamera).toHaveBeenCalledTimes(1);
    expect(methods.setCamera).toHaveBeenCalledWith(savedView.camera);
    expect(methods.setEncoding).toHaveBeenCalledTimes(1);
    expect(methods.setEncoding).toHaveBeenCalledWith(savedView.encoding);
    expect(methods.setScaleMode).toHaveBeenCalledTimes(1);
    expect(methods.setScaleMode).toHaveBeenCalledWith(savedView.scaleMode);
    expect(methods.clearSelection).toHaveBeenCalledTimes(1);
    expect(methods.selectObject).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Restored its absolute view in Workshop');
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

  it('applies a quick lens exactly once through the immediate filter path', () => {
    const { methods } = renderApp();

    fireEvent.click(screen.getByTestId('starlink-lens'));

    expect(methods.setFilters).toHaveBeenCalledTimes(1);
    expect(methods.setFilters).toHaveBeenCalledWith(expect.objectContaining({ constellation: 'starlink' }));
    expect(methods.setEncoding).toHaveBeenCalledWith('orbital-plane');
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
