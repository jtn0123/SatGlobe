import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AvailableConjunctionState,
  ResolvedConjunctionObject,
  ResolvedConjunctionPair,
  SpaceObjectView,
} from '../../domain/types';
import { Inspector } from '../inspector';

/** Builds one complete catalog view for Inspector fixtures. */
function makeView(catalogId: string, name: string): SpaceObjectView {
  return {
    catalogId,
    name,
    kind: 'payload',
    active: true,
    status: 'Known active',
    internationalDesignator: '1998-067A',
    launchDate: '1998-11-20',
    launchVehicle: 'Proton-K',
    owner: 'NASA',
    country: 'US',
    source: 'CelesTrak',
    epoch: '2026-07-18T00:00:00.000Z',
    apogeeKm: 420,
    perigeeKm: 410,
    inclinationDeg: 51.6,
    periodMinutes: 92.9,
    regime: 'leo',
    isStarlink: false,
    nameText: name.toLocaleLowerCase(),
    launchText: '1998-067a 1998-11-20',
    ownershipText: 'us nasa',
    searchText: `${name.toLocaleLowerCase()} ${catalogId}`,
  };
}

const SELECTED = makeView('25544', 'ISS (ZARYA)');
const PARTNER = makeView('43013', 'TEST PARTNER');

/** Attaches feed-side element age to a resolved catalog view. */
function resolved(object: SpaceObjectView, dseDays: number): ResolvedConjunctionObject {
  return { catalogId: object.catalogId, name: object.name, dseDays, object };
}

/** Builds a zero-valued encounter in either object orientation. */
function makePair(selectedIsObject1: boolean, tca: string): ResolvedConjunctionPair {
  const selected = resolved(SELECTED, 0);
  const partner = resolved(PARTNER, 0);

  return {
    id: 'b'.repeat(24),
    object1: selectedIsObject1 ? selected : partner,
    object2: selectedIsObject1 ? partner : selected,
    timeOfClosestApproach: tca,
    missDistanceKm: 0,
    relativeSpeedKmS: 0,
    maximumProbability: 0,
    dilutionThreshold: 0,
  };
}

/** Wraps a resolved encounter in one available engine state. */
function makeState(
  pair: ResolvedConjunctionPair,
  status: AvailableConjunctionState['status'] = 'current',
): AvailableConjunctionState {
  return {
    status,
    conjunctions: [pair],
    lensPairCount: 1,
    catalogIds: [SELECTED.catalogId, PARTNER.catalogId],
    droppedPairCount: 0,
    source: {
      provider: 'CelesTrak',
      rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
      updatedAt: '2026-07-18T08:00:00.000Z',
      retrievedAt: '2026-07-18T08:05:00.000Z',
      checksum: 'a'.repeat(64),
    },
    error: null,
  };
}

describe('Inspector conjunction details', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([true, false])('orients a future partner when the selected object is object1=%s', (selectedIsObject1) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T10:00:00.000Z'));
    const conjunctions = makeState(makePair(selectedIsObject1, '2026-07-19T12:00:00.000Z'));

    render(<Inspector conjunctions={conjunctions} object={SELECTED} onClose={vi.fn()} />);
    const detail = screen.getByTestId('conjunction-detail');

    expect(detail.getAttribute('data-temporal-label')).toBe('next');
    expect(detail.textContent).toContain('Next close approach');
    expect(detail.textContent).toContain(PARTNER.name);
    expect(detail.textContent).toContain(`Catalog ${PARTNER.catalogId}`);
  });

  it('renders valid zero-valued metrics and complete source provenance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T10:00:00.000Z'));

    render(<Inspector conjunctions={makeState(makePair(true, '2026-07-19T12:00:00.000Z'))} object={SELECTED} onClose={vi.fn()} />);
    const detail = screen.getByTestId('conjunction-detail');

    expect(detail.textContent).toContain('Miss distance0 km');
    expect(detail.textContent).toContain('Relative speed0 km/s');
    expect(detail.textContent).toContain('Maximum modeled probability0');
    expect(detail.textContent).toContain('Dilution threshold0 km');
    expect(detail.textContent).toContain('Source updated 18 JUL 2026');
    expect(detail.textContent).toContain('Retrieved 18 JUL 2026');
    expect(detail.textContent).toContain('not live telemetry or an operator alert');
  });

  it('labels an archival event as latest rather than upcoming', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));

    render(<Inspector conjunctions={makeState(makePair(false, '2026-07-19T12:00:00.000Z'), 'archival')} object={SELECTED} onClose={vi.fn()} />);
    const detail = screen.getByTestId('conjunction-detail');

    expect(detail.getAttribute('data-temporal-label')).toBe('latest');
    expect(detail.textContent).toContain('Latest screened approach');
    expect(detail.textContent).toContain('latest past event');
    expect(detail.textContent).not.toContain('Next close approach');
  });

  it('warns that a selected past event is not upcoming even while another feed event is current', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));

    render(<Inspector conjunctions={makeState(makePair(true, '2026-07-19T12:00:00.000Z'), 'current')} object={SELECTED} onClose={vi.fn()} />);

    expect(screen.getByTestId('conjunction-detail').textContent).toContain('latest past event');
    expect(screen.getByTestId('conjunction-detail').textContent).toContain('not an upcoming alert');
  });

  it('warns when the provider snapshot is stale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T10:00:00.000Z'));

    render(<Inspector conjunctions={makeState(makePair(true, '2026-07-19T12:00:00.000Z'), 'stale')} object={SELECTED} onClose={vi.fn()} />);

    expect(screen.getByTestId('conjunction-detail').textContent).toContain('source snapshot is stale');
  });
});
