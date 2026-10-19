// How the Build tab uses the custom-feature pieces. The tab itself needs a whole workspace to
// render, so the wiring that is easy to break silently is pinned from its source.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../tabs/BuildTab.jsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');

describe('Build tab custom features', () => {
  it('offers [+] Custom in the section header of every section but the companion', () => {
    expect(source).toMatch(/active\.key !== 'companion' && canCustom && \(/);
    expect(source).toMatch(/showsUnderFor\(active\.key\)/);
  });

  it('starts an entry under the section it was started from, else Other', () => {
    expect(source).toMatch(/\['race', 'class', 'feats'\]\.includes\(sectionKey\) \? sectionKey : 'other'/);
  });

  it('lists a custom feat with Edit and Remove for its draft, not as a DM grant', () => {
    expect(source).toMatch(/e\.type === 'Feat' && !customIds\.has\(e\.id\)/);
    expect(source).toMatch(/<CustomEntryRows[\s\S]{0,120}customIn\('feats'\)/);
    expect(source).toContain('customServices.remove(entry.elementId)');
  });

  it('keeps the Other section in the nav while it holds a custom entry', () => {
    expect(source).toMatch(/customEntries\.some\(\(e\) => e\.section === 'other'\)/);
  });

  it('shows the section an entry landed in after it is saved', () => {
    expect(source).toMatch(/onSaved=\{\(saved\) => \{[\s\S]{0,200}setSection\(saved\.section\)/);
  });

  it('groups the header buttons so they sit together at the right edge', () => {
    // Feat / ASI / Custom share one actions group; loose siblings of the title would be spread
    // across the header by its space-between layout.
    expect(source).toMatch(/<div className="fcb-panel-actions">[\s\S]*setAddFeatOpen\(true\)[\s\S]*setCustomDialog\(\{[\s\S]*<\/div>\s*<\/header>/);
    expect(stylesheet).toMatch(/\.fcb-panel-actions \{[^}]*margin-left: auto;/);
  });
});
