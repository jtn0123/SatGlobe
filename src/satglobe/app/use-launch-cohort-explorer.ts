import { useCallback, useMemo, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { buildVisualLegend, withConjunctionHighlight } from '../domain/encodings';
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
  const objects = adapter.getObjects();
  const cohorts = useMemo(
    () => buildStarlinkLaunchCohorts(objects, stories),
    [objects, stories],
  );
  const baseLegend = useMemo(
    () => buildVisualLegend(engine.encoding, objects, filters),
    [engine.encoding, filters, objects],
  );
  const legend = useMemo(
    () => withConjunctionHighlight(
      baseLegend,
      engine.conjunctionHighlightActive,
      engine.highlightedObjectCount,
    ),
    [baseLegend, engine.conjunctionHighlightActive, engine.highlightedObjectCount],
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
