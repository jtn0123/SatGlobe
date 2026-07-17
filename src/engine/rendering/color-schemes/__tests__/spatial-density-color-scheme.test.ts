

import { SpatialDensityColorScheme } from '@app/engine/rendering/color-schemes/spatial-density-color-scheme';
import { vi } from 'vitest';

// Mock dependencies
vi.mock('@app/keepTrackApi', () => ({keepTrackApi: {html: (strings: TemplateStringsArray) => strings[0],
    getSpatialDensityManager: () => ({getDensityForObject: (obj: any) => obj.mockDensity ?? 0.5 }) } }));

vi.mock('@app/settings/settings', () => ({settingsManager: {colors: {transparent: [0, 0, 0, 0],
      deselected: [0.1, 0.1, 0.1, 0.5] } } }));

describe('SpatialDensityColorScheme', () => {
  let colorScheme: SpatialDensityColorScheme;

  beforeEach(() => {
    colorScheme = new SpatialDensityColorScheme();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with correct label and id', () => {
      expect(colorScheme.label).toBe('Spatial Density');
      expect(colorScheme.id).toBe('SpatialDensityColorScheme');
      expect(SpatialDensityColorScheme.id).toBe('SpatialDensityColorScheme');
    });

    it('should initialize color theme', () => {
      expect(colorScheme.colorTheme.spatialDensityLow).toBeDefined();
      expect(colorScheme.colorTheme.spatialDensityHi).toBeDefined();
    });
  });

});
