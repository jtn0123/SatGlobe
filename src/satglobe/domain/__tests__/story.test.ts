import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { storyManifestV1Schema } from '../schemas';
import { cosmosIridiumStory } from '../../stories/cosmos-iridium';
import { starlinkBuildoutStory } from '../../stories/starlink-buildout';
import { storyLibrary } from '../../stories';

interface InstalledCatalogRow {
  name?: string;
  status?: string;
  tle1: string;
  tle2: string;
  type?: number;
}

let installedCatalog: InstalledCatalogRow[];

beforeAll(async () => {
  const raw = await readFile(path.join(process.cwd(), 'public', 'tle', 'tle.json'), 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Installed SatGlobe catalog must be an array.');
  }
  installedCatalog = parsed as InstalledCatalogRow[];
});

/** Reads the numeric NORAD id from the fixed-width first TLE line. */
function catalogId(row: InstalledCatalogRow): string {
  return row.tle1.slice(2, 7).trim();
}

/** Reads right ascension of the ascending node from the fixed-width second TLE line. */
function ascendingNodeDegrees(row: InstalledCatalogRow): number {
  return Number(row.tle2.slice(17, 25));
}

/** Reads the orbital period from the TLE mean motion. */
function orbitalPeriodMinutes(row: InstalledCatalogRow): number {
  return 1_440 / Number(row.tle2.slice(52, 63));
}

/** Mirrors the catalog payload statuses accepted by SatGlobe's active filter. */
function isActivePayload(row: InstalledCatalogRow): boolean {
  return row.type === 1 && ['+', 'P', 'B', 'S', 'X'].includes(row.status ?? '');
}

describe('Starlink buildout story', () => {
  it('is a complete, sourced five-beat manifest', () => {
    expect(storyManifestV1Schema.parse(starlinkBuildoutStory)).toBeTruthy();
    expect(starlinkBuildoutStory.beats).toHaveLength(5);
    expect(starlinkBuildoutStory.beats.some(({ reconstruction }) => reconstruction === 'reconstructed')).toBe(true);
    expect(starlinkBuildoutStory.beats.at(-1)?.reconstruction).toBe('observed');
  });

  it('fails when a beat cites a missing fact', () => {
    const invalid = structuredClone(starlinkBuildoutStory);

    invalid.beats[0].factIds = ['not-a-fact'];
    expect(storyManifestV1Schema.safeParse(invalid).success).toBe(false);
  });
});

