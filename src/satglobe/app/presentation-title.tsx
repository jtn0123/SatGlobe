import { memo } from 'react';
import type { VisualEncoding } from '../domain/types';
import { encodingLabels, formatNumber } from './labels';

/** Renders the minimal editorial title used in presentation mode. */
function PresentationTitleBase({ encoding, objectCount, onOpenWorkshop }: { encoding: VisualEncoding; objectCount: number; onOpenWorkshop: () => void }) {
  return (
    <section className="sg-presentation-title">
      <span>EARTH ORBIT / LOCAL SNAPSHOT</span>
      <h2>A living orbital environment</h2>
      <p>{formatNumber(objectCount)} objects in the current view · {encodingLabels[encoding].toLocaleLowerCase()} encoding</p>
      <button onClick={onOpenWorkshop} type="button">Open workshop</button>
    </section>
  );
}

export const PresentationTitle = memo(PresentationTitleBase);
