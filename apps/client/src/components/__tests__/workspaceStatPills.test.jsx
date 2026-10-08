import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorkspaceStatPills from '../WorkspaceStatPills.jsx';

const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8'
);

const detail = (overrides = {}) => ({
  armorClass: 16,
  initiative: 2,
  proficiency: 3,
  speed: 40,
  initiativeAdvantage: false,
  initiativeAdvantageSources: [],
  ...overrides,
});

const render = (props) =>
  renderToStaticMarkup(createElement(WorkspaceStatPills, props));

/** The markup of the pill titled Initiative, up to the next pill. */
const initiativePill = (html) =>
  /<span class="fcb-stat-pill"[^>]*title="Initiative"[^>]*>.*?<\/span>(?=<span class="fcb-stat-pill"|<\/div>)/.exec(
    html
  )?.[0] ?? '';

describe('workspace stat pills', () => {
  it('marks initiative ADV with a labelled tooltip naming the sources', () => {
    const html = render({
      detail: detail({
        initiativeAdvantage: true,
        initiativeAdvantageSources: ['Feral Instinct', 'Sentinel Shield'],
      }),
      hp: 77,
    });
    const pill = initiativePill(html);
    expect(pill).toContain('<strong>2</strong> INIT');
    expect(pill).toContain('>ADV<');
    expect(pill).toContain(
      'title="Advantage on Initiative: Feral Instinct, Sentinel Shield"'
    );
    expect(pill).toContain(
      '<span class="dmf-sr-only">Advantage on Initiative: Feral Instinct, Sentinel Shield</span>'
    );
    // The visible abbreviation is not read twice.
    expect(pill).toMatch(/<span aria-hidden="true">ADV<\/span>/);
  });

  it('shows no ADV marker without advantage', () => {
    const html = render({ detail: detail(), hp: 77 });
    expect(initiativePill(html)).toContain('<strong>2</strong> INIT');
    expect(html).not.toContain('ADV');
    expect(html).not.toContain('Advantage on Initiative');
  });

  it('keeps every pill and its value', () => {
    const html = render({ detail: detail(), hp: undefined });
    for (const [value, label, full] of [
      ['—', 'HP', 'Hit Points'],
      ['16', 'AC', 'Armor Class'],
      ['2', 'INIT', 'Initiative'],
      ['3', 'PROF', 'Proficiency'],
      ['40', 'SPEED', 'Speed'],
    ]) {
      expect(html).toContain(
        `<span class="fcb-stat-pill" title="${full}"><strong>${value}</strong> ${label}`
      );
    }
  });

  it('is the workspace subbar', () => {
    expect(workspaceSource).toContain('<WorkspaceStatPills');
    expect(workspaceSource).not.toContain('["INIT", "Initiative"');
  });
});

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

/** The bodies of every `@media <query>` block, brace-balanced. */
const mediaBlocks = (query) => {
  const blocks = [];
  const opener = `@media ${query} {`;
  for (
    let start = css.indexOf(opener);
    start !== -1;
    start = css.indexOf(opener, start + 1)
  ) {
    let depth = 0;
    const bodyStart = start + opener.length;
    for (let i = bodyStart - 1; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(bodyStart, i));
        break;
      }
    }
  }
  return blocks;
};

/** Declarations of the rules whose selector list names `selector`. */
const rulesFor = (source, selector) =>
  [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) =>
      selectors
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((part) => part.trim())
        .includes(selector)
    )
    .map(([, , body]) => body);

describe('workspace stat bar on phones', () => {
  const mobile = mediaBlocks('(max-width: 820px)').join('\n');

  it('is not hidden by the mobile layout', () => {
    expect(mobile).not.toBe('');
    for (const selector of [
      '.fcb-subbar-stats',
      '.fcb-workspace > .fcb-subbar',
      '.fcb-subbar',
    ]) {
      for (const body of rulesFor(mobile, selector)) {
        expect(body, selector).not.toMatch(/display:\s*none/);
      }
    }
  });

  it('keeps the bottom nav as the only tab strip on phones', () => {
    // The subbar now shows for its stats; its desktop tab strip stays hidden
    // so phones keep a single navigation (the bottom bar).
    expect(
      rulesFor(mobile, '.fcb-subbar .fcb-secondary-tabs').join('\n')
    ).toMatch(/display:\s*none/);
  });

  it('fits the stats on one row that scrolls on its own if it must', () => {
    const row = rulesFor(mobile, '.fcb-subbar-stats').join('\n');
    expect(row).toMatch(/flex-wrap:\s*nowrap/);
    expect(row).toMatch(/overflow-x:\s*auto/);
    const pill = rulesFor(mobile, '.fcb-subbar-stats .fcb-stat-pill').join(
      '\n'
    );
    expect(pill).toMatch(/white-space:\s*nowrap/);
  });

  it('keeps the Save button hidden on phones', () => {
    expect(rulesFor(mobile, '.fcb-save-button').join('\n')).toMatch(
      /display:\s*none/
    );
  });
});
