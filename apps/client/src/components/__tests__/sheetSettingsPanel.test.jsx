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
    expect(markup).not.toMatch(/save/i);
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
    for (const label of ['Appearance &amp; portrait', 'Notes', 'Spell cards', 'Item cards']) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    // Four page checkboxes, every one ticked: the default sheet prints them all.
    expect(markup.match(/type="checkbox"/g)).toHaveLength(4);
    expect(markup.match(/checked=""/g)).toHaveLength(4);
    expect(markup).toContain('Sheet pages');
  });

  it('maps every face to a browser font stack', () => {
    for (const name of Object.keys(SHEET_FONT_FACES)) {
      expect(sheetFaceFontFamily(name)).toBeTruthy();
    }
    expect(sheetFaceFontFamily('helvetica')).toContain('Helvetica');
    expect(sheetFaceFontFamily('pirataOne')).toContain('fcb-sheet-face-pirataOne');
  });
});
