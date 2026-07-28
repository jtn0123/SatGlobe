import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { GraphicsSettings } from '@app/settings/graphics-settings';
import { SettingsManager } from '@app/settings/settings';
import { describe, expect, it } from 'vitest';

const configRoot = path.join(process.cwd(), 'configs');

/** Reads one profile override as source so the executable JS stays the contract. */
function profileOverride(profile: string): string {
  return readFileSync(path.join(configRoot, profile, 'settingsOverride.js'), 'utf8');
}

describe('snapshot profile settings', () => {
  it('maps the compatibility property to GraphicsSettings', () => {
    const settings = new SettingsManager();

    expect(new GraphicsSettings().isPreserveDrawingBuffer).toBe(true);
    expect(settings.isPreserveDrawingBuffer).toBe(true);

    settings.isPreserveDrawingBuffer = false;

    expect(settings.graphics.isPreserveDrawingBuffer).toBe(false);
  });

  it('opts SatGlobe out without changing the global or unrelated profile defaults', () => {
    expect(profileOverride('satglobe')).toMatch(/\bisPreserveDrawingBuffer:\s*false\b/u);
    expect(profileOverride('companion')).toMatch(/\bisPreserveDrawingBuffer:\s*false\b/u);

    const unrelatedProfiles = readdirSync(configRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !['satglobe', 'companion'].includes(entry.name))
      .map((entry) => entry.name)
      .filter((profile) => {
        try {
          profileOverride(profile);

          return true;
        } catch {
          return false;
        }
      });

    for (const profile of unrelatedProfiles) {
      expect(profileOverride(profile), profile).not.toContain('isPreserveDrawingBuffer');
    }
  });
});
