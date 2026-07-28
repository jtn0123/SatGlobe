import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { DEFAULT_FILTERS, type FilterState, type VisualEncoding } from '../domain/types';

/**
 * Owns workshop filter state. Controls mirror committed engine changes through
 * transition work, while callers choose whether the corresponding engine
 * recolor happens now or is coalesced to the trailing value of a slider drag.
 */
export function useWorkshopFilters(adapter: SatGlobeEngineAdapter): {
  filters: FilterState;
  setFiltersImmediate: (next: FilterState) => void;
  setFiltersWithEncodingImmediate: (next: FilterState, encoding: VisualEncoding) => void;
  setFiltersDebounced: (next: FilterState) => void;
} {
  const [filters, setFiltersState] = useState<FilterState>(structuredClone(DEFAULT_FILTERS));
  const pending = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
  }, []);

  const setFiltersImmediate = useCallback((next: FilterState) => {
    cancelPending();
    // The engine transaction can consume most of one frame on the full
    // catalog. Publish its React mirror as transition work so renderer and UI
    // reconciliation cannot combine into one browser long task.
    startTransition(() => setFiltersState(next));
    adapter.setFilters(next);
  }, [adapter, cancelPending]);

  const setFiltersWithEncodingImmediate = useCallback((next: FilterState, encoding: VisualEncoding) => {
    cancelPending();
    startTransition(() => setFiltersState(next));
    adapter.setVisualState({ filters: next, encoding });
  }, [adapter, cancelPending]);

  const setFiltersDebounced = useCallback((next: FilterState) => {
    setFiltersState(next);
    cancelPending();
    pending.current = window.setTimeout(() => {
      pending.current = null;
      adapter.setFilters(next);
    }, 120);
  }, [adapter, cancelPending]);

  useEffect(() => cancelPending, [adapter, cancelPending]);

  return { filters, setFiltersImmediate, setFiltersWithEncodingImmediate, setFiltersDebounced };
}
