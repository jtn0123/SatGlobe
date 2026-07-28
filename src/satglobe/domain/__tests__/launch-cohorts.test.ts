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

  it('uses majority catalog metadata and discloses conflicting member values', () => {
    const cohort = buildStarlinkLaunchCohorts([
      object({
        catalogId: '10',
        internationalDesignator: '2025-243A',
        launchDate: '2025 Dec 12',
        launchVehicle: 'Chang Zheng 3B',
      }),
      object({
        catalogId: '11',
        internationalDesignator: '2025-243B',
        launchDate: '2025-12-12T00:00:00.000Z',
      }),
      object({
        catalogId: '12',
        internationalDesignator: '2025-243C',
        launchDate: '2025-12-12',
      }),
    ])[0]!;

    expect(cohort.launchDate).toBe('2025-12-12');
    expect(cohort.launchVehicle).toBe('Falcon 9');
    expect(cohort.catalogMetadataWarning).toContain('Launch vehicle varies');
    expect(cohort.catalogMetadataWarning).toContain('Falcon 9 (2 of 3 populated records)');
  });

  it('sorts mixed-format launch dates by calendar chronology', () => {
    const cohorts = buildStarlinkLaunchCohorts([
      object({ catalogId: '20', internationalDesignator: '2026-001A', launchDate: '2026 Jan 9' }),
      object({ catalogId: '21', internationalDesignator: '2026-002A', launchDate: '2026 Jan 30' }),
      object({ catalogId: '22', internationalDesignator: '2026-003A', launchDate: '2026 Feb 7' }),
    ]);

    expect(cohorts.map(({ id }) => id)).toEqual(['2026-003', '2026-002', '2026-001']);
    expect(cohorts.map(({ launchDate }) => launchDate)).toEqual(['2026-02-07', '2026-01-30', '2026-01-09']);
  });
});
