/**
 * Companion page contract: the stat block is built from the shared panel
 * primitives (not ad-hoc utility classes), prints each trait and action with
 * its rules text, and offers a portrait for the companion itself.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../tabs/magic/CompanionSection.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('companion page', () => {
  it('names the creature and the feature that granted it', () => {
    expect(source).toContain('fcb-panel-subtitle');
    expect(source).toMatch(/companion\.kind, companion\.owner/);
  });

  it('uses the shared definition list for the creature facts', () => {
    expect(source).toContain('fcb-detail-list');
    expect(source).toContain('<dt>');
    expect(source).toContain('<dd>');
    // The shared rule serves the cloud drawer too, so one selector list covers both.
    expect(css).toMatch(/\.fcb-detail-list,\s*\n\.fcb-cloud-detail-list \{/);
  });

  it('prints trait and action rules text instead of bare chips', () => {
    expect(source).toContain('fcb-companion-feature-text');
    expect(source).toContain('feature.description');
    // The feature groups are structured cards now, not a wrapped chip row.
    expect(source).toContain('fcb-companion-feature-group');
    expect(source).not.toMatch(/fcb-card-title[^\n]*>\{label\}[\s\S]{0,120}flex flex-wrap gap-2/);
  });

  it('inspects the creature from its header and each ability from its name', () => {
    expect(source).toContain('<InspectableItemButton');
    expect(source).toContain('<InformationButton');
    // The rules text prints inline, so a feature carries no second control
    // that would reopen the same words in a panel.
    expect(source).not.toMatch(/fcb-companion-feature-name[\s\S]{0,400}<InformationButton/);
  });

  it('offers a companion portrait through the shared control', () => {
    expect(source).toContain('<PortraitControls');
    expect(source).toContain('setCompanionPortrait');
    expect(source).toContain('removeCompanionPortrait');
    expect(source).toContain('size="lg"');
    // The larger frame is driven by one custom property, not duplicated sizes.
    expect(css).toMatch(/\.fcb-portrait-controls--lg \{[^}]*--fcb-portrait-size:/s);
  });

  it('uses the canonical pill row for the headline statistics', () => {
    expect(source).toContain('fcb-meta-strip');
    expect(source).not.toContain('fcb-toolbar flex-wrap');
  });
});
