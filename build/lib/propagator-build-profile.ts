import { resolve } from 'node:path';
import type { BuildConfig, PropagatorBackend } from './config-manager';

/** Main-thread build boundary that owns the optional loader chunk. */
export const PROPAGATOR_RUNTIME_REQUEST = './engine/utils/propagator-backend-runtime$';

/** Shared import used by every worker that can opt into wasm propagation. */
export const PROPAGATOR_WORKER_HANDLER_REQUEST = './shared/sgp4-wasm-backend-handler$';

/** Vendored OOTK public barrel that otherwise retains the eval-bearing classes. */
export const OOTK_EXTERNAL_EXPORTS_REQUEST = './external/index$';

/** Vendored propagator barrel's optional wasm adapter export. */
export const OOTK_WASM_PROPAGATOR_REQUEST = './Sgp4WasmPropagator$';

/** The nine OSS workers that currently propagate through `Sgp4`. */
export const SGP4_WASM_WORKER_ENTRY_NAMES = [
  'positionCruncher',
  'orbitCruncher',
  'debrisScreeningWorker',
  'fovPredictionWorker',
  'bestPassWorker',
  'closeObjectsWorker',
  'proximityOpsWorker',
  'time2lonWorker',
  'azRangeHeatmapWorker',
] as const;

/** Proprietary loader artifacts belong only in a WASM-enabled Pro distribution. */
export const shouldCopyProWasmArtifacts = (
  config: Pick<BuildConfig, 'isPro' | 'propagatorBackend'>,
): boolean => config.isPro && config.propagatorBackend !== 'sgp4';

/**
 * Exact request aliases for a pure-TypeScript SGP4 build.
 *
 * These are selected while constructing the graph, before tree-shaking. That
 * is stronger than a runtime branch around `new Function`: the eval-bearing
 * modules never enter the SatGlobe main or worker graphs at all.
 */
export const disabledPropagatorRuntimeAliases = (
  rootDir: string,
  backend: PropagatorBackend,
): Record<string, string> => {
  if (backend === 'sgp4') {
    return {
      [PROPAGATOR_RUNTIME_REQUEST]: resolve(rootDir, 'src/engine/utils/propagator-backend-runtime-disabled.ts'),
      [PROPAGATOR_WORKER_HANDLER_REQUEST]: resolve(rootDir, 'src/webworker/shared/sgp4-wasm-backend-handler-disabled.ts'),
      [OOTK_EXTERNAL_EXPORTS_REQUEST]: resolve(rootDir, 'src/engine/ootk/src/external/disabled.ts'),
      [OOTK_WASM_PROPAGATOR_REQUEST]: resolve(rootDir, 'src/engine/ootk/src/propagator/Sgp4WasmPropagator.disabled.ts'),
    };
  }

  return {};
};
