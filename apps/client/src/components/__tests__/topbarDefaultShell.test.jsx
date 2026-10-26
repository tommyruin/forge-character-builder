// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shell } from '@shell';
import { TopbarUtilities, describeDriveState } from '../TopbarUtilities.jsx';
import ToolsNav from '../ToolsNav.jsx';
import ThemeMenu, { themeLabel } from '../ThemeMenu.jsx';
import AutosaveToggle from '../AutosaveToggle.jsx';
import UtilityBadge from '../UtilityBadge.jsx';

const css = readFileSync(new NodeURL('../../index.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new NodeURL('../../shell/default/styles.css', import.meta.url), 'utf8');

let cleanup = null;

async function mount(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, rerender: (next) => act(async () => root.render(next)) };
}

async function press(target, key) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('top bar with the default shell', () => {
  it('has no support link, Tools nav or token link', () => {
    expect(shell.links.support).toBeUndefined();
    expect(shell.links.tools).toBeUndefined();
    expect(shell.links.makeToken).toBeUndefined();
    const markup = renderToStaticMarkup(<TopbarUtilities onCloudOpen={() => {}} />);
    expect(markup).not.toContain('fcb-topbar-utility--quiet');
    expect(markup).toContain('aria-label="Theme: Dark"');
    expect(renderToStaticMarkup(<ToolsNav tools={shell.links.tools} />)).toBe('');
    expect(renderToStaticMarkup(<ToolsNav tools={[]} />)).toBe('');
  });

  it('gives Drive sync a glyph badge and its state in words', () => {
    const markup = renderToStaticMarkup(<TopbarUtilities onCloudOpen={() => {}} />);
    expect(markup).toMatch(/aria-label="Open Drive sync \(not connected\)"/);
    expect(markup).toContain('title="Drive sync: not connected"');
    expect(markup).toContain('data-badge="off"');
    expect(describeDriveState({ busy: true })).toEqual({ label: 'syncing', badge: 'busy' });
    expect(describeDriveState({ connected: true, status: 'connected' })).toEqual({ label: 'connected', badge: 'on' });
    expect(describeDriveState({ status: 'reconnect' }).badge).toBe('warn');
    expect(describeDriveState({ connected: true, status: 'error' })).toEqual({ label: 'sync failed', badge: 'warn' });
  });

  it('marks autosave on with a tick and off with a slash', () => {
    const on = renderToStaticMarkup(<AutosaveToggle enabled onToggle={() => {}} />);
    const off = renderToStaticMarkup(<AutosaveToggle enabled={false} onToggle={() => {}} />);
    expect(on).toContain('data-badge="on"');
    expect(off).toContain('data-badge="off"');
    for (const state of ['on', 'off', 'warn', 'busy']) {
      expect(renderToStaticMarkup(<UtilityBadge state={state} />)).toContain('<path');
    }
    expect(css).toMatch(/\.fcb-utility-badge\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/s);
  });

  it('shows the theme menu as a labelled, keyboard-driven menu', async () => {
    const onSelect = vi.fn();
    const themes = ['retro', 'dark', 'light'];
    const { container } = await mount(<ThemeMenu onSelect={onSelect} theme="dark" themes={themes} />);
    const trigger = container.querySelector('button');
    expect(trigger.getAttribute('aria-label')).toBe('Theme: Dark');
    expect(trigger.getAttribute('title')).toBe('Theme: Dark');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    trigger.focus();
    await press(trigger, 'ArrowDown');
    const items = [...container.querySelectorAll('[role="menuitemradio"]')];
    expect(items.map((item) => item.textContent)).toEqual(['Retro', 'Dark', 'Light']);
    expect(items[1].getAttribute('aria-checked')).toBe('true');
    // Focus starts on the theme in use.
    expect(document.activeElement).toBe(items[1]);
    await press(items[1], 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    await press(items[2], 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    await press(items[0], 'End');
    expect(document.activeElement).toBe(items[2]);
    await press(items[2], 'Home');
    expect(document.activeElement).toBe(items[0]);
    await act(async () => items[0].click());
    expect(onSelect).toHaveBeenCalledWith('retro');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the theme menu on Escape and on a click outside', async () => {
    const { container } = await mount(<ThemeMenu onSelect={() => {}} theme="light" themes={['dark', 'light']} />);
    const trigger = container.querySelector('button');
    await act(async () => trigger.click());
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    await press(menu.querySelector('button'), 'Escape');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => trigger.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('capitalises theme names', () => {
    expect(themeLabel('retro')).toBe('Retro');
    expect(themeLabel('light')).toBe('Light');
  });

  it('sizes the bar from the host header tokens with fallbacks in the default shell', () => {
    expect(css).toMatch(/\.fcb-topbar-inner\s*\{[^}]*align-items:\s*center;[^}]*min-height:\s*var\(--dmf-header-height, 56px\);/s);
    expect(css).not.toMatch(/calc\([^)]*--dmf-header-height/);
    for (const token of ['--dmf-header-height', '--dmf-header-background', '--dmf-control-radius', '--dmf-type-control', '--dmf-type-meta']) {
      expect(shellCss, token).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
    }
  });

  it('styles the section tabs as 14 px sentence-case tiles', () => {
    expect(css).toMatch(
      /\.fcb-global-tabs \.fcb-tab\s*\{[^}]*border-radius:\s*var\(--fcb-control-radius\);[^}]*font-size:\s*var\(--dmf-type-control, 14px\);[^}]*text-transform:\s*none;/s,
    );
  });

  it('keeps the library buttons flat with no glow', () => {
    expect(css).toMatch(/\.fcb-character-list \.fcb-button\s*\{[^}]*border-radius:\s*var\(--fcb-control-radius\);[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.fcb-character-list \.fcb-button-primary\s*\{[^}]*background:\s*var\(--dmf-primary\);/s);
  });

  it('gives the retro theme a warning hue apart from its primary', () => {
    const retro = shellCss.slice(shellCss.indexOf(':root[data-theme="retro"]'));
    const value = (name) => retro.match(new RegExp(`${name}:\\s*([^;]+);`))[1];
    expect(value('--dmf-warning')).not.toBe(value('--dmf-primary'));
  });
});

describe('theme menu order', () => {
  it('lists the default theme first, then the rest in the shell’s order', async () => {
    const { themeMenuOrder } = await import('../TopbarUtilities.jsx');
    expect(themeMenuOrder({ AVAILABLE_THEMES: ['dark', 'light', 'retro'], DEFAULT_THEME: 'retro' })).toEqual(['retro', 'dark', 'light']);
    expect(themeMenuOrder({ AVAILABLE_THEMES: ['dark', 'light', 'retro'], DEFAULT_THEME: 'dark' })).toEqual(['dark', 'light', 'retro']);
  });
});
