import { describe, expect, it } from 'vitest';
import { importSavedView, loadPersistedViews, persistViews, serializeSavedView } from '../saved-view';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type SavedViewV1, type SpaceObjectView } from '../types';

const view: SavedViewV1 = {
  schemaVersion: 1,
  name: 'Starlink study',
  camera: DEFAULT_CAMERA,
  simulationTime: '2026-07-15T20:00:00.000Z',
  filters: DEFAULT_FILTERS,
  encoding: 'orbital-plane',
  selectedObjectIds: ['44714', 'missing'],
  scaleMode: 'semantic',
  presentation: { mode: 'workshop', panelsVisible: true },
};

const catalog = [{ catalogId: '44714' }] as SpaceObjectView[];

describe('portable saved views', () => {
  it('round trips without embedding the catalog', () => {
    const launchHistoryView = { ...view, filters: { ...view.filters, launchYearMax: 2020 } };
    const encoded = serializeSavedView(launchHistoryView);
    const imported = importSavedView(encoded, catalog);

    expect(encoded).not.toContain('objects');
    expect(imported.view.selectedObjectIds).toEqual(['44714']);
    expect(imported.view.filters.launchYearMax).toBe(2020);
    expect(imported.warnings[0]).toContain('missing');
  });

  it('rejects unknown versions before changing state', () => {
    expect(() => importSavedView('{"schemaVersion":2}', catalog)).toThrow('not supported');
  });

  it('rejects arbitrary extra fields and invalid JSON', () => {
    expect(() => importSavedView(JSON.stringify({ ...view, script: 'alert(1)' }), catalog)).toThrow('This preset is invalid');
    expect(() => importSavedView('<script>', catalog)).toThrow('not valid JSON');
  });

  it('reports the invalid field without partially importing the preset', () => {
    expect(() => importSavedView(JSON.stringify({ ...view, camera: { ...view.camera, zoom: 2 } }), catalog)).toThrow('camera.zoom');
  });
});

describe('persisted saved views', () => {
  const fakeStorage = (initial: Record<string, string> = {}) => {
    const store = new Map(Object.entries(initial));

    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      dump: () => Object.fromEntries(store),
    };
  };

  it('round trips through storage', () => {
    const storage = fakeStorage();

    persistViews([view], storage);
    expect(loadPersistedViews(storage)).toEqual([{ ...view }]);
  });

  it('drops corrupt entries individually instead of discarding the rest', () => {
    const storage = fakeStorage({
      'satglobe.savedViews.v1': JSON.stringify([view, { schemaVersion: 1, name: 'broken' }, 42]),
    });

    const loaded = loadPersistedViews(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Starlink study');
  });

  it('treats garbage, non-arrays, and absent keys as empty', () => {
    expect(loadPersistedViews(fakeStorage({ 'satglobe.savedViews.v1': 'not json' }))).toEqual([]);
    expect(loadPersistedViews(fakeStorage({ 'satglobe.savedViews.v1': '{"a":1}' }))).toEqual([]);
    expect(loadPersistedViews(fakeStorage())).toEqual([]);
  });

  it('survives storage that throws (privacy modes)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(loadPersistedViews(throwing)).toEqual([]);
    expect(() => persistViews([view], throwing)).not.toThrow();
  });
});
