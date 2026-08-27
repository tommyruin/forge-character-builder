import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

/** The declaration block of the first rule whose selector list contains `selector` verbatim. */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `[^{)]*` skips occurrences inside a `:not(...)` of another selector.
  const match = css.match(new RegExp(`${escaped}[^{)]*\\{([^}]*)\\}`, 's'));
  return match ? match[1] : null;
}

// The corpus authors its descriptions against these class semantics:
// .feature/.emphasis are bold in-family labels with trailing space, .flavor is
// a plain italic lead-in, and .sidebar is the bordered callout box.
describe('rich-text CSS semantics', () => {
  it('styles feature labels as bold italic body text with trailing space, not a different font', () => {
    const body = ruleBody('.fcb-hb-feature');
    expect(body).not.toBeNull();
    expect(body).toContain('font-weight: 700');
    expect(body).toContain('font-style: italic');
    expect(body).toContain('padding-right');
    expect(body).not.toContain('ScalySansSmallCapsRemake');
    expect(body).not.toContain('!important');
  });

  it('styles emphasis labels bold with trailing space', () => {
    const body = ruleBody('.fcb-hb-emphasis');
    expect(body).not.toBeNull();
    expect(body).toContain('font-weight: 700');
    expect(body).toContain('padding-right');
  });

  it('styles flavor as a plain italic lead-in, not a callout box', () => {
    const body = ruleBody('.fcb-hb-flavor');
    expect(body).not.toBeNull();
    expect(body).toContain('font-style: italic');
    expect(body).not.toContain('border-left');
    expect(body).not.toContain('background');
  });

  it('styles sidebar as the bordered callout box', () => {
    const body = ruleBody('.fcb-hb-sidebar');
    expect(body).not.toBeNull();
    expect(body).toContain('padding');
    expect(body).toContain('background');
    expect(body).toContain('border-top');
    expect(body).toContain('border-bottom');
  });

  it('gives sidebar children the same vertical rhythm as top-level content', () => {
    expect(css).toMatch(/\.fcb-hb-sidebar\s*>\s*\*\s*\+\s*\*[^{]*\{[^}]*margin-top:/s);
  });

  it('restores visible list markers inside descriptions', () => {
    expect(css).toMatch(/\.fcb-rich-text ul[^{]*\{[^}]*list-style:\s*disc/s);
    expect(css).toMatch(/\.fcb-rich-text ol[^{]*\{[^}]*list-style:\s*decimal/s);
  });

  it('does not track bold text tighter than the surrounding copy', () => {
    const body = ruleBody('.fcb-rich-text strong');
    expect(body).not.toBeNull();
    expect(body).not.toContain('letter-spacing: -');
  });

  it('turns the empty indent separator into a visible paragraph indent', () => {
    expect(css).toMatch(/\.fcb-hb-indent:empty\s*\{[^}]*display:\s*inline-block/s);
  });

  it('keeps generated stat blocks flush instead of indenting them as prose', () => {
    // The prose indent rule out-ranks a descendant selector on specificity, so
    // stat lines and entry headings opt out by class, as spell meta lines do.
    expect(css).toMatch(/:not\(\.fcb-stat-line\):not\(\.fcb-hb-entry\)/);
    expect(css).toMatch(
      /\.fcb-stat-line,\s*\.fcb-rich-text \.fcb-hb-entry\s*\{[^}]*text-indent:\s*0/s,
    );
    expect(css).toMatch(/\.fcb-stat-block\s*\{[^}]*margin-bottom:/s);
  });

  it('styles the lead paragraph italic per legacy underline semantics', () => {
    const body = ruleBody('.fcb-rich-lead');
    expect(body).not.toBeNull();
    expect(body).toContain('font-style: italic');
  });
});
