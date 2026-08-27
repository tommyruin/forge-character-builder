import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FilterSelect from '../FilterSelect.jsx';

const managerSource = readFileSync(
  new URL('../ContentManager.jsx', import.meta.url),
  'utf8',
);
const filterSource = readFileSync(
  new URL('../FilterSelect.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('FilterSelect', () => {
  const options = [
    { value: 'Spell', label: 'Spell (1080)' },
    { value: 'Race', label: 'Race (139)' },
  ];

  it('renders a listbox trigger showing the current choice', () => {
    const markup = renderToStaticMarkup(
      createElement(FilterSelect, {
        value: 'Race',
        options,
        onChange: () => {},
        testId: 'cm-type-filter',
      }),
    );
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-testid="cm-type-filter"');
    expect(markup).toContain('Race (139)');
    expect(markup).not.toContain('Spell (1080)');
  });

  it('falls back to a placeholder when nothing matches the value', () => {
    const markup = renderToStaticMarkup(
      createElement(FilterSelect, {
        value: '',
        options,
        onChange: () => {},
        placeholder: 'All sources',
      }),
    );
    expect(markup).toContain('All sources');
  });

  it('owns its popup so long lists scroll instead of being cut off', () => {
    // A native <select> popup clips on long lists; the component renders its
    // own scroll container instead.
    expect(filterSource).toContain('role="listbox"');
    expect(filterSource).toContain('fcb-filter-select-menu');
    expect(css).toMatch(
      /\.fcb-filter-select-menu\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto;/s,
    );
  });

  it('portals the menu so panel overflow cannot clip it to the card', () => {
    // The first fix positioned the menu inside the elements card, which capped
    // it to the card height (nearly nothing with zero results). The menu must
    // escape every clipping ancestor via a body portal with a fixed position.
    expect(filterSource).toContain('createPortal(');
    expect(filterSource).toContain('document.body');
    expect(filterSource).toContain('getBoundingClientRect');
    expect(css).toMatch(
      /\.fcb-filter-select-menu\s*\{[^}]*position:\s*fixed;/s,
    );
  });

  it('offers an all-types browse option in the content manager', () => {
    expect(managerSource).toContain("export const ALL_TYPES = '*'");
    expect(managerSource).toMatch(/All types \(\$\{totalElementCount\}\)/);
    expect(managerSource).toMatch(
      /if \(effectiveBrowseType !== ALL_TYPES\) params\.type = effectiveBrowseType;/,
    );
  });

  it('scopes the type counts to the active source/search filters', () => {
    // The engine returns typeCounts computed over every filter except the type
    // filter itself; the dropdown labels must prefer those over the
    // library-wide totals so counts agree with the selected source.
    expect(managerSource).toContain('setScopedTypeCounts(next.typeCounts)');
    expect(managerSource).toMatch(
      /scopedTypeCounts \? \(scopedTypeCounts\[type\] \?\? 0\) : count/,
    );
  });

  it('backs both content browser filters', () => {
    expect(managerSource).toMatch(/<FilterSelect[\s\S]{0,200}testId="cm-type-filter"/);
    expect(managerSource).toMatch(/<FilterSelect[\s\S]{0,300}testId="cm-source-filter"/);
    expect(managerSource).not.toMatch(/<select[\s\S]{0,200}cm-(type|source)-filter/);
  });
});
