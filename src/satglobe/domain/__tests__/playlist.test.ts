import { describe, expect, it, vi } from 'vitest';
import {
  importPlaylist,
  loadPersistedPlaylists,
  normalizePlaylist,
  persistPlaylists,
  PLAYLISTS_STORAGE_KEY,
  serializePlaylist,
  upsertPersistedPlaylist,
} from '../playlist';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type PlaylistV1, type SavedViewV1, type SpaceObjectView } from '../types';

const view = (name: string, selectedObjectIds: string[] = []): SavedViewV1 => ({
  schemaVersion: 1,
  name,
  camera: DEFAULT_CAMERA,
  simulationTime: '2026-07-18T12:00:00.000Z',
  filters: structuredClone(DEFAULT_FILTERS),
  encoding: 'object-type',
  selectedObjectIds,
  scaleMode: 'semantic',
  presentation: { mode: 'story', panelsVisible: false, storyId: 'removed-story', storyBeat: 3 },
});

const playlist: PlaylistV1 = {
  schemaVersion: 1,
  id: '8abfe008-373f-41d3-82f6-4ac21f9b2638',
  name: 'Orbital handoff',
  entries: [
    { view: view('Opening frame', ['25544']), caption: 'Establish the low orbit field.', durationMs: 5_000 },
    { view: view('Closing frame', ['43013', '999999']), caption: 'Move to the high ring.', durationMs: 8_000 },
  ],
};

const catalog = [
  { catalogId: '25544' },
  { catalogId: '43013' },
] as SpaceObjectView[];

/** Minimal observable storage boundary for persistence resilience tests. */
function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    values,
  };
}

describe('portable playlists', () => {
  it('round-trips strict JSON and normalizes every step to Presentation mode', () => {
    const encoded = serializePlaylist(playlist);
    const imported = importPlaylist(encoded, catalog);

    expect(imported.playlist.name).toBe(playlist.name);
    expect(imported.playlist.entries).toHaveLength(2);
    expect(imported.playlist.entries.every(({ view: entryView }) => (
      entryView.presentation.mode === 'presentation' &&
      entryView.presentation.panelsVisible === false &&
      entryView.presentation.storyId === undefined
    ))).toBe(true);
    expect(imported.playlist.entries[1].view.selectedObjectIds).toEqual(['43013']);
    expect(imported.warnings[0]).toContain('999999');
  });

  it('rejects hostile or malformed files as one atomic record', () => {
    expect(() => importPlaylist('{broken', catalog)).toThrow('not valid JSON');
    expect(() => importPlaylist('{"schemaVersion":2}', catalog)).toThrow('not supported');
    expect(() => importPlaylist(JSON.stringify({ ...playlist, script: 'alert(1)' }), catalog)).toThrow('invalid');
    expect(() => importPlaylist(JSON.stringify({
      ...playlist,
      entries: [{ ...playlist.entries[0], view: { ...playlist.entries[0].view, script: 'alert(1)' } }, playlist.entries[1]],
    }), catalog)).toThrow('entries.0.view');
  });

  it.each([
    ['one entry', { ...playlist, entries: playlist.entries.slice(0, 1) }],
    ['25 entries', { ...playlist, entries: Array.from({ length: 25 }, () => playlist.entries[0]) }],
    ['blank name', { ...playlist, name: '   ' }],
    ['long caption', { ...playlist, entries: [{ ...playlist.entries[0], caption: 'x'.repeat(281) }, playlist.entries[1]] }],
    ['short duration', { ...playlist, entries: [{ ...playlist.entries[0], durationMs: 999 }, playlist.entries[1]] }],
    ['long duration', { ...playlist, entries: [{ ...playlist.entries[0], durationMs: 120_001 }, playlist.entries[1]] }],
  ])('enforces the bounded %s contract', (_case, invalid) => {
    expect(() => normalizePlaylist(invalid as PlaylistV1)).toThrow();
  });
});

describe('persisted playlists', () => {
  it('drops corrupt records individually and keeps valid neighbors', () => {
    const valid = normalizePlaylist(playlist);
    const storage = fakeStorage({
      [PLAYLISTS_STORAGE_KEY]: JSON.stringify([
        valid,
        { ...valid, id: 'not-a-uuid' },
        { ...valid, entries: valid.entries.slice(0, 1) },
        { ...valid, id: 'ad8e5692-240b-42b8-a6f8-91a70cf22026', name: 'Still valid' },
      ]),
    });

    expect(loadPersistedPlaylists(storage)).toEqual([
      valid,
      { ...valid, id: 'ad8e5692-240b-42b8-a6f8-91a70cf22026', name: 'Still valid' },
    ]);
  });

  it('persists validated normalized records under the versioned key', () => {
    const storage = fakeStorage();

    persistPlaylists([playlist], storage);

    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem.mock.calls[0][0]).toBe(PLAYLISTS_STORAGE_KEY);
    expect(JSON.parse(storage.setItem.mock.calls[0][1] as string)[0].entries[0].view.presentation).toEqual({
      mode: 'presentation',
      panelsVisible: false,
    });
  });

  it('treats unavailable or malformed storage as empty', () => {
    expect(loadPersistedPlaylists(fakeStorage({ [PLAYLISTS_STORAGE_KEY]: 'not json' }))).toEqual([]);
    expect(loadPersistedPlaylists(fakeStorage({ [PLAYLISTS_STORAGE_KEY]: '{"record":true}' }))).toEqual([]);
    expect(loadPersistedPlaylists({
      getItem: () => {
        throw new Error('blocked');
      },
    })).toEqual([]);
  });

  it('rejects a 25th record instead of evicting an existing playlist', () => {
    const records = Array.from({ length: 24 }, (_, index): PlaylistV1 => ({
      ...playlist,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `Sequence ${index + 1}`,
    }));
    const overflow = {
      ...playlist,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      name: 'Overflow sequence',
    };
    const replacement = { ...records[23], name: 'Updated sequence' };

    expect(upsertPersistedPlaylist(records, overflow)).toBeNull();
    expect(records).toHaveLength(24);
    expect(upsertPersistedPlaylist(records, replacement)).toEqual([
      ...records.slice(0, 23),
      replacement,
    ]);
  });
});
