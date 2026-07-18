import { memo } from 'react';
import { findSelectedConjunction } from '../domain/conjunctions';
import type { ConjunctionState, SpaceObjectView } from '../domain/types';
import { Icon } from './icon';
import { describeEpoch, formatCalendarDate, formatNumber, formatUtc, objectKindLabels, regimeLabels } from './labels';

interface InspectorProps {
  readonly conjunctions: ConjunctionState;
  readonly inert?: boolean;
  readonly object: SpaceObjectView | null;
  readonly onClose: () => void;
}

/** Uses compact scientific notation without turning a valid zero into missing data. */
function formatProbability(value: number): string {
  return value === 0 ? '0' : value.toExponential(2);
}

/** Explains stale/past screening without presenting it as an active alert. */
function conjunctionCaveat(
  status: ConjunctionState['status'],
  temporalLabel: 'next' | 'latest',
): string {
  const caveats: string[] = [];

  if (temporalLabel === 'latest') {
    caveats.push('This is the latest past event in the bundled screening snapshot, not an upcoming alert.');
  }
  if (status === 'stale') {
    caveats.push('The bundled source snapshot is stale; the encounter may have changed.');
  }

  return caveats.length > 0 ? `${caveats.join(' ')} ` : '';
}

/** Shows identity, orbit, mission, screening context, and provenance for the selected record. */
function InspectorBase({ conjunctions, inert, object, onClose }: InspectorProps) {
  if (!object) {
    return (
      <aside className="sg-panel sg-side-panel sg-inspector sg-inspector-empty" inert={inert || undefined}>
        <div className="sg-panel-kicker">INSPECT</div>
        <div className="sg-empty-orbit" aria-hidden="true"><span /><i /></div>
        <h2>Select an object</h2>
        <p>Search by name, catalog ID, launch designator, operator, or country. The selected orbit will remain visible while you explore.</p>
        <div className="sg-truth-note"><Icon name="info" /><span>Positions are predicted from public element sets. They are not live operator telemetry.</span></div>
      </aside>
    );
  }

  const rows = [
    ['Catalog ID', object.catalogId],
    ['International designator', object.internationalDesignator || '—'],
    ['Object class', objectKindLabels[object.kind]],
    ['Status', object.status],
    ['Orbital regime', regimeLabels[object.regime]],
    ['Perigee', `${formatNumber(object.perigeeKm)} km`],
    ['Apogee', `${formatNumber(object.apogeeKm)} km`],
    ['Inclination', `${formatNumber(object.inclinationDeg, 2)}°`],
    ['Period', `${formatNumber(object.periodMinutes, 1)} min`],
  ];
  const selectedConjunction = conjunctions.status === 'loading' || conjunctions.status === 'unavailable'
    ? null
    : findSelectedConjunction(conjunctions.conjunctions, object.catalogId, new Date());

  return (
    <aside className="sg-panel sg-side-panel sg-inspector" data-testid="object-inspector" inert={inert || undefined}>
      <div className="sg-inspector-head">
        <div><div className="sg-panel-kicker">SELECTED OBJECT</div><h2>{object.name}</h2></div>
        <button aria-label="Close inspector" className="sg-icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
      </div>
      <div className="sg-object-tags"><span>{regimeLabels[object.regime]}</span><span>{objectKindLabels[object.kind]}</span><span className={object.active ? 'is-active' : 'is-inactive'}>{object.active ? 'Known active' : 'Inactive / unknown'}</span></div>
      <dl className="sg-data-list">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {selectedConjunction && conjunctions.source && (
        <section
          className="sg-conjunction-detail"
          data-testid="conjunction-detail"
          data-temporal-label={selectedConjunction.temporalLabel}
        >
          <div className="sg-divider" />
          <div className="sg-panel-kicker">PUBLIC CONJUNCTION SCREENING</div>
          <h3>{selectedConjunction.temporalLabel === 'next' ? 'Next close approach' : 'Latest screened approach'}</h3>
          <p className="sg-conjunction-partner">
            with <strong>{selectedConjunction.otherObject.name}</strong>
            <span>Catalog {selectedConjunction.otherObject.catalogId}</span>
          </p>
          <dl className="sg-data-list sg-data-list-soft">
            <div><dt>Closest approach</dt><dd>{formatUtc(selectedConjunction.pair.timeOfClosestApproach)}</dd></div>
            <div><dt>Miss distance</dt><dd>{formatNumber(selectedConjunction.pair.missDistanceKm, 3)} km</dd></div>
            <div><dt>Relative speed</dt><dd>{formatNumber(selectedConjunction.pair.relativeSpeedKmS, 3)} km/s</dd></div>
            <div><dt>Maximum modeled probability</dt><dd>{formatProbability(selectedConjunction.pair.maximumProbability)}</dd></div>
            <div><dt>Dilution threshold</dt><dd>{formatNumber(selectedConjunction.pair.dilutionThreshold, 3)} km</dd></div>
            <div><dt>Element age at approach</dt><dd>{formatNumber(selectedConjunction.selectedObject.dseDays, 3)} / {formatNumber(selectedConjunction.otherObject.dseDays, 3)} days</dd></div>
          </dl>
          <p className="sg-conjunction-source">
            <strong>SOCRATES screening · {conjunctions.status}</strong>
            <span>Source updated {formatUtc(conjunctions.source.updatedAt)}</span>
            <span>Retrieved {formatUtc(conjunctions.source.retrievedAt)}</span>
          </p>
          <div className="sg-truth-note">
            <Icon name="info" />
            <span>
              {conjunctionCaveat(conjunctions.status, selectedConjunction.temporalLabel)}
              Public screening is not live telemetry or an operator alert. Do not use it alone for operational decisions.
            </span>
          </div>
        </section>
      )}
      <div className="sg-divider" />
      <div className="sg-panel-kicker">MISSION & PROVENANCE</div>
      <dl className="sg-data-list sg-data-list-soft">
        <div><dt>Launch</dt><dd>{formatCalendarDate(object.launchDate)}</dd></div>
        <div><dt>Vehicle</dt><dd>{object.launchVehicle || 'Not listed'}</dd></div>
        <div><dt>Operator</dt><dd>{object.owner || 'Not listed'}</dd></div>
        <div><dt>Country</dt><dd>{object.country || 'Not listed'}</dd></div>
        <div><dt>Element epoch</dt><dd>{object.epoch ? formatUtc(object.epoch) : 'Not listed'}<small>{describeEpoch(object.epoch)}</small></dd></div>
        <div><dt>Catalog source</dt><dd>{object.source}</dd></div>
      </dl>
    </aside>
  );
}

export const Inspector = memo(InspectorBase);
