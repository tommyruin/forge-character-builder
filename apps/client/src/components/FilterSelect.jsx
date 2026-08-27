import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Drop-in replacement for a filter <select>. Options may carry a `style`
// (e.g. a font family) that both the option row and the chosen value take,
// which the native control cannot do. The native control delegates its
// popup to the platform, which clips long option lists (the content browser's
// 40+ element types) with no way to scroll. The listbox is portaled to
// document.body and fixed-positioned from the trigger's rect, so no ancestor
// (panel bodies, scroll containers, cards with overflow) can clip it — it is
// bounded only by the viewport and scrolls internally.
export default function FilterSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Choose…',
  testId,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.innerHeight;
      const below = viewportHeight - rect.bottom - 12;
      const above = rect.top - 12;
      // Open upward only when the space below is cramped and above is roomier.
      const openUp = below < 160 && above > below;
      const maxHeight = Math.min(320, Math.max(120, openUp ? above : below));
      setPosition({
        left: rect.left,
        width: rect.width,
        top: openUp ? null : rect.bottom + 4,
        bottom: openUp ? viewportHeight - rect.top + 4 : null,
        maxHeight,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    // Capture-phase so scrolls inside nested panels reposition the menu too.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = options.find((option) => option.value === value) ?? null;

  const menu =
    open && position
      ? createPortal(
          <ul
            className="fcb-filter-select-menu"
            role="listbox"
            ref={menuRef}
            style={{
              left: position.left,
              width: position.width,
              top: position.top ?? 'auto',
              bottom: position.bottom ?? 'auto',
              maxHeight: position.maxHeight,
            }}
          >
            {options.map((option) => (
              <li key={option.key ?? option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`fcb-filter-select-option ${option.value === value ? 'is-selected' : ''}`}
                  style={option.style}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))}
            {options.length === 0 && (
              <li className="fcb-filter-select-empty">No options</li>
            )}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div className={`fcb-filter-select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="fcb-select fcb-filter-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fcb-filter-select-value" style={current?.style}>
          {current ? current.label : placeholder}
        </span>
        <span className="fcb-filter-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}
