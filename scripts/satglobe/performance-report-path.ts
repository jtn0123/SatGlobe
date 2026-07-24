import { constants, type BigIntStats } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export const PERFORMANCE_TRUSTED_ROOT = path.resolve();
export const PERFORMANCE_REPORT_ROOT = path.resolve('benchmark-results/satglobe');

/** Returns whether one resolved file path is a descendant of the resolved root. */
function isDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

/** Returns whether two canonical paths identify the same location. */
function isSamePath(left: string, right: string): boolean {
  return path.relative(left, right).length === 0;
}

/** Returns whether path and handle metadata identify the same opened file. */
function isSameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export interface OpenPerformanceReportFile {
  filePath: string;
  handle: FileHandle;
}

/**
 * Opens one CLI-selected raw report below the repository-owned benchmark
 * directory. The returned handle, rather than the pathname, must be used for
 * reading so a later path replacement cannot change the opened file.
 */
export async function openPerformanceReportFile(
  input: string,
  reportRoot = PERFORMANCE_REPORT_ROOT,
  trustedRoot = PERFORMANCE_TRUSTED_ROOT,
): Promise<OpenPerformanceReportFile> {
  const declaredTrustedRoot = path.resolve(trustedRoot);
  const declaredRoot = path.resolve(reportRoot);
  const declaredCandidate = path.resolve(input);

  if (!isDescendant(declaredTrustedRoot, declaredRoot)) {
    throw new Error(`Performance report root must be inside ${declaredTrustedRoot}.`);
  }
  if (!declaredCandidate.endsWith('.raw.json') || !isDescendant(declaredRoot, declaredCandidate)) {
    throw new Error(`Performance report must be a .raw.json file inside ${declaredRoot}.`);
  }
  const rootRelative = path.relative(declaredTrustedRoot, declaredRoot);
  const candidateRelative = path.relative(declaredRoot, declaredCandidate);
  const [canonicalTrustedRoot, canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(declaredTrustedRoot),
    realpath(declaredRoot),
    realpath(declaredCandidate),
  ]);
  const expectedCanonicalRoot = path.resolve(canonicalTrustedRoot, rootRelative);
  const expectedCanonicalCandidate = path.resolve(expectedCanonicalRoot, candidateRelative);

  if (!isSamePath(expectedCanonicalRoot, canonicalRoot)) {
    throw new Error('Performance report root must not resolve through a symlink or junction.');
  }
  if (!canonicalCandidate.endsWith('.raw.json') ||
      !isDescendant(canonicalRoot, canonicalCandidate) ||
      !isSamePath(expectedCanonicalCandidate, canonicalCandidate)) {
    throw new Error('Performance report path must not resolve through a symlink or junction.');
  }

  const handle = await open(
    expectedCanonicalCandidate,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );

  try {
    const [openedStats, currentRoot, currentCandidate, currentStats] = await Promise.all([
      handle.stat({ bigint: true }),
      realpath(declaredRoot),
      realpath(declaredCandidate),
      stat(expectedCanonicalCandidate, { bigint: true }),
    ]);

    if (!openedStats.isFile() || !currentStats.isFile()) {
      throw new Error('Performance report must resolve to a regular file.');
    }
    if (!isSamePath(currentRoot, canonicalRoot) ||
        !isSamePath(currentCandidate, expectedCanonicalCandidate) ||
        !isSameFile(openedStats, currentStats)) {
      throw new Error('Performance report path changed while it was being opened.');
    }

    return { filePath: expectedCanonicalCandidate, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
