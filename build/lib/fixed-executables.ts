import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';

const require = createRequire(import.meta.url);

const FIXED_GIT_CANDIDATES = process.platform === 'win32'
  ? [String.raw`C:\Program Files\Git\cmd\git.exe`, String.raw`C:\Program Files (x86)\Git\cmd\git.exe`]
  : ['/usr/bin/git'];

const dockerCandidatesForPlatform = (): string[] => {
  if (process.platform === 'win32') {
    return [String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker'];
  }

  return ['/usr/bin/docker', '/usr/local/bin/docker'];
};

const openCandidatesForPlatform = (): string[] => {
  if (process.platform === 'win32') {
    return [String.raw`C:\Windows\explorer.exe`];
  }
  if (process.platform === 'darwin') {
    return ['/usr/bin/open'];
  }

  return ['/usr/bin/xdg-open'];
};

const FIXED_OPEN_CANDIDATES = openCandidatesForPlatform();
const FIXED_DOCKER_CANDIDATES = dockerCandidatesForPlatform();

interface PackageMetadata {
  bin?: string | Record<string, string>;
}

/** Return the first installed executable from an explicit system-path allowlist. */
function firstExisting(name: string, candidates: string[]): string {
  const executable = candidates.find((candidate) => existsSync(candidate));

  if (!executable) {
    throw new Error(`${name} is unavailable at the fixed system locations: ${candidates.join(', ')}`);
  }

  return executable;
}

/** Resolve Git only from fixed system locations, never from caller-controlled PATH. */
export function fixedGitExecutable(): string {
  return firstExisting('Git', FIXED_GIT_CANDIDATES);
}

/** Resolve Docker only from fixed installation locations, never from PATH. */
export function fixedDockerExecutable(): string {
  return firstExisting('Docker', FIXED_DOCKER_CANDIDATES);
}

/** Resolve a package's declared JavaScript CLI from the locked local install. */
export function fixedPackageExecutable(packageName: string, binaryName = packageName): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageRoot = dirname(packageJsonPath);
  const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageMetadata;
  const relativeBinary = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[binaryName];

  if (!relativeBinary) {
    throw new Error(`Package ${packageName} does not declare the ${binaryName} executable.`);
  }
  const executable = resolve(packageRoot, relativeBinary);

  if (!executable.startsWith(`${packageRoot}${sep}`) || !existsSync(executable)) {
    throw new Error(`Package ${packageName} resolved an invalid ${binaryName} executable.`);
  }

  return executable;
}

/** Resolve the operating system's URL/file opener without consulting PATH. */
export function fixedOpenExecutable(): string {
  return firstExisting('File opener', FIXED_OPEN_CANDIDATES);
}
