import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA, DEFAULT_FILTERS, type PlaylistV1 } from '../../domain/types';
import { PlaylistDeck } from '../playlist-deck';

const playlist: PlaylistV1 = {
  schemaVersion: 1,
  id: '2e0acef6-7baf-48c5-b0dc-a773dd6d4906',
  name: 'Across the catalog',
  entries: ['Low orbit opens', 'The high ring closes'].map((caption, index) => ({
    caption,
    durationMs: 6_000,
    view: {
      schemaVersion: 1,
      name: index === 0 ? 'LEO field' : 'GEO belt',
      camera: DEFAULT_CAMERA,
      simulationTime: '2026-07-18T12:00:00.000Z',
      filters: structuredClone(DEFAULT_FILTERS),
      encoding: 'orbit-regime' as const,
      selectedObjectIds: [],
      scaleMode: 'semantic' as const,
      presentation: { mode: 'presentation' as const, panelsVisible: false },
    },
  })),
};

describe('PlaylistDeck', () => {
  afterEach(cleanup);

  it('renders sequence identity, caption, progress, and transport callbacks', () => {
    const onEntryChange = vi.fn();
    const onPlayingChange = vi.fn();
    const onOpenWorkshop = vi.fn();

    render(<PlaylistDeck
      entryIndex={0}
      onEntryChange={onEntryChange}
      onOpenWorkshop={onOpenWorkshop}
      onPlayingChange={onPlayingChange}
      playing={false}
      playlist={playlist}
      progress={0.4}
      reducedMotion={false}
    />);

    expect(screen.getByTestId('playlist-deck').textContent).toContain('MISSION SEQUENCE · Across the catalog');
    expect(screen.getByTestId('playlist-caption').textContent).toBe('Low orbit opens');
    expect(screen.getByTestId('playlist-counter').textContent).toBe('01 / 02');
    expect((screen.getByRole('button', { name: 'Previous playlist view' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('playlist-next'));
    fireEvent.click(screen.getByTestId('playlist-play'));
    fireEvent.click(screen.getByRole('button', { name: 'Open workshop' }));

    expect(onEntryChange).toHaveBeenCalledWith(1);
    expect(onPlayingChange).toHaveBeenCalledOnce();
    expect(onOpenWorkshop).toHaveBeenCalledOnce();
  });

  it('announces discrete playback for reduced motion without disabling transport', () => {
    render(<PlaylistDeck
      entryIndex={1}
      onEntryChange={vi.fn()}
      onOpenWorkshop={vi.fn()}
      onPlayingChange={vi.fn()}
      playing={false}
      playlist={playlist}
      progress={0}
      reducedMotion
    />);

    expect((screen.getByTestId('playlist-play') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/holds each view, then jumps/u)).toBeTruthy();
    expect((screen.getByTestId('playlist-next') as HTMLButtonElement).disabled).toBe(true);
  });
});
