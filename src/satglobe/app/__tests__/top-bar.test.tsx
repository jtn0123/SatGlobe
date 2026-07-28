import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../top-bar';

afterEach(cleanup);

/** Renders one catalog-age state with inert mode callbacks. */
function renderTopBar(newestElementAge: number | null) {
  render(
    <TopBar
      mode="workshop"
      newestElementAge={newestElementAge}
      objectCount={35_049}
      onModeChange={vi.fn()}
      onSnapshot={vi.fn()}
      onStoryOpen={vi.fn()}
      ready
      snapshotBusy={false}
      storyCount={8}
    />,
  );
}

describe('TopBar catalog time status', () => {
  it('surfaces a future newest-element epoch instead of presenting it as fresh', () => {
    renderTopBar(-2.4);

    expect(screen.getByText('NEWEST ELEMENT 2D IN FUTURE')).toBeDefined();
  });

  it('retains the established stale-element warning', () => {
    renderTopBar(14.9);

    expect(screen.getByText('NEWEST ELEMENT 14D OLD')).toBeDefined();
  });
});
