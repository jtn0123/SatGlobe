import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const PERFORMANCE_REPORT_ROOT = path.resolve('benchmark-results/satglobe');

/** Returns whether one resolved file path is a descendant of the resolved root. */
function isDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

/**
 * Restricts CLI-selected reports to real raw-report files below the ignored
 * benchmark directory. Canonical-path validation also rejects symlink escapes.
 */
export async function resolvePerformanceReportPath(
  input: string,
  reportRoot = PERFORMANCE_REPORT_ROOT,
): Promise<string> {
  const declaredRoot = path.resolve(reportRoot);
  const declaredCandidate = path.resolve(input);

  if (!declaredCandidate.endsWith('.raw.json') || !isDescendant(declaredRoot, declaredCandidate)) {
    throw new Error(`Performance report must be a .raw.json file inside ${declaredRoot}.`);
  }
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(declaredRoot),
    realpath(declaredCandidate),
  ]);

  if (!isDescendant(canonicalRoot, canonicalCandidate)) {
    throw new Error(`Performance report resolves outside ${canonicalRoot}.`);
  }
  const candidateStats = await stat(canonicalCandidate);

  if (!candidateStats.isFile()) {
    throw new Error('Performance report must resolve to a regular file.');
  }

  return canonicalCandidate;
}
