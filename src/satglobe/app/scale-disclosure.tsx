import type { ScaleMode } from '../domain/types';
import { Icon } from './icon';

/** Shows and toggles the visual scale disclosure shared by all modes. */
export function ScaleDisclosure({ mode, onToggle }: { mode: ScaleMode; onToggle: () => void }) {
  return (
    <div className="sg-scale-disclosure" data-testid="scale-disclosure">
      <Icon name="info" size={15} />
      <span><strong>{mode === 'semantic' ? 'SEMANTIC SCALE' : 'TRUE SCALE'}</strong>{mode === 'semantic' ? ' Marks are enlarged for legibility.' : ' Physical scale comparison; most objects become sub-pixel.'}</span>
      <button onClick={onToggle} type="button">{mode === 'semantic' ? 'Compare true scale' : 'Restore readable marks'}</button>
    </div>
  );
}
