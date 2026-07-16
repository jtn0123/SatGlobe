import { describe, expect, it } from 'vitest';
import { storyManifestV1Schema } from '../schemas';
import { starlinkBuildoutStory } from '../../stories/starlink-buildout';

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
