import { describe, expect, it } from 'vitest';
import { shortCommitSha, validateFullCommitSha } from '../lib/build-provenance';

describe('build provenance', () => {
  it('uses one stable 12-character display hash for SHA-1 and SHA-256 object IDs', () => {
    const sha1 = '0123456789abcdef0123456789abcdef01234567';
    const sha256 = `${sha1}89abcdef0123456789abcdef`;

    expect(validateFullCommitSha(sha1)).toBe(sha1);
    expect(shortCommitSha(sha1)).toBe('0123456789ab');
    expect(shortCommitSha(sha256)).toBe('0123456789ab');
  });

  it.each([
    '0123456',
    '0123456789ABCDEF0123456789ABCDEF01234567',
    'g123456789abcdef0123456789abcdef01234567',
    ' 0123456789abcdef0123456789abcdef01234567',
  ])('rejects a non-canonical full object ID: %s', (commitSha) => {
    expect(() => validateFullCommitSha(commitSha)).toThrow('full lowercase Git object ID');
  });
});
