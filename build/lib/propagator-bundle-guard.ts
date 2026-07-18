import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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

/** Lists emitted JavaScript recursively across main, worker, auth, and static asset roots. */
const listJavaScriptAssets = (distDir: string, currentDir = distDir): string[] => readdirSync(currentDir, { withFileTypes: true })
  .flatMap((entry) => {
    const assetPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      return listJavaScriptAssets(distDir, assetPath);
    }

    return entry.isFile() && entry.name.endsWith('.js') ? [relative(distDir, assetPath)] : [];
  });

/** Inspect every emitted JS entry, async chunk, and copied runtime artifact. */
export const inspectPropagatorBundle = (distDir: string): PropagatorBundleInspection => {
  const assets = listJavaScriptAssets(distDir).sort();
  const offenders = assets.filter((name) => {
    const source = readFileSync(join(distDir, name), 'utf8');

    return SGP4_WASM_GLUE_SIGNATURES.some((signature) => source.includes(signature));
  });

  return { assetCount: assets.length, offenders };
};

/** Fail pure-SGP4 production builds if any main, worker, or lazy chunk retains the glue. */
export const assertPropagatorBundleProfile = (distDir: string, backend: PropagatorBackend): PropagatorBundleInspection => {
  const inspection = inspectPropagatorBundle(distDir);

  if (backend === 'sgp4' && inspection.offenders.length > 0) {
    throw new BuildError(
      `Pure-SGP4 build retained the optional Emscripten loader in: ${inspection.offenders.join(', ')}`,
      ErrorCodes.BUNDLE_POLICY,
    );
  }
  if (backend !== 'sgp4' && inspection.offenders.length === 0) {
    throw new BuildError(
      `WASM-enabled ${backend} build did not retain the optional Emscripten loader`,
      ErrorCodes.BUNDLE_POLICY,
    );
  }

  return inspection;
};
