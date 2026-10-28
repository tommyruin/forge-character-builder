import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const panel = readFileSync(
  new URL('../tabs/manage/AdditionalFeaturesPanel.jsx', import.meta.url),
  'utf8',
);
const manage = readFileSync(
  new URL('../tabs/ManageTab.jsx', import.meta.url),
  'utf8',
);
const desktopStart = css.lastIndexOf('@media (min-width: 821px)');
const desktop = css.slice(
  desktopStart,
  css.indexOf('@media (max-width: 820px)', desktopStart),
);

// Manage › Additional features follows the item pane: on a wide window the
// header, the search and the category tabs stay put and only the feature list
// scrolls, inside a panel that keeps clipping to its rounded corners. A narrow
// window keeps the ordinary page scroll, so none of this leaves the desktop
// block.
describe('additional features scrolling', () => {
  it('stops the Manage wrapper scrolling on this sub-tab and clips it instead', () => {
    expect(desktop).toMatch(
      /\.fcb-manage-content\s*>\s*\.fcb-manage-single-primary\.fcb-manage-features-primary\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s,
    );
    expect(manage).toMatch(
      /subTab === 'features' \? ' fcb-manage-features-primary' : ''/,
    );
  });

  it('carries the bounded height down to the panel body', () => {
    expect(desktop).toMatch(
      /\.fcb-additional-features-grid\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;/s,
    );
    // Without min-height: 0 the grid's auto row grows to the whole list.
    expect(desktop).toMatch(
      /\.fcb-additional-features-primary\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*flex-direction:\s*column;/s,
    );
    for (const name of ['panel', 'body']) {
      expect(desktop).toMatch(
        new RegExp(
          `\\.fcb-additional-features-${name}\\s*\\{[^}]*min-height:\\s*0;[^}]*flex:\\s*1 1 auto;[^}]*overflow:\\s*hidden;`,
          's',
        ),
      );
    }
  });

  it('scrolls the list in the shared pane scroller rule', () => {
    const shared = [
      ...desktop.matchAll(/([^{}]*)\{[^{}]*overflow-y:\s*auto;[^{}]*border-radius:\s*0;[^{}]*\}/gs),
    ].map((match) => match[1]);
    expect(
      shared.some(
        (selectors) =>
          selectors.includes('.fcb-additional-features-scroll') &&
          selectors.includes('.fcb-inventory-scroll'),
      ),
    ).toBe(true);
    expect(desktop).toMatch(
      /\.fcb-additional-features-scroll\s*\{[^}]*flex:\s*1 1 auto;/s,
    );
  });

  it('leaves the narrow window on its document scroll', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 820px)', desktopStart));
    expect(mobile).not.toContain('fcb-additional-features');
    expect(css.slice(0, desktopStart)).not.toMatch(
      /\.fcb-additional-features-(scroll|panel|body|primary|grid)\s*\{/,
    );
  });

  it('keeps the search and the tabs outside the scroll region, with the list inside it', () => {
    const scrollAt = panel.indexOf('className="fcb-additional-features-scroll');
    expect(scrollAt).toBeGreaterThan(-1);
    expect(panel.indexOf('type="search"')).toBeLessThan(scrollAt);
    expect(panel.indexOf('className="fcb-feature-category-nav"')).toBeLessThan(scrollAt);
    expect(panel.indexOf('<FeatureList', scrollAt)).toBeGreaterThan(scrollAt);
    expect(panel.indexOf('Loading features…', scrollAt)).toBeGreaterThan(scrollAt);
  });

  it('registers the list as the scroll owner, not the Manage wrapper', () => {
    expect(panel).toMatch(
      /className="fcb-additional-features-scroll[^"]*"\s*\n\s*ref=\{registerPrimaryScroll\}/,
    );
    expect(manage).toMatch(
      /ref=\{subTab === 'features' \? undefined : registerPrimaryScroll\}/,
    );
  });
});
