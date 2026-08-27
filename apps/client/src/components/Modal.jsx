// Centered explanation/confirmation dialog. Renders nothing when closed; Escape or the
// backdrop dismisses. Keep children to short explanatory content + action rows.
import { useEffect } from 'react';
import Icon from './Icon';

export default function Modal({
  open,
  title,
  onClose,
  children,
  size = 'default',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = size === 'wide' ? 'max-w-3xl' : 'max-w-md';

  return (
    <div
      className="fcb-scrim-overlay fixed inset-0 z-50 flex items-center justify-center p-6"
      data-testid="fcb-modal"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full ${widthClass} flex-col rounded-[var(--fcb-radius-lg)] border border-[var(--fcb-border)] bg-[var(--fcb-surface)] p-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="fcb-panel-title">{title}</h3>
          <button onClick={onClose} className="fcb-icon-button" aria-label="Close dialog"><Icon name="close" /></button>
        </div>
        {/* Cap the dialog at 90vh and scroll the body so tall content stays reachable on
            short/phone viewports (the header + close button stay pinned). */}
        <div className="space-y-3 overflow-y-auto text-sm text-[var(--fcb-text)]">{children}</div>
      </div>
    </div>
  );
}
