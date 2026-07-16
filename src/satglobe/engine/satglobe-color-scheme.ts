import { ColorInformation, Pickable, rgbaArray } from '@app/engine/core/interfaces';
import { BaseObject, Satellite, SpaceObjectType } from '@ootk/src/main';
import { ColorScheme, ColorSchemeParams } from '@app/engine/rendering/color-schemes/color-scheme';
import { GpAgeColorScheme } from '@app/engine/rendering/color-schemes/gp-age-color-scheme';
import { MissionColorScheme } from '@app/engine/rendering/color-schemes/mission-color-scheme';
import { ObjectTypeColorScheme } from '@app/engine/rendering/color-schemes/object-type-color-scheme';
import { OrbitalPlaneDensityColorScheme } from '@app/engine/rendering/color-schemes/orbital-plane-density-color-scheme';
import { StarlinkColorScheme } from '@app/engine/rendering/color-schemes/starlink-color-scheme';
import { classifyOrbit } from '../domain/orbits';
import type { FilterState, ObjectKind, OrbitRegime, VisualEncoding } from '../domain/types';
import { isKnownActivePayloadStatus } from './satglobe-object-state';

const regimeColors: Record<OrbitRegime, rgbaArray> = {
  leo: [0.54, 0.84, 0.81, 0.9],
  meo: [0.91, 0.79, 0.5, 0.9],
  geo: [0.94, 0.55, 0.42, 0.9],
  heo: [0.66, 0.59, 0.82, 0.9],
  other: [0.72, 0.75, 0.72, 0.72],
};

const objectColors: Record<ObjectKind, rgbaArray> = {
  payload: [0.43, 0.78, 0.74, 0.68],
  'rocket-body': [0.9, 0.67, 0.36, 0.76],
  debris: [0.62, 0.66, 0.64, 0.42],
  other: [0.72, 0.72, 0.69, 0.5],
};

/** Maps KeepTrack object types to SatGlobe's stable public filter vocabulary. */
function kindOf(obj: BaseObject): ObjectKind {
  if (obj.type === SpaceObjectType.PAYLOAD) {
    return 'payload';
  }
  if (obj.type === SpaceObjectType.ROCKET_BODY) {
    return 'rocket-body';
  }
  if (obj.type === SpaceObjectType.DEBRIS) {
    return 'debris';
  }

  return 'other';
}

export class SatGlobeColorScheme extends ColorScheme {
  readonly id = 'SatGlobeColorScheme';
  readonly label = 'SatGlobe';
  isOptionInColorMenu = false;
  isOptionInRmbMenu = false;
  private filters_: FilterState;
  private encoding_: VisualEncoding;
  private readonly schemes_: Record<Exclude<VisualEncoding, 'orbit-regime'>, ColorScheme>;

  constructor(filters: FilterState, encoding: VisualEncoding) {
    super({
      satglobeLeo: regimeColors.leo,
      satglobeMeo: regimeColors.meo,
      satglobeGeo: regimeColors.geo,
      satglobeHeo: regimeColors.heo,
      satglobeOther: regimeColors.other,
    });
    this.filters_ = filters;
    this.encoding_ = encoding;
    this.schemes_ = {
      'object-type': new ObjectTypeColorScheme(),
      'launch-cohort': new MissionColorScheme(),
      'orbital-plane': new OrbitalPlaneDensityColorScheme(),
      'data-age': new GpAgeColorScheme(),
      starlink: new StarlinkColorScheme(),
    };
    this.schemes_.starlink.objectTypeFlags.starlinkNot = false;
  }

  setState(filters: FilterState, encoding: VisualEncoding): void {
    this.filters_ = filters;
    this.encoding_ = encoding;
  }

  calculateParams() {
    if (this.encoding_ === 'orbit-regime') {
      return null;
    }

    return this.schemes_[this.encoding_].calculateParams();
  }

  update(obj: BaseObject, params?: ColorSchemeParams): ColorInformation {
    if (!obj.isSatellite()) {
      return this.hidden_();
    }

    const sat = obj as Satellite;
    const regime = classifyOrbit(Number(sat.perigee), Number(sat.apogee), Number(sat.period));

    if (!this.matches_(sat, regime)) {
      return this.hidden_();
    }

    if (this.encoding_ === 'orbit-regime') {
      return { color: regimeColors[regime], pickable: Pickable.Yes };
    }

    if (this.encoding_ === 'object-type') {
      return { color: objectColors[kindOf(obj)], pickable: Pickable.Yes };
    }

    if (this.encoding_ === 'starlink') {
      const isOperational = isKnownActivePayloadStatus(sat.status);
      const isStarlink = sat.name.toLocaleLowerCase().startsWith('starlink');

      if (!isStarlink) {
        return this.hidden_();
      }

      return {
        color: isOperational ? [0.48, 0.86, 0.81, 0.9] : [0.91, 0.72, 0.42, 0.86],
        pickable: Pickable.Yes,
      };
    }

    return this.schemes_[this.encoding_].update(obj, params);
  }

  private hidden_(): ColorInformation {
    return { color: [0, 0, 0, 0], pickable: Pickable.No };
  }

  private matches_(sat: Satellite, regime: OrbitRegime): boolean {
    const filters = this.filters_;
    const text = `${sat.country} ${sat.owner}`.toLocaleLowerCase();
    const launchCohort = filters.launchCohort.trim().toLocaleLowerCase();
    const constellation = filters.constellation.trim().toLocaleLowerCase();
    const countryOrOperator = filters.countryOrOperator.trim().toLocaleLowerCase();
    const isKnownActive = isKnownActivePayloadStatus(sat.status);
    const statusMatches = filters.status === 'all' || (filters.status === 'active' ? isKnownActive : !isKnownActive);

    return filters.objectKinds.includes(kindOf(sat)) &&
      statusMatches &&
      filters.regimes.includes(regime) &&
      Number(sat.perigee) >= filters.altitudeKm.min &&
      Number(sat.apogee) <= filters.altitudeKm.max &&
      Number(sat.inclination) >= filters.inclinationDeg.min &&
      Number(sat.inclination) <= filters.inclinationDeg.max &&
      (!launchCohort || `${sat.intlDes} ${sat.launchDate}`.toLocaleLowerCase().includes(launchCohort)) &&
      (!constellation || sat.name.toLocaleLowerCase().includes(constellation)) &&
      (!countryOrOperator || text.includes(countryOrOperator));
  }
}
