import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SectionNav from '../SectionNav';

const items = [
  { key: 'race', label: 'Race', detail: '1 choices' },
  { key: 'class', label: 'Class', detail: '2 choices', badge: <span className="fcb-tab-dot" /> },
  { key: 'feats', label: 'Feats' },
];

describe('SectionNav', () => {
  it('renders the shared left-nav markup', () => {
    const markup = renderToStaticMarkup(
      <SectionNav ariaLabel="Build sections" items={items} activeKey="class" onSelect={() => {}} />
    );

    expect(markup).toContain('<nav class="fcb-left-nav" aria-label="Build sections">');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('class="fcb-nav-item is-active"');
    expect(markup).toContain('<span class="fcb-nav-item-title">Race</span>');
    expect(markup).toContain('<span class="fcb-nav-item-detail">1 choices</span>');
    expect(markup).toContain('<span class="fcb-tab-dot"></span>');
  });

  it('marks only the active item and omits missing details', () => {
    const markup = renderToStaticMarkup(
      <SectionNav ariaLabel="x" items={items} activeKey="race" onSelect={() => {}} />
    );

    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    // "Feats" has no detail entry, so no empty detail span is rendered for it.
    expect(markup.match(/fcb-nav-item-detail/g)).toHaveLength(2);
  });

  it('appends extra nav classes', () => {
    const markup = renderToStaticMarkup(
      <SectionNav ariaLabel="x" className="fcb-equipment-category-nav" items={items} activeKey="race" onSelect={() => {}} />
    );

    expect(markup).toContain('class="fcb-left-nav fcb-equipment-category-nav"');
  });
});

describe('SectionNav adoption', () => {
  // The four workspace tabs must share one nav implementation; page files may
  // not hand-roll the left-nav markup.
  const adopters = [
    '../tabs/BuildTab.jsx',
    '../tabs/EquipmentTab.jsx',
    '../tabs/MagicTab.jsx',
    '../tabs/ManageTab.jsx',
  ];

  for (const file of adopters) {
    it(`${file} uses SectionNav instead of literal left-nav markup`, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).toContain('<SectionNav');
      expect(source).not.toContain('"fcb-left-nav');
      expect(source).not.toContain('fcb-nav-item ');
    });
  }
});
