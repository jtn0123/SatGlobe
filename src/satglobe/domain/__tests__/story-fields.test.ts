import { describe, expect, it } from 'vitest';
import { storyManifestV1Schema } from '../schemas';
import { starlinkBuildoutStory } from '../../stories/starlink-buildout';

describe('optional story beat controls', () => {
  it('accepts strict launch-cohort and relative simulation-time fields', () => {
    const story = structuredClone(starlinkBuildoutStory);

    story.beats[0].launchCohort = '2024-001';
    story.beats[0].simulationTimeOffsetHours = 0;
    story.beats[0].orbitCatalogId = '25544';
    story.beats[0].orbitCatalogIds = ['64202', '67588'];

    const parsed = storyManifestV1Schema.parse(story);

    expect(parsed.beats[0].launchCohort).toBe('2024-001');
    expect(parsed.beats[0].simulationTimeOffsetHours).toBe(0);
    expect(parsed.beats[0].orbitCatalogId).toBe('25544');
    expect(parsed.beats[0].orbitCatalogIds).toEqual(['64202', '67588']);
  });

  it.each(['2024-001', '2024-'])('accepts canonical authored launch cohort %s', (launchCohort) => {
    const story = structuredClone(starlinkBuildoutStory);

    story.beats[0].launchCohort = launchCohort;

    expect(storyManifestV1Schema.parse(story).beats[0].launchCohort).toBe(launchCohort);
  });

  it.each(['', ' ', '\t'])('rejects blank authored constellation %j', (constellation) => {
    const story = structuredClone(starlinkBuildoutStory);

    story.beats[0].constellation = constellation;

    expect(storyManifestV1Schema.safeParse(story).success).toBe(false);
  });

  it.each(['2024', '24-001', '2024-1', '2024-0001', '2024-001A', ' 2024-001'])('rejects malformed authored launch cohort %j', (launchCohort) => {
    const story = structuredClone(starlinkBuildoutStory);

    story.beats[0].launchCohort = launchCohort;

    expect(storyManifestV1Schema.safeParse(story).success).toBe(false);
  });

  it('rejects offsets outside the authored-story range and oversized cohort filters', () => {
    const invalidOffset = structuredClone(starlinkBuildoutStory);
    const invalidCohort = structuredClone(starlinkBuildoutStory);
    const invalidConstellation = structuredClone(starlinkBuildoutStory);
    const invalidOrbitId = structuredClone(starlinkBuildoutStory);

    invalidOffset.beats[0].simulationTimeOffsetHours = Number.MAX_VALUE;
    invalidCohort.beats[0].launchCohort = 'x'.repeat(121);
    invalidConstellation.beats[0].constellation = 'x'.repeat(121);
    invalidOrbitId.beats[0].orbitCatalogId = '../25544';

    expect(storyManifestV1Schema.safeParse(invalidOffset).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(invalidCohort).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(invalidConstellation).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(invalidOrbitId).success).toBe(false);
  });

  it('requires a bounded, nonempty, unique list of strict numeric orbit cue ids', () => {
    const empty = structuredClone(starlinkBuildoutStory);
    const duplicate = structuredClone(starlinkBuildoutStory);
    const oversized = structuredClone(starlinkBuildoutStory);
    const unsafe = structuredClone(starlinkBuildoutStory);

    empty.beats[0].orbitCatalogIds = [];
    duplicate.beats[0].orbitCatalogIds = ['64202', '64202'];
    oversized.beats[0].orbitCatalogIds = Array.from({ length: 13 }, (_, index) => String(60_000 + index));
    unsafe.beats[0].orbitCatalogIds = ['64202', '../67588'];

    expect(storyManifestV1Schema.safeParse(empty).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(duplicate).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(oversized).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(unsafe).success).toBe(false);
  });

  it('bounds the filter-matched orbit cue limit to a small whole number', () => {
    const story = structuredClone(starlinkBuildoutStory);

    story.beats[0].orbitMatchLimit = 1;
    expect(storyManifestV1Schema.parse(story).beats[0].orbitMatchLimit).toBe(1);
    story.beats[0].orbitMatchLimit = 8;
    expect(storyManifestV1Schema.parse(story).beats[0].orbitMatchLimit).toBe(8);

    for (const orbitMatchLimit of [0, 9, 2.5, -1]) {
      story.beats[0].orbitMatchLimit = orbitMatchLimit;
      expect(storyManifestV1Schema.safeParse(story).success).toBe(false);
    }
  });

  it('rejects path-unsafe story, source, fact, and beat ids', () => {
    const invalidStory = structuredClone(starlinkBuildoutStory);
    const invalidSource = structuredClone(starlinkBuildoutStory);
    const invalidFact = structuredClone(starlinkBuildoutStory);
    const invalidBeat = structuredClone(starlinkBuildoutStory);

    invalidStory.id = '../story';
    invalidSource.sources[0].id = 'source/escape';
    invalidFact.facts[0].id = 'Fact With Spaces';
    invalidBeat.beats[0].id = '..';

    expect(storyManifestV1Schema.safeParse(invalidStory).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(invalidSource).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(invalidFact).success).toBe(false);
    expect(storyManifestV1Schema.safeParse(invalidBeat).success).toBe(false);
  });

  it.each(['sources', 'facts', 'beats'] as const)('rejects duplicate %s ids inside one manifest', (collection) => {
    const story = structuredClone(starlinkBuildoutStory);
    const duplicate = structuredClone(story[collection][0]);

    story[collection].push(duplicate as never);

    expect(storyManifestV1Schema.safeParse(story).success).toBe(false);
  });

  it('leaves legacy manifests byte-equivalent when every new optional field is absent', () => {
    const legacy = {
      schemaVersion: 1,
      id: 'legacy-story',
      title: 'Legacy story',
      dek: 'A raw pre-extension manifest fixture.',
      reconstructionPolicy: 'observed',
      facts: [
        {
          id: 'legacy-fact',
          text: 'A legacy fact.',
          sourceIds: ['legacy-source'],
        },
      ],
      beats: [
        {
          id: 'legacy-beat',
          eyebrow: '01 / LEGACY',
          title: 'Legacy beat',
          dateLabel: 'Installed catalog',
          narration: 'A beat authored before the optional fields existed.',
          factIds: ['legacy-fact'],
          durationMs: 10_000,
          camera: { pitch: 0.1, yaw: 0.2, zoom: 0.5 },
          encoding: 'object-type',
          reconstruction: 'observed',
          scaleMode: 'semantic',
        },
      ],
      sources: [
        {
          id: 'legacy-source',
          title: 'Legacy source',
          url: 'https://example.test/legacy',
          retrievedAt: '2026-07-17',
          publisher: 'Example publisher',
        },
      ],
    };
    const parsed = storyManifestV1Schema.parse(legacy);
    const optionalFields = ['launchCohort', 'simulationTimeOffsetHours', 'orbitCatalogId', 'orbitCatalogIds', 'orbitMatchLimit'] as const;

    expect(JSON.stringify(parsed)).toBe(JSON.stringify(legacy));
    expect(parsed.beats.every((beat) => optionalFields.every((field) => !Object.hasOwn(beat, field)))).toBe(true);
  });
});
