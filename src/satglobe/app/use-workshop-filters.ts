import { useCallback, useEffect, useRef, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { DEFAULT_FILTERS, type FilterState } from '../domain/types';

/**
 * Owns workshop filter state. Every UI change updates React immediately, while
 * callers choose whether the corresponding engine recolor happens now or is
 * coalesced to the trailing value of a slider drag.
 */
export function useWorkshopFilters(adapter: SatGlobeEngineAdapter): {
  filters: FilterState;
  setFiltersImmediate: (next: FilterState) => void;
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
    setFiltersState(next);
    adapter.setFilters(next);
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

  return { filters, setFiltersImmediate, setFiltersDebounced };
}
