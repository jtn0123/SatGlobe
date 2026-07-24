import type { VisualLegend as VisualLegendModel } from '../domain/types';
import { formatNumber } from './labels';

/** Explains the colors currently emitted by SatGlobe's renderer. */
export function VisualLegend({ legend }: Readonly<{ legend: VisualLegendModel }>) {
  return (
    <section className="sg-legend" data-encoding={legend.encoding} data-testid="visual-legend">
      <div className="sg-legend-head"><span>LIVE COLOR KEY</span><strong>{legend.title}</strong></div>
      <div className="sg-legend-items">
        {legend.items.map((entry) => (
          <div className={`sg-legend-item${entry.temporary ? ' is-temporary' : ''}`} data-testid={`legend-item-${entry.id}`} key={entry.id}>
            <i aria-hidden="true" style={{ backgroundColor: entry.color, color: entry.color }} />
            <span>{entry.label}</span>
            {entry.count !== undefined && <small>{formatNumber(entry.count)}</small>}
          </div>
        ))}
      </div>
      {legend.disclosure && <p>{legend.disclosure}</p>}
    </section>
  );
}
