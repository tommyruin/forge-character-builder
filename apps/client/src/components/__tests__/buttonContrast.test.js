import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}[^{)]*\\{([^}]*)\\}`, 's'));
  return match ? match[1] : null;
}

// A button filled with --fcb-surface, the same colour as the panel behind it,
// reads as plain text with a hairline; controls need their own raised surface.
describe('button contrast', () => {
  it('defines a raised control surface distinct from the panel surface', () => {
    for (const token of [
      '--fcb-control',
      '--fcb-control-hover',
      '--fcb-control-border',
    ]) {
      expect(css, token).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
    }
    // The control surface lifts away from the panel by mixing in the theme's
    // text colour, so it lightens on dark themes and darkens on light ones.
    expect(css).toMatch(
      /--fcb-control:\s*color-mix\([^;]*var\(--dmf-text\)[^;]*var\(--dmf-surface-strong\)[^;]*\)/s,
    );
  });

  it('fills buttons with the control surface, not the panel surface', () => {
    const body = ruleBody('.fcb-button,\n.fcb-icon-button');
    expect(body).not.toBeNull();
    expect(body).toContain('background: var(--fcb-control)');
    expect(body).toContain('border: 1px solid var(--fcb-control-border)');
    expect(body).not.toContain('var(--fcb-surface) 94%');
  });

  it('gives the header utilities the same control surface', () => {
    // Sync, theme and support sat on transparent backgrounds beside three
    // filled buttons, so they read as bare glyphs rather than controls.
    const body = ruleBody('.fcb-topbar-utility');
    expect(body).not.toBeNull();
    expect(body).toContain('background: var(--fcb-control)');
    expect(body).toContain('border: 1px solid var(--fcb-control-border)');
    expect(body).not.toContain('background: transparent');
    // Same shape as every other icon button, not a pill.
    expect(body).toContain('border-radius: var(--fcb-radius)');
    expect(body).not.toContain('border-radius: 999px');
  });

  it('keeps a visible hover step', () => {
    const body = ruleBody('.fcb-button:hover,\n.fcb-icon-button:hover');
    expect(body).not.toBeNull();
    expect(body).toContain('var(--fcb-control-hover)');
  });
});
