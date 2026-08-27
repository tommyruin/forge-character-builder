import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SheetSettingsPanel from '../tabs/manage/SheetSettingsPanel.jsx';
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

  it('maps every face to a browser font stack', () => {
    for (const name of Object.keys(SHEET_FONT_FACES)) {
      expect(sheetFaceFontFamily(name)).toBeTruthy();
    }
    expect(sheetFaceFontFamily('helvetica')).toContain('Helvetica');
    expect(sheetFaceFontFamily('pirataOne')).toContain('fcb-sheet-face-pirataOne');
  });
});
