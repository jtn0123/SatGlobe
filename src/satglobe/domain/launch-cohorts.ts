import { normalizeLaunchCohort } from './launch-designator';
import type { LaunchCohortView, SpaceObjectView, StoryManifestV1 } from './types';

const FEATURED_COHORT_STORIES: Readonly<Record<string, Readonly<{ beatId: string; storyId: string }>>> = {
  '2021-021': { storyId: 'starlink-buildout', beatId: 'deployment-train' },
};

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

interface CatalogConsensus {
  value: string;
  warning?: string;
}

/** Returns a finite range while ignoring catalog gaps. */
function finiteRange(values: readonly number[]): [number, number] | null {
  const finite = values.filter(Number.isFinite);

  return finite.length ? [Math.min(...finite), Math.max(...finite)] : null;
}

/** Returns the newest valid element epoch in a cohort. */
function newestIso(values: readonly string[]): string {
  const newest = values.reduce((latest, value) => {
    const epoch = new Date(value).getTime();

    return Number.isFinite(epoch) ? Math.max(latest, epoch) : latest;
  }, Number.NEGATIVE_INFINITY);

  return Number.isFinite(newest) ? new Date(newest).toISOString() : '';
}

/** Canonicalizes the two launch-date forms present in the installed catalog. */
function canonicalLaunchDate(raw: string): string {
  const value = raw.trim();
  const iso = (/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})(?:T.*)?$/u).exec(value);
  const named = (/^(?<year>\d{4}) (?<month>[A-Za-z]{3}) (?<day>\d{1,2})$/u).exec(value);
  const year = Number(iso?.groups?.year ?? named?.groups?.year);
  const month = iso
    ? Number(iso.groups?.month) - 1
    : MONTH_INDEX[named?.groups?.month.toLocaleLowerCase() ?? ''];
  const day = Number(iso?.groups?.day ?? named?.groups?.day);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return '';
  }
  const instant = new Date(Date.UTC(year, month, day));

  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month ||
    instant.getUTCDate() !== day
  ) {
    return '';
  }

  return instant.toISOString().slice(0, 10);
}

/** Chooses count-first deterministic metadata and discloses conflicting values. */
function catalogConsensus(
  values: readonly string[],
  label: string,
  normalize: (value: string) => string = (value) => value.trim(),
): CatalogConsensus {
  const counts = new Map<string, number>();

  for (const raw of values) {
    const value = normalize(raw);

    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .sort(([leftValue, leftCount], [rightValue, rightCount]) => (
      rightCount - leftCount || leftValue.localeCompare(rightValue)
    ));
  const [value = '', count = 0] = ranked[0] ?? [];

  if (ranked.length <= 1) {
    return { value };
  }
  const populatedCount = ranked.reduce((total, [, valueCount]) => total + valueCount, 0);

  return {
    value,
    warning: `${label} varies across retained catalog records; showing ${value} (${count} of ${populatedCount} populated records).`,
  };
}

/** Keeps a cohort-to-story shortcut only while both referenced manifest ids still exist. */
function validStoryLink(
  cohortId: string,
  stories: readonly StoryManifestV1[],
): LaunchCohortView['featuredStory'] {
  const candidate = FEATURED_COHORT_STORIES[cohortId];

  if (!candidate) {
    return undefined;
  }
  const story = stories.find(({ id }) => id === candidate.storyId);

  return story?.beats.some(({ id }) => id === candidate.beatId) ? candidate : undefined;
}

/** Builds factual summaries from Starlink objects retained in the installed catalog. */
export function buildStarlinkLaunchCohorts(
  objects: readonly SpaceObjectView[],
  stories: readonly StoryManifestV1[] = [],
): LaunchCohortView[] {
  const groups = new Map<string, SpaceObjectView[]>();

  for (const object of objects) {
    const id = normalizeLaunchCohort(object.internationalDesignator);

    if (!object.isStarlink || !id) {
      continue;
    }
    const members = groups.get(id);

    if (members) {
      members.push(object);
    } else {
      groups.set(id, [object]);
    }
  }

  return [...groups.entries()].map(([id, members]): LaunchCohortView => {
    const featuredStory = validStoryLink(id, stories);
    const launchDate = catalogConsensus(members.map(({ launchDate: value }) => value), 'Launch date', canonicalLaunchDate);
    const launchVehicle = catalogConsensus(members.map(({ launchVehicle: value }) => value), 'Launch vehicle');
    const owner = catalogConsensus(members.map(({ owner: value }) => value), 'Owner');
    const country = catalogConsensus(members.map(({ country: value }) => value), 'Country');
    const catalogMetadataWarning = [
      launchDate.warning,
      launchVehicle.warning,
      owner.warning,
      country.warning,
    ].filter((warning): warning is string => Boolean(warning)).join(' ');

    return {
      id,
      constellation: 'starlink',
      launchDate: launchDate.value,
      launchVehicle: launchVehicle.value,
      owner: owner.value,
      country: country.value,
      catalogMemberIds: members.map(({ catalogId }) => catalogId).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      catalogMemberCount: members.length,
      activeCount: members.filter(({ active }) => active).length,
      perigeeKmRange: finiteRange(members.map(({ perigeeKm }) => perigeeKm)),
      apogeeKmRange: finiteRange(members.map(({ apogeeKm }) => apogeeKm)),
      inclinationDegRange: finiteRange(members.map(({ inclinationDeg }) => inclinationDeg)),
      newestElementEpoch: newestIso(members.map(({ epoch }) => epoch)),
      sourceLabels: [...new Set(members.map(({ source }) => source).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
      ...(catalogMetadataWarning ? { catalogMetadataWarning } : {}),
      ...(featuredStory ? { featuredStory } : {}),
    };
  }).sort((a, b) => b.launchDate.localeCompare(a.launchDate) || b.id.localeCompare(a.id));
}
