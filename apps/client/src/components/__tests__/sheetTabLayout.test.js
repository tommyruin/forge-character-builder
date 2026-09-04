import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHEET_RENDERER_REVISION, sheetCacheKey } from '../sheetCache';

const source = readFileSync(
  new URL('../tabs/SheetTab.jsx', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const previewSource = readFileSync(
  new URL('../SheetPreviewPanel.jsx', import.meta.url),
  'utf8',
);
const cacheSource = readFileSync(
  new URL('../sheetCache.js', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('SheetTab floating controls', () => {
  it('gives the sheet its full height with no header row', () => {
    // The sheet is the content: its controls float over the page rather than
    // costing a full-width bar above it.
    expect(source).not.toContain('fcb-sheet-header');
    expect(source).not.toContain('fcb-sheet-title');
    expect(source).not.toContain('fcb-panel-header');
  });

  it('keeps every sheet action available in the floating toolbar', () => {
    expect(source).toContain('fcb-sheet-float');
    expect(source).toContain('fcb-sheet-zoom');
    expect(source).toContain("'Regenerate character sheet'");
    expect(source).toContain("'Generating character sheet'");
    expect(source).toContain('aria-label="Save character sheet"');
    expect(source).toContain('aria-label="Zoom in"');
    expect(source).toContain('aria-label="Zoom out"');
  });

  it('draws the toolbar icons from the shared registry', () => {
    expect(source).toContain('<Icon name="refresh" />');
    expect(source).toContain('<Icon name="save" />');
    expect(source).not.toContain('fcb-sheet-action-icon');
    expect(source).not.toContain('<svg');
  });

  it('floats the toolbar over the top right of the canvas', () => {
    expect(css).toMatch(
      /\.fcb-sheet-float\s*\{[^}]*position:\s*absolute;[^}]*top:[^}]*right:/s,
    );
    // It must sit above the canvas and stay put while the sheet scrolls.
    expect(css).toMatch(/\.fcb-sheet-float\s*\{[^}]*z-index:/s);
    expect(css).toMatch(
      /\.fcb-sheet-tab\s*\{[^}]*position:\s*relative;/s,
    );
    expect(source).toContain('fcb-panel-body fcb-sheet-body');
  });

  it('does not mount or generate hidden sheet views', () => {
    expect(workspaceSource).toContain('const splitActive = active &&');
    expect(workspaceSource).toContain('{tab === "sheet" && active &&');
    expect(source).toMatch(
      /const\s*\{[\s\S]*id,[\s\S]*mutationTick,[\s\S]*libraryRevision[\s\S]*registerPrimaryScroll,[\s\S]*\}\s*= useWorkspace\(\)/,
    );
    expect(previewSource).toContain(
      'const { id, mutationTick, libraryRevision = 0, active }',
    );
  });

  it('requests and caches the lite sheet in the split-view Live Sheet (deployed-site behavior)', () => {
    expect(previewSource).toContain('lite: true');
    expect(previewSource).toContain(
      'sheetCacheKey(id, target.tick, true, libraryRevision, templateSet, coloursKey, fontsKey, pagesKey)',
    );
    expect(previewSource).not.toContain('lite: false');
  });

  it('includes the content revision while preserving tick and variant cache identity', () => {
    expect(source).toContain('libraryRevision');
    expect(previewSource).toContain('libraryRevision');
    expect(cacheSource).toContain('SHEET_RENDERER_REVISION');
    expect(sheetCacheKey('hero', 4, false, 7)).toBe(
      `hero#${SHEET_RENDERER_REVISION}#7#4#2014#crimson/gold/ink#cinzelDecorative/spectral/helvetica/helvetica#background+notes+spellCards+itemCards#full`,
    );
    expect(
      sheetCacheKey('hero', 4, false, 7),
    ).not.toBe(sheetCacheKey('hero', 4, false, 8));
    expect(
      sheetCacheKey('hero', 4, false, 7),
    ).not.toBe(sheetCacheKey('hero', 5, false, 7));
    expect(
      sheetCacheKey('hero', 4, false, 7),
    ).not.toBe(sheetCacheKey('hero', 4, true, 7));
    // Dropping a page produces different bytes, so it must produce a different key.
    expect(sheetCacheKey('hero', 4, false, 7)).not.toBe(
      sheetCacheKey(
        'hero',
        4,
        false,
        7,
        '2014',
        'crimson/gold/ink',
        'cinzelDecorative/spectral/helvetica/helvetica',
        'background+notes+-spellCards+itemCards',
      ),
    );
  });
});
