import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';

// "retro" -> "Retro". Theme names come from the shell, so their labels are
// derived rather than kept in a second list.
export function themeLabel(theme) {
  const name = String(theme ?? '');
  return name ? name[0].toUpperCase() + name.slice(1) : '';
}

function PaletteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="fcb-theme-menu-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" />
      <circle cx="7.5" cy="10.5" r=".6" />
      <circle cx="10.5" cy="7" r=".6" />
      <circle cx="15" cy="7.5" r=".6" />
    </svg>
  );
}

/**
 * "Theme: Retro" button with a small menu of the shell's themes. It names the
 * theme in use rather than the one a click would switch to. The text label
 * shows from 1280 px; below that the button is icon-only and the same words
 * are its accessible name and tooltip.
 */
export default function ThemeMenu({ theme, themes, onSelect }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const menuId = useId();
  const label = `Theme: ${themeLabel(theme)}`;

  const close = useCallback((returnFocus) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const activeIndex = Math.max(0, themes.indexOf(theme));
    itemRefs.current[activeIndex]?.focus();

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
    // Focus moves only when the menu opens, not on every theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleMenuKeyDown = (event) => {
    const items = itemRefs.current.filter(Boolean);
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const choose = (value) => {
    onSelect(value);
    close(true);
  };

  return (
    <div className="fcb-theme-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="fcb-topbar-utility fcb-topbar-utility--labelled fcb-theme-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        title={label}
        type="button"
      >
        <PaletteIcon />
        <span className="fcb-topbar-utility-label">{label}</span>
        <Icon name="chevron-down" className="fcb-icon-sm fcb-topbar-utility-label" />
      </button>
      {open ? (
        <div
          aria-label="Theme"
          className="fcb-topbar-menu"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          role="menu"
        >
          {themes.map((value, index) => {
            const checked = value === theme;
            return (
              <button
                key={value}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                aria-checked={checked}
                className="fcb-topbar-menu-item"
                onClick={() => choose(value)}
                role="menuitemradio"
                tabIndex={-1}
                type="button"
              >
                <span>{themeLabel(value)}</span>
                {checked ? <Icon name="check" className="fcb-icon-sm" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
