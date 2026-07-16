import { PayloadStatus, SpaceObjectType } from '@ootk/src/main';
import { describe, expect, it } from 'vitest';
import { isKnownActivePayloadStatus, objectKindFromSpaceObjectType } from '../satglobe-object-state';

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

describe('objectKindFromSpaceObjectType', () => {
  it.each([
    [SpaceObjectType.PAYLOAD, 'payload'],
    [SpaceObjectType.ROCKET_BODY, 'rocket-body'],
    [SpaceObjectType.DEBRIS, 'debris'],
    [SpaceObjectType.BALLISTIC_MISSILE, 'other'],
  ] as const)('maps engine type %s to %s', (type, expected) => {
    expect(objectKindFromSpaceObjectType(type)).toBe(expected);
  });
});
