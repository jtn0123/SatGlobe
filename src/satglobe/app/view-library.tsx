import { useRef, useState } from 'react';
import { downloadPlaylist, normalizePlaylist } from '../domain/playlist';
import { downloadSavedView } from '../domain/saved-view';
import { playlistV1Schema } from '../domain/schemas';
import type { PlaylistEntryV1, PlaylistV1, SavedViewV1 } from '../domain/types';
import { Icon } from './icon';
import { encodingLabels } from './labels';

export interface ViewLibraryProps {
  savedViews: readonly SavedViewV1[];
  playlists: readonly PlaylistV1[];
  createView: () => SavedViewV1;
  onApplyView: (view: SavedViewV1) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onImportPlaylistFile: (file?: File) => Promise<void> | void;
  onImportViewFile: (file?: File) => Promise<void> | void;
  onPlayPlaylist: (playlist: PlaylistV1) => void;
  onSavePlaylist: (playlist: PlaylistV1) => boolean | void;
  onSaveView: () => void;
}

interface PlaylistDraft {
  id: string;
  name: string;
  entries: PlaylistEntryV1[];
}

/** Creates a portable identity without coupling a playlist to a storage slot. */
function createPlaylistId(): string {
  return crypto.randomUUID();
}

/** Inline sequence authoring keeps mission construction beside the saved views it uses. */
export function ViewLibrary({
  savedViews,
  playlists,
  createView,
  onApplyView,
  onDeletePlaylist,
  onImportPlaylistFile,
  onImportViewFile,
  onPlayPlaylist,
  onSavePlaylist,
  onSaveView,
}: Readonly<ViewLibraryProps>) {
  const viewFileInput = useRef<HTMLInputElement>(null);
  const playlistFileInput = useRef<HTMLInputElement>(null);
  const [importingView, setImportingView] = useState(false);
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [draft, setDraft] = useState<PlaylistDraft | null>(null);
  const [editorError, setEditorError] = useState('');
  const newSequence = () => {
    setEditorError('');
    setDraft({ id: createPlaylistId(), name: '', entries: [] });
  };
  const editSequence = (playlist: PlaylistV1) => {
    setEditorError('');
    setDraft(structuredClone(playlist));
  };
  const patchEntry = (index: number, patch: Partial<PlaylistEntryV1>) => setDraft((current) => current && ({
    ...current,
    entries: current.entries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)),
  }));
  const moveEntry = (index: number, offset: -1 | 1) => setDraft((current) => {
    if (!current) {
      return current;
    }
    const target = index + offset;

    if (target < 0 || target >= current.entries.length) {
      return current;
    }
    const entries = [...current.entries];

    [entries[index], entries[target]] = [entries[target], entries[index]];

    return { ...current, entries };
  });
  const saveSequence = () => {
    if (!draft) {
      return;
    }
    const candidate = { schemaVersion: 1 as const, ...draft };
    const parsed = playlistV1Schema.safeParse(candidate);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];

      setEditorError(issue?.message ?? 'This sequence is incomplete.');

      return;
    }
    if (onSavePlaylist(normalizePlaylist(parsed.data)) === false) {
      setEditorError('The playlist library is full. Delete one saved playlist, then try again.');

      return;
    }
    setEditorError('');
    setDraft(null);
  };

  return (
    <section className="sg-view-library" data-testid="view-library">
      <div className="sg-saved-views">
        <div className="sg-section-heading"><span><Icon name="bookmark" size={15} /> SAVED VIEWS</span><button onClick={onSaveView} type="button">+ Save current</button></div>
        {savedViews.length === 0
          ? <p>Camera, time, filters, selection, scale, and presentation mode travel together.</p>
          : savedViews.slice(0, 6).map((view, index) => (
            <button key={`${view.name}-${view.simulationTime}-${index}`} onClick={() => onApplyView(view)} type="button">
              <strong>{view.name}</strong><small>{encodingLabels[view.encoding]}</small>
            </button>
          ))}
        <div className="sg-portable-actions">
          <button data-testid="export-view" onClick={() => downloadSavedView(createView())} type="button"><Icon name="export" size={14} /> Export JSON</button>
          <button aria-busy={importingView || undefined} disabled={importingView} onClick={() => viewFileInput.current?.click()} type="button"><Icon name="import" size={14} /> {importingView ? 'Importing…' : 'Import'}</button>
          <input accept="application/json,.json" data-testid="import-view" onChange={async (event) => {
            setImportingView(true);
            try {
              await onImportViewFile(event.target.files?.[0]);
            } finally {
              setImportingView(false);
              if (viewFileInput.current) {
                viewFileInput.current.value = '';
              }
            }
          }} ref={viewFileInput} type="file" />
        </div>
      </div>

      <div className="sg-playlist-library">
        <div className="sg-section-heading"><span><Icon name="play" size={14} /> PLAYLISTS</span><button data-testid="open-playlist-editor" disabled={savedViews.length === 0} onClick={newSequence} type="button">+ New sequence</button></div>
        {playlists.length === 0
          ? <p>Chain two or more saved views into a captioned mission sequence.</p>
          : playlists.map((playlist) => (
            <article className="sg-playlist-record" data-playlist-id={playlist.id} data-testid="playlist-record" key={playlist.id}>
              <button data-testid={`play-playlist-${playlist.id}`} onClick={() => onPlayPlaylist(playlist)} type="button">
                <span className="sg-sequence-number">{String(playlist.entries.length).padStart(2, '0')}</span>
                <span><strong>{playlist.name}</strong><small>{playlist.entries.length} views · {Math.round(playlist.entries.reduce((total, entry) => total + entry.durationMs, 0) / 1_000)} sec</small></span>
                <Icon name="play" size={13} />
              </button>
              <div>
                <button aria-label={`Edit ${playlist.name}`} onClick={() => editSequence(playlist)} type="button">Edit</button>
                <button aria-label={`Export ${playlist.name}`} onClick={() => downloadPlaylist(playlist)} type="button">Export</button>
                <button aria-label={`Delete ${playlist.name}`} onClick={() => onDeletePlaylist(playlist.id)} type="button">Delete</button>
              </div>
            </article>
          ))}
        <div className="sg-portable-actions">
          <button aria-busy={importingPlaylist || undefined} disabled={importingPlaylist} onClick={() => playlistFileInput.current?.click()} type="button"><Icon name="import" size={14} /> {importingPlaylist ? 'Importing…' : 'Import playlist'}</button>
          <input accept="application/json,.json" data-testid="import-playlist" onChange={async (event) => {
            setImportingPlaylist(true);
            try {
              await onImportPlaylistFile(event.target.files?.[0]);
            } finally {
              setImportingPlaylist(false);
              if (playlistFileInput.current) {
                playlistFileInput.current.value = '';
              }
            }
          }} ref={playlistFileInput} type="file" />
        </div>
      </div>

      {draft && (
        <div className="sg-playlist-editor" data-testid="playlist-editor">
          <div className="sg-playlist-editor-head">
            <span>SEQUENCE BAY · {draft.entries.length.toString().padStart(2, '0')} / 24</span>
            <button aria-label="Close playlist editor" onClick={() => setDraft(null)} type="button"><Icon name="close" size={14} /></button>
          </div>
          <label>Sequence name<input autoFocus data-testid="playlist-name" maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. From LEO to the high ring" value={draft.name} /></label>
          <div className="sg-playlist-entry-list">
            {draft.entries.length === 0 && <p>Add at least two saved views. Their inline snapshots remain portable even if the originals are later removed.</p>}
            {draft.entries.map((entry, index) => (
              <fieldset className="sg-playlist-entry" key={`${entry.view.name}-${index}`}>
                <legend><span>{String(index + 1).padStart(2, '0')}</span>{entry.view.name}</legend>
                <label>Caption<input data-testid={`playlist-caption-${index}`} maxLength={280} onChange={(event) => patchEntry(index, { caption: event.target.value })} value={entry.caption} /></label>
                <label>Hold, seconds<input data-testid={`playlist-duration-${index}`} max={120} min={1} onChange={(event) => patchEntry(index, { durationMs: Number(event.target.value) * 1_000 })} type="number" value={entry.durationMs / 1_000} /></label>
                <div>
                  <button aria-label={`Move ${entry.view.name} earlier`} disabled={index === 0} onClick={() => moveEntry(index, -1)} type="button">↑</button>
                  <button aria-label={`Move ${entry.view.name} later`} disabled={index === draft.entries.length - 1} onClick={() => moveEntry(index, 1)} type="button">↓</button>
                  <button aria-label={`Remove ${entry.view.name}`} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, entryIndex) => entryIndex !== index) })} type="button">Remove</button>
                </div>
              </fieldset>
            ))}
          </div>
          <div className="sg-playlist-source-views">
            <span>ADD SAVED VIEW</span>
            {savedViews.map((view, index) => (
              <button data-testid={`add-playlist-view-${index}`} disabled={draft.entries.length >= 24} key={`${view.name}-${index}`} onClick={() => setDraft({
                ...draft,
                entries: [...draft.entries, { view: structuredClone(view), caption: view.name, durationMs: 6_000 }],
              })} type="button"><span>+</span>{view.name}</button>
            ))}
          </div>
          {editorError && <p aria-live="polite" className="sg-playlist-editor-error" role="status">{editorError}</p>}
          <div className="sg-playlist-editor-actions">
            <small>{draft.entries.length < 2 ? `${2 - draft.entries.length} more required` : 'Ready to sequence'}</small>
            <button onClick={() => setDraft(null)} type="button">Cancel</button>
            <button data-testid="save-playlist" onClick={saveSequence} type="button">Save playlist</button>
          </div>
        </div>
      )}
    </section>
  );
}
