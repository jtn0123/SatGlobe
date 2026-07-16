import { describe, expect, it } from 'vitest';
import { importSavedView, serializeSavedView } from '../saved-view';
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
    const encoded = serializeSavedView(view);
    const imported = importSavedView(encoded, catalog);

    expect(encoded).not.toContain('objects');
    expect(imported.view.selectedObjectIds).toEqual(['44714']);
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
