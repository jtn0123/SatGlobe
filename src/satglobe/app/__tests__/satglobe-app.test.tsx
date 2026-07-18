import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA, DEFAULT_FILTERS } from '../../domain/types';
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
    expect(screen.queryByRole('status')).not.toBeNull();
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
    expect(screen.getByTestId('story-deck').textContent).toContain('A train appears');
    expect(methods.setFilters).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('story-deck').textContent).toContain('Before the shell');

    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByTestId('story-play').getAttribute('aria-label')).toBe('Pause story');
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
