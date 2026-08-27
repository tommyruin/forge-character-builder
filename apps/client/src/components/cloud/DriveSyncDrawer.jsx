import { useEffect, useRef } from 'react';
import DriveSyncPanel from './DriveSyncPanel.jsx';
import Icon from '../Icon';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function DriveSyncDrawer({
  beforeSync,
  onClose,
  onLibraryChanged,
  onReviewDuplicates,
  onSyncFinished,
}) {
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll(FOCUSABLE) ?? [],
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
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fcb-cloud-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        aria-labelledby="fcb-cloud-drawer-title"
        aria-modal="true"
        className="fcb-cloud-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <header className="fcb-cloud-drawer-header">
          <div>
            <p className="fcb-cloud-drawer-eyebrow">Character Builder</p>
            <h1 id="fcb-cloud-drawer-title">Storage & sync</h1>
          </div>
          <button
            aria-label="Close Storage & Sync"
            className="fcb-icon-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="fcb-cloud-drawer-body">
          <DriveSyncPanel
            beforeSync={beforeSync}
            compact
            onLibraryChanged={onLibraryChanged}
            onReviewDuplicates={onReviewDuplicates}
            onSyncFinished={onSyncFinished}
          />
        </div>
      </aside>
    </div>
  );
}
