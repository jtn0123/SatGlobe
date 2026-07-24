import { prepareFilterMatcher } from './filters';
import {
  launchCohortColorForKey,
  normalizeLaunchCohort,
  UNKNOWN_LAUNCH_COHORT_COLOR,
  type RgbaColor,
} from './launch-designator';
import type {
  FilterState,
  LegendItem,
  ObjectKind,
  OrbitRegime,
  SpaceObjectView,
  VisualEncoding,
  VisualLegend,
} from './types';

export const REGIME_COLORS: Readonly<Record<OrbitRegime, RgbaColor>> = {
  leo: [0.54, 0.84, 0.81, 0.9],
  meo: [0.91, 0.79, 0.5, 0.9],
  geo: [0.94, 0.55, 0.42, 0.9],
  heo: [0.66, 0.59, 0.82, 0.9],
  other: [0.72, 0.75, 0.72, 0.72],
};

export const OBJECT_COLORS: Readonly<Record<ObjectKind, RgbaColor>> = {
  payload: [0.43, 0.78, 0.74, 0.68],
  'rocket-body': [0.9, 0.67, 0.36, 0.76],
  debris: [0.62, 0.66, 0.64, 0.42],
  other: [0.72, 0.72, 0.69, 0.5],
};

export const STARLINK_COLORS = {
  operational: [0.48, 0.86, 0.81, 0.9],
  other: [0.91, 0.72, 0.42, 0.86],
} as const satisfies Readonly<Record<string, RgbaColor>>;

export const CONJUNCTION_HIGHLIGHT_COLOR: RgbaColor = [1, 0.78, 0.3, 1];

/** Converts the renderer's normalized RGBA tuple into a CSS color. */
export function rgbaToCss(color: RgbaColor): string {
  return `rgba(${color.slice(0, 3).map((value) => Math.round(value * 255)).join(', ')}, ${color[3]})`;
}

/** Builds one presentational item from a normalized renderer color. */
function item(id: string, label: string, color: RgbaColor, count?: number): LegendItem {
  return { id, label, color: rgbaToCss(color), count };
}

/** Adds the transient conjunction key only while the renderer is dimming context around those subjects. */
export function withConjunctionHighlight(
  legend: VisualLegend,
  conjunctionHighlightActive: boolean,
  highlightedObjectCount: number,
): VisualLegend {
  if (!conjunctionHighlightActive) {
    return legend;
  }

  return {
    ...legend,
    items: [
      {
        ...item('close-approach-highlight', 'Close-approach subjects', CONJUNCTION_HIGHLIGHT_COLOR, highlightedObjectCount),
        temporary: true,
      },
      ...legend.items,
    ],
  };
}

