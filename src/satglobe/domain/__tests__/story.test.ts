import { describe, expect, it } from 'vitest';
import { storyManifestV1Schema } from '../schemas';
import { starlinkBuildoutStory } from '../../stories/starlink-buildout';
import { storyLibrary } from '../../stories';

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
  it('every story parses, has unique ids, and ends on the installed catalog', () => {
    expect(storyLibrary.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(storyLibrary.map(({ id }) => id));

    expect(ids.size).toBe(storyLibrary.length);
    for (const story of storyLibrary) {
      expect(storyManifestV1Schema.parse(story)).toBeTruthy();
      expect(story.beats.at(-1)?.reconstruction).toBe('observed');
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
});
