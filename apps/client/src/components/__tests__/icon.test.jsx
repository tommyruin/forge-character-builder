import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Icon, { ICON_NAMES } from '../Icon';

describe('Icon registry', () => {
  it('covers every action the UI performs', () => {
    for (const name of [
      'add',
      'remove',
      'delete',
      'edit',
      'close',
      'info',
      'export',
      'import',
      'refresh',
      'randomize',
      'learn',
      'clear',
      'save',
      'chevron-down',
      'move-up',
      'move-down',
      'show',
      'hide',
      'check',
    ]) {
      expect(ICON_NAMES).toContain(name);
    }
  });

  it('draws every icon on one normalized grid', () => {
    for (const name of ICON_NAMES) {
      const markup = renderToStaticMarkup(<Icon name={name} />);
      expect(markup, name).toContain('viewBox="0 0 24 24"');
      expect(markup, name).toContain('stroke="currentColor"');
      expect(markup, name).toContain('stroke-width="1.8"');
      expect(markup, name).toContain('fill="none"');
      expect(markup, name).toContain('aria-hidden="true"');
      expect(markup, name).toContain('class="fcb-icon"');
    }
  });

  it('sizes through the class, not per-call width attributes', () => {
    const markup = renderToStaticMarkup(<Icon name="delete" />);
    expect(markup).not.toMatch(/\swidth=/);
    expect(markup).not.toMatch(/\sheight=/);
  });

  it('accepts extra classes for size variants', () => {
    const markup = renderToStaticMarkup(
      <Icon name="close" className="fcb-icon-sm" />,
    );
    expect(markup).toContain('class="fcb-icon fcb-icon-sm"');
  });

  it('is styled once in the stylesheet', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.fcb-icon\s*\{[^}]*width:/s);
  });
});

describe('icon duplication', () => {
  const files = [
    '../TopbarUtilities.jsx',
    '../WorkspaceNavigation.jsx',
    '../tabs/EquipmentTab.jsx',
    '../tabs/ManageTab.jsx',
  ];

  it('keeps the trash path in the registry alone', () => {
    const trash = 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5';
    const holders = files.filter((file) =>
      readFileSync(new URL(file, import.meta.url), 'utf8').includes(trash),
    );
    expect(holders).toEqual([]);
    expect(
      readFileSync(new URL('../Icon.jsx', import.meta.url), 'utf8'),
    ).toContain(trash);
  });
});
