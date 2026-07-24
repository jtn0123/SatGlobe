import { useCallback, useMemo, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { buildVisualLegend } from '../domain/encodings';
import { buildStarlinkLaunchCohorts } from '../domain/launch-cohorts';
import {
  DEFAULT_FILTERS,
  type EngineState,
  type FilterState,
  type LaunchCohortView,
  type StoryManifestV1,
  type VisualEncoding,
} from '../domain/types';

interface LaunchCohortExplorerOptions {
  adapter: SatGlobeEngineAdapter;
  engine: EngineState;
  filters: FilterState;
  stories: readonly StoryManifestV1[];
  onNotice: (notice: string) => void;
  onOpenStory: (cohort: LaunchCohortView) => void;
  setFiltersWithEncodingImmediate: (filters: FilterState, encoding: VisualEncoding) => void;
}

/** Owns transient cohort browsing while leaving portable SavedViewV1 state unchanged. */
export function useLaunchCohortExplorer({
  adapter,
  engine,
  filters,
  stories,
  onNotice,
  onOpenStory,
  setFiltersWithEncodingImmediate,
}: LaunchCohortExplorerOptions) {
  const [selectedCohortId, setSelectedCohortId] = useState<string>();
  const cohorts = useMemo(
    () => buildStarlinkLaunchCohorts(adapter.getObjects(), stories),
    [adapter, engine.objectCount, stories],
  );
  const legend = useMemo(
    () => buildVisualLegend(
      engine.encoding,
      adapter.getObjects(),
      filters,
      engine.conjunctionHighlightActive,
      engine.highlightedObjectCount,
    ),
    [adapter, engine.conjunctionHighlightActive, engine.encoding, engine.highlightedObjectCount, engine.objectCount, filters],
  );
  const select = useCallback((cohort: LaunchCohortView) => setSelectedCohortId(cohort.id), []);
  const clearSelection = useCallback(() => setSelectedCohortId(undefined), []);
  const openMembers = useCallback((cohort: LaunchCohortView) => {
    setSelectedCohortId(cohort.id);
    setFiltersWithEncodingImmediate({
      ...structuredClone(DEFAULT_FILTERS),
      status: 'all',
      constellation: 'starlink',
      launchCohort: cohort.id,
    }, 'launch-cohort');
    onNotice(`${cohort.id}: showing ${cohort.catalogMemberCount.toLocaleString()} objects retained in this catalog snapshot.`);
  }, [onNotice, setFiltersWithEncodingImmediate]);

  return {
    clearSelection,
    cohorts,
    legend,
    openMembers,
    openStory: onOpenStory,
    select,
    selectedCohortId,
  };
}
