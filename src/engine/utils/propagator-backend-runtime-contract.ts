import type { Sgp4Wasm, Sgp4XpWasm } from '@ootk/src/main';

/**
 * Build-selected access to the optional Astro Standards propagator runtime.
 *
 * The enabled implementation lazy-loads the Emscripten wrapper. Profiles whose
 * compile-time backend is the pure-TypeScript `sgp4` use a dependency-free
 * implementation instead, keeping the eval-bearing glue out of their graph.
 */
export interface PropagatorBackendRuntime {
  activateConfiguredPropagatorBackend: () => Promise<boolean>;
  isWasmPropagatorActive: () => Promise<boolean>;
  loadSgp4Wasm: () => Promise<Sgp4Wasm>;
  loadSgp4XpWasm: () => Promise<Sgp4XpWasm>;
}
