import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SheetSettingsPanel from '../tabs/manage/SheetSettingsPanel.jsx';
import { WorkspaceContext } from '../WorkspaceContext';
import { sheetFaceFontFamily } from '../../sheetFontFaces.js';
import { SHEET_FONT_FACES } from '../../sheetFontsSetting.js';

describe('SheetSettingsPanel', () => {
  const markup = renderToStaticMarkup(createElement(SheetSettingsPanel));

  it('offers each typeface role as a dropdown showing its face, with no save button', () => {
    for (const role of ['titles', 'captions', 'body', 'numbers']) {
      expect(markup).toContain(`data-testid="sheet-face-${role}"`);
    }
    // The chosen value wears its own face; the default title face is Cinzel Decorative.
    expect(markup).toContain(`font-family:${sheetFaceFontFamily('cinzelDecorative').replace(/"/g, '&quot;')}`);
    for (const button of markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      expect(button[1]).not.toMatch(/\bsave\b/i);
    }
  });

  it('explains every colour part and typeface role with a tip', () => {
    for (const tip of [
      "Colours the sheet&#x27;s borders, title ribbons and shields.",
      'Colours the inner rules, ornaments and small captions.',
      'Colours the labels and the values written into the sheet.',
      'The section names and ribbon titles.',
      'Ability scores, armor class, hit points and similar figures.',
    ]) {
      expect(markup).toContain(`aria-label="${tip}"`);
    }
  });

  it('offers to match the layout to the character\'s ruleset, and only on a mismatch', () => {
    const inWorkspace = (rulesetMode) => renderToStaticMarkup(
      createElement(
        WorkspaceContext.Provider,
        { value: { detail: { rulesetMode } } },
        createElement(SheetSettingsPanel),
      ),
    );
    // The default layout is the 2014 one, so a 2024 character mismatches.
    const mismatched = inWorkspace('2024');
    expect(mismatched).toContain('Match ruleset');
    expect(mismatched).toContain('built on the 2024 rules');
    expect(inWorkspace('2014')).not.toContain('Match ruleset');
    expect(inWorkspace('all')).not.toContain('Match ruleset');
    // Rendered without a workspace there is no character to compare against.
    expect(markup).not.toContain('Match ruleset');
  });

  it('offers each optional page as a checkbox, on by default', () => {
    for (const label of ['Appearance &amp; portrait', 'Notes', 'Attack notes', 'Spell cards', 'Item cards']) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    // Five page checkboxes on, plus ability emphasis, compact top row, split
    // feature boxes, smart cards and item notes off by default on the 2014 layout.
    expect(markup.match(/type="checkbox"/g)).toHaveLength(10);
    expect(markup.match(/checked=""/g)).toHaveLength(5);
    expect(markup).toContain('Sheet pages');
    expect(markup).toContain('Emphasize ability modifiers');
  });

  it('explains that item cards follow each item\'s own Card choice', () => {
    expect(markup).not.toContain('that carries a description');
    expect(markup).toContain('Card on the Equipment tab');
  });

  it('offers smart cards as a switch, off by default', () => {
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('Only give new items a card when they&#x27;re magic, tools or useful gear');
    expect(markup).not.toMatch(/role="switch"[^>]*checked=""/);
  });

  it('offers item notes for the inventory as a switch, off by default', () => {
    expect(markup).toContain('Print item notes in the inventory: magic items in full, tools and useful gear in brief');
    expect(markup.match(/role="switch"/g)).toHaveLength(4);
  });

  it('offers a compact top row as a layout option, off by default', () => {
    const top = markup.match(/<input[^>]*aria-label="Compact top row"[^>]*>/)?.[0];
    expect(top).toBeDefined();
    expect(top).toContain('role="switch"');
    expect(top).not.toContain('checked=""');
    expect(markup).toContain('Compact top row');
  });

  it('offers split feature boxes as a layout option, off on the default layout', () => {
    expect(markup).toContain('Layout options');
    expect(markup).toContain('Split feature boxes');
    expect(markup).toContain('Separate boxes for class features, subclass features and feats');
    const split = markup.match(/<input[^>]*aria-label="Split feature boxes"[^>]*>/)?.[0];
    expect(split).toBeDefined();
    expect(split).toContain('role="switch"');
    expect(split).not.toContain('checked=""');
    // Nothing overridden, so there is no default to return to.
    expect(markup).not.toContain('Use layout default');
  });

  it('offers the bulk item-card actions only with a character open', () => {
    expect(markup).not.toContain('Cards for magic &amp; useful items only');
    expect(markup).not.toContain('No item cards');
    const inWorkspace = renderToStaticMarkup(
      createElement(
        WorkspaceContext.Provider,
        { value: { id: 'Ada', detail: { rulesetMode: '2014' } } },
        createElement(SheetSettingsPanel),
      ),
    );
    expect(inWorkspace).toContain('Cards for magic &amp; useful items only');
    expect(inWorkspace).toContain('No item cards');
  });

  it('maps every face to a browser font stack', () => {
    for (const name of Object.keys(SHEET_FONT_FACES)) {
      expect(sheetFaceFontFamily(name)).toBeTruthy();
    }
    expect(sheetFaceFontFamily('helvetica')).toContain('Helvetica');
    expect(sheetFaceFontFamily('pirataOne')).toContain('fcb-sheet-face-pirataOne');
  });
});
