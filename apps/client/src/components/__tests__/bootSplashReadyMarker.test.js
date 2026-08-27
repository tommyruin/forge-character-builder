import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../BootSplash.jsx', import.meta.url), 'utf8');

describe('boot readiness marker', () => {
  it('exposes stable machine-readable readiness and progress attributes', () => {
    expect(source).toContain('data-fcb-engine-ready');
    expect(source).toContain('data-fcb-engine-progress');
    expect(source).toContain('state.interactive ? "true" : "false"');
  });
});
