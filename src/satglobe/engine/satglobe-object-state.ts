import { PayloadStatus } from '@ootk/src/main';

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
