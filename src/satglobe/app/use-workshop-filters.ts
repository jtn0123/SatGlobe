import { useCallback, useEffect, useRef, useState } from 'react';
import type { SatGlobeEngineAdapter } from '../engine/satglobe-engine-adapter';
import { DEFAULT_FILTERS, type FilterState } from '../domain/types';

/**
 * Owns workshop filter state. UI state updates immediately; the engine
 * application (a full-catalog recolor) coalesces to the trailing value, so
 * dragging a slider costs one recolor instead of one per input event.
 */
export function useWorkshopFilters(adapter: SatGlobeEngineAdapter): {
  filters: FilterState;
  setFilters: (next: FilterState) => void;
  setFiltersState: React.Dispatch<React.SetStateAction<FilterState>>;
} {
  const [filters, setFiltersState] = useState<FilterState>(structuredClone(DEFAULT_FILTERS));
  const pending = useRef<number | null>(null);
  const setFilters = useCallback((next: FilterState) => {
    setFiltersState(next);
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
    }
    pending.current = window.setTimeout(() => {
      pending.current = null;
      adapter.setFilters(next);
    }, 120);
  }, [adapter]);

  useEffect(() => () => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
    }
  }, []);

  return { filters, setFilters, setFiltersState };
}
