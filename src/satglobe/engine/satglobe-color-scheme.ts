import { ColorInformation, Pickable } from '@app/engine/core/interfaces';
import { BaseObject, Satellite } from '@ootk/src/main';
import { ColorScheme, ColorSchemeParams } from '@app/engine/rendering/color-schemes/color-scheme';
import { GpAgeColorScheme } from '@app/engine/rendering/color-schemes/gp-age-color-scheme';
import { OrbitalPlaneDensityColorScheme } from '@app/engine/rendering/color-schemes/orbital-plane-density-color-scheme';
import { prepareFilterMatcher, type FilterableSpaceObject, type FilterMatcher } from '../domain/filters';
import {
  CONJUNCTION_HIGHLIGHT_COLOR,
  OBJECT_COLORS,
  REGIME_COLORS,
  STARLINK_COLORS,
} from '../domain/encodings';
import { classifyOrbit } from '../domain/orbits';
import type { FilterState, OrbitRegime, VisualEncoding } from '../domain/types';
import { launchCohortColor } from './launch-cohort-color';
import { isKnownActivePayloadStatus, objectKindFromSpaceObjectType } from './satglobe-object-state';

const conjunctionContextAlpha = 0.16;

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
  private highlightedCatalogIds_: ReadonlySet<string>;
  /*
   * Recoloring evaluates every dot on every pass; caching each satellite's
   * normalized filterable view avoids re-allocating and re-lowercasing ~30k
   * objects per recolor. Keyed weakly so catalog reloads release entries.
   */
  private readonly filterableViews_ = new WeakMap<Satellite, FilterableSpaceObject>();
  private readonly schemes_: Record<'orbital-plane' | 'data-age', ColorScheme>;

  constructor(filters: FilterState, encoding: VisualEncoding, highlightedCatalogIds: ReadonlySet<string> = new Set()) {
    super({
      satglobeLeo: REGIME_COLORS.leo,
      satglobeMeo: REGIME_COLORS.meo,
      satglobeGeo: REGIME_COLORS.geo,
      satglobeHeo: REGIME_COLORS.heo,
      satglobeOther: REGIME_COLORS.other,
    });
    this.encoding_ = encoding;
    this.matcher_ = prepareFilterMatcher(filters);
    this.highlightedCatalogIds_ = highlightedCatalogIds;
    this.schemes_ = {
      'orbital-plane': new OrbitalPlaneDensityColorScheme(),
      'data-age': new GpAgeColorScheme(),
    };
  }

  setState(filters: FilterState, encoding: VisualEncoding, highlightedCatalogIds: ReadonlySet<string> = new Set()): void {
    this.encoding_ = encoding;
    this.matcher_ = prepareFilterMatcher(filters);
    this.highlightedCatalogIds_ = highlightedCatalogIds;
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
    const hasHighlight = this.highlightedCatalogIds_.size > 0;
    const isHighlighted = hasHighlight && this.highlightedCatalogIds_.has(String(sat.sccNum));

    // A conjunction subject stays legible even when the workshop's current
    // filter would normally exclude it. Everything outside that selected pair
    // still obeys the filter so the lens cannot accidentally reveal the full
    // catalog.
    if (!isHighlighted && !this.matches_(sat, regime)) {
      return this.hidden_();
    }

    if (isHighlighted) {
      return { color: CONJUNCTION_HIGHLIGHT_COLOR, pickable: Pickable.Yes };
    }

    const encoded = this.encodedColor_(obj, sat, regime, params);

    if (!hasHighlight || encoded.pickable === Pickable.No) {
      return encoded;
    }

    // Matching objects provide restrained orbital context while the pair is
    // highlighted. Clone the delegated color: several upstream schemes reuse
    // their palette arrays, which must never be mutated here.
    return {
      color: [
        encoded.color[0],
        encoded.color[1],
        encoded.color[2],
        Math.min(encoded.color[3], conjunctionContextAlpha),
      ],
      pickable: encoded.pickable,
    };
  }

  private encodedColor_(obj: BaseObject, sat: Satellite, regime: OrbitRegime, params?: ColorSchemeParams): ColorInformation {
    if (this.encoding_ === 'orbit-regime') {
      return { color: REGIME_COLORS[regime], pickable: Pickable.Yes };
    }

    if (this.encoding_ === 'object-type') {
      return { color: OBJECT_COLORS[objectKindFromSpaceObjectType(obj.type)], pickable: Pickable.Yes };
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
        color: isOperational ? STARLINK_COLORS.operational : STARLINK_COLORS.other,
        pickable: Pickable.Yes,
      };
    }

    const delegatedScheme = this.schemes_[this.encoding_ as keyof typeof this.schemes_];

    if (!delegatedScheme) {
      return { color: OBJECT_COLORS[objectKindFromSpaceObjectType(obj.type)], pickable: Pickable.Yes };
    }

    return delegatedScheme.update(obj, params);
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
