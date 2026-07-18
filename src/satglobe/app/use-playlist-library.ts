import { useCallback, useEffect, useMemo, useState } from 'react';
import { importPlaylist, loadPersistedPlaylists, persistPlaylists } from '../domain/playlist';
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
  const [activePlaylist, setActivePlaylist] = useState<PlaylistV1 | null>(null);

  useEffect(() => persistPlaylists(playlists), [playlists]);

  const savePlaylist = useCallback((playlist: PlaylistV1) => {
    setPlaylists((records) => {
      const existing = records.some(({ id }) => id === playlist.id);

      return existing
        ? records.map((record) => (record.id === playlist.id ? playlist : record))
        : [playlist, ...records].slice(0, 24);
    });
    setActivePlaylist((current) => (current?.id === playlist.id ? playlist : current));
    onNotice(`Saved playlist “${playlist.name}” on this device.`);
  }, [onNotice]);
  const deletePlaylist = useCallback((playlistId: string) => {
    setPlaylists((records) => records.filter(({ id }) => id !== playlistId));
    setActivePlaylist((current) => (current?.id === playlistId ? null : current));
    onNotice('Playlist removed from this device.');
  }, [onNotice]);
  const importPlaylistFile = useCallback(async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const imported = importPlaylist(await file.text(), adapter.getObjects());

      setPlaylists((records) => [imported.playlist, ...records.filter(({ id }) => id !== imported.playlist.id)].slice(0, 24));
      setActivePlaylist((current) => (current?.id === imported.playlist.id ? imported.playlist : current));
      onNotice(imported.warnings.join(' ') || `Imported playlist “${imported.playlist.name}”.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not import this playlist.');
    }
  }, [adapter, onNotice]);
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
