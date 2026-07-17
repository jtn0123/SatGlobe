import { PayloadStatus, SpaceObjectType } from '@ootk/src/main';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { SatGlobeEngineAdapter } from '../satglobe-engine-adapter';

/*
 * The adapter is the fork's most upstream-exposed seam, so these tests mock the
 * engine services it consumes (ServiceLocator, PluginRegistry, EventBus) and
 * lock in the contracts the React layer depends on: hydration and error state,
 * precomputed search text, selection routing, and diff-emit semantics.
 */

interface FakeServices {
  catalog: { objectCache: unknown[]; getSats: () => unknown[] };
  time: { simulationTimeObj: Date; changeStaticOffset: ReturnType<typeof vi.fn>; setSelectedDate: ReturnType<typeof vi.fn>; changePropRate: ReturnType<typeof vi.fn> };
  camera: { state: { camPitchTarget: number; camYawTarget: number; zoomTarget: number }; satShaderSizes: { minSize: number | null; maxSize: number | null } };
  colorSchemes: { registerScheme: ReturnType<typeof vi.fn>; setColorScheme: ReturnType<typeof vi.fn> };
  orbits: { addInViewOrbit: ReturnType<typeof vi.fn>; clearInViewOrbit: ReturnType<typeof vi.fn> };
}

/*
 * vi.mock factories are hoisted above module-level consts, so any state they
 * close over must come from vi.hoisted() — a plain const hits the temporal
 * dead zone whenever a mocked module is imported before this file's body runs
 * (order-dependent: it passed in PR CI and failed on main).
 */
const { busHandlers, fakeBus, selectSat, warn, log, services } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    busHandlers: handlers,
    fakeBus: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers.has(event)) {
          handlers.set(event, new Set());
        }
        handlers.get(event)!.add(handler);
      },
      unregister: (event: string, handler: (...args: unknown[]) => void) => {
        handlers.get(event)?.delete(handler);
      },
      emit: (event: string, ...args: unknown[]) => {
        handlers.get(event)?.forEach((handler) => handler(...args));
      },
      // vitest-setup's async standard-env cleanup calls this on whatever
      // EventBus module resolves to - which is this mock inside this file.
      unregisterAllEvents: () => {
        handlers.clear();
      },
    },
    selectSat: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    services: {} as FakeServices,
  };
});

vi.mock('@app/engine/events/event-bus', () => ({
  EventBus: { getInstance: () => fakeBus },
}));

vi.mock('@app/engine/core/plugin-registry', () => ({
  PluginRegistry: { getPlugin: () => ({ selectSat }), unregisterAllPlugins: () => undefined },
}));

vi.mock('@app/plugins/select-sat-manager/select-sat-manager', () => ({
  SelectSatManager: class SelectSatManager {},
}));

vi.mock('@app/engine/utils/errorManager', () => ({
  errorManagerInstance: {
    warn: (...args: unknown[]) => warn(...args),
    log: (...args: unknown[]) => log(...args),
  },
}));

vi.mock('@app/engine/core/service-locator', () => ({
  ServiceLocator: {
    getCatalogManager: () => services.catalog,
    getTimeManager: () => services.time,
    getMainCamera: () => services.camera,
    getColorSchemeManager: () => services.colorSchemes,
    getOrbitManager: () => services.orbits,
  },
}));

const fakeSat = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  active: true,
  isSatellite: () => true,
  type: SpaceObjectType.PAYLOAD,
  status: PayloadStatus.OPERATIONAL,
  name: 'STARLINK-1008',
  sccNum: '44714',
  intlDes: '2019-074B',
  launchDate: '2019-11-11',
  launchVehicle: 'Falcon 9',
  owner: 'SpaceX',
  country: 'US',
  source: 'Celestrak',
  epochYear: 22,
  epochDay: 1.5,
  perigee: 540,
  apogee: 560,
  inclination: 53.2,
  period: 95,
  ...overrides,
});

const bootAdapter = (sats: unknown[]) => {
  services.catalog = { objectCache: sats, getSats: () => sats };
  const adapter = new SatGlobeEngineAdapter();

  fakeBus.emit(EventBusEvent.onKeepTrackReady);

  return adapter;
};

