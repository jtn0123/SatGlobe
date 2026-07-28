import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type PlaylistV1, type SavedViewV1 } from '../../domain/types';
import { ViewLibrary, type ViewLibraryProps } from '../view-library';

const view = (name: string, encoding: SavedViewV1['encoding']): SavedViewV1 => ({
  schemaVersion: 1,
  name,
  camera: DEFAULT_CAMERA,
  simulationTime: '2026-07-18T12:00:00.000Z',
  filters: structuredClone(DEFAULT_FILTERS),
  encoding,
  selectedObjectIds: [],
  scaleMode: 'semantic',
  presentation: { mode: 'story', panelsVisible: false, storyId: 'story-source', storyBeat: 2 },
});

const savedViews = [view('Low orbit field', 'object-type'), view('High ring', 'orbit-regime')];
const playlist: PlaylistV1 = {
  schemaVersion: 1,
  id: '94298a2f-07e0-4f51-b44f-c19421b30b34',
  name: 'Catalog ascent',
  entries: savedViews.map((savedView, index) => ({ view: savedView, caption: `Step ${index + 1}`, durationMs: 6_000 })),
};

const makeProps = (overrides: Partial<ViewLibraryProps> = {}): ViewLibraryProps => ({
  savedViews,
  playlists: [],
  createView: vi.fn(() => savedViews[0]),
  onApplyView: vi.fn(),
  onDeletePlaylist: vi.fn(),
  onImportPlaylistFile: vi.fn(),
  onImportViewFile: vi.fn(),
  onPlayPlaylist: vi.fn(),
  onSavePlaylist: vi.fn(),
  onSaveView: vi.fn(),
  ...overrides,
});

describe('ViewLibrary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('authors a bounded portable sequence from saved views', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('52b6993d-248e-4501-9180-541dc00cbdc1');
    const props = makeProps();

    render(<ViewLibrary {...props} />);
    fireEvent.click(screen.getByTestId('open-playlist-editor'));
    fireEvent.change(screen.getByTestId('playlist-name'), { target: { value: 'LEO to GEO briefing' } });
    fireEvent.click(screen.getByTestId('add-playlist-view-0'));
    fireEvent.click(screen.getByTestId('add-playlist-view-1'));
    fireEvent.change(screen.getByTestId('playlist-caption-1'), { target: { value: 'Arrive at the high ring.' } });
    fireEvent.change(screen.getByTestId('playlist-duration-1'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('save-playlist'));

    expect(props.onSavePlaylist).toHaveBeenCalledOnce();
    expect(props.onSavePlaylist).toHaveBeenCalledWith(expect.objectContaining({
      id: '52b6993d-248e-4501-9180-541dc00cbdc1',
      name: 'LEO to GEO briefing',
      entries: [
        expect.objectContaining({ caption: 'Low orbit field', durationMs: 6_000 }),
        expect.objectContaining({ caption: 'Arrive at the high ring.', durationMs: 9_000 }),
      ],
    }));
    const saved = vi.mocked(props.onSavePlaylist).mock.calls[0][0];

    expect(saved.entries.every(({ view: entryView }) => entryView.presentation.mode === 'presentation')).toBe(true);
    expect(screen.queryByTestId('playlist-editor')).toBeNull();
  });

  it('keeps a valid draft open when the playlist library is full', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('d2e48c5c-83c3-4fa0-9c55-ad587a4e2975');
    const props = makeProps({ onSavePlaylist: vi.fn(() => false) });

    render(<ViewLibrary {...props} />);
    fireEvent.click(screen.getByTestId('open-playlist-editor'));
    fireEvent.change(screen.getByTestId('playlist-name'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByTestId('add-playlist-view-0'));
    fireEvent.click(screen.getByTestId('add-playlist-view-1'));
    fireEvent.click(screen.getByTestId('save-playlist'));

    expect(props.onSavePlaylist).toHaveBeenCalledOnce();
    expect(screen.getByTestId('playlist-editor')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('playlist library is full');
  });

  it('edits and plays an existing sequence without changing its id', () => {
    const props = makeProps({ playlists: [playlist] });

    render(<ViewLibrary {...props} />);
    fireEvent.click(screen.getByTestId(`play-playlist-${playlist.id}`));
    expect(props.onPlayPlaylist).toHaveBeenCalledWith(playlist);

    fireEvent.click(screen.getByRole('button', { name: `Edit ${playlist.name}` }));
    fireEvent.change(screen.getByTestId('playlist-name'), { target: { value: 'Edited ascent' } });
    fireEvent.click(screen.getByTestId('save-playlist'));

    expect(props.onSavePlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: playlist.id, name: 'Edited ascent' }));
  });

  it('reorders inline views and exports the validated playlist record', () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:playlist-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const props = makeProps({ playlists: [playlist] });

    render(<ViewLibrary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: `Edit ${playlist.name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Low orbit field later' }));
    fireEvent.click(screen.getByTestId('save-playlist'));

    expect(props.onSavePlaylist).toHaveBeenCalledWith(expect.objectContaining({
      entries: [
        expect.objectContaining({ view: expect.objectContaining({ name: 'High ring' }) }),
        expect.objectContaining({ view: expect.objectContaining({ name: 'Low orbit field' }) }),
      ],
    }));

    fireEvent.click(screen.getByRole('button', { name: `Export ${playlist.name}` }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:playlist-export');
  });

  it('keeps an incomplete sequence local to the editor and explains the bound', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('d4c5e3b6-d65d-4a40-bb85-f21ee1027401');
    const props = makeProps();

    render(<ViewLibrary {...props} />);
    fireEvent.click(screen.getByTestId('open-playlist-editor'));
    fireEvent.change(screen.getByTestId('playlist-name'), { target: { value: 'Incomplete' } });
    fireEvent.click(screen.getByTestId('add-playlist-view-0'));
    fireEvent.click(screen.getByTestId('save-playlist'));

    expect(props.onSavePlaylist).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBeTruthy();
    expect(screen.getByText('1 more required')).toBeTruthy();
  });

  it('routes playlist import and delete without applying orbital state', async () => {
    const props = makeProps({ playlists: [playlist] });
    const file = new File(['{}'], 'sequence.json', { type: 'application/json' });

    render(<ViewLibrary {...props} />);
    fireEvent.change(screen.getByTestId('import-playlist'), { target: { files: [file] } });
    await vi.waitFor(() => expect(props.onImportPlaylistFile).toHaveBeenCalledWith(file));
    fireEvent.click(screen.getByRole('button', { name: `Delete ${playlist.name}` }));

    expect(props.onDeletePlaylist).toHaveBeenCalledWith(playlist.id);
    expect(props.onApplyView).not.toHaveBeenCalled();
  });
});
