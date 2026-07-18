import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoverPanel, getQuickLensState, type DiscoverPanelProps } from '../discover-panel';
import { INITIAL_CONJUNCTION_STATE, createUnavailableConjunctionState } from '../../domain/conjunctions';
import { DEFAULT_FILTERS, type AvailableConjunctionState, type FilterState, type ResolvedConjunctionPair, type SpaceObjectView } from '../../domain/types';

const NON_DEFAULT_FILTERS: FilterState = {
  objectKinds: ['payload', 'debris'],
  status: 'inactive',
  regimes: ['leo', 'geo'],
  altitudeKm: { min: 321, max: 98_765 },
  inclinationDeg: { min: 10, max: 150 },
  launchCohort: '2010-2019',
  constellation: 'starlink',
  countryOrOperator: 'SpaceX',
};

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
  conjunctions: INITIAL_CONJUNCTION_STATE,
  conjunctionHighlightActive: false,
  highlightedObjectCount: 0,
  savedViews: [],
  onQueryChange: vi.fn(),
  onSelectResult: vi.fn(),
  onQuickLens: vi.fn(),
  onConjunctionLens: vi.fn(),
  setFiltersImmediate: vi.fn(),
  setFiltersDebounced: vi.fn(),
  onEncodingChange: vi.fn(),
  onSaveView: vi.fn(),
  onApplyView: vi.fn(),
  createView: vi.fn(),
  onImportFile: vi.fn(),
  ...overrides,
});

const SUBJECT = makeView();
const PARTNER = makeView({ catalogId: '43013', name: 'TEST PARTNER' });
const makePair = (timeOfClosestApproach: string): ResolvedConjunctionPair => ({
  id: 'a'.repeat(24),
  object1: { catalogId: SUBJECT.catalogId, name: SUBJECT.name, dseDays: 0.5, object: SUBJECT },
  object2: { catalogId: PARTNER.catalogId, name: PARTNER.name, dseDays: 0.75, object: PARTNER },
  timeOfClosestApproach,
  missDistanceKm: 0.25,
  relativeSpeedKmS: 12.5,
  maximumProbability: 0.001,
  dilutionThreshold: 0.01,
});

const SOURCE = {
  provider: 'CelesTrak' as const,
  rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv' as const,
  updatedAt: '2026-07-18T08:00:00.000Z',
  retrievedAt: '2026-07-18T08:05:00.000Z',
  checksum: 'a'.repeat(64),
};

const AVAILABLE_CONJUNCTIONS: AvailableConjunctionState = {
  status: 'current',
  conjunctions: [makePair('2026-07-19T08:00:00.000Z')],
  lensPairCount: 1,
  catalogIds: ['25544', '43013'],
  droppedPairCount: 1,
  source: SOURCE,
  error: null,
};

