import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SatGlobeErrorBoundary } from '../error-boundary';

/** A child that throws during render to trip the boundary. */
function ExplodingChild(): never {
  throw new Error('bad catalog record');
}

describe('SatGlobeErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders its children when nothing throws', () => {
    render(
      <SatGlobeErrorBoundary>
        <p>healthy shell</p>
      </SatGlobeErrorBoundary>,
    );

    expect(screen.getByText('healthy shell')).toBeDefined();
    expect(screen.queryByTestId('shell-error')).toBeNull();
  });

  it('swaps a render error for the recovery panel instead of blanking the tree', () => {
    // React logs the caught error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <SatGlobeErrorBoundary>
        <ExplodingChild />
      </SatGlobeErrorBoundary>,
    );

    const panel = screen.getByTestId('shell-error');

    expect(panel.getAttribute('role')).toBe('alert');
    expect(screen.getByText('bad catalog record')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });
});
