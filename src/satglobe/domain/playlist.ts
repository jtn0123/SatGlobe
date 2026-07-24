import { ZodError } from 'zod';
import { playlistV1Schema } from './schemas';
import type { PlaylistV1, SavedViewV1, SpaceObjectView } from './types';

export const PLAYLISTS_STORAGE_KEY = 'satglobe.playlists.v1';
export const MAX_PERSISTED_PLAYLISTS = 24;

export interface PlaylistImportResult {
  playlist: PlaylistV1;
  warnings: string[];
}

/** Adds or replaces one record without evicting an unrelated saved playlist. */
export function upsertPersistedPlaylist(
  playlists: readonly PlaylistV1[],
  playlist: PlaylistV1,
): PlaylistV1[] | null {
  const existing = playlists.some(({ id }) => id === playlist.id);

  if (!existing && playlists.length >= MAX_PERSISTED_PLAYLISTS) {
    return null;
  }

  return existing
    ? playlists.map((record) => (record.id === playlist.id ? playlist : record))
    : [playlist, ...playlists];
}

/** Playlist steps are absolute Present views, never story reconstructions. */
export function normalizePlaylistView(view: SavedViewV1): SavedViewV1 {
  return {
    ...structuredClone(view),
    presentation: { mode: 'presentation', panelsVisible: false },
  };
}

/** Validates and normalizes every inline view before it crosses a storage/export boundary. */
export function normalizePlaylist(playlist: PlaylistV1): PlaylistV1 {
  const parsed = playlistV1Schema.parse(playlist);

  return {
    ...parsed,
    entries: parsed.entries.map((entry) => ({
      ...entry,
      view: normalizePlaylistView(entry.view),
    })),
  };
}

/** Serializes one strict, presentation-normalized portable sequence. */
export function serializePlaylist(playlist: PlaylistV1): string {
  return `${JSON.stringify(normalizePlaylist(playlist), null, 2)}\n`;
}

/** Rejects an imported sequence atomically, then drops only unavailable selections. */
export function importPlaylist(raw: string, catalog: readonly SpaceObjectView[]): PlaylistImportResult {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('This playlist is not valid JSON. No application state was changed.');
  }
  if (typeof decoded !== 'object' || decoded === null || !('schemaVersion' in decoded)) {
    throw new Error('This playlist does not declare a schema version.');
  }
  if ((decoded as { schemaVersion: unknown }).schemaVersion !== 1) {
    throw new Error(`Playlist schema version ${String((decoded as { schemaVersion: unknown }).schemaVersion)} is not supported.`);
  }
  let playlist: PlaylistV1;

  try {
    playlist = normalizePlaylist(playlistV1Schema.parse(decoded));
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const location = issue?.path.length ? issue.path.join('.') : 'playlist';

      throw new Error(`This playlist is invalid at ${location}: ${issue?.message ?? 'schema validation failed'}. No application state was changed.`);
    }
    throw error;
  }
  const catalogIds = new Set(catalog.map(({ catalogId }) => catalogId));
  const missing = playlist.entries.flatMap(({ view }) => view.selectedObjectIds.filter((id) => !catalogIds.has(id)));

  return {
    playlist: {
      ...playlist,
      entries: playlist.entries.map((entry) => ({
        ...entry,
        view: {
          ...entry.view,
          selectedObjectIds: entry.view.selectedObjectIds.filter((id) => catalogIds.has(id)),
        },
      })),
    },
    warnings: missing.length === 0
      ? []
      : [`${missing.length} selected object${missing.length === 1 ? '' : 's'} across this playlist ${missing.length === 1 ? 'is' : 'are'} absent from this catalog: ${missing.slice(0, 8).join(', ')}`],
  };
}

/** Drops corrupt persisted records individually; valid neighbors always survive. */
export function loadPersistedPlaylists(storage: Pick<Storage, 'getItem'> = localStorage): PlaylistV1[] {
  let raw: string | null;

  try {
    raw = storage.getItem(PLAYLISTS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) {
    return [];
  }

  return decoded.flatMap((record) => {
    const parsed = playlistV1Schema.safeParse(record);

    return parsed.success ? [normalizePlaylist(parsed.data)] : [];
  }).slice(0, MAX_PERSISTED_PLAYLISTS);
}

/** Persists validated records while treating quota/privacy failures as non-fatal. */
export function persistPlaylists(
  playlists: readonly PlaylistV1[],
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(
      PLAYLISTS_STORAGE_KEY,
      JSON.stringify(playlists.slice(0, MAX_PERSISTED_PLAYLISTS).map(normalizePlaylist)),
    );
  } catch {
    // Storage quota/privacy failures degrade to session-only sequences.
  }
}

/** Downloads one validated sequence through the same short-lived URL contract as saved views. */
export function downloadPlaylist(playlist: PlaylistV1): void {
  const blob = new Blob([serializePlaylist(playlist)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `${playlist.name.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/(?:^-|-$)/gu, '') || 'satglobe-playlist'}.playlist.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
