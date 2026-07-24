import { describe, expect, it } from 'vitest';
import type { SpaceObjectView, StoryManifestV1 } from '../types';
import { buildStarlinkLaunchCohorts } from '../launch-cohorts';

const object = (overrides: Partial<SpaceObjectView> = {}): SpaceObjectView => ({
  catalogId: '1',
  name: 'STARLINK-1',
  kind: 'payload',
  active: true,
  status: 'Operational',
  internationalDesignator: '2021-021A',
  launchDate: '2021-03-14T10:01:00.000Z',
  launchVehicle: 'Falcon 9',
  owner: 'SpaceX',
  country: 'US',
  source: 'CelesTrak',
  epoch: '2026-07-20T00:00:00.000Z',
  apogeeKm: 560,
  perigeeKm: 540,
  inclinationDeg: 53.2,
  periodMinutes: 95,
  regime: 'leo',
  isStarlink: true,
  nameText: 'starlink-1',
  launchText: '2021-021a 2021-03-14',
  ownershipText: 'us spacex',
  searchText: 'starlink-1 1 2021-021a spacex us',
  ...overrides,
});

const story = (beatId = 'deployment-train'): StoryManifestV1 => ({
  schemaVersion: 1,
  id: 'starlink-buildout',
  title: 'Building a shell',
  dek: 'Test story',
  reconstructionPolicy: 'sourced-reconstruction',
  facts: [],
  sources: [],
  beats: [
    {
      id: beatId,
      eyebrow: '01',
      title: 'Deployment',
      dateLabel: '2021',
      narration: 'Test',
      factIds: [],
      durationMs: 10_000,
      camera: { pitch: 0, yaw: 0, zoom: 0.5 },
      encoding: 'launch-cohort',
      reconstruction: 'observed',
      scaleMode: 'semantic',
    },
  ],
});

describe('Starlink launch cohorts', () => {
  it('summarizes only retained Starlink members with factual ranges and counts', () => {
    const cohorts = buildStarlinkLaunchCohorts([
      object(),
      object({ catalogId: '2', active: false, internationalDesignator: '21021B', apogeeKm: 570, perigeeKm: 530, inclinationDeg: 53.4, epoch: '2026-07-21T00:00:00.000Z' }),
      object({ catalogId: '3', name: 'OTHER', isStarlink: false }),
    ]);

    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]).toMatchObject({
      id: '2021-021',
      catalogMemberIds: ['1', '2'],
      catalogMemberCount: 2,
      activeCount: 1,
      apogeeKmRange: [560, 570],
      perigeeKmRange: [530, 540],
      inclinationDegRange: [53.2, 53.4],
      newestElementEpoch: '2026-07-21T00:00:00.000Z',
    });
  });

  it('offers a story link only while its authored story and beat remain valid', () => {
    expect(buildStarlinkLaunchCohorts([object()], [story()])[0]?.featuredStory).toEqual({
      storyId: 'starlink-buildout',
      beatId: 'deployment-train',
    });
    expect(buildStarlinkLaunchCohorts([object()], [story('renamed')])[0]?.featuredStory).toBeUndefined();
    expect(buildStarlinkLaunchCohorts([object()])[0]?.featuredStory).toBeUndefined();
  });
});
