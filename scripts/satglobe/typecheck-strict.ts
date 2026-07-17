#!/usr/bin/env npx tsx

/*
 * Strict typecheck gate for SatGlobe-owned code.
 *
 * Runs tsc with strict/strictNullChecks over src/satglobe (tsconfig.satglobe.json)
 * and fails only on errors inside src/satglobe. The engine files the adapter
 * imports are compiled with the repo-wide non-strict tsconfig.build.json and are
 * not held to strict mode here, so their diagnostics are reported as a count and
 * filtered out; making the engine strict is tracked separately (grade-report I2).
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['tsc', '-p', 'tsconfig.satglobe.json', '--pretty', 'false'], { encoding: 'utf8', shell: false });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const errorLines = output.split('\n').filter((line) => line.includes('error TS'));
const satglobeErrors = errorLines.filter((line) => line.startsWith('src/satglobe/'));
const engineErrorCount = errorLines.length - satglobeErrors.length;

if (satglobeErrors.length > 0) {
  process.stderr.write(`${satglobeErrors.join('\n')}\n`);
  process.stderr.write(`\nStrict typecheck failed: ${satglobeErrors.length} error(s) in src/satglobe (plus ${engineErrorCount} in non-strict engine imports, ignored).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Strict typecheck passed for src/satglobe (${engineErrorCount} diagnostics in non-strict engine imports filtered).\n`);
}
