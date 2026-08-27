import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manage = readFileSync(
  new URL('../tabs/ManageTab.jsx', import.meta.url),
  'utf8',
);

describe('Manage character controls', () => {
  it('keeps section randomisers without offering Randomize all', () => {
    expect(manage).not.toContain("randomizeButton('all'");
    expect(manage).toContain("randomizeButton('details'");
    expect(manage).toContain("randomizeButton('alignment'");
    expect(manage).toContain("randomizeButton('appearance'");
  });
});
