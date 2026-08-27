import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const source = readFileSync(
  new URL('../tabs/EquipmentTab.jsx', import.meta.url),
  'utf8',
);
const desktopStart = css.lastIndexOf('@media (min-width: 821px)');
// Bound the slice at the mobile block that follows, which keeps its own
// document-scroll rules and legitimately leaves the catalog overflow visible.
const desktop = css.slice(
  desktopStart,
  css.indexOf('@media (max-width: 820px)', desktopStart),
);

// The panel owns its height: the search is a fixed header and only the item
// list scrolls, which lets the panel keep clipping to its radius. A catalog
// that scrolled as a whole would run its rows across the rounded corners and
// square them off at both ends.
describe('equipment catalog scrolling', () => {
  it('clips the catalog panel so its corners stay rounded', () => {
    expect(desktop).toMatch(
      /\.fcb-equipment-catalog\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(desktop).not.toMatch(
      /\.fcb-equipment-catalog\s*\{[^}]*overflow:\s*visible;/s,
    );
  });

  it('gives the item list its own scroll region under a fixed search header', () => {
    expect(desktop).toMatch(
      /\.fcb-equipment-catalog \.fcb-equipment-results\s*\{[^}]*overflow-y:\s*auto;/s,
    );
    expect(desktop).toMatch(
      /\.fcb-equipment-search\s*\{[^}]*position:\s*static;/s,
    );
  });

  it('gives the inventory grid the app-height treatment the other tabs have', () => {
    // Without it the grid row is content-sized, so a panel inside it can never
    // resolve a height and its inner region would overflow instead of scroll.
    expect(desktop).toMatch(
      /\.fcb-equipment-tab\s*>\s*\.fcb-two-panel-grid\s*\{[^}]*min-height:\s*0;/s,
    );
    expect(desktop).toMatch(
      /\.fcb-equipment-tab\s*>\s*\.fcb-two-panel-grid\s*\{[^}]*flex:\s*1 1 auto;/s,
    );
  });

  it('clips the inventory panel and scrolls the region inside it', () => {
    expect(desktop).toMatch(
      /\.fcb-inventory-primary\s*\{[^}]*overflow:\s*hidden;/s,
    );
    // The scroll behaviour itself lives in the shared I4 rule, which lists
    // every pane scroll owner — see workspaceLayoutContract.test.js.
    expect(desktop).toMatch(
      /\.fcb-inventory-scroll[^{]*\{[^}]*overflow-y:\s*auto;/s,
    );
    expect(source).toMatch(
      /className="fcb-inventory-scroll"\s+ref=\{registerPrimaryScroll\}/,
    );
    expect(source).not.toMatch(
      /fcb-editor-primary fcb-inventory-primary"\s*\n\s*ref=\{registerPrimaryScroll\}/,
    );
  });

  // The rail carries every equipment category the loaded content publishes —
  // seventeen on the public base alone — which is more than a 1080p pane is
  // tall. With `overflow-y: hidden` the categories past the pane's bottom edge
  // would be unreachable, so the scrolling belongs to the shared rail rule, which every tab's rail
  // takes — see workspaceLayoutContract.test.js — so what this checks is that
  // the category rail is not carved back out of it.
  it('leaves the category rail inside the shared scrolling rail rule', () => {
    expect(desktop).not.toMatch(/\.fcb-equipment-category-nav\s*\{[^}]*overflow-y:\s*hidden;/s);
    expect(desktop).not.toMatch(/:not\(\.fcb-equipment-category-nav\)/);
  });

  it('registers the item list as the scroll owner, not the pane', () => {
    expect(source).toMatch(
      /className="fcb-scroll-panel[^"]*fcb-equipment-results[^"]*"\s*\n\s*ref=\{registerPrimaryScroll\}/,
    );
    expect(source).not.toMatch(
      /fcb-editor-primary fcb-equipment-primary[^>]*\n\s*ref=\{registerPrimaryScroll\}/,
    );
  });
});
