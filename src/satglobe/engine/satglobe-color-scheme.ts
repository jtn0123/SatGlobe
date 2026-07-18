import { ColorInformation, Pickable, rgbaArray } from '@app/engine/core/interfaces';
import { BaseObject, Satellite } from '@ootk/src/main';
import { ColorScheme, ColorSchemeParams } from '@app/engine/rendering/color-schemes/color-scheme';
import { GpAgeColorScheme } from '@app/engine/rendering/color-schemes/gp-age-color-scheme';
import { OrbitalPlaneDensityColorScheme } from '@app/engine/rendering/color-schemes/orbital-plane-density-color-scheme';
import { prepareFilterMatcher, type FilterableSpaceObject, type FilterMatcher } from '../domain/filters';
import { classifyOrbit } from '../domain/orbits';
import type { FilterState, ObjectKind, OrbitRegime, VisualEncoding } from '../domain/types';
import { launchCohortColor } from './launch-cohort-color';
import { isKnownActivePayloadStatus, objectKindFromSpaceObjectType } from './satglobe-object-state';

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

export class SatGlobeColorScheme extends ColorScheme {
  readonly id = 'SatGlobeColorScheme';
  readonly label = 'SatGlobe';
  isOptionInColorMenu = false;
  isOptionInRmbMenu = false;
  /*
   * Colors derive from catalog data plus filters/encoding applied through
   * setState (always followed by a forced recolor), so the manager's periodic
   * per-frame sweep adds nothing but main-thread cost.
   */
  override readonly isStaticColorScheme = true;
  private encoding_: VisualEncoding;
  private matcher_: FilterMatcher;
  /*
   * Recoloring evaluates every dot on every pass; caching each satellite's
   * normalized filterable view avoids re-allocating and re-lowercasing ~30k
   * objects per recolor. Keyed weakly so catalog reloads release entries.
   */
  private readonly filterableViews_ = new WeakMap<Satellite, FilterableSpaceObject>();
  private readonly schemes_: Record<'orbital-plane' | 'data-age', ColorScheme>;

  constructor(filters: FilterState, encoding: VisualEncoding) {
    super({
      satglobeLeo: regimeColors.leo,
      satglobeMeo: regimeColors.meo,
      satglobeGeo: regimeColors.geo,
      satglobeHeo: regimeColors.heo,
      satglobeOther: regimeColors.other,
    });
    this.encoding_ = encoding;
    this.matcher_ = prepareFilterMatcher(filters);
    this.schemes_ = {
      'orbital-plane': new OrbitalPlaneDensityColorScheme(),
      'data-age': new GpAgeColorScheme(),
    };
  }

  setState(filters: FilterState, encoding: VisualEncoding): void {
    this.encoding_ = encoding;
    this.matcher_ = prepareFilterMatcher(filters);
  }

  calculateParams() {
    if (this.encoding_ !== 'orbital-plane' && this.encoding_ !== 'data-age') {
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
      return { color: objectColors[objectKindFromSpaceObjectType(obj.type)], pickable: Pickable.Yes };
    }

    if (this.encoding_ === 'launch-cohort') {
      return { color: launchCohortColor(sat.intlDes), pickable: Pickable.Yes };
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
    let view = this.filterableViews_.get(sat);

    if (!view) {
      view = {
        kind: objectKindFromSpaceObjectType(sat.type),
        active: isKnownActivePayloadStatus(sat.status),
        regime,
        perigeeKm: Number(sat.perigee),
        apogeeKm: Number(sat.apogee),
        inclinationDeg: Number(sat.inclination),
        name: sat.name,
        internationalDesignator: sat.intlDes,
        launchDate: sat.launchDate,
        country: sat.country,
        owner: sat.owner,
        nameText: (sat.name ?? '').toLocaleLowerCase(),
        launchText: `${sat.intlDes} ${sat.launchDate}`.toLocaleLowerCase(),
        ownershipText: `${sat.country} ${sat.owner}`.toLocaleLowerCase(),
      };
      this.filterableViews_.set(sat, view);
    }

    return this.matcher_(view);
  }
}
