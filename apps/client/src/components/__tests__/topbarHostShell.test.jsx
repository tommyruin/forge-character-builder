// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A host shell with every optional link: support, a Tools nav (site tools,
// a separate app, and the builder itself as the current entry) and a
// "Make a token" destination.
vi.mock('@shell', async (importOriginal) => {
  const original = await importOriginal();
  const ToolGlyph = ({ size = 16, className = '' }) => (
    <svg aria-hidden="true" className={`test-tool-glyph ${className}`.trim()} height={size} width={size} />
  );
  const shell = {
    ...original.shell,
    theme: { ...original.shell.theme, AVAILABLE_THEMES: ['retro', 'dark', 'light'] },
    links: {
      ...original.shell.links,
      support: { href: 'https://example.test/support', label: 'Support', title: 'Support the host' },
      makeToken: { href: '/tools/token', label: 'Make a token' },
      tools: [
        { href: '/tools/map', label: 'Map maker', Icon: ToolGlyph },
        { href: '/tools/token', label: 'Token maker', title: 'Token maker tool', Icon: ToolGlyph },
        { href: '/builder/', label: 'Character builder', group: 'apps', current: true, Icon: ToolGlyph },
        { href: '/table/', label: 'Table', group: 'apps', Icon: ToolGlyph },
      ],
    },
  };
  return { ...original, shell, default: shell };
});

vi.mock('../../api', () => ({
  api: { characters: { export: vi.fn(), exportPackage: vi.fn() } },
}));

const { shell } = await import('@shell');
const { TopbarUtilities } = await import('../TopbarUtilities.jsx');
const { default: ToolsNav } = await import('../ToolsNav.jsx');
const { default: ExportMenu } = await import('../ExportMenu.jsx');

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
  return container;
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

describe('top bar with a host shell', () => {
  it('shows the support link as a quiet icon named by its title', () => {
    const markup = renderToStaticMarkup(<TopbarUtilities onCloudOpen={() => {}} />);
    expect(markup).toContain('fcb-topbar-utility--quiet');
    expect(markup).toContain('aria-label="Support the host"');
    expect(markup).toContain('title="Support the host"');
    expect(markup).not.toContain('fcb-topbar-utility--support');
  });

  it('names the theme in use with the shell’s theme list', () => {
    const markup = renderToStaticMarkup(<TopbarUtilities onCloudOpen={() => {}} />);
    expect(markup).toMatch(/aria-label="Theme: (Retro|Dark|Light)"/);
    expect(markup).not.toContain('Switch to');
  });

  it('renders a labelled Tools nav that opens the host’s entries', async () => {
    const container = await mount(<ToolsNav tools={shell.links.tools} />);
    const nav = container.querySelector('nav');
    expect(nav.getAttribute('aria-label')).toBe('Tools');
    const trigger = nav.querySelector('button');
    expect(trigger.getAttribute('aria-label')).toBe('Tools');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('Tools');

    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const links = [...nav.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['Map maker', 'Token maker', 'Table']);
    expect(links[1].getAttribute('title')).toBe('Token maker tool');
    // Apps follow a divider, carry a ↗ and say they open their own page.
    expect(nav.querySelector('.fcb-topbar-menu-divider')).not.toBeNull();
    expect(links[2].getAttribute('title')).toBe('Table (opens its own page)');
    expect(links[2].querySelector('.fcb-tools-nav-external')).not.toBeNull();
    expect(links[0].querySelector('.fcb-tools-nav-external')).toBeNull();
    expect(nav.querySelectorAll('.test-tool-glyph')).toHaveLength(4);

    // The builder itself is the current page, not a link.
    const current = nav.querySelector('[aria-current="page"]');
    expect(current.tagName).toBe('SPAN');
    expect(current.textContent).toBe('Character builder');
    expect(current.className).toContain('is-current');
  });

  it('moves through the Tools entries with the keyboard and closes on Escape', async () => {
    const container = await mount(<ToolsNav tools={shell.links.tools} />);
    const trigger = container.querySelector('nav button');
    trigger.focus();
    await press(trigger, 'ArrowDown');
    const links = [...container.querySelectorAll('nav a')];
    expect(document.activeElement).toBe(links[0]);
    await press(links[0], 'End');
    expect(document.activeElement).toBe(links[2]);
    await press(links[2], 'ArrowDown');
    expect(document.activeElement).toBe(links[0]);
    await press(links[0], 'Home');
    expect(document.activeElement).toBe(links[0]);
    await press(links[0], 'Escape');
    expect(container.querySelector('nav a')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the Tools panel on a click outside it', async () => {
    const container = await mount(<ToolsNav tools={shell.links.tools} />);
    const trigger = container.querySelector('nav button');
    await act(async () => trigger.click());
    expect(container.querySelector('nav a')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('nav a')).toBeNull();
  });

  it('offers "Make a token" in the character menu, in the same tab', async () => {
    const container = await mount(<ExportMenu id="Ada" includeSheet label="Export" />);
    await act(async () => container.querySelector('button').click());
    const link = [...container.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Make a token',
    );
    expect(link).toBeDefined();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/tools/token');
    expect(link.hasAttribute('target')).toBe(false);
  });
});
