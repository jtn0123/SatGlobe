import type { ObjectKind, OrbitRegime, VisualEncoding } from '../domain/types';

export const objectKindLabels: Record<ObjectKind, string> = {
  payload: 'Payloads',
  'rocket-body': 'Rocket bodies',
  debris: 'Debris',
  other: 'Other',
};

export const regimeLabels: Record<OrbitRegime, string> = {
  leo: 'LEO',
  meo: 'MEO',
  geo: 'GEO',
  heo: 'Highly elliptical',
  other: 'Other',
};

export const encodingLabels: Record<VisualEncoding, string> = {
  'object-type': 'Object type',
  'orbit-regime': 'Orbital regime',
  'launch-cohort': 'Launch cohort',
  'orbital-plane': 'Plane density',
  'data-age': 'Data age',
  starlink: 'Starlink state',
};

/** Formats a finite measurement for compact workshop labels. */
export function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value) : '—';
}

/** Formats an ISO timestamp as an explicit UTC presentation string. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return 'WAITING FOR ENGINE';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'UTC', timeZoneName: 'short',
  }).format(date).toLocaleUpperCase();
}

/** Formats launch dates without exposing raw ISO timestamps in the inspector. */
export function formatCalendarDate(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso || 'Not listed';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date).toLocaleUpperCase();
}

/** Returns the non-negative age of an ISO timestamp in days. */
export function ageInDays(iso: string): number | null {
  const epoch = new Date(iso).getTime();

  return Number.isFinite(epoch) ? Math.max(0, (Date.now() - epoch) / 86_400_000) : null;
}

/** Describes element age without implying the propagated position is live. */
export function describeEpoch(epoch: string): string {
  if (!epoch) {
    return 'Epoch unavailable';
  }
  const ageDays = ageInDays(epoch);

  return ageDays === null ? 'Epoch unavailable' : `${ageDays.toFixed(ageDays < 10 ? 1 : 0)} days old`;
}