/** Returns the exact live key for the current renderer encoding and visible catalog population. */
export function buildVisualLegend(
  encoding: VisualEncoding,
  objects: readonly SpaceObjectView[],
  filters: FilterState,
  conjunctionHighlightActive = false,
  highlightedObjectCount = 0,
): VisualLegend {
  if (encoding === 'orbital-plane') {
    return withConjunctionHighlight({
      encoding,
      title: 'Relative plane density',
      kind: 'threshold',
      items: [
        item('high', '> 75% of peak', [1, 0, 0, 1]),
        item('medium', '> 25–75%', [1, 0.5, 0, 1]),
        item('low', '> 10–25%', [1, 1, 0, 1]),
        item('context', '≤ 10%', [1, 1, 1, 0.3]),
      ],
      disclosure: 'Density is binned by inclination and mean altitude relative to this installed catalog.',
    }, conjunctionHighlightActive, highlightedObjectCount);
  }
  if (encoding === 'data-age') {
    return withConjunctionHighlight({
      encoding,
      title: 'GP element age',
      kind: 'threshold',
      items: [
        item('age1', '< 0.5 day', [0, 1, 0, 0.9]),
        item('age2', '0.5–1 day', [0.6, 0.996, 0, 0.9]),
        item('age3', '1–1.5 days', [0.8, 1, 0, 0.9]),
        item('age4', '1.5–2 days', [1, 1, 0, 0.9]),
        item('age5', '2–2.5 days', [1, 0.8, 0, 0.9]),
        item('age6', '2.5–3 days', [1, 0.6, 0, 0.9]),
        item('age7', '≥ 3 days', [1, 0, 0, 0.9]),
      ],
      disclosure: 'Older elements can make propagated positions less representative.',
    }, conjunctionHighlightActive, highlightedObjectCount);
  }
  const matcher = prepareFilterMatcher(filters);
  const visible = objects.filter(matcher);

  if (encoding === 'launch-cohort') {
    const counts = new Map<string, number>();
    let unknownCount = 0;

    for (const object of visible) {
      const cohort = normalizeLaunchCohort(object.internationalDesignator);

      if (cohort) {
        counts.set(cohort, (counts.get(cohort) ?? 0) + 1);
      } else {
        unknownCount += 1;
      }
    }
    const top = [...counts.entries()]
      .sort(([aId, aCount], [bId, bCount]) => bCount - aCount || aId.localeCompare(bId))
      .slice(0, 6);

    return withConjunctionHighlight({
      encoding,
      title: 'Launch cohorts',
      kind: 'cohort',
      items: [
        ...top.map(([id, count]) => item(id, id, launchCohortColorForKey(id), count)),
        ...(unknownCount > 0
          ? [item('unknown-cohort', 'Unknown designator', UNKNOWN_LAUNCH_COHORT_COLOR, unknownCount)]
          : []),
      ],
      disclosure: counts.size > top.length
        ? `Showing the ${top.length} largest visible named cohorts; gray marks lack a usable international designator.`
        : 'Colors identify shared international launch designators, not mission purpose; gray marks lack a usable designator.',
    }, conjunctionHighlightActive, highlightedObjectCount);
  }

  const counts = {
    kinds: new Map<ObjectKind, number>(),
    regimes: new Map<OrbitRegime, number>(),
    starlinkActive: 0,
    starlinkOther: 0,
  };

  for (const object of visible) {
    counts.kinds.set(object.kind, (counts.kinds.get(object.kind) ?? 0) + 1);
    counts.regimes.set(object.regime, (counts.regimes.get(object.regime) ?? 0) + 1);
    if (object.isStarlink) {
      if (object.active) {
        counts.starlinkActive += 1;
      } else {
        counts.starlinkOther += 1;
      }
    }
  }

  const legends: Record<Exclude<VisualEncoding, 'launch-cohort' | 'orbital-plane' | 'data-age'>, VisualLegend> = {
    'object-type': {
      encoding, title: 'Object class', kind: 'categorical', items: [
        item('payload', 'Payload', OBJECT_COLORS.payload, counts.kinds.get('payload') ?? 0),
        item('rocket-body', 'Rocket body', OBJECT_COLORS['rocket-body'], counts.kinds.get('rocket-body') ?? 0),
        item('debris', 'Debris', OBJECT_COLORS.debris, counts.kinds.get('debris') ?? 0),
        item('other', 'Other', OBJECT_COLORS.other, counts.kinds.get('other') ?? 0),
      ],
    },
    'orbit-regime': {
      encoding, title: 'Orbital regime', kind: 'categorical', items: [
        item('leo', 'LEO', REGIME_COLORS.leo, counts.regimes.get('leo') ?? 0),
        item('meo', 'MEO', REGIME_COLORS.meo, counts.regimes.get('meo') ?? 0),
        item('geo', 'GEO', REGIME_COLORS.geo, counts.regimes.get('geo') ?? 0),
        item('heo', 'Highly elliptical', REGIME_COLORS.heo, counts.regimes.get('heo') ?? 0),
        item('other', 'Other', REGIME_COLORS.other, counts.regimes.get('other') ?? 0),
      ],
    },
    starlink: {
      encoding, title: 'Starlink catalog state', kind: 'categorical', items: [
        item('operational', 'Known active', STARLINK_COLORS.operational, counts.starlinkActive),
        item('other', 'Inactive / unknown', STARLINK_COLORS.other, counts.starlinkOther),
      ],
    },
  };

  return withConjunctionHighlight(legends[encoding], conjunctionHighlightActive, highlightedObjectCount);
}
