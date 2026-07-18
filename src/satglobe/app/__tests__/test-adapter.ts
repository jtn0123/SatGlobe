import { vi } from 'vitest';
import { INITIAL_CONJUNCTION_STATE } from '../../domain/conjunctions';
import type { SatGlobeEngineAdapter } from '../../engine/satglobe-engine-adapter';
import {
  DEFAULT_CAMERA,
  DEFAULT_FILTERS,
  type EngineState,
  type SpaceObjectView,
} from '../../domain/types';

type AdapterSurface = Pick<SatGlobeEngineAdapter, keyof SatGlobeEngineAdapter>;

interface TestAdapterOptions {
  state?: Partial<EngineState>;
  objects?: SpaceObjectView[];
}

/** Builds a complete, constructor-free adapter boundary for SatGlobe shell tests. */
export function makeAdapter({ state: stateOverrides = {}, objects = [] }: TestAdapterOptions = {}) {
  const state: EngineState = {
    ready: true,
    error: null,
    objectCount: objects.length,
    visibleCount: objects.length,
    newestElementEpoch: '2026-07-17T00:00:00.000Z',
    simulationTime: '2026-07-17T12:00:00.000Z',
    selectedObject: null,
    filters: structuredClone(DEFAULT_FILTERS),
    encoding: 'object-type',
    camera: { ...DEFAULT_CAMERA },
    conjunctions: INITIAL_CONJUNCTION_STATE,
    conjunctionHighlightActive: false,
    highlightedObjectCount: 0,
    ...stateOverrides,
  };
  const listeners = new Set<Parameters<SatGlobeEngineAdapter['subscribe']>[0]>();
  const methods = {
    getState: vi.fn(() => state),
    getObjects: vi.fn((): readonly SpaceObjectView[] => objects),
    subscribe: vi.fn((listener: Parameters<SatGlobeEngineAdapter['subscribe']>[0]) => {
      listeners.add(listener);
      listener({ ...state });

      return () => {
        listeners.delete(listener);
      };
    }),
    search: vi.fn((_query: string, _limit = 24): SpaceObjectView[] => []),
    selectObject: vi.fn((_catalogId: string): void => undefined),
    clearSelection: vi.fn((): void => undefined),
    setSimulationTime: vi.fn((_iso: string): void => undefined),
    setPlaybackRate: vi.fn((_rate: number): void => undefined),
    captureSnapshot: vi.fn((): Promise<Blob> => Promise.resolve(new Blob(['snapshot'], { type: 'image/png' }))),
    setCamera: vi.fn((_pose: Parameters<SatGlobeEngineAdapter['setCamera']>[0]): void => undefined),
    setFilters: vi.fn((_filters: Parameters<SatGlobeEngineAdapter['setFilters']>[0]): void => undefined),
    setEncoding: vi.fn((_encoding: Parameters<SatGlobeEngineAdapter['setEncoding']>[0]): void => undefined),
    setVisualState: vi.fn((_update: Parameters<SatGlobeEngineAdapter['setVisualState']>[0]): void => undefined),
    setHighlight: vi.fn((catalogIds: Parameters<SatGlobeEngineAdapter['setHighlight']>[0]): void => {
      const highlightedIds = new Set(catalogIds);

      state.conjunctionHighlightActive = highlightedIds.size > 0;
      state.highlightedObjectCount = highlightedIds.size;
      const snapshot = { ...state };

      listeners.forEach((listener) => listener(snapshot));
    }),
    setScaleMode: vi.fn((_mode: Parameters<SatGlobeEngineAdapter['setScaleMode']>[0]): void => undefined),
    drawOrbit: vi.fn((_catalogId: string): void => undefined),
    clearOrbits: vi.fn((): void => undefined),
    dispose: vi.fn((): void => undefined),
  } satisfies AdapterSurface;

  // The production class has private engine fields; this single fixture boundary
  // intentionally supplies only its complete public surface.
  const adapter = methods as unknown as SatGlobeEngineAdapter;

  return { adapter, methods, state };
}
