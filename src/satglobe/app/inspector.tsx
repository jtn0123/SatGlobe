import { memo } from 'react';
import type { SpaceObjectView } from '../domain/types';
import { Icon } from './icon';
import { describeEpoch, formatCalendarDate, formatNumber, formatUtc, objectKindLabels, regimeLabels } from './labels';

/** Shows identity, orbit, mission, and provenance for the selected record. */
function InspectorBase({ object, onClose }: { object: SpaceObjectView | null; onClose: () => void }) {
  if (!object) {
    return (
      <aside className="sg-panel sg-side-panel sg-inspector sg-inspector-empty">
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

  return (
    <aside className="sg-panel sg-side-panel sg-inspector" data-testid="object-inspector">
      <div className="sg-inspector-head">
        <div><div className="sg-panel-kicker">SELECTED OBJECT</div><h2>{object.name}</h2></div>
        <button aria-label="Close inspector" className="sg-icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
      </div>
      <div className="sg-object-tags"><span>{regimeLabels[object.regime]}</span><span>{objectKindLabels[object.kind]}</span><span className={object.active ? 'is-active' : 'is-inactive'}>{object.active ? 'Known active' : 'Inactive / unknown'}</span></div>
      <dl className="sg-data-list">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
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