describe('story library', () => {
  it('ships ten parsed stories with unique ids and observed endings', () => {
    expect(storyLibrary).toHaveLength(10);
    expect(new Set(storyLibrary.map(({ id }) => id)).size).toBe(storyLibrary.length);

    for (const story of storyLibrary) {
      expect(storyManifestV1Schema.parse(story)).toBeTruthy();
      expect(story.beats.at(-1)?.reconstruction).toBe('observed');
    }
  });

  it('ships Wave 3 as two sourced six-beat stories', () => {
    const wave3 = storyLibrary.filter(({ id }) => ['gnss-families', 'landsat-continuity'].includes(id));

    expect(wave3.map(({ id }) => id)).toEqual(['gnss-families', 'landsat-continuity']);
    for (const story of wave3) {
      expect(story.beats).toHaveLength(6);
      expect(story.beats.at(-1)?.reconstruction).toBe('observed');
      expect(story.sources.every(({ retrievedAt, url }) => retrievedAt === '2026-07-18' && url.startsWith('https://'))).toBe(true);
    }
  });

  it('keeps source, fact, and beat ids unique within every story', () => {
    for (const story of storyLibrary) {
      const nestedIds = [
        ['source', story.sources.map(({ id }) => id)],
        ['fact', story.facts.map(({ id }) => id)],
        ['beat', story.beats.map(({ id }) => id)],
      ] as const;

      for (const [kind, ids] of nestedIds) {
        expect(new Set(ids).size, `${story.id} has a duplicate ${kind} id`).toBe(ids.length);
        for (const id of ids) {
          expect(id, `${story.id} has an unsafe ${kind} id`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        }
      }
    }
  });

  it('per-beat filter overrides stay within the schema whitelist', () => {
    const overriding = storyLibrary.flatMap(({ beats }) => beats).filter((beat) => beat.filterOverrides);

    expect(overriding.length).toBeGreaterThan(0);
    for (const beat of overriding) {
      for (const key of Object.keys(beat.filterOverrides!)) {
        expect(['objectKinds', 'status', 'regimes']).toContain(key);
      }
    }
  });

  it('keeps current-population story claims aligned with their visual filters', () => {
    const story = (id: string) => storyLibrary.find((candidate) => candidate.id === id)!;
    const beat = (storyId: string, beatId: string) => story(storyId).beats.find((candidate) => candidate.id === beatId)!;

    expect(beat('starlink-buildout', 'deployment-train')).toMatchObject({
      launchCohort: '2021-021',
      reconstruction: 'observed',
    });
    expect(beat('starlink-buildout', 'present-scale')).toMatchObject({
      encoding: 'data-age',
      reconstruction: 'observed',
    });
    expect(beat('one-day-in-orbit', 'one-low-orbit').constellation).toBeUndefined();
    expect(beat('one-day-in-orbit', 'one-low-orbit')).toMatchObject({
      encoding: 'orbit-regime',
      filterOverrides: { regimes: ['leo'] },
    });

    for (const beatId of ['six-planes-beat', 'two-orbits-a-day', 'gps-present']) {
      expect(beat('gps-constellation', beatId).filterOverrides?.status).toBe('active');
    }
    const gpsPlanes = beat('gps-constellation', 'six-planes-beat');
    const gpsPeriod = beat('gps-constellation', 'two-orbits-a-day');

    expect(gpsPlanes.orbitCatalogIds).toEqual(['64202', '67588', '55268', '68791', '40730', '62339']);
    expect(gpsPlanes.narration).toContain('representative paths from the installed catalog');
    expect(gpsPlanes.narration).toContain('dots alone do not prove');
    expect(gpsPeriod.orbitCatalogId).toBe('64202');
    expect(gpsPeriod.narration).toContain('source gives');
    expect(gpsPeriod.narration).toContain('static propagated path');
    const launchNonPayloads = beat('launch-to-orbit', 'one-launch-many-records');

    expect(launchNonPayloads.filterOverrides?.objectKinds).toEqual(['rocket-body', 'debris']);
    expect(launchNonPayloads.narration).toContain('count comes from the installed catalog rather than visual identification');
    for (const beatId of ['standing-still', 'why-it-matters', 'geo-present']) {
      expect(beat('geo-belt', beatId).filterOverrides?.status).toBe('active');
    }
  });

  it('keeps the authored 2026-027 composition aligned with the installed catalog', () => {
    const cohort = installedCatalog.filter((row) => row.tle1.slice(9, 14) === '26027');
    const kindByType: Record<number, string> = { 1: 'payload', 2: 'rocket-body', 3: 'debris' };
    const typeCounts = cohort.reduce((counts, row) => {
      const key = kindByType[row.type ?? -1] ?? 'other';

      counts[key] = (counts[key] ?? 0) + 1;

      return counts;
    }, {} as Record<string, number>);

    expect(cohort).toHaveLength(9);
    expect(typeCounts).toEqual({ payload: 7, 'rocket-body': 1, debris: 1 });
  });

  it('keeps every authored GPS orbit cue installed, active, and in a distinct plane', () => {
    const gpsBeat = storyLibrary
      .find(({ id }) => id === 'gps-constellation')!
      .beats.find(({ id }) => id === 'six-planes-beat')!;
    const rowsById = new Map(installedCatalog.map((row) => [catalogId(row), row]));
    const orbitRows = gpsBeat.orbitCatalogIds?.map((id) => rowsById.get(id)) ?? [];

    expect(orbitRows).toHaveLength(6);
    expect(orbitRows.every((row) => row !== undefined)).toBe(true);
    const installedRows = orbitRows.filter((row): row is InstalledCatalogRow => row !== undefined);

    expect(installedRows.every(({ name }) => name?.startsWith('NAVSTAR '))).toBe(true);
    expect(installedRows.every(({ status, type }) => status === '+' && type === 1)).toBe(true);
    const ascendingNodes = installedRows.map(ascendingNodeDegrees).sort((left, right) => left - right);
    const circularGaps = ascendingNodes.map((node, index) => {
      const next = ascendingNodes[(index + 1) % ascendingNodes.length] + (index === ascendingNodes.length - 1 ? 360 : 0);

      return next - node;
    });

    expect(ascendingNodes.every(Number.isFinite)).toBe(true);
    expect(Math.min(...circularGaps)).toBeGreaterThan(45);
    expect(Math.max(...circularGaps)).toBeLessThan(75);
  });

  it('keeps every Wave 3 subject filter and orbit cue aligned with the installed catalog', () => {
    const rowsById = new Map(installedCatalog.map((row) => [catalogId(row), row]));
    const wave3 = storyLibrary.filter(({ id }) => ['gnss-families', 'landsat-continuity'].includes(id));

    for (const story of wave3) {
      for (const beat of story.beats) {
        const matchingRows = beat.constellation
          ? installedCatalog.filter(({ name }) => name?.toLocaleLowerCase().includes(beat.constellation!))
          : [];

        if (beat.constellation) {
          const statusRows = beat.filterOverrides?.status === 'active'
            ? matchingRows.filter(isActivePayload)
            : matchingRows;

          expect(statusRows.length, `${story.id}/${beat.id} has no installed subject`).toBeGreaterThan(0);
        }

        const ids = [...(beat.orbitCatalogId ? [beat.orbitCatalogId] : []), ...(beat.orbitCatalogIds ?? [])];

        for (const id of ids) {
          const row = rowsById.get(id);

          expect(row, `${story.id}/${beat.id} is missing catalog ${id}`).toBeDefined();
          if (beat.constellation) {
            expect(row?.name?.toLocaleLowerCase()).toContain(beat.constellation);
          }
          if (beat.filterOverrides?.status === 'active') {
            expect(isActivePayload(row!), `${story.id}/${beat.id} uses inactive catalog ${id}`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps the GNSS plane and hybrid-orbit cues physically distinct', () => {
    const rowsById = new Map(installedCatalog.map((row) => [catalogId(row), row]));
    const story = storyLibrary.find(({ id }) => id === 'gnss-families')!;
    const beat = (id: string) => story.beats.find((candidate) => candidate.id === id)!;
    const installedRows = (ids: readonly string[]) => ids.map((id) => rowsById.get(id)!);
    const circularGaps = (rows: readonly InstalledCatalogRow[]) => {
      const nodes = rows.map(ascendingNodeDegrees).sort((left, right) => left - right);

      return nodes.map((node, index) => {
        const next = nodes[(index + 1) % nodes.length] + (index === nodes.length - 1 ? 360 : 0);

        return next - node;
      });
    };
    const glonass = installedRows(beat('glonass-three-planes').orbitCatalogIds!);
    const galileo = installedRows(beat('galileo-three-planes').orbitCatalogIds!);

    for (const familyRows of [glonass, galileo]) {
      const gaps = circularGaps(familyRows);

      expect(Math.min(...gaps)).toBeGreaterThan(110);
      expect(Math.max(...gaps)).toBeLessThan(130);
    }

    const [beidouMeo, beidouIgso, beidouGeo] = installedRows(beat('beidou-hybrid').orbitCatalogIds!);

    expect(orbitalPeriodMinutes(beidouMeo)).toBeLessThan(1_000);
    expect(orbitalPeriodMinutes(beidouIgso)).toBeGreaterThan(1_200);
    expect(orbitalPeriodMinutes(beidouGeo)).toBeGreaterThan(1_200);
    expect(Number(beidouIgso.tle2.slice(8, 16))).toBeGreaterThan(45);
    expect(Number(beidouGeo.tle2.slice(8, 16))).toBeLessThan(5);
  });

  it('keeps Landsat history separate from the two active installed records', () => {
    const story = storyLibrary.find(({ id }) => id === 'landsat-continuity')!;
    const finalBeat = story.beats.at(-1)!;
    const landsatRows = installedCatalog.filter(({ name }) => name?.startsWith('LANDSAT '));
    const activeIds = landsatRows.filter(isActivePayload).map(catalogId);

    expect(landsatRows.map(catalogId)).toEqual(['6126', '7615', '10702', '14780', '25682', '39084', '49260']);
    expect(activeIds).toEqual(['39084', '49260']);
    expect(finalBeat).toMatchObject({
      constellation: 'landsat',
      encoding: 'data-age',
      filterOverrides: { objectKinds: ['payload'], status: 'active', regimes: ['leo'] },
      orbitCatalogIds: ['39084', '49260'],
      reconstruction: 'observed',
    });
  });

  it('rejects unknown fields at every authored manifest layer', () => {
    const topLevel = { ...starlinkBuildoutStory, unexpected: true };
    const source = structuredClone(starlinkBuildoutStory);
    const fact = structuredClone(starlinkBuildoutStory);
    const beat = structuredClone(starlinkBuildoutStory);
    const camera = structuredClone(starlinkBuildoutStory);
    const filterOverrides = structuredClone(cosmosIridiumStory);

    Object.assign(source.sources[0], { unexpected: true });
    Object.assign(fact.facts[0], { unexpected: true });
    Object.assign(beat.beats[0], { unexpected: true });
    Object.assign(camera.beats[0].camera, { unexpected: true });
    Object.assign(filterOverrides.beats[0].filterOverrides!, { altitudeKm: { min: 0, max: 1 } });

    for (const manifest of [topLevel, source, fact, beat, camera, filterOverrides]) {
      expect(storyManifestV1Schema.safeParse(manifest).success).toBe(false);
    }
  });
});
