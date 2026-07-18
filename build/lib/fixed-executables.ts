import { existsSync } from 'node:fs';

const FIXED_GIT_CANDIDATES = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']
  : ['/usr/bin/git'];

/** Resolve Git only from fixed system locations, never from caller-controlled PATH. */
export function fixedGitExecutable(): string {
  const executable = FIXED_GIT_CANDIDATES.find((candidate) => existsSync(candidate));

  if (!executable) {
    throw new Error(`Git is unavailable at the fixed system locations: ${FIXED_GIT_CANDIDATES.join(', ')}`);
  }

  return executable;
}
