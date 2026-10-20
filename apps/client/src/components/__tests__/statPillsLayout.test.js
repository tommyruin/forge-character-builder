import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

// Every rule block whose selector is exactly `.fcb-subbar-stats`, at any width.
const statRules = [...styles.matchAll(/(?:^|\n)\s*\.fcb-subbar-stats\s*\{([^}]*)\}/g)].map((match) => match[1]);

describe('the subbar stat pills', () => {
  it('sit grouped with a small gap at every width, never spread across the row', () => {
    expect(statRules.length).toBeGreaterThanOrEqual(2);
    for (const rule of statRules) {
      expect(rule).not.toMatch(/justify-content:\s*space-(between|around|evenly)/);
      expect(rule).not.toMatch(/gap:\s*(?:\d{3,}px|[2-9]\d+px)/);
    }
  });

  it('stay right-aligned on a narrow row, where overflow scrolls instead of clipping the left pills', () => {
    const narrow = statRules[statRules.length - 1];
    expect(narrow).toContain('justify-content: flex-start;');
    expect(styles).toMatch(/\.fcb-subbar-stats > :first-child\s*\{[^}]*margin-left:\s*auto;/s);
  });
});
