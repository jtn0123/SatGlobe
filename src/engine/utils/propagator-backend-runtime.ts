import type { PropagatorBackendRuntime } from './propagator-backend-runtime-contract';

const loadRuntime_ = () => import('./sgp4-wasm-loader');

/** Enabled build boundary for profiles compiled with a wasm propagator backend. */
export const propagatorBackendRuntime = {
  activateConfiguredPropagatorBackend: async () =>
    (await loadRuntime_()).activateConfiguredPropagatorBackend(),
  isWasmPropagatorActive: async () => (await loadRuntime_()).isWasmPropagatorActive(),
  loadSgp4Wasm: async () => (await loadRuntime_()).loadSgp4Wasm(),
  loadSgp4XpWasm: async () => (await loadRuntime_()).loadSgp4XpWasm(),
} satisfies PropagatorBackendRuntime;
