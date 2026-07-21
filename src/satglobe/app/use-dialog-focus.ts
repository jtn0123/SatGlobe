import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Makes an overlay behave like a modal dialog: moves focus inside on mount,
 * keeps Tab cycling within it, and restores focus to the opener on unmount.
 * Without this, Tab escapes into the still-visible UI behind the overlay.
 */
export function useDialogFocus<T extends HTMLElement>(onDismiss?: () => void): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const onDismissRef = useRef(onDismiss);

  onDismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = ref.current;

    if (!dialog) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));

    (focusables()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onDismissRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();

        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables();

      if (!items.length) {
        return;
      }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex = 0;

      if (event.shiftKey) {
        nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      } else if (currentIndex >= 0 && currentIndex < items.length - 1) {
        nextIndex = currentIndex + 1;
      }

      event.preventDefault();
      items[nextIndex].focus();
    };

    dialog.addEventListener('keydown', onKeyDown);

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);

  return ref;
}
