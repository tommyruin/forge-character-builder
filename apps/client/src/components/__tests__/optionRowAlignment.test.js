import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const card = readFileSync(
  new URL('../SelectionRuleCard.jsx', import.meta.url),
  'utf8',
);

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}[^{)]*\\{([^}]*)\\}`, 's'));
  return match ? match[1] : null;
}

describe('option row alignment', () => {
  it('centres the info button in its column', () => {
    // The row is a grid; without align-items the fixed-height icon button
    // stretches to the top of a two-line row instead of sitting on its centre.
    const body = css.match(/\.fcb-option-row\s*\{([^}]*)\}/s)?.[1];
    expect(body).toBeDefined();
    expect(body).toContain('align-items: center');
    expect(body).toContain('justify-items: center');
  });

  it('spaces the info button with padding rather than an ad-hoc margin', () => {
    expect(card).not.toContain('className="m-1"');
    expect(ruleBody('.fcb-option-row > .fcb-icon-button')).toContain(
      'margin',
    );
  });
});

describe('chosen value emphasis', () => {
  it('sizes the chosen option to hold its own beside the row controls', () => {
    const body = ruleBody('.fcb-rule-selected');
    expect(body).not.toBeNull();
    const size = body.match(/font-size:\s*([\d.]+)rem/);
    expect(size).not.toBeNull();
    expect(Number(size[1])).toBeGreaterThanOrEqual(0.95);
  });
});
