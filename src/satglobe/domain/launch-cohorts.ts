import { normalizeLaunchCohort } from './launch-designator';
import type { LaunchCohortView, SpaceObjectView, StoryManifestV1 } from './types';

const FEATURED_COHORT_STORIES: Readonly<Record<string, Readonly<{ beatId: string; storyId: string }>>> = {
  '2021-021': { storyId: 'starlink-buildout', beatId: 'deployment-train' },
};

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
    const first = members[0]!;
    const featuredStory = validStoryLink(id, stories);

    return {
      id,
      constellation: 'starlink',
      launchDate: first.launchDate,
      launchVehicle: first.launchVehicle,
      owner: first.owner,
      country: first.country,
      catalogMemberIds: members.map(({ catalogId }) => catalogId).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      catalogMemberCount: members.length,
      activeCount: members.filter(({ active }) => active).length,
      perigeeKmRange: finiteRange(members.map(({ perigeeKm }) => perigeeKm)),
      apogeeKmRange: finiteRange(members.map(({ apogeeKm }) => apogeeKm)),
      inclinationDegRange: finiteRange(members.map(({ inclinationDeg }) => inclinationDeg)),
      newestElementEpoch: newestIso(members.map(({ epoch }) => epoch)),
      sourceLabels: [...new Set(members.map(({ source }) => source).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
      ...(featuredStory ? { featuredStory } : {}),
    };
  }).sort((a, b) => b.launchDate.localeCompare(a.launchDate) || b.id.localeCompare(a.id));
}
