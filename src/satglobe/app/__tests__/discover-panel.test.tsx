import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoverPanel, getQuickLensState, type DiscoverPanelProps } from '../discover-panel';
import { DEFAULT_FILTERS, type SpaceObjectView } from '../../domain/types';

const makeView = (overrides: Partial<SpaceObjectView> = {}): SpaceObjectView => ({
  catalogId: '25544',
  name: 'ISS (ZARYA)',
  kind: 'payload',
  active: true,
  status: 'Operational',
  internationalDesignator: '1998-067A',
  launchDate: '1998-11-20',
  launchVehicle: 'Proton-K',
  owner: 'NASA',
  country: 'US',
  source: 'celestrak',
  epoch: '2021-12-31T00:00:00Z',
  apogeeKm: 420,
  perigeeKm: 410,
  inclinationDeg: 51.6,
  periodMinutes: 92.9,
  regime: 'leo',
  isStarlink: false,
  nameText: 'iss (zarya)',
  launchText: '1998-11-20 proton-k',
  ownershipText: 'nasa us',
  searchText: 'iss (zarya) 25544 1998-067a',
  ...overrides,
});

const makeProps = (overrides: Partial<DiscoverPanelProps> = {}): DiscoverPanelProps => ({
  visibleCount: 8250,
  query: '',
  results: [],
  filters: structuredClone(DEFAULT_FILTERS),
  encoding: 'object-type',
  savedViews: [],
  onQueryChange: vi.fn(),
  onSelectResult: vi.fn(),
  onQuickLens: vi.fn(),
  setFilters: vi.fn(),
  onEncodingChange: vi.fn(),
  onSaveView: vi.fn(),
  onApplyView: vi.fn(),
  createView: vi.fn(),
  onImportFile: vi.fn(),
  ...overrides,
});

describe('getQuickLensState', () => {
  it('starlink lens narrows to the constellation and plane encoding', () => {
    const { filters, encoding } = getQuickLensState('starlink');

    expect(filters.constellation).toBe('starlink');
    expect(encoding).toBe('orbital-plane');
    expect(filters.objectKinds).toEqual(DEFAULT_FILTERS.objectKinds);
  });

  it('geo lens narrows regimes to the high ring', () => {
    const { filters, encoding } = getQuickLensState('geo');

    expect(filters.regimes).toEqual(['geo']);
    expect(encoding).toBe('orbit-regime');
  });

  it('debris lens widens status to all and recolors by data age', () => {
    const { filters, encoding } = getQuickLensState('debris');

    expect(filters.objectKinds).toEqual(['debris']);
    expect(filters.status).toBe('all');
    expect(encoding).toBe('data-age');
  });

  it('never mutates the shared defaults', () => {
    getQuickLensState('debris');
    expect(DEFAULT_FILTERS.status).toBe('active');
    expect(DEFAULT_FILTERS.objectKinds).toEqual(['payload']);
  });
});

describe('DiscoverPanel', () => {
  afterEach(cleanup);

  it('shows the formatted visible count', () => {
    render(<DiscoverPanel {...makeProps()} />);

    expect(screen.getByTestId('visible-count').textContent).toBe('8,250 visible');
  });

  it('forwards search input to onQueryChange', () => {
    const props = makeProps();

    render(<DiscoverPanel {...props} />);
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'iss' } });

    expect(props.onQueryChange).toHaveBeenCalledWith('iss');
  });

  it('reports when a query has no local matches', () => {
    render(<DiscoverPanel {...makeProps({ query: 'zzzz', results: [] })} />);

    expect(screen.getByTestId('search-results').textContent).toContain('No local catalog matches.');
  });

  it('selects a result by catalog id', () => {
    const props = makeProps({ query: 'iss', results: [makeView()] });

    render(<DiscoverPanel {...props} />);
    fireEvent.click(screen.getByText('ISS (ZARYA)'));

    expect(props.onSelectResult).toHaveBeenCalledWith('25544');
  });

  it('routes quick lenses through onQuickLens', () => {
    const props = makeProps();

    render(<DiscoverPanel {...props} />);
    fireEvent.click(screen.getByTestId('starlink-lens'));

    expect(props.onQuickLens).toHaveBeenCalledWith('starlink');
  });

  it('exposes sliders for both inclination bounds and keeps min below max', () => {
    const props = makeProps();

    render(<DiscoverPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Minimum inclination'), { target: { value: '45' } });
    expect(props.setFilters).toHaveBeenCalledWith(expect.objectContaining({
      inclinationDeg: expect.objectContaining({ min: 45 }),
    }));

    // A min dragged past the max clamps to max - 1 instead of crossing it.
    const crossing = makeProps({ filters: { ...structuredClone(DEFAULT_FILTERS), inclinationDeg: { min: 0, max: 50 } } });

    render(<DiscoverPanel {...crossing} />);
    fireEvent.change(screen.getAllByLabelText('Minimum inclination')[1], { target: { value: '170' } });
    expect(crossing.setFilters).toHaveBeenCalledWith(expect.objectContaining({
      inclinationDeg: expect.objectContaining({ min: 49, max: 50 }),
    }));
  });

  it('removes the hidden panel from the accessibility tree via inert', () => {
    render(<DiscoverPanel {...makeProps({ inert: true })} />);
    expect(screen.getByTestId('discover-panel').hasAttribute('inert')).toBe(true);

    cleanup();
    render(<DiscoverPanel {...makeProps()} />);
    expect(screen.getByTestId('discover-panel').hasAttribute('inert')).toBe(false);
  });
});
