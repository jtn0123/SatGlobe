/**
 * Engine-boundary ratchet (grade-report finding A1).
 *
 * src/engine is supposed to be the bottom layer, but it historically imports
 * upward into the application tiers (src/app, src/plugins, src/settings,
 * src/locales, the keeptrack/keepTrackApi roots) in dozens of files. Burning
 * that down is a long campaign; this check stops the count from growing in
 * the meantime.
 *
 * Every upward import found under src/engine (tests and the vendored ootk
 * tree excluded) is compared against scripts/engine-boundary-baseline.json:
 *   - a file NOT in the baseline with violations fails the check;
 *   - a file exceeding its baselined count fails the check;
 *   - a file now under its baselined count prints a ratchet-down reminder.
 *
 * Regenerate the baseline (only to record IMPROVEMENTS) with:
 *   npx tsx ./scripts/check-engine-boundary.ts --update
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = path.join(repoRoot, 'src', 'engine');
const baselinePath = path.join(repoRoot, 'scripts', 'engine-boundary-baseline.json');

/** Alias prefixes that resolve into tiers above the engine layer. */
const UPWARD_ALIAS_PREFIXES = [
  '@app/app/',
  '@app/plugins/',
  '@app/plugins-pro/',
  '@app/settings/',
  '@app/locales',
  '@app/keeptrack',
  '@app/keepTrackApi',
];

/** Top-level src/ directories that sit above the engine layer. */
const UPWARD_SRC_DIRS = new Set(['app', 'plugins', 'plugins-pro', 'settings', 'locales']);
const UPWARD_SRC_FILES = new Set(['keeptrack.ts', 'keepTrackApi.ts', 'main.ts']);

/** Recursively collects engine source files, skipping tests and vendored ootk. */
function collectEngineFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__' || full === path.join(engineRoot, 'ootk')) {
        continue;
      }
      collectEngineFiles(full, out);
    } else if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

/** Returns true when an import specifier resolves above the engine layer. */
function isUpwardImport(specifier: string, importerDir: string): boolean {
  if (UPWARD_ALIAS_PREFIXES.some((prefix) => specifier === prefix.replace(/\/$/u, '') || specifier.startsWith(prefix))) {
    return true;
  }
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolved = path.resolve(importerDir, specifier);
  const rel = path.relative(path.join(repoRoot, 'src'), resolved);

  if (rel.startsWith('..')) {
    return false;
  }
  const [head] = rel.split(path.sep);

  return UPWARD_SRC_DIRS.has(head) || UPWARD_SRC_FILES.has(`${rel}.ts`) || UPWARD_SRC_FILES.has(rel);
}

/** Counts upward imports (static, re-export, and dynamic) in one file. */
function countViolations(file: string): number {
  const source = readFileSync(file, 'utf8');
  const specifiers = [
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+['"](?<spec>[^'"]+)['"]/gu),
    ...source.matchAll(/import\(\s*['"](?<spec>[^'"]+)['"]/gu),
  ].map((match) => match.groups!.spec);

  return specifiers.filter((spec) => isUpwardImport(spec, path.dirname(file))).length;
}

const files = collectEngineFiles(engineRoot);

// Guard against the gate passing vacuously after a path change or rename.
if (files.length < 100) {
  process.stderr.write(`check-engine-boundary: only ${files.length} engine files found - the scan looks broken.\n`);
  process.exit(1);
}

const current: Record<string, number> = {};

for (const file of files) {
  const count = countViolations(file);

  if (count > 0) {
    current[path.relative(repoRoot, file).replaceAll(path.sep, '/')] = count;
  }
}

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));

  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(`check-engine-boundary: baseline updated (${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((a, b) => a + b, 0)} imports).\n`);
  process.exit(0);
}

const baseline: Record<string, number> = JSON.parse(readFileSync(baselinePath, 'utf8'));
const failures: string[] = [];
const improvements: string[] = [];

for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file] ?? 0;

  if (count > allowed) {
    failures.push(`${file}: ${count} upward imports (baseline allows ${allowed})`);
  } else if (count < allowed) {
    improvements.push(`${file}: ${count} (baseline ${allowed})`);
  }
}
for (const file of Object.keys(baseline)) {
  if (!(file in current)) {
    improvements.push(`${file}: 0 (baseline ${baseline[file]})`);
  }
}

if (failures.length > 0) {
  process.stderr.write('check-engine-boundary: new upward imports from src/engine into app tiers (ADR 0001 layering):\n');
  for (const failure of failures) {
    process.stderr.write(`  ${failure}\n`);
  }
  process.stderr.write('Route the dependency through ServiceLocator/EventBus/Container instead, or (last resort) discuss expanding the baseline in review.\n');
  process.exit(1);
}

if (improvements.length > 0) {
  process.stdout.write('check-engine-boundary: files improved past their baseline - lock it in with --update:\n');
  for (const improvement of improvements) {
    process.stdout.write(`  ${improvement}\n`);
  }
}

const total = Object.values(current).reduce((a, b) => a + b, 0);

process.stdout.write(`check-engine-boundary: OK (${Object.keys(current).length} files, ${total} baselined upward imports, ${files.length} engine files scanned).\n`);
