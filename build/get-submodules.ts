/* eslint-disable prefer-named-capture-group */
/* eslint-disable require-jsdoc */
// build/ensure-submodules.ts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConsoleStyles, logWithStyle } from './lib/build-error';
import { fixedGitExecutable } from './lib/fixed-executables';

const GIT_EXECUTABLE = fixedGitExecutable();

function sh(cmd: string, args: string[], opts: { allowFail?: boolean } = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });

  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }

  return res.status === 0;
}

function listSubmodules(): { name: string; path: string }[] {
  const gm = resolve(process.cwd(), '.gitmodules');

  if (!existsSync(gm)) {
    return [];
  }
  const txt = readFileSync(gm, 'utf8');
  // Minimal parser: lines like [submodule "name"] then path = foo/bar
  const out: { name: string; path: string }[] = [];
  let current: string | null = null;

  for (const line of txt.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const headerPrefix = '[submodule "';
    const headerSuffix = '"]';

    if (trimmed.startsWith(headerPrefix) && trimmed.endsWith(headerSuffix)) {
      current = trimmed.slice(headerPrefix.length, -headerSuffix.length);
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    const key = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : '';
    const submodulePath = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : '';

    if (key === 'path' && submodulePath && current) {
      out.push({ name: current, path: submodulePath });
    }
  }

  return out;
}

function ensureSubmodules() {
  if (!existsSync('.git') || !existsSync('.gitmodules')) {
    logWithStyle('[submodules] No git or no .gitmodules; skipping.', ConsoleStyles.WARNING);

    return;
  }

  // Get all submodules and split into optional vs required
  const subs = listSubmodules();
  const optionalNames = new Set(['src/plugins-pro']); // mark expected-to-fail here

  const required = subs.filter((s) => !optionalNames.has(s.name));
  const optional = subs.filter((s) => optionalNames.has(s.name));

  if (required.length === 0 && optional.length === 0) {
    logWithStyle('[submodules] No submodules found.', ConsoleStyles.WARNING);

    return;
  }

  // Init only the required ones (by path), recurse for their nested children
  for (const s of required) {
    logWithStyle(`[submodules] Updating required: ${s.name} (${s.path})`, ConsoleStyles.INFO);
    sh(GIT_EXECUTABLE, ['submodule', 'update', '--init', '--recursive', '--depth', '1', '--jobs', '4', '--', s.path]);
    logWithStyle(`[submodules] Updated required submodule: ${s.name}`, ConsoleStyles.SUCCESS);
  }

  // Try the optional ones, but do not fail the build if they error out
  for (const s of optional) {
    logWithStyle(`[submodules] Attempting optional: ${s.name} (${s.path})`, ConsoleStyles.INFO);
    const ok = sh(GIT_EXECUTABLE, ['submodule', 'update', '--init', '--recursive', '--depth', '1', '--jobs', '4', '--', s.path], { allowFail: true });

    if (!ok) {
      logWithStyle(`[submodules] Skipped optional submodule ${s.name}; continuing without it.`, ConsoleStyles.WARNING);
    } else {
      logWithStyle(`[submodules] Updated optional submodule: ${s.name}`, ConsoleStyles.SUCCESS);
    }
  }

  // Optional: print a summary
  sh(GIT_EXECUTABLE, ['submodule', 'status', '--recursive'], { allowFail: true });
}

ensureSubmodules();
