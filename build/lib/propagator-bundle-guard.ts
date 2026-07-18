import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BuildError, ErrorCodes } from './build-error';
import type { PropagatorBackend } from './config-manager';

/** Signatures unique to the vendored Emscripten loader after production minification. */
export const SGP4_WASM_GLUE_SIGNATURES = [
  'Function("Module","require","__dirname"',
  'return { Module: Module, FS: FS };',
  'TleAddSatFrLines_wasm',
] as const;

export interface PropagatorBundleInspection {
  assetCount: number;
  offenders: string[];
}

/** Inspect every emitted JS entry and async chunk, not only the main asset. */
export const inspectPropagatorBundle = (jsDir: string): PropagatorBundleInspection => {
  const assets = readdirSync(jsDir)
    .filter((name) => name.endsWith('.js'))
    .sort();
  const offenders = assets.filter((name) => {
    const source = readFileSync(join(jsDir, name), 'utf8');

    return SGP4_WASM_GLUE_SIGNATURES.some((signature) => source.includes(signature));
  });

  return { assetCount: assets.length, offenders };
};

/** Fail pure-SGP4 production builds if any main, worker, or lazy chunk retains the glue. */
export const assertPropagatorBundleProfile = (jsDir: string, backend: PropagatorBackend): PropagatorBundleInspection => {
  const inspection = inspectPropagatorBundle(jsDir);

  if (backend === 'sgp4' && inspection.offenders.length > 0) {
    throw new BuildError(
      `Pure-SGP4 build retained the optional Emscripten loader in: ${inspection.offenders.join(', ')}`,
      ErrorCodes.BUNDLE_POLICY,
    );
  }

  return inspection;
};
