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
