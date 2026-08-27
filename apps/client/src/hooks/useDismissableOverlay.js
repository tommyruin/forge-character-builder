import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Escape, a focus trap, a scroll lock and focus restore for a side drawer, so
// the close button is never the only way out.
//
// `suspended` releases the keyboard while a dialog rendered outside the panel
// is open: that dialog runs its own Escape handler, and one keypress must not
// dismiss both it and the drawer behind it.
export default function useDismissableOverlay({
  panelRef,
  initialFocusRef,
  onDismiss,
  suspended = false,
}) {
  // Callers pass inline arrows, so the callback identity changes on every
  // parent render. Reading it through a ref keeps those renders out of the
  // mount effect's dependencies, which would otherwise re-run and drag focus
  // back to the trigger mid-interaction.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = document.activeElement;
    document.body.style.overflow = 'hidden';
    initialFocusRef?.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    if (suspended) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll(FOCUSABLE) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panelRef, suspended]);
}
