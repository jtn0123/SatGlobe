import { ZodError } from 'zod';
import { savedViewV1Schema } from './schemas';
import type { SavedViewV1, SpaceObjectView } from './types';

export interface SavedViewImportResult {
  view: SavedViewV1;
  warnings: string[];
}

/** Serializes a strict versioned view without catalog or executable content. */
export function serializeSavedView(view: SavedViewV1): string {
  return `${JSON.stringify(savedViewV1Schema.parse(view), null, 2)}\n`;
}

/** Validates a portable view before returning any state that can be applied. */
export function importSavedView(raw: string, catalog: readonly SpaceObjectView[]): SavedViewImportResult {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('This preset is not valid JSON. No application state was changed.');
  }

  if (typeof decoded !== 'object' || decoded === null || !('schemaVersion' in decoded)) {
    throw new Error('This preset does not declare a schema version.');
  }
  if ((decoded as { schemaVersion: unknown }).schemaVersion !== 1) {
    throw new Error(`Preset schema version ${(decoded as { schemaVersion: unknown }).schemaVersion as string} is not supported.`);
  }

  let view: SavedViewV1;

  try {
    view = savedViewV1Schema.parse(decoded);
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const location = issue?.path.length ? issue.path.join('.') : 'preset';

      throw new Error(`This preset is invalid at ${location}: ${issue?.message ?? 'schema validation failed'}. No application state was changed.`);
    }
    throw error;
  }
  const catalogIds = new Set(catalog.map(({ catalogId }) => catalogId));
  const missing = view.selectedObjectIds.filter((id) => !catalogIds.has(id));

  return {
    view: { ...view, selectedObjectIds: view.selectedObjectIds.filter((id) => catalogIds.has(id)) },
    warnings: missing.length === 0 ? [] : [`${missing.length} selected object${missing.length === 1 ? '' : 's'} are absent from this catalog: ${missing.slice(0, 8).join(', ')}`],
  };
}

/** Downloads a validated view through a short-lived local object URL. */
export function downloadSavedView(view: SavedViewV1): void {
  const blob = new Blob([serializeSavedView(view)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `${view.name.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/(?:^-|-$)/gu, '') || 'satglobe-view'}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
