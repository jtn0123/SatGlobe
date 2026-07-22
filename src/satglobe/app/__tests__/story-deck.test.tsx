import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initMaterialSelects } from '../../../engine/ui/material-select';
import { storyLibrary } from '../../stories';
import { StoryDeck } from '../story-deck';

describe('StoryDeck', () => {
  afterEach(cleanup);

  it('keeps the full story title in a native picker after global select initialization', () => {
    const story = storyLibrary.find(({ id }) => id === 'iss-assembly')!;

    render(
      <StoryDeck
        beatIndex={0}
        onAuthoredView={vi.fn()}
        onBeatChange={vi.fn()}
        onOpenWorkshop={vi.fn()}
        onPlayingChange={vi.fn()}
        onSourcesChange={vi.fn()}
        onStoryChange={vi.fn()}
        playing={false}
        progress={0}
        showSources={false}
        stories={storyLibrary}
        story={story}
      />,
    );
    const picker = screen.getByTestId('story-picker') as HTMLSelectElement;

    initMaterialSelects(screen.getByTestId('story-deck'));

    expect(picker.classList.contains('browser-default')).toBe(true);
    expect(picker.closest('.select-wrapper')).toBeNull();
    expect(picker.options[picker.selectedIndex]?.text).toBe(story.title);
  });

  it('exposes the active story and beat identity beside its visible title and counter', () => {
    const story = storyLibrary.find(({ id }) => id === 'iss-assembly')!;
    const beatIndex = story.beats.length - 1;
    const beat = story.beats[beatIndex];

    render(
      <StoryDeck
        beatIndex={beatIndex}
        onAuthoredView={vi.fn()}
        onBeatChange={vi.fn()}
        onOpenWorkshop={vi.fn()}
        onPlayingChange={vi.fn()}
        onSourcesChange={vi.fn()}
        onStoryChange={vi.fn()}
        playing={false}
        progress={0}
        showSources={false}
        stories={storyLibrary}
        story={story}
      />,
    );

    const deck = screen.getByTestId('story-deck');

    expect(deck.dataset.storyId).toBe(story.id);
    expect(deck.dataset.beatId).toBe(beat.id);
    expect(screen.getByTestId('story-beat-title').textContent).toBe(beat.title);
    expect(screen.getByTestId('story-beat-counter').textContent).toBe('05 / 05');
  });

  it('disables unavailable boundary navigation and offers replay on the final beat', () => {
    const story = storyLibrary.find(({ id }) => id === 'iss-assembly')!;
    const props = {
      onAuthoredView: vi.fn(),
      onBeatChange: vi.fn(),
      onOpenWorkshop: vi.fn(),
      onPlayingChange: vi.fn(),
      onSourcesChange: vi.fn(),
      onStoryChange: vi.fn(),
      playing: false,
      progress: 0,
      showSources: false,
      stories: storyLibrary,
      story,
    };
    const { rerender } = render(<StoryDeck {...props} beatIndex={0} />);

    expect((screen.getByRole('button', { name: 'Previous beat' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next beat' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Play story' }) as HTMLButtonElement).disabled).toBe(false);

    rerender(<StoryDeck {...props} beatIndex={story.beats.length - 1} />);

    expect((screen.getByRole('button', { name: 'Previous beat' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Next beat' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Replay story' }));
    expect(props.onPlayingChange).toHaveBeenCalledOnce();
  });

  it('cycles focus forward through source links and dismisses only the sources dialog on Escape', () => {
    const story = storyLibrary.find(({ id }) => id === 'iss-assembly')!;
    const onSourcesChange = vi.fn();

    render(
      <StoryDeck
        beatIndex={0}
        onAuthoredView={vi.fn()}
        onBeatChange={vi.fn()}
        onOpenWorkshop={vi.fn()}
        onPlayingChange={vi.fn()}
        onSourcesChange={onSourcesChange}
        onStoryChange={vi.fn()}
        playing={false}
        progress={0}
        showSources
        stories={storyLibrary}
        story={story}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Sources and technical facts' });
    const close = screen.getByRole('button', { name: 'Close sources' });
    const sourceLink = within(dialog).getAllByRole('link')[0];

    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(sourceLink);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onSourcesChange).toHaveBeenCalledOnce();
  });
});
