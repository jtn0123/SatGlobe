const FULL_COMMIT_PATTERN = /^(?:[\da-f]{40}|[\da-f]{64})$/u;

/** Validate a complete lowercase Git object ID supplied by the build environment. */
export function validateFullCommitSha(commitSha: string): string {
  if (!FULL_COMMIT_PATTERN.test(commitSha)) {
    throw new Error('SATGLOBE_COMMIT_SHA must be a full lowercase Git object ID.');
  }

  return commitSha;
}

/** Use one stable display length regardless of Git's local abbreviation config. */
export function shortCommitSha(commitSha: string): string {
  return validateFullCommitSha(commitSha).slice(0, 12);
}
