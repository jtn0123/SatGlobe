import { PayloadStatus } from '@ootk/src/main';
import { describe, expect, it } from 'vitest';
import { isKnownActivePayloadStatus } from '../satglobe-object-state';

describe('isKnownActivePayloadStatus', () => {
  it.each([
    PayloadStatus.OPERATIONAL,
    PayloadStatus.PARTIALLY_OPERATIONAL,
    PayloadStatus.BACKUP_STANDBY,
    PayloadStatus.SPARE,
    PayloadStatus.EXTENDED_MISSION,
  ])('treats %s as a known active state', (status) => {
    expect(isKnownActivePayloadStatus(status)).toBe(true);
  });

  it.each([
    PayloadStatus.NONOPERATIONAL,
    PayloadStatus.DECAYED,
    PayloadStatus.UNKNOWN,
  ])('does not infer activity from %s', (status) => {
    expect(isKnownActivePayloadStatus(status)).toBe(false);
  });
});
