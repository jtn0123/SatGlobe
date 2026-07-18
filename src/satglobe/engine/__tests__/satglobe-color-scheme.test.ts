import { PayloadStatus, SpaceObjectType, type BaseObject } from '@ootk/src/main';
import { Pickable } from '@app/engine/core/interfaces';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type VisualEncoding } from '../../domain/types';
import { launchCohortColor } from '../launch-cohort-color';
import { SatGlobeColorScheme } from '../satglobe-color-scheme';

const satellite = (internationalDesignator: string, overrides: Record<string, unknown> = {}) => ({
  id: 1,
  sccNum: '44714',
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
  ...overrides,
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

  it('falls back to object-type colors when a runtime encoding is missing', () => {
    const missingEncoding = new SatGlobeColorScheme(
      structuredClone(DEFAULT_FILTERS),
      undefined as unknown as VisualEncoding,
    );
    const objectType = new SatGlobeColorScheme(structuredClone(DEFAULT_FILTERS), 'object-type');
    const object = satellite('2019-074B');

    expect(missingEncoding.calculateParams()).toBeNull();
    expect(missingEncoding.update(object)).toEqual(objectType.update(object));
  });

  it('emphasizes known conjunction subjects, dims matching context, and hides nonmatching objects', () => {
    const highlighted = satellite('2020-001A', {
      sccNum: '30001',
      type: SpaceObjectType.DEBRIS,
      status: PayloadStatus.NONOPERATIONAL,
    });
    const context = satellite('2019-074B');
    const filteredOut = satellite('2020-001B', {
      sccNum: '30002',
      type: SpaceObjectType.DEBRIS,
      status: PayloadStatus.NONOPERATIONAL,
    });
    const scheme = new SatGlobeColorScheme(
      structuredClone(DEFAULT_FILTERS),
      'object-type',
      new Set(['30001']),
    );

    // Highlighted subjects bypass the default active-payload filter.
    expect(scheme.update(highlighted)).toEqual({ color: [1, 0.78, 0.3, 1], pickable: Pickable.Yes });
    // Matching objects remain as quiet, pickable orbital context.
    expect(scheme.update(context)).toMatchObject({ color: [0.43, 0.78, 0.74, 0.16], pickable: Pickable.Yes });
    // The lens never reveals unrelated objects that fail the active filters.
    expect(scheme.update(filteredOut)).toEqual({ color: [0, 0, 0, 0], pickable: Pickable.No });
  });

  it('returns to the ordinary palette when highlight state is cleared', () => {
    const scheme = new SatGlobeColorScheme(
      structuredClone(DEFAULT_FILTERS),
      'object-type',
      new Set(['44714']),
    );
    const object = satellite('2019-074B');

    expect(scheme.update(object).color).toEqual([1, 0.78, 0.3, 1]);
    scheme.setState(structuredClone(DEFAULT_FILTERS), 'object-type');
    expect(scheme.update(object).color).toEqual([0.43, 0.78, 0.74, 0.68]);
  });
});
