import type { OrbitRegime } from './types';

/** Classifies a public element set into SatGlobe's presentation regimes. */
export function classifyOrbit(perigeeKm: number, apogeeKm: number, periodMinutes: number): OrbitRegime {
  if (![perigeeKm, apogeeKm, periodMinutes].every(Number.isFinite)) {
    return 'other';
  }
  if (apogeeKm < 2_000) {
    return 'leo';
  }
  if (periodMinutes >= 1_300 && periodMinutes <= 1_600 && perigeeKm > 30_000 && apogeeKm < 45_000) {
    return 'geo';
  }
  if (apogeeKm - perigeeKm > 10_000) {
    return 'heo';
  }
  if (apogeeKm < 35_000) {
    return 'meo';
  }

  return 'other';
}

/** Converts TLE epoch fields to an ISO UTC timestamp. */
export function tleEpochToIso(epochYear: number, epochDay: number): string {
  if (!Number.isFinite(epochYear) || !Number.isFinite(epochDay)) {
    return '';
  }
  const fullYear = epochYear < 57 ? 2_000 + epochYear : 1_900 + epochYear;
  const epoch = new Date(Date.UTC(fullYear, 0, 1));

  epoch.setUTCDate(epoch.getUTCDate() + Math.floor(epochDay) - 1);
  epoch.setUTCMilliseconds(Math.round((epochDay % 1) * 86_400_000));

  return epoch.toISOString();
}
