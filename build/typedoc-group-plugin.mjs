/**
 * Local TypeDoc plugin that renames file-level modules to their directory path,
 * so typedoc-plugin-merge-modules can merge files from the same directory into
 * a single module. Produces a two-level hierarchy: Section / Subdirectory.
 */
import { Converter, ReflectionKind } from 'typedoc';

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, (_context, reflection) => {
    if (reflection.kind !== ReflectionKind.Module) {
      return;
    }

    const source = reflection.sources?.[0];

    if (!source?.fullFileName) {
      return;
    }

    const normalized = source.fullFileName.replaceAll('\\', '/');
    const srcMatch = normalized.match(/\/src\/(.+)$/u);

    if (!srcMatch) {
      return;
    }

    const relative = srcMatch[1]; // e.g. "engine/camera/camera.ts"
    const segments = relative.split('/');

    // Files directly in src/ (keeptrack.ts, main.ts, etc.)
    if (segments.length === 1) {
      reflection.name = 'Root';

      return;
    }

    const section = titleCase(segments[0]);

    // Files directly in a section dir: src/engine/engine.ts → "Engine"
    if (segments.length === 2) {
      reflection.name = section;

      return;
    }

    // Files in a subdirectory: src/engine/camera/camera.ts → "Engine / Camera"
    const subdir = titleCase(segments[1]);

    reflection.name = `${section} / ${subdir}`;
  });
}

/**
 * Convert kebab-case directory name to TitleCase.
 * "filter-menu" → "FilterMenu", "plugins-pro" → "PluginsPro"
 */
function titleCase(str) {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}
