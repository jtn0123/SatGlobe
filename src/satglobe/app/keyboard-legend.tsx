import { memo } from 'react';
import { Icon } from './icon';
import { useDialogFocus } from './use-dialog-focus';

const shortcuts: Array<[string, string]> = [
  ['/', 'Focus the catalog search'],
  ['F', 'Toggle the presentation view'],
  ['Esc', 'Return to the Workshop'],
  ['← →', 'Previous / next story beat (Story mode)'],
  ['Space', 'Play / pause the story (Story mode)'],
  ['?', 'Show or hide this legend'],
];

/** Compact keyboard-shortcut reference, toggled with "?". */
function KeyboardLegendBase({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div aria-label="Keyboard shortcuts" aria-modal="true" className="sg-keyboard-legend" data-testid="keyboard-legend" ref={dialogRef} role="dialog">
      <div className="sg-inspector-head">
        <div><div className="sg-panel-kicker">KEYBOARD</div><h2>Shortcuts</h2></div>
        <button aria-label="Close shortcuts" className="sg-icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
      </div>
      <dl className="sg-data-list">
        {shortcuts.map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></div>)}
      </dl>
    </div>
  );
}

export const KeyboardLegend = memo(KeyboardLegendBase);
