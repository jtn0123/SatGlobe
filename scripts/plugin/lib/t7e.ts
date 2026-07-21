import { spawnSync } from 'node:child_process';
import { fixedPackageExecutable } from '../../../build/lib/fixed-executables';
import { REPO_ROOT } from './paths';

const TSX_CLI = fixedPackageExecutable('tsx');

/**
 * Regenerate the merged locale bundles + typed keys.ts by running the host's
 * translation generator. It scans src/ ** /locales/*.src.json, so external plugin
 * locales under src/plugins-external are merged automatically.
 */
export function runGenerateT7e(): boolean {
  const res = spawnSync(process.execPath, [TSX_CLI, './build/generate-translation.ts'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  return res.status === 0;
}
