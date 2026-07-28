import type { PropagatorBackendRuntime } from './propagator-backend-runtime-contract';

const disabledError_ = (): Error => new Error(
  'The Astro Standards SGP4 wasm runtime is not included in this build profile.',
);

/** Dependency-free boundary used when `PROPAGATOR_BACKEND=sgp4`. */
export const propagatorBackendRuntime = {
  activateConfiguredPropagatorBackend: () => Promise.resolve(false),
  isWasmPropagatorActive: () => Promise.resolve(false),
  loadSgp4Wasm: () => Promise.reject(disabledError_()),
  loadSgp4XpWasm: () => Promise.reject(disabledError_()),
} satisfies PropagatorBackendRuntime;
