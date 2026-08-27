import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const source = readFileSync(
  new URL('../DescriptionPanel.jsx', import.meta.url),
  'utf8',
);
// Every panel that fills the details slot, not just the generic one. A second
// implementation of the same panel is exactly where the scroll region gets
// left out, and then nothing scrolls at all.
const DETAIL_PANELS = {
  'DescriptionPanel.jsx': source,
  'tabs/magic/SpellDetails.jsx': readFileSync(
    new URL('../tabs/magic/SpellDetails.jsx', import.meta.url),
    'utf8',
  ),
};

// A scrollbar is painted on the border box, so a rounded panel that scrolls
// itself gets a straight track down its right edge that squares the corners
// wherever the platform draws classic (non-overlay) scrollbars. The panel
// clips and an inner region scrolls, keeping the track away from the radius.
describe('description panel scrolling', () => {
  it('scrolls an inner region rather than the rounded panel', () => {
    expect(source).toContain('fcb-description-scroll');
    expect(source).toMatch(
      /<div\s+ref=\{setPanelRef\}[\s\S]{0,200}fcb-description-scroll/,
    );
  });

  it.each(Object.keys(DETAIL_PANELS))(
    '%s scrolls its inner region, not the panel',
    (name) => {
      const text = DETAIL_PANELS[name];
      // The ref is what actually scrolls, so it has to land on the inner
      // region. On the panel itself the content is simply clipped and there is
      // no way to reach the rest of it.
      expect(text).toContain('fcb-description-scroll');
      expect(text).not.toMatch(
        /<aside\s+ref=\{setPanelRef\}/,
      );
    },
  );

  it('keeps the panel clipping so its corners survive', () => {
    expect(css).toMatch(
      /\.fcb-description-panel\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-description-scroll\s*\{[^}]*overflow-y:\s*auto;/s,
    );
  });

  it('keeps the scroll and focus target one element', () => {
    // The mobile navigation focuses and scrolls whatever scrollRef reports, so
    // the label and tab stop belong on the scrolling region itself.
    expect(source).toMatch(
      /fcb-description-scroll[\s\S]{0,240}tabIndex=\{onReturn \? -1 : undefined\}|tabIndex=\{onReturn \? -1 : undefined\}[\s\S]{0,240}fcb-description-scroll/,
    );
    expect(source).toContain('panelRef.current?.scrollTo');
    expect(source).toContain('onContentReady(panelRef.current)');
  });
});
