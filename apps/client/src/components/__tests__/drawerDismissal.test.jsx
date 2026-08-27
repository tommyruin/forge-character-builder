// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { useRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useDismissableOverlay from '../../hooks/useDismissableOverlay';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A drawer reduced to what the hook touches: a panel holding two focusable
// controls, with the close button as the initial focus target.
function Drawer({ onDismiss, suspended }) {
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);
  useDismissableOverlay({
    panelRef,
    initialFocusRef: closeButtonRef,
    onDismiss,
    suspended,
  });
  return (
    <div ref={panelRef}>
      <button data-testid="close" ref={closeButtonRef} type="button">
        Close
      </button>
      <button data-testid="action" type="button">
        Action
      </button>
    </div>
  );
}

let container;
let root;
let trigger;

beforeEach(() => {
  document.body.style.overflow = '';
  trigger = document.createElement('button');
  trigger.dataset.testid = 'trigger';
  document.body.append(trigger);
  trigger.focus();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  trigger.remove();
  document.body.style.overflow = '';
});

function mount(props = {}) {
  act(() => root.render(<Drawer onDismiss={() => {}} {...props} />));
}

function pressKey(key, init = {}) {
  act(() => {
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        ...init,
      }),
    );
  });
}

const find = (testid) => document.querySelector(`[data-testid="${testid}"]`);

describe('useDismissableOverlay', () => {
  it('dismisses on Escape', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss });

    pressKey('Escape');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a dialog rendered outside the panel', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss, suspended: true });

    pressKey('Escape');

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('resumes handling Escape once that dialog closes', () => {
    const onDismiss = vi.fn();
    mount({ onDismiss, suspended: true });
    act(() => root.render(<Drawer onDismiss={onDismiss} suspended={false} />));

    pressKey('Escape');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls the latest callback without re-running the mount effect', () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    mount({ onDismiss: stale });

    find('action').focus();
    // A new callback identity on every parent render must not re-focus the
    // close button or re-lock scrolling behind the user's cursor.
    act(() => root.render(<Drawer onDismiss={fresh} />));
    expect(document.activeElement).toBe(find('action'));

    pressKey('Escape');

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('focuses the close button and restores focus to the opener', () => {
    mount();
    expect(document.activeElement).toBe(find('close'));

    act(() => root.unmount());
    root = createRoot(container);

    expect(document.activeElement).toBe(trigger);
  });

  it('locks body scrolling and restores the previous value', () => {
    document.body.style.overflow = 'auto';
    mount();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => root.unmount());
    root = createRoot(container);

    expect(document.body.style.overflow).toBe('auto');
  });

  it('cycles Tab from the last control back to the first', () => {
    mount();
    find('action').focus();

    pressKey('Tab');

    expect(document.activeElement).toBe(find('close'));
  });

  it('cycles Shift+Tab from the first control back to the last', () => {
    mount();
    find('close').focus();

    pressKey('Tab', { shiftKey: true });

    expect(document.activeElement).toBe(find('action'));
  });
});

describe('workspace side drawers', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const css = read('../../index.css');
  const drawers = {
    'LevelUpFlyout.jsx': read('../LevelUpFlyout.jsx'),
    'MigrationDrawer.jsx': read('../MigrationDrawer.jsx'),
  };

  it('gives the panel a dialog role and the shared drawer geometry', () => {
    for (const [name, source] of Object.entries(drawers)) {
      expect(source, name).toContain('useDismissableOverlay');
      expect(source, name).toContain('role="dialog"');
      expect(source, name).toContain('aria-modal="true"');
      expect(source, name).toContain('className="fcb-side-drawer"');
      expect(source, name).not.toContain('max-w-[92vw]');
    }
  });

  it('dismisses only on a press that starts on the backdrop', () => {
    for (const [name, source] of Object.entries(drawers)) {
      expect(source, name).toContain('e.target === e.currentTarget');
      expect(source, name).not.toContain('e.stopPropagation()');
    }
  });

  it('keeps the close button out of the scrolling region', () => {
    // The close button is the only way out once the panel is full-width, so it
    // must not scroll away with a long level history behind it.
    for (const [name, source] of Object.entries(drawers)) {
      expect(source, name).toContain('className="fcb-side-drawer-header"');
      expect(source, name).toContain('className="fcb-side-drawer-body"');
      expect(source, name).toMatch(
        /fcb-side-drawer-header[\s\S]*ref=\{closeButtonRef\}[\s\S]*fcb-side-drawer-body/,
      );
    }
    expect(css).toMatch(
      /\.fcb-side-drawer\s*\{[^}]*grid-template-rows: auto minmax\(0, 1fr\);/s,
    );
    expect(css).toMatch(/\.fcb-side-drawer-body\s*\{[^}]*overflow-y: auto;/s);
    // Only the body scrolls; a scrollable panel would carry the header with it.
    expect(css).not.toMatch(
      /\.fcb-side-drawer\s*\{[^}]*overflow-y: auto;/s,
    );
  });

  it('fills the screen where no scrim is left to tap', () => {
    expect(css).toMatch(
      /\.fcb-side-drawer\s*\{[^}]*width: min\(24rem, 100vw\);/s,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.fcb-side-drawer\s*\{[^}]*width: 100vw;/,
    );
  });
});
