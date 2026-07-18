import { useCallback, useMemo } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { launchYearBounds, type LaunchYearBounds } from '../domain/launch-years';
import { DEFAULT_FILTERS, type FilterState, type VisualEncoding } from '../domain/types';
import { LAUNCH_TIMELAPSE_APPLY_MEASURE, measureSync } from '../runtime/performance-measure';

/** Builds one cumulative launch-history visual update from the installed catalog. */
export function useLaunchTimelapse(
  adapter: SatGlobeEngineAdapter,
  setFiltersWithEncodingImmediate: (filters: FilterState, encoding: VisualEncoding) => void,
): { launchBounds: LaunchYearBounds | null; applyLaunchYear: (year: number) => void } {
  const catalogObjects = adapter.getObjects();
  const launchBounds = useMemo(() => launchYearBounds(catalogObjects), [catalogObjects]);
  const applyLaunchYear = useCallback((year: number) => {
    const next: FilterState = {
      ...structuredClone(DEFAULT_FILTERS),
      objectKinds: ['payload', 'rocket-body', 'debris', 'other'],
      status: 'all',
      launchYearMax: year,
    };

    measureSync(LAUNCH_TIMELAPSE_APPLY_MEASURE, { year }, () => {
      setFiltersWithEncodingImmediate(next, 'launch-cohort');
    });
  }, [setFiltersWithEncodingImmediate]);

  return { launchBounds, applyLaunchYear };
}
