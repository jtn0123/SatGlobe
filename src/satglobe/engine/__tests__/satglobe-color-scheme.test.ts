import { PayloadStatus, SpaceObjectType, type BaseObject } from '@ootk/src/main';
import { Pickable } from '@app/engine/core/interfaces';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../../domain/types';
import { launchCohortColor } from '../launch-cohort-color';
import { SatGlobeColorScheme } from '../satglobe-color-scheme';

const satellite = (internationalDesignator: string) => ({
  id: 1,
  type: SpaceObjectType.PAYLOAD,
  status: PayloadStatus.OPERATIONAL,
  name: 'COHORT TEST',
  intlDes: internationalDesignator,
  launchDate: '2019-11-11',
  country: 'US',
  owner: 'Test',
  perigee: 540,
  apogee: 560,
  inclination: 53.2,
  period: 95,
  isSatellite: () => true,
}) as unknown as BaseObject;

describe('SatGlobe launch cohort encoding', () => {
  it('routes actual launch designators through the static SatGlobe-owned cohort palette', () => {
    const scheme = new SatGlobeColorScheme(structuredClone(DEFAULT_FILTERS), 'launch-cohort');
    const result = scheme.update(satellite('2019-074B'));

    expect(scheme.isStaticColorScheme).toBe(true);
    expect(result).toEqual({ color: launchCohortColor('2019-074B'), pickable: Pickable.Yes });
    expect(scheme.update(satellite('2019-074C')).color).toEqual(result.color);
    expect(scheme.update(satellite('2019-075A')).color).not.toEqual(result.color);
  });
});
