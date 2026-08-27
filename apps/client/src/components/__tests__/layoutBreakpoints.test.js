import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOBILE_VIEWPORT_QUERY } from '../../layoutBreakpoints';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const workspace = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);

describe('layout breakpoints', () => {
  it('declares the mobile threshold once', () => {
    expect(MOBILE_VIEWPORT_QUERY).toBe('(max-width: 820px)');
    expect(workspace).toContain('isMobileViewport()');
    expect(workspace).not.toContain('matchMedia("(max-width: 820px)")');
  });

  it('documents the canonical thresholds in the stylesheet', () => {
    const header = css.slice(0, css.indexOf(':root {'));
    expect(header).toContain('820/821px');
    expect(header).toContain('1080/1081px');
    expect(header).toContain('layoutBreakpoints');
  });

  it('keeps the stylesheet and the JS query on the same value', () => {
    expect(css).toContain('@media (max-width: 820px)');
  });
});
