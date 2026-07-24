import { PayloadStatus, SpaceObjectType } from '@ootk/src/main';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import type { ConjunctionFeedV1 } from '../../domain/types';
import {
  COUNT_UPDATE_MEASURE,
  FILTER_APPLY_MEASURE,
  RECOLOR_MEASURE,
} from '../../runtime/performance-measure';
import {
  SatGlobeEngineAdapter,
  type SatGlobeEngineAdapterOptions,
} from '../satglobe-engine-adapter';

/*
 * The adapter is the fork's most upstream-exposed seam, so these tests mock the
 * engine services it consumes (ServiceLocator, PluginRegistry, EventBus) and
 * lock in the contracts the React layer depends on: hydration and error state,
 * precomputed search text, selection routing, and diff-emit semantics.
 */

interface FakeServices {
  catalog: { objectCache: unknown[]; getSats: () => unknown[] };
  time: { simulationTimeObj: Date; changeStaticOffset: ReturnType<typeof vi.fn>; setSelectedDate: ReturnType<typeof vi.fn>; changePropRate: ReturnType<typeof vi.fn> };
  camera: {
    autoRotate: ReturnType<typeof vi.fn>;
    camSnap: ReturnType<typeof vi.fn>;
    state: {
      camPitchTarget: number;
      camYawTarget: number;
      camPitch: number;
      camYaw: number;
      earthCenteredPitch: number;
      earthCenteredYaw: number;
      hasPrevGmst: boolean;
      hasPrevSatAngles: boolean;
      isAutoRotate: boolean;
      isAutoPitchYawToTarget: boolean;
      isZoomIn: boolean;
      zoomLevel: number;
      zoomTarget: number;
    };
    satShaderSizes: { minSize: number | null; maxSize: number | null };
  };
  colorSchemes: { registerScheme: ReturnType<typeof vi.fn>; setColorScheme: ReturnType<typeof vi.fn> };
  orbits: { addInViewOrbit: ReturnType<typeof vi.fn>; clearInViewOrbit: ReturnType<typeof vi.fn> };
  renderer: { cancelFrameCapture: ReturnType<typeof vi.fn>; captureNextFrame: ReturnType<typeof vi.fn> };
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
    getRenderer: () => services.renderer,
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

const pendingConjunctionLoad = () => new Promise<ConjunctionFeedV1>(() => {
  // Deliberately unresolved: ordinary adapter tests should not exercise the
  // optional feed unless they install an explicit loader.
});

const bootAdapter = (sats: unknown[], options: SatGlobeEngineAdapterOptions = {}) => {
  services.catalog = { objectCache: sats, getSats: () => sats };
  const adapter = new SatGlobeEngineAdapter({
    loadConjunctionFeed: pendingConjunctionLoad,
    scheduleIdle: () => 99,
    cancelIdle: () => undefined,
    ...options,
  });

  fakeBus.emit(EventBusEvent.onKeepTrackReady);

  return adapter;
};

const conjunctionFeed = (): ConjunctionFeedV1 => ({
  schemaVersion: 1,
  snapshotId: 'socrates-2022-01-01-aaaaaaaaaaaa',
  generatedAt: '2021-12-31T18:00:00.000Z',
  source: {
    provider: 'CelesTrak',
    rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
    updatedAt: '2021-12-31T18:00:00.000Z',
    retrievedAt: '2022-01-01T00:00:00.000Z',
    checksum: 'a'.repeat(64),
  },
  conjunctions: [
    {
      id: 'a'.repeat(24),
      object1: { catalogId: '44714', name: 'STARLINK-1008', dseDays: 1.2 },
      object2: { catalogId: '99999', name: 'ONEWEB-0001', dseDays: 0.8 },
      timeOfClosestApproach: '2022-01-02T00:00:00.000Z',
      missDistanceKm: 0.4,
      relativeSpeedKmS: 12.3,
      maximumProbability: 0.002,
      dilutionThreshold: 0.01,
    },
    {
      id: 'b'.repeat(24),
      object1: { catalogId: '44714', name: 'STARLINK-1008', dseDays: 1.2 },
      object2: { catalogId: '12345', name: 'NOT INSTALLED', dseDays: 0.9 },
      timeOfClosestApproach: '2022-01-03T00:00:00.000Z',
      missDistanceKm: 0.6,
      relativeSpeedKmS: 8.1,
      maximumProbability: 0.001,
      dilutionThreshold: 0.02,
    },
  ],
});

describe('SatGlobeEngineAdapter', () => {
  let adapter: SatGlobeEngineAdapter | null = null;

  beforeEach(() => {
    vi.setSystemTime(new Date('2022-01-01T00:00:00.000Z'));
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
    const cameraState = {
      camPitchTarget: 0.34,
      camYawTarget: 0.38,
      camPitch: 0.34,
      camYaw: 0.38,
      earthCenteredPitch: 0.34,
      earthCenteredYaw: 0.38,
      hasPrevGmst: false,
      hasPrevSatAngles: true,
      isAutoRotate: true,
      isAutoPitchYawToTarget: true,
      isZoomIn: false,
      zoomLevel: 0.58,
      zoomTarget: 0.58,
    };

    services.camera = {
      autoRotate: vi.fn((enabled: boolean) => {
        cameraState.isAutoRotate = enabled;
      }),
      camSnap: vi.fn((pitch: number, yaw: number) => {
        cameraState.camPitchTarget = pitch;
        cameraState.camYawTarget = yaw;
        cameraState.earthCenteredPitch = pitch;
        cameraState.earthCenteredYaw = yaw;
        cameraState.isAutoPitchYawToTarget = true;
        cameraState.hasPrevSatAngles = false;
      }),
      state: cameraState,
      satShaderSizes: { minSize: null, maxSize: null },
    };
    services.colorSchemes = { registerScheme: vi.fn(), setColorScheme: vi.fn() };
    services.orbits = { addInViewOrbit: vi.fn(), clearInViewOrbit: vi.fn() };
    services.renderer = { cancelFrameCapture: vi.fn(), captureNextFrame: vi.fn() };
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

  it('loads conjunctions after hydration on a two-second idle deadline and drops unresolved pairs', async () => {
    let runIdle: (() => void) | null = null;
    const scheduleIdle = vi.fn((callback: () => void, _timeoutMs: number) => {
      runIdle = callback;

      return 41;
    });
    const loadConjunctions = vi.fn(() => Promise.resolve(conjunctionFeed()));

    services.catalog = {
      objectCache: [fakeSat(), fakeSat({ id: 2, sccNum: '99999', name: 'ONEWEB-0001' })],
      getSats: () => services.catalog.objectCache,
    };
    adapter = new SatGlobeEngineAdapter({
      loadConjunctionFeed: loadConjunctions,
      scheduleIdle,
      cancelIdle: vi.fn(),
    });

    expect(scheduleIdle).not.toHaveBeenCalled();
    expect(adapter.getState().conjunctions.status).toBe('loading');

    fakeBus.emit(EventBusEvent.onKeepTrackReady);

    expect(scheduleIdle).toHaveBeenCalledOnce();
    expect(scheduleIdle).toHaveBeenCalledWith(expect.any(Function), 2_000);
    expect(loadConjunctions).not.toHaveBeenCalled();

    runIdle!();
    await vi.waitFor(() => expect(adapter?.getState().conjunctions.status).toBe('current'));

    expect(loadConjunctions).toHaveBeenCalledOnce();
    expect(loadConjunctions).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(adapter.getState().conjunctions).toMatchObject({
      status: 'current',
      lensPairCount: 1,
      droppedPairCount: 1,
      catalogIds: ['44714', '99999'],
    });
    expect(adapter.getState().conjunctions.conjunctions).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(adapter.getState().conjunctions.status).toBe('current');

    // Catalog reloads can rehydrate the engine, but never add another idle
    // loader or a per-frame feed cost.
    fakeBus.emit(EventBusEvent.catalogReloaded);
    expect(scheduleIdle).toHaveBeenCalledOnce();
  });

  it('reclassifies and resynchronizes an active lens as conjunction boundaries pass', async () => {
    let runIdle: (() => void) | null = null;
    const feed = conjunctionFeed();

    feed.conjunctions[1].object2 = { catalogId: '30001', name: 'CATALOG THREE', dseDays: 0.9 };
    services.catalog = {
      objectCache: [
        fakeSat(),
        fakeSat({ id: 2, sccNum: '99999', name: 'ONEWEB-0001' }),
        fakeSat({ id: 3, sccNum: '30001', name: 'CATALOG THREE' }),
      ],
      getSats: () => services.catalog.objectCache,
    };
    adapter = new SatGlobeEngineAdapter({
      loadConjunctionFeed: () => Promise.resolve(feed),
      scheduleIdle: (callback) => {
        runIdle = callback;

        return 46;
      },
    });
    fakeBus.emit(EventBusEvent.onKeepTrackReady);
    runIdle!();
    await vi.waitFor(() => expect(adapter?.getState().conjunctions.status).toBe('current'));
    const filters = structuredClone(adapter.getState().filters);

    filters.constellation = 'starlink';
    adapter.setFilters(filters);
    adapter.setHighlight(adapter.getState().conjunctions.catalogIds);
    services.colorSchemes.setColorScheme.mockClear();

    expect(adapter.getState().conjunctions).toMatchObject({ lensPairCount: 2 });
    expect(adapter.getState().conjunctionHighlightActive).toBe(true);
    expect(adapter.getState().highlightedObjectCount).toBe(3);
    expect(adapter.getState().visibleCount).toBe(3);

    vi.setSystemTime(new Date('2022-01-02T00:00:00.001Z'));
    vi.advanceTimersByTime(600);

    expect(adapter.getState().conjunctions).toMatchObject({
      status: 'stale',
      lensPairCount: 1,
      catalogIds: ['44714', '30001'],
    });
    expect(adapter.getState().highlightedObjectCount).toBe(2);
    expect(adapter.getState().visibleCount).toBe(2);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date('2022-01-03T00:00:00.001Z'));
    vi.advanceTimersByTime(600);

    expect(adapter.getState().conjunctions).toMatchObject({
      status: 'archival',
      lensPairCount: 2,
      catalogIds: ['44714', '99999', '30001'],
    });
    expect(adapter.getState().highlightedObjectCount).toBe(3);
    expect(adapter.getState().visibleCount).toBe(3);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledTimes(2);
  });

  it('re-resolves retained feed references and an active lens after a catalog reload', async () => {
    let runIdle: (() => void) | null = null;
    const scheduleIdle = vi.fn((callback: () => void) => {
      runIdle = callback;

      return 47;
    });

    services.catalog = {
      objectCache: [fakeSat(), fakeSat({ id: 2, sccNum: '99999', name: 'ONEWEB-0001' })],
      getSats: () => services.catalog.objectCache,
    };
    adapter = new SatGlobeEngineAdapter({
      loadConjunctionFeed: () => Promise.resolve(conjunctionFeed()),
      scheduleIdle,
    });
    fakeBus.emit(EventBusEvent.onKeepTrackReady);
    runIdle!();
    await vi.waitFor(() => expect(adapter?.getState().conjunctions.status).toBe('current'));
    adapter.setHighlight(adapter.getState().conjunctions.catalogIds);
    services.colorSchemes.setColorScheme.mockClear();

    services.catalog.objectCache = [
      fakeSat({ name: 'STARLINK-1008 RELOADED' }),
      fakeSat({ id: 3, sccNum: '12345', name: 'NEWLY INSTALLED' }),
    ];
    fakeBus.emit(EventBusEvent.catalogReloaded);

    expect(adapter.getState().conjunctions).toMatchObject({
      droppedPairCount: 1,
      lensPairCount: 1,
      catalogIds: ['44714', '12345'],
    });
    expect(adapter.getState().conjunctions.conjunctions[0]).toMatchObject({
      id: 'b'.repeat(24),
      object2: { object: { name: 'NEWLY INSTALLED' } },
    });
    expect(adapter.getState().highlightedObjectCount).toBe(2);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();
    expect(scheduleIdle).toHaveBeenCalledOnce();
  });

  it('keeps a conjunction load failure nonfatal', async () => {
    let runIdle: (() => void) | null = null;
    const loadConjunctions = vi.fn(() => Promise.reject(new Error('offline fixture')));

    adapter = bootAdapter([fakeSat()], {
      loadConjunctionFeed: loadConjunctions,
      scheduleIdle: (callback) => {
        runIdle = callback;

        return 42;
      },
      cancelIdle: vi.fn(),
    });
    runIdle!();

    await vi.waitFor(() => expect(adapter?.getState().conjunctions.status).toBe('unavailable'));

    expect(adapter.getState().ready).toBe(true);
    expect(adapter.getState().error).toBeNull();
    expect(adapter.getState().conjunctions.error).toContain('offline fixture');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('offline fixture'));
  });

  it('aborts an in-flight conjunction load after two seconds and marks only that slice unavailable', () => {
    let runIdle: (() => void) | null = null;
    const observedLoad: { signal?: AbortSignal } = {};

    adapter = bootAdapter([fakeSat()], {
      loadConjunctionFeed: (signal) => {
        observedLoad.signal = signal;

        return pendingConjunctionLoad();
      },
      scheduleIdle: (callback) => {
        runIdle = callback;

        return 45;
      },
      cancelIdle: vi.fn(),
    });
    runIdle!();

    vi.advanceTimersByTime(1_999);
    expect(observedLoad.signal?.aborted).toBe(false);
    expect(adapter.getState().conjunctions.status).toBe('loading');

    vi.advanceTimersByTime(1);
    expect(observedLoad.signal?.aborted).toBe(true);
    expect(adapter.getState().conjunctions).toMatchObject({
      status: 'unavailable',
      error: expect.stringContaining('timed out after 2 seconds'),
    });
    expect(adapter.getState().ready).toBe(true);
    expect(adapter.getState().error).toBeNull();
  });

  it('cancels a pending idle load and aborts an in-flight load on dispose', () => {
    const cancelIdle = vi.fn();
    const scheduleIdle = vi.fn(() => 43);
    const loadConjunctions = vi.fn(pendingConjunctionLoad);

    adapter = bootAdapter([fakeSat()], {
      loadConjunctionFeed: loadConjunctions,
      scheduleIdle,
      cancelIdle,
    });
    adapter.dispose();
    adapter = null;

    expect(cancelIdle).toHaveBeenCalledWith(43);
    expect(loadConjunctions).not.toHaveBeenCalled();

    let runIdle: (() => void) | null = null;
    const observedLoad: { signal?: AbortSignal } = {};

    adapter = bootAdapter([fakeSat()], {
      loadConjunctionFeed: (signal) => {
        observedLoad.signal = signal;

        return pendingConjunctionLoad();
      },
      scheduleIdle: (callback) => {
        runIdle = callback;

        return 44;
      },
      cancelIdle,
    });
    runIdle!();
    expect(observedLoad.signal?.aborted).toBe(false);

    adapter.dispose();
    adapter = null;

    expect(observedLoad.signal?.aborted).toBe(true);
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

  it('reports the dots actually rendered by the Starlink encoding', () => {
    adapter = bootAdapter([
      fakeSat(),
      fakeSat({ id: 2, sccNum: '99999', name: 'ONEWEB-0001', owner: 'OneWeb', country: 'GB' }),
    ]);

    expect(adapter.getState().visibleCount).toBe(2);
    adapter.setEncoding('starlink');
    expect(adapter.getState().visibleCount).toBe(1);

    adapter.setHighlight(['99999']);
    expect(adapter.getState().visibleCount).toBe(2);

    adapter.setHighlight([]);
    expect(adapter.getState().visibleCount).toBe(1);
    adapter.setEncoding('object-type');
    expect(adapter.getState().visibleCount).toBe(2);
  });

  it('applies filters and encoding through one measured recolor and notification', () => {
    adapter = bootAdapter([
      fakeSat(),
      fakeSat({ id: 2, sccNum: '30001', name: 'COSMOS 2251 DEB', type: SpaceObjectType.DEBRIS, status: PayloadStatus.NONOPERATIONAL }),
    ]);
    const filters = structuredClone(adapter.getState().filters);

    filters.objectKinds = ['payload', 'debris'];
    filters.status = 'all';
    const filterSweep = vi.spyOn(
      adapter as unknown as { rebuildFilterVisibility_: () => number },
      'rebuildFilterVisibility_',
    );
    const listener = vi.fn();

    adapter.subscribe(listener);
    listener.mockClear();
    services.colorSchemes.setColorScheme.mockClear();
    const measure = vi.spyOn(performance, 'measure');

    adapter.setVisualState({ filters, encoding: 'orbit-regime' });
    const measurements = measure.mock.calls;

    measure.mockRestore();

    expect(adapter.getState()).toMatchObject({ filters, encoding: 'orbit-regime', visibleCount: 2 });
    expect(filterSweep).toHaveBeenCalledOnce();
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    for (const name of [FILTER_APPLY_MEASURE, RECOLOR_MEASURE, COUNT_UPDATE_MEASURE]) {
      const entries = measurements.filter(([entryName]) => entryName === name);

      expect(entries).toHaveLength(1);
      expect(entries[0][1]).toEqual(expect.objectContaining({ detail: { cause: 'combined' } }));
    }
  });

  it('canonicalizes known highlight ids and forces exactly one recolor per distinct pair', () => {
    adapter = bootAdapter([
      fakeSat(),
      fakeSat({
        id: 2,
        sccNum: '30001',
        name: 'COSMOS 2251 DEB',
        type: SpaceObjectType.DEBRIS,
        status: PayloadStatus.NONOPERATIONAL,
      }),
    ]);
    services.colorSchemes.setColorScheme.mockClear();
    const filterSweep = vi.spyOn(
      adapter as unknown as { rebuildFilterVisibility_: () => number },
      'rebuildFilterVisibility_',
    );
    const listener = vi.fn();

    adapter.subscribe(listener);
    listener.mockClear();
    adapter.setHighlight([' 30001 ', '44714', '30001', 'not-installed']);

    expect(adapter.getState().conjunctionHighlightActive).toBe(true);
    expect(adapter.getState().highlightedObjectCount).toBe(2);
    expect(adapter.getState().visibleCount).toBe(2);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();
    expect(filterSweep).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();

    const snapshot = adapter.getState();

    adapter.setHighlight(['44714', '30001', '44714']);

    expect(adapter.getState()).toBe(snapshot);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();
    expect(filterSweep).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();

    adapter.setHighlight([]);

    expect(adapter.getState().conjunctionHighlightActive).toBe(false);
    expect(adapter.getState().highlightedObjectCount).toBe(0);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledTimes(2);
    expect(filterSweep).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clears conjunction highlighting inside one filter or encoding visual-state apply', () => {
    adapter = bootAdapter([
      fakeSat(),
      fakeSat({
        id: 2,
        sccNum: '30001',
        name: 'COSMOS 2251 DEB',
        type: SpaceObjectType.DEBRIS,
        status: PayloadStatus.NONOPERATIONAL,
      }),
    ]);
    adapter.setHighlight(['44714', '30001']);
    services.colorSchemes.setColorScheme.mockClear();

    adapter.setFilters(structuredClone(adapter.getState().filters));

    expect(adapter.getState().conjunctionHighlightActive).toBe(false);
    expect(adapter.getState().highlightedObjectCount).toBe(0);
    expect(adapter.getState().visibleCount).toBe(1);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();

    adapter.setHighlight(['44714', '30001']);
    services.colorSchemes.setColorScheme.mockClear();
    adapter.setEncoding('orbit-regime');

    expect(adapter.getState().conjunctionHighlightActive).toBe(false);
    expect(adapter.getState().highlightedObjectCount).toBe(0);
    expect(services.colorSchemes.setColorScheme).toHaveBeenCalledOnce();
  });

  it.each([
    ['zoom in', 0.7, 0.3, true],
    ['zoom out', 0.3, 0.7, false],
    ['unchanged zoom', 0.5, 0.5, false],
  ] as const)('sets camera direction so an authored %s target survives the engine guard', (_label, zoomLevel, zoomTarget, expectedIsZoomIn) => {
    services.camera.state.zoomLevel = zoomLevel;
    services.camera.state.isZoomIn = !expectedIsZoomIn;
    services.camera.state.isAutoPitchYawToTarget = false;
    adapter = bootAdapter([fakeSat()]);
    const pose = { pitch: 0.2, yaw: 1.4, zoom: zoomTarget };

    adapter.setCamera(pose);

    expect(services.camera.camSnap).toHaveBeenCalledWith(pose.pitch, pose.yaw);
    expect(services.camera.state.isAutoPitchYawToTarget).toBe(true);
    expect(services.camera.state.hasPrevSatAngles).toBe(false);
    expect(services.camera.state.isZoomIn).toBe(expectedIsZoomIn);
    expect(services.camera.state.zoomTarget).toBe(zoomTarget);
    expect(services.camera.state.camPitchTarget).toBe(pose.pitch);
    expect(services.camera.state.camYawTarget).toBe(pose.yaw);
    const engineWouldCancelTarget =
      (services.camera.state.zoomLevel > services.camera.state.zoomTarget && !services.camera.state.isZoomIn) ||
      (services.camera.state.zoomLevel < services.camera.state.zoomTarget && services.camera.state.isZoomIn);

    expect(engineWouldCancelTarget).toBe(false);
  });

  it('stops ambient rotation before chasing an authored camera pose', () => {
    adapter = bootAdapter([fakeSat()]);

    expect(services.camera.state.isAutoRotate).toBe(true);
    adapter.setCamera({ pitch: 0.2, yaw: 1.4, zoom: 0.5 });

    expect(services.camera.autoRotate).toHaveBeenCalledWith(false);
    expect(services.camera.state.isAutoRotate).toBe(false);
    expect(services.camera.autoRotate.mock.invocationCallOrder[0]).toBeLessThan(
      services.camera.camSnap.mock.invocationCallOrder[0],
    );
  });

  it('forwards snapshot fulfillment and rejection through the renderer seam', async () => {
    const png = new Blob(['png'], { type: 'image/png' });

    services.renderer.captureNextFrame.mockResolvedValueOnce(png);
    adapter = bootAdapter([fakeSat()]);

    await expect(adapter.captureSnapshot()).resolves.toBe(png);
    expect(services.renderer.captureNextFrame).toHaveBeenCalledOnce();

    services.renderer.captureNextFrame.mockRejectedValueOnce(new Error('context lost'));
    await expect(adapter.captureSnapshot()).rejects.toThrow('context lost');
    expect(services.renderer.captureNextFrame).toHaveBeenCalledTimes(2);
  });

  it('publishes the rendered camera pose instead of stale destination targets', () => {
    adapter = bootAdapter([fakeSat()]);
    services.camera.state.camPitch = -0.21;
    services.camera.state.camYaw = 2.41;
    services.camera.state.zoomLevel = 0.46;
    services.camera.state.camPitchTarget = 0.7;
    services.camera.state.camYawTarget = 5.2;
    services.camera.state.zoomTarget = 0.91;

    vi.advanceTimersByTime(600);

    expect(adapter.getState().camera).toEqual({ pitch: -0.21, yaw: 2.41, zoom: 0.46 });
  });

  it.each([
    ['+1.5 hours', '2022-01-01T01:30:00.000Z', 1.1],
    ['+6 hours', '2022-01-01T06:00:00.000Z', 2.35],
  ] as const)('resets the Earth-rotation baseline after a %s time jump so authored yaw remains absolute', (_label, simulationTime, yaw) => {
    adapter = bootAdapter([fakeSat()]);
    services.camera.state.hasPrevGmst = true;
    adapter.setSimulationTime(simulationTime);
    const pose = { pitch: 0.4, yaw, zoom: 0.5 };

    adapter.setCamera(pose);

    expect(services.time.setSelectedDate).toHaveBeenCalledWith(new Date(simulationTime));
    expect(services.camera.state.hasPrevGmst).toBe(false);
    expect(services.camera.state.camYawTarget).toBe(pose.yaw);
  });

  it('identifies an invalid simulation timestamp as a caller type error', () => {
    const activeAdapter = bootAdapter([fakeSat()]);

    adapter = activeAdapter;

    expect(() => activeAdapter.setSimulationTime('not-a-date')).toThrow(TypeError);
    expect(services.time.changeStaticOffset).not.toHaveBeenCalled();
    expect(services.time.setSelectedDate).not.toHaveBeenCalled();
  });

  it('surfaces catalog hydration failures as state and a logged warning', () => {
    services.catalog = {
      objectCache: [fakeSat()],
      getSats: () => {
        throw new Error('catalog exploded');
      },
    };
    adapter = new SatGlobeEngineAdapter({ loadConjunctionFeed: pendingConjunctionLoad });
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
    expect(services.renderer.cancelFrameCapture).toHaveBeenCalledOnce();
    adapter = null;

    const remaining = [...busHandlers.values()].reduce((total, handlers) => total + handlers.size, 0);

    expect(remaining).toBe(0);
  });
});
