import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('shared scrollbar styling', () => {
  it('applies the shared scrollbar theme to app-owned scroll containers', () => {
    expect(css).toMatch(
      /html,\s*body,\s*\.fcb-app-shell,\s*\.fcb-app-shell \*\s*\{[^}]*scrollbar-color:\s*var\(--fcb-border\) transparent;[^}]*scrollbar-width:\s*thin;/s,
    );
  });

  it('keeps intentionally hidden horizontal navigation scrollbars hidden', () => {
    expect(css).toMatch(
      /\.fcb-primary-tabs,\s*\.fcb-secondary-tabs\s*\{[^}]*scrollbar-width:\s*none;/s,
    );
    expect(css).toMatch(
      /\.fcb-subtab-bar\s*\{[^}]*scrollbar-width:\s*none;/s,
    );
    expect(css).toMatch(
      /\.fcb-spell-level-tabs\s*\{[^}]*scrollbar-width:\s*none;/s,
    );
  });
});
