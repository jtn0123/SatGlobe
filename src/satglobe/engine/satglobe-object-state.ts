import { PayloadStatus, SpaceObjectType } from '@ootk/src/main';
import type { ObjectKind } from '../domain/types';

const KNOWN_ACTIVE_STATUSES = new Set<PayloadStatus>([
  PayloadStatus.OPERATIONAL,
  PayloadStatus.PARTIALLY_OPERATIONAL,
  PayloadStatus.BACKUP_STANDBY,
  PayloadStatus.SPARE,
  PayloadStatus.EXTENDED_MISSION,
]);

/**
 * KeepTrack's BaseObject.active flag means the propagation slot is usable; it
 * does not describe whether a payload is operational. SatGlobe's public
 * active/inactive filter is derived from the catalog payload status instead.
 */
export function isKnownActivePayloadStatus(status: PayloadStatus): boolean {
  return KNOWN_ACTIVE_STATUSES.has(status);
}

/** Maps KeepTrack object types to SatGlobe's stable public vocabulary. */
export function objectKindFromSpaceObjectType(type: SpaceObjectType): ObjectKind {
  if (type === SpaceObjectType.PAYLOAD) {
    return 'payload';
  }
  if (type === SpaceObjectType.ROCKET_BODY) {
    return 'rocket-body';
  }
  if (type === SpaceObjectType.DEBRIS) {
    return 'debris';
  }

  return 'other';
}
