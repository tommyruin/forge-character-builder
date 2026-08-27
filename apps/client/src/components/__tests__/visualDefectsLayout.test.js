import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(
  new URL('../../shell/default/styles.css', import.meta.url),
  'utf8',
);

describe('visual defect layout contracts', () => {
  it('keeps mobile choice text flexible and completion controls fully visible', () => {
    expect(css).toMatch(
      /\.fcb-rule-trigger-main\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto;/s
    );
    expect(css).toMatch(
      /\.fcb-rule-trigger-actions\s*\{[^}]*flex:\s*0 0 auto;/s
    );
    expect(css).toMatch(/\.fcb-status-badge\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(css).toMatch(
      /@media \(max-width:\s*820px\)[\s\S]*?\.fcb-rule-selected\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s
    );
    expect(css).toMatch(
      /\.fcb-rule-slot-label\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s
    );
  });

  it('wraps information metadata instead of clipping it', () => {
    expect(css).toMatch(/\.fcb-meta-pill\s*\{[^}]*max-width:\s*100%;/s);
    expect(css).toMatch(
      /\.fcb-meta-pill strong\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s
    );
  });

  it('uses the larger shared cap and centres the desktop footer', () => {
    // The cap is the shell's page column, so the builder and its host agree.
    expect(css).toContain('--fcb-content-width: min(var(--dmf-page-max-width), 100%);');
    expect(sharedCss).toContain('--dmf-page-max-width: 3200px;');
    expect(css).toMatch(
      /@media \(min-width:\s*821px\)[\s\S]*?\.fcb-app-shell--library \.fcb-public-footer\s*\{[^}]*margin-inline:\s*auto;/s
    );
  });
});
