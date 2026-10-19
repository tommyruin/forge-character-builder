// A control typed inside a caption label must not print in the caption's bold capitals. The rule
// that stops it lives in the stylesheet, so it is pinned from there.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');

function ruleBody(selector) {
  const start = stylesheet.indexOf(`${selector} {`);
  expect(start, `${selector} is styled`).toBeGreaterThan(-1);
  return stylesheet.slice(start, stylesheet.indexOf('}', start));
}

describe('controls inside a field label', () => {
  const body = ruleBody(':where(.fcb-field-label) :is(input, select, textarea, option)');

  it('reset the weight, tracking and case the caption sets', () => {
    expect(body).toMatch(/font-weight: 400;/);
    expect(body).toMatch(/letter-spacing: normal;/);
    expect(body).toMatch(/text-transform: none;/);
  });

  it('return to the body text size, not the caption size', () => {
    expect(body).toMatch(/font-size: 0\.875rem;/);
  });

  it('do not out-rank a control that sets its own look', () => {
    // :where() contributes no specificity, so a class rule on the control still wins.
    expect(stylesheet).toContain(':where(.fcb-field-label) :is(');
  });
});
