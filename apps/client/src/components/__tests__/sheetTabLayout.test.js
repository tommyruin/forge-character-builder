import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHEET_RENDERER_REVISION, sheetCacheKey } from '../sheetCache';
import {
  DEFAULT_SHEET_LAYOUT_OPTIONS,
  effectiveSheetLayout,
  sheetLayoutCacheKey,
} from '../../sheetLayoutOptionsSetting.js';

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
      'sheetCacheKey(id, target.tick, true, libraryRevision, templateSet, coloursKey, fontsKey, pagesKey, emphasizeAbilityModifiers, inventoryNotes, layoutKey)',
    );
    expect(previewSource).not.toContain('lite: false');
  });

  it('includes the content revision while preserving tick and variant cache identity', () => {
    expect(source).toContain('libraryRevision');
    expect(previewSource).toContain('libraryRevision');
    expect(cacheSource).toContain('SHEET_RENDERER_REVISION');
    expect(sheetCacheKey('hero', 4, false, 7)).toBe(
      `hero#${SHEET_RENDERER_REVISION}#7#4#2014#crimson/gold/ink#cinzelDecorative/spectral/helvetica/helvetica#background+notes+attackNotes+spellCards+itemCards#scores#no-item-notes#layout-default#full`,
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
        'background+notes+attackNotes+-spellCards+itemCards',
      ),
    );
  });

  it('separates cached PDFs by the item notes switch and retires older renders', () => {
    // v10: the character page has optional layouts (split feature boxes).
    expect(SHEET_RENDERER_REVISION).toBe('pdf-canvas-v10');
    const args = ['hero', 4, false, 7, '2014', 'colours', 'fonts', 'pages', false];
    expect(sheetCacheKey(...args, true)).not.toBe(sheetCacheKey(...args, false));
    expect(sheetCacheKey(...args)).toBe(sheetCacheKey(...args, false));
  });

  it('separates cached PDFs by the effective layout switches', () => {
    const args = ['hero', 4, false, 7, '2014', 'colours', 'fonts', 'pages', false, false];
    const plain = sheetLayoutCacheKey(effectiveSheetLayout('2014', DEFAULT_SHEET_LAYOUT_OPTIONS));
    const split = sheetLayoutCacheKey(effectiveSheetLayout('2014', { ...DEFAULT_SHEET_LAYOUT_OPTIONS, split: true }));
    expect(sheetCacheKey(...args, split)).not.toBe(sheetCacheKey(...args, plain));
    // The same effective layout shares its renders however it was reached.
    expect(sheetLayoutCacheKey(effectiveSheetLayout('2024-hybrid', DEFAULT_SHEET_LAYOUT_OPTIONS))).toBe(
      sheetLayoutCacheKey(effectiveSheetLayout('2024-hybrid', { ...DEFAULT_SHEET_LAYOUT_OPTIONS, split: true })),
    );
  });

  it('passes the effective layout to every sheet render and its cache key', () => {
    const exportSource = readFileSync(new URL('../ExportMenu.jsx', import.meta.url), 'utf8');
    for (const view of [source, previewSource, exportSource]) {
      expect(view).toContain('effectiveSheetLayout(templateSet, layoutOptions)');
      expect(view).toMatch(/sheetBytes\([\s\S]*layout[,:][\s\S]*\)|characters\.sheet\([^)]*layout[,:]/);
    }
    for (const view of [source, previewSource]) {
      expect(view).toMatch(/sheetCacheKey\([\s\S]*?inventoryNotes,\s*(run\.)?layoutKey,?\s*\)/);
      expect(view).toMatch(/const key = `[^`]*\$\{layoutKey\}/);
    }
  });

  it('passes the item notes switch to every sheet render', () => {
    const exportSource = readFileSync(new URL('../ExportMenu.jsx', import.meta.url), 'utf8');
    for (const view of [source, previewSource, exportSource]) {
      expect(view).toContain('useSheetLayoutOptionsSetting');
      expect(view).toMatch(/sheetBytes\([\s\S]*inventoryNotes[\s\S]*\)|characters\.sheet\([^)]*inventoryNotes/);
    }
    expect(source).toMatch(/sheetCacheKey\([\s\S]*?emphasizeAbilityModifiers,\s*inventoryNotes,\s*layoutKey,?\s*\)/);
  });
});