const ARCHIVAL_CONJUNCTIONS: AvailableConjunctionState = {
  ...AVAILABLE_CONJUNCTIONS,
  status: 'archival',
  conjunctions: [makePair('2026-07-17T08:00:00.000Z')],
};

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

  it.each([
    ['loading', 'loading', INITIAL_CONJUNCTION_STATE, true, 'Loading screening'],
    ['unavailable', 'unavailable', createUnavailableConjunctionState('missing'), true, 'Screening unavailable'],
    ['current', 'current', AVAILABLE_CONJUNCTIONS, false, '1 upcoming pair'],
    ['stale', 'stale', { ...AVAILABLE_CONJUNCTIONS, status: 'stale' as const }, false, '1 stale upcoming pair'],
    ['archival', 'archival', ARCHIVAL_CONJUNCTIONS, false, '1 latest past pair'],
    ['empty archival', 'archival', { ...ARCHIVAL_CONJUNCTIONS, conjunctions: [], lensPairCount: 0, catalogIds: [] }, true, '0 latest past pairs'],
  ])('renders a truthful %s conjunction-lens state', (_case, status, conjunctions, disabled, label) => {
    render(<DiscoverPanel {...makeProps({ conjunctions })} />);
    const button = screen.getByTestId('conjunction-lens') as HTMLButtonElement;

    expect(button.disabled).toBe(disabled);
    expect(button.getAttribute('data-conjunction-status')).toBe(status);
    expect(screen.getByTestId('conjunction-lens-status').textContent).toContain(label);
  });

  it('applies the conjunction lens through its dedicated callback and reports highlight/drop counts', () => {
    const props = makeProps({
      conjunctions: AVAILABLE_CONJUNCTIONS,
      conjunctionHighlightActive: true,
      highlightedObjectCount: 2,
    });

    render(<DiscoverPanel {...props} />);
    fireEvent.click(screen.getByTestId('conjunction-lens'));

    expect(props.onConjunctionLens).toHaveBeenCalledOnce();
    expect(props.onQuickLens).not.toHaveBeenCalled();
    expect(screen.getByTestId('conjunction-lens-status').textContent).toBe('2 highlighted');
    expect(screen.getByTestId('conjunction-lens').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('conjunction-lens').getAttribute('data-highlighted-count')).toBe('2');
    expect(screen.getByTestId('conjunction-lens').getAttribute('data-dropped-pair-count')).toBe('1');
  });

  it('does not treat an unrelated nonzero highlight count as an active conjunction lens', () => {
    render(<DiscoverPanel {...makeProps({
      conjunctions: AVAILABLE_CONJUNCTIONS,
      conjunctionHighlightActive: false,
      highlightedObjectCount: 2,
    })} />);

    expect(screen.getByTestId('conjunction-lens').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('conjunction-lens-status').textContent).toBe('1 upcoming pair');
  });

  it('announces asynchronous lens status and uses singular pair grammar', () => {
    render(<DiscoverPanel {...makeProps({
      conjunctions: { ...AVAILABLE_CONJUNCTIONS, lensPairCount: 1 },
    })} />);
    const status = screen.getByTestId('conjunction-lens-status');

    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('1 upcoming pair');
  });

  it('routes both inclination sliders through the debounced setter and keeps the bounds ordered', () => {
    const props = makeProps({ filters: structuredClone(NON_DEFAULT_FILTERS) });

    render(<DiscoverPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Minimum inclination'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Maximum inclination'), { target: { value: '120' } });

    expect(props.setFiltersDebounced).toHaveBeenNthCalledWith(1, {
      ...NON_DEFAULT_FILTERS,
      inclinationDeg: { min: 45, max: 150 },
    });
    expect(props.setFiltersDebounced).toHaveBeenNthCalledWith(2, {
      ...NON_DEFAULT_FILTERS,
      inclinationDeg: { min: 10, max: 120 },
    });
    expect(props.setFiltersImmediate).not.toHaveBeenCalled();

    // A min dragged past the max clamps to max - 1 instead of crossing it.
    const crossing = makeProps({
      filters: { ...structuredClone(NON_DEFAULT_FILTERS), inclinationDeg: { min: 10, max: 50 } },
    });

    render(<DiscoverPanel {...crossing} />);
    fireEvent.change(screen.getAllByLabelText('Minimum inclination')[1], { target: { value: '170' } });
    expect(crossing.setFiltersDebounced).toHaveBeenCalledWith({
      ...NON_DEFAULT_FILTERS,
      inclinationDeg: { min: 49, max: 50 },
    });
    expect(crossing.setFiltersImmediate).not.toHaveBeenCalled();
  });

  it('routes the filter heading reset through the immediate setter', () => {
    const props = makeProps();

    render(<DiscoverPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(props.setFiltersImmediate).toHaveBeenCalledWith(DEFAULT_FILTERS);
    expect(props.setFiltersDebounced).not.toHaveBeenCalled();
  });

  it('routes the empty-results reset through the immediate setter', () => {
    const props = makeProps({ visibleCount: 0 });

    render(<DiscoverPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'reset them' }));

    expect(props.setFiltersImmediate).toHaveBeenCalledWith(DEFAULT_FILTERS);
    expect(props.setFiltersDebounced).not.toHaveBeenCalled();
  });

  it('routes object class, operational status, and orbital regime through the immediate setter', () => {
    const props = makeProps({ filters: structuredClone(NON_DEFAULT_FILTERS) });

    render(<DiscoverPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rocket bodies' }));
    fireEvent.click(screen.getByTestId('status-all'));
    fireEvent.click(screen.getByRole('button', { name: 'LEO' }));

    expect(props.setFiltersImmediate).toHaveBeenNthCalledWith(1, {
      ...NON_DEFAULT_FILTERS,
      objectKinds: ['payload', 'debris', 'rocket-body'],
    });
    expect(props.setFiltersImmediate).toHaveBeenNthCalledWith(2, {
      ...NON_DEFAULT_FILTERS,
      status: 'all',
    });
    expect(props.setFiltersImmediate).toHaveBeenNthCalledWith(3, {
      ...NON_DEFAULT_FILTERS,
      regimes: ['geo'],
    });
    expect(props.setFiltersDebounced).not.toHaveBeenCalled();
  });

  it('removes the hidden panel from the accessibility tree via inert', () => {
    render(<DiscoverPanel {...makeProps({ inert: true })} />);
    expect(screen.getByTestId('discover-panel').hasAttribute('inert')).toBe(true);

    cleanup();
    render(<DiscoverPanel {...makeProps()} />);
    expect(screen.getByTestId('discover-panel').hasAttribute('inert')).toBe(false);
  });
});
