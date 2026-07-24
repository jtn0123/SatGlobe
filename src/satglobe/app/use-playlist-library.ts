import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  importPlaylist,
  loadPersistedPlaylists,
  MAX_PERSISTED_PLAYLISTS,
  persistPlaylists,
  upsertPersistedPlaylist,
} from '../domain/playlist';
import { importSavedView } from '../domain/saved-view';
import type {
  AppMode,
  FilterState,
  PlaylistEntryV1,
  PlaylistV1,
  SavedViewV1,
  ScaleMode,
  VisualEncoding,
} from '../domain/types';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { PLAYLIST_APPLY_MEASURE, measureSync } from '../runtime/performance-measure';
import { usePlaylistPlayback } from './use-playlist-playback';
import type { ViewLibraryProps } from './view-library';

interface UsePlaylistLibraryOptions {
  adapter: SatGlobeEngineAdapter;
  mode: AppMode;
  savedViews: readonly SavedViewV1[];
  createView: () => SavedViewV1;
  onApplyView: (view: SavedViewV1) => string | null;
  onNotice: (notice: string) => void;
  onSaveView: () => void;
  setFiltersWithEncodingImmediate: (filters: FilterState, encoding: VisualEncoding) => void;
  setScaleMode: (mode: ScaleMode) => void;
  switchMode: (mode: AppMode) => void;
}

/** Owns local playlist records, portable imports, playback, and the grouped ViewLibrary surface. */
export function usePlaylistLibrary({
  adapter,
  mode,
  savedViews,
  createView,
  onApplyView,
  onNotice,
  onSaveView,
  setFiltersWithEncodingImmediate,
  setScaleMode,
  switchMode,
}: UsePlaylistLibraryOptions) {
  const [playlists, setPlaylists] = useState<PlaylistV1[]>(() => loadPersistedPlaylists());
  const playlistsRef = useRef(playlists);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistV1 | null>(null);

  useEffect(() => persistPlaylists(playlists), [playlists]);
  useEffect(() => {
    if (mode !== 'presentation') {
      setActivePlaylist(null);
    }
  }, [mode]);

  const replacePlaylists = useCallback((records: PlaylistV1[]) => {
    playlistsRef.current = records;
    setPlaylists(records);
  }, []);
  const storePlaylist = useCallback((playlist: PlaylistV1): boolean => {
    const records = upsertPersistedPlaylist(playlistsRef.current, playlist);

    if (!records) {
      return false;
    }
    replacePlaylists(records);
    setActivePlaylist((current) => (current?.id === playlist.id ? playlist : current));

    return true;
  }, [replacePlaylists]);
  const savePlaylist = useCallback((playlist: PlaylistV1) => {
    if (!storePlaylist(playlist)) {
      onNotice(`Playlist library is full (${MAX_PERSISTED_PLAYLISTS}). Delete one before saving another.`);

      return false;
    }
    onNotice(`Saved playlist “${playlist.name}” on this device.`);

    return true;
  }, [onNotice, storePlaylist]);
  const deletePlaylist = useCallback((playlistId: string) => {
    replacePlaylists(playlistsRef.current.filter(({ id }) => id !== playlistId));
    setActivePlaylist((current) => (current?.id === playlistId ? null : current));
    onNotice('Playlist removed from this device.');
  }, [onNotice, replacePlaylists]);
  const importPlaylistFile = useCallback(async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const imported = importPlaylist(await file.text(), adapter.getObjects());

      if (!storePlaylist(imported.playlist)) {
        onNotice(`Playlist library is full (${MAX_PERSISTED_PLAYLISTS}). Delete one before importing another.`);

        return;
      }
      onNotice(imported.warnings.join(' ') || `Imported playlist “${imported.playlist.name}”.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not import this playlist.');
    }
  }, [adapter, onNotice, storePlaylist]);
  const importViewFile = useCallback(async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const imported = importSavedView(await file.text(), adapter.getObjects());

      setActivePlaylist(null);
      const storyWarning = onApplyView(imported.view);
      const warnings = [storyWarning, ...imported.warnings].filter(Boolean).join(' ');

      onNotice(warnings || `Imported “${imported.view.name}”.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not import this preset.');
    }
  }, [adapter, onApplyView, onNotice]);
  const applyPlaylistEntry = useCallback((playlist: PlaylistV1, entry: PlaylistEntryV1, entryIndex: number) => {
    measureSync(PLAYLIST_APPLY_MEASURE, { playlistId: playlist.id, entryIndex }, () => {
      setFiltersWithEncodingImmediate(entry.view.filters, entry.view.encoding);
      setScaleMode(entry.view.scaleMode);
      adapter.setScaleMode(entry.view.scaleMode);
      adapter.setCamera(entry.view.camera);
      adapter.setSimulationTime(entry.view.simulationTime);
      adapter.clearSelection();
      if (entry.view.selectedObjectIds[0]) {
        adapter.selectObject(entry.view.selectedObjectIds[0]);
      }
      switchMode('presentation');
    });
  }, [adapter, setFiltersWithEncodingImmediate, setScaleMode, switchMode]);
  const onPlaylistEntryApplied = useCallback((entry: PlaylistEntryV1, entryIndex: number) => {
    if (activePlaylist) {
      applyPlaylistEntry(activePlaylist, entry, entryIndex);
    }
  }, [activePlaylist, applyPlaylistEntry]);
  const player = usePlaylistPlayback(activePlaylist, mode === 'presentation', onPlaylistEntryApplied);
  const restartPlayback = player.restart;
  const playPlaylist = useCallback((playlist: PlaylistV1) => {
    const firstEntry = playlist.entries[0];

    if (!firstEntry) {
      return;
    }
    restartPlayback();
    setActivePlaylist(playlist);
    applyPlaylistEntry(playlist, firstEntry, 0);
  }, [applyPlaylistEntry, restartPlayback]);
  const applySavedView = useCallback((view: SavedViewV1) => {
    setActivePlaylist(null);
    onApplyView(view);
  }, [onApplyView]);
  const viewLibrary = useMemo<ViewLibraryProps>(() => ({
    savedViews,
    playlists,
    createView,
    onApplyView: applySavedView,
    onDeletePlaylist: deletePlaylist,
    onImportPlaylistFile: importPlaylistFile,
    onImportViewFile: importViewFile,
    onPlayPlaylist: playPlaylist,
    onSavePlaylist: savePlaylist,
    onSaveView,
  }), [applySavedView, createView, deletePlaylist, importPlaylistFile, importViewFile, onSaveView, playPlaylist, playlists, savePlaylist, savedViews]);

  return { activePlaylist, player, viewLibrary };
}