describe('SatGlobeEngineAdapter', () => {
  let adapter: SatGlobeEngineAdapter | null = null;

  beforeEach(() => {
    busHandlers.clear();
    selectSat.mockClear();
    warn.mockClear();
    log.mockClear();
    services.time = {
      simulationTimeObj: new Date('2022-01-01T00:00:00.000Z'),
      changeStaticOffset: vi.fn(),
      setSelectedDate: vi.fn(),
      changePropRate: vi.fn(),
    };
    services.camera = {
      state: { camPitchTarget: 0.34, camYawTarget: 0.38, zoomTarget: 0.58 },
      satShaderSizes: { minSize: null, maxSize: null },
    };
    services.colorSchemes = { registerScheme: vi.fn(), setColorScheme: vi.fn() };
    services.orbits = { addInViewOrbit: vi.fn(), clearInViewOrbit: vi.fn() };
  });

  afterEach(() => {
    adapter?.dispose();
    adapter = null;
  });

  it('hydrates state and precomputed search text from the catalog', () => {
    adapter = bootAdapter([fakeSat(), fakeSat({ id: 2, sccNum: '99999', name: 'ONEWEB-0001', owner: 'OneWeb', country: 'GB', active: true })]);
    const state = adapter.getState();

    expect(state.ready).toBe(true);
    expect(state.error).toBeNull();
    expect(state.objectCount).toBe(2);
    expect(state.visibleCount).toBe(2);
    expect(state.newestElementEpoch).not.toBe('');
    const [starlink] = adapter.getObjects();

    expect(starlink.nameText).toBe('starlink-1008');
    expect(starlink.searchText).toContain('44714');
    expect(starlink.ownershipText).toBe('us spacex');
  });

  it('registers its color scheme through the manager seam', () => {
    adapter = bootAdapter([fakeSat()]);

    expect(services.colorSchemes.registerScheme).toHaveBeenCalledTimes(1);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalled();
  });

  it('searches via precomputed text and ranks name prefixes first', () => {
    adapter = bootAdapter([
      fakeSat({ id: 2, sccNum: '20001', name: 'USA 224', owner: 'Starlink Services' }),
      fakeSat(),
    ]);
    const results = adapter.search('starlink');

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('STARLINK-1008');
  });

  it('routes selection through the engine id map and ignores unknown ids', () => {
    adapter = bootAdapter([fakeSat({ id: 7 })]);
    adapter.selectObject('44714');

    expect(selectSat).toHaveBeenCalledWith(7);
    expect(adapter.getState().selectedObject?.catalogId).toBe('44714');

    selectSat.mockClear();
    adapter.selectObject('does-not-exist');
    expect(selectSat).not.toHaveBeenCalled();
  });

  it('treats a null selection event as deselect instead of crashing', () => {
    adapter = bootAdapter([fakeSat({ id: 7 })]);
    adapter.selectObject('44714');
    expect(adapter.getState().selectedObject).not.toBeNull();

    // Clicking empty space makes SelectSatManager emit selectSatData with null.
    fakeBus.emit(EventBusEvent.selectSatData, null);

    expect(adapter.getState().selectedObject).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits nothing while the scene is idle and keeps slice identity on time ticks', () => {
    adapter = bootAdapter([fakeSat()]);
    const listener = vi.fn();

    adapter.subscribe(listener);
    listener.mockClear();

    // Idle: unchanged time and camera must produce zero notifications.
    vi.advanceTimersByTime(1_800);
    expect(listener).not.toHaveBeenCalled();

    const before = adapter.getState();

    services.time.simulationTimeObj = new Date('2022-01-01T01:00:00.000Z');
    vi.advanceTimersByTime(600);

    expect(listener).toHaveBeenCalledTimes(1);
    const after = adapter.getState();

    expect(after).not.toBe(before);
    expect(after.simulationTime).toBe('2022-01-01T01:00:00.000Z');
    // Unchanged slices keep reference identity so memoized panels skip re-rendering.
    expect(after.filters).toBe(before.filters);
    expect(after.camera).toBe(before.camera);
    expect(after.selectedObject).toBe(before.selectedObject);
  });

  it('recomputes visibleCount when filters change', () => {
    adapter = bootAdapter([
      fakeSat(),
      // Engine-slot `active` stays true (hydration drops inactive propagation
      // slots); only the payload status marks this one non-operational.
      fakeSat({ id: 2, sccNum: '30001', name: 'COSMOS 2251 DEB', type: SpaceObjectType.DEBRIS, status: PayloadStatus.NONOPERATIONAL }),
    ]);
    expect(adapter.getState().visibleCount).toBe(1);

    const filters = structuredClone(adapter.getState().filters);

    filters.objectKinds = ['payload', 'debris'];
    filters.status = 'all';
    adapter.setFilters(filters);

    expect(adapter.getState().visibleCount).toBe(2);
  });

  it('surfaces catalog hydration failures as state and a logged warning', () => {
    services.catalog = {
      objectCache: [fakeSat()],
      getSats: () => {
        throw new Error('catalog exploded');
      },
    };
    adapter = new SatGlobeEngineAdapter();
    fakeBus.emit(EventBusEvent.onKeepTrackReady);

    expect(adapter.getState().ready).toBe(false);
    expect(adapter.getState().error).toContain('catalog exploded');
    expect(warn).toHaveBeenCalled();
  });

  it('unregisters every engine listener on dispose', () => {
    adapter = bootAdapter([fakeSat()]);
    const registered = [...busHandlers.values()].reduce((total, handlers) => total + handlers.size, 0);

    expect(registered).toBeGreaterThan(0);
    adapter.dispose();
    adapter = null;

    const remaining = [...busHandlers.values()].reduce((total, handlers) => total + handlers.size, 0);

    expect(remaining).toBe(0);
  });
});
