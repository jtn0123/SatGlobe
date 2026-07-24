import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaunchCohortView } from '../../domain/types';
import { LaunchExplorer } from '../launch-explorer';

const cohort = (overrides: Partial<LaunchCohortView> = {}): LaunchCohortView => ({
  id: '2021-021',
  constellation: 'starlink',
  launchDate: '2021-03-14T10:01:00.000Z',
  launchVehicle: 'Falcon 9',
  owner: 'SpaceX',
  country: 'US',
  catalogMemberIds: ['1', '2'],
  catalogMemberCount: 2,
  activeCount: 1,
  perigeeKmRange: [530, 540],
  apogeeKmRange: [560, 570],
  inclinationDegRange: [53.2, 53.4],
  newestElementEpoch: '2026-07-21T00:00:00.000Z',
  sourceLabels: ['CelesTrak'],
  featuredStory: { storyId: 'starlink-buildout', beatId: 'deployment-train' },
  ...overrides,
});

afterEach(cleanup);

describe('LaunchExplorer', () => {
  it('filters by search and launch year without changing the catalog', () => {
    render(<LaunchExplorer cohorts={[
      cohort(),
      cohort({ id: '2024-001', launchDate: '2024-01-02T00:00:00.000Z', launchVehicle: 'Falcon Heavy' }),
    ]} onOpenMembers={vi.fn()} onOpenStory={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Filter Starlink launch year'), { target: { value: '2024' } });
    expect(screen.getByTestId('launch-list').textContent).toContain('2024-001');
    expect(screen.getByTestId('launch-list').textContent).not.toContain('2021-021');

    fireEvent.change(screen.getByLabelText('Search Starlink launch cohorts'), { target: { value: 'missing' } });
    expect(screen.getByText('No launch cohorts match this view.')).toBeTruthy();
  });

  it('selects a cohort and opens retained members or a validated story beat', () => {
    const selected = cohort();
    const onSelect = vi.fn();
    const onOpenMembers = vi.fn();
    const onOpenStory = vi.fn();
    const { rerender } = render(<LaunchExplorer cohorts={[selected]} onOpenMembers={onOpenMembers} onOpenStory={onOpenStory} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /2021-021/u }));
    expect(onSelect).toHaveBeenCalledWith(selected);

    rerender(<LaunchExplorer cohorts={[selected]} onOpenMembers={onOpenMembers} onOpenStory={onOpenStory} onSelect={onSelect} selectedCohortId={selected.id} />);
    fireEvent.click(screen.getByTestId('open-cohort-members'));
    fireEvent.click(screen.getByTestId('open-cohort-story'));
    expect(onOpenMembers).toHaveBeenCalledWith(selected);
    expect(onOpenStory).toHaveBeenCalledWith(selected);
  });

  it('does not render a stale or unvalidated story shortcut', () => {
    render(<LaunchExplorer cohorts={[cohort({ featuredStory: undefined })]} onOpenMembers={vi.fn()} onOpenStory={vi.fn()} onSelect={vi.fn()} selectedCohortId="2021-021" />);

    expect(screen.queryByTestId('open-cohort-story')).toBeNull();
  });
});
