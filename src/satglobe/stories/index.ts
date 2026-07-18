import type { StoryManifestV1 } from '../domain/types';
import { starlinkBuildoutStory } from './starlink-buildout';
import { gpsConstellationStory } from './gps-constellation';
import { cosmosIridiumStory } from './cosmos-iridium';
import { geoBeltStory } from './geo-belt';

/**
 * The story library, in presentation order. Every manifest is validated at
 * module evaluation (each story file parses itself through the zod schema),
 * so an invalid story fails the build and tests rather than the viewer.
 */
export const storyLibrary: readonly StoryManifestV1[] = [
  starlinkBuildoutStory,
  gpsConstellationStory,
  cosmosIridiumStory,
  geoBeltStory,
];
