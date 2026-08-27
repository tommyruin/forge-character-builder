import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../SelectionRuleCard.jsx', import.meta.url),
  'utf8',
);

// A completed pick must be inspectable from the collapsed card itself — without
// re-opening the option grid and re-finding the element in the selector.
describe('SelectionRuleCard selected-element info buttons', () => {
  it('offers an inspect control beside the collapsed single-pick summary', () => {
    expect(source).toContain('SelectedElementInfoButton');
    expect(source).toMatch(
      /selectedSummary[\s\S]{0,600}SelectedElementInfoButton[\s\S]{0,200}elementId=\{selectedIds\[0\]\}/,
    );
  });

  it('offers an inspect control on each filled multi-pick slot', () => {
    expect(source).toMatch(
      /filledId &&[\s\S]{0,400}SelectedElementInfoButton[\s\S]{0,200}elementId=\{filledId\}/,
    );
  });

  it('uses a nested-button-safe control that does not toggle the card', () => {
    // The card trigger is a real <button>; the info control must be a
    // role="button" span and swallow the click so the card does not toggle.
    expect(source).toMatch(
      /SelectedElementInfoButton\(\{[\s\S]{0,900}role="button"/,
    );
    expect(source).toMatch(
      /SelectedElementInfoButton\(\{[\s\S]{0,1200}stopPropagation/,
    );
  });
});
