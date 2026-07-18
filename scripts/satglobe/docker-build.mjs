#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gitCandidates = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']
  : ['/usr/bin/git'];

/** Enumerate only explicit Docker CLI locations for the current platform. */
function dockerCandidatesForPlatform() {
  if (process.platform === 'win32') {
    return ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker'];
  }

  return ['/usr/bin/docker', '/usr/local/bin/docker'];
}

const dockerCandidates = dockerCandidatesForPlatform();

/** Return the first executable found at one explicit system location. */
function fixedExecutable(name, candidates) {
  const executable = candidates.find((candidate) => existsSync(candidate));

  if (!executable) {
    throw new Error(`${name} is unavailable at the fixed locations: ${candidates.join(', ')}`);
  }

  return executable;
}

const gitExecutable = fixedExecutable('Git', gitCandidates);
const commitSha = execFileSync(gitExecutable, ['rev-parse', 'HEAD'], {
  cwd: ROOT_DIR,
  encoding: 'utf8',
}).trim();

if (!(/^(?:[\da-f]{40}|[\da-f]{64})$/u).test(commitSha)) {
  throw new Error('Git returned an invalid full commit object ID.');
}
const statusPorcelain = execFileSync(gitExecutable, [
  'status',
  '--porcelain=v1',
  '--untracked-files=all',
  '--ignore-submodules=none',
], {
  cwd: ROOT_DIR,
  encoding: 'utf8',
});

if (statusPorcelain.length > 0) {
  throw new Error('Refusing to build a commit-labelled SatGlobe image from a dirty worktree.');
}

const result = spawnSync(fixedExecutable('Docker', dockerCandidates), [
  'build',
  '--build-arg',
  `SATGLOBE_COMMIT_SHA=${commitSha}`,
  '-f',
  'Dockerfile.satglobe',
  '-t',
  'satglobe:local',
  '.',
], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`SatGlobe Docker build failed with exit code ${result.status ?? 'unknown'}.`);
}
