import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('sub-tab bar full bleed', () => {
  it('bleeds the bar through the page gutter to the window edge', () => {
    // The bar continues the navigation stack above it, which is full-width;
    // inset by the gutter it left a strip of page background at each edge.
    const rule = css.match(
      /\.fcb-workspace-content \.fcb-workspace-tab\s*>\s*\.fcb-subtab-bar\s*\{([^}]*)\}/s,
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/margin-left:\s*calc\(0px - var\(--fcb-gutter\)\)/);
    expect(rule).toMatch(/padding-left:\s*var\(--fcb-gutter\)/);
  });

  it('rounds only the free corner where the bar stops beside the sheet', () => {
    // The outer end runs off the window, and the top meets the navigation
    // above, so the bottom inner corner is the only one that reads as an edge.
    const rule = css.match(
      /\.fcb-split-layout \.fcb-workspace-tab\s*>\s*\.fcb-subtab-bar\s*\{([^}]*)\}/s,
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toContain('border-bottom-right-radius: var(--fcb-radius)');
    expect(rule).not.toContain('border-top-right-radius');
  });

  it('sets the sheet down from the workspace bar above it', () => {
    expect(css).toMatch(
      /\.fcb-split-layout\s*>\s*\.fcb-sheet-preview\s*\{[^}]*margin-top:/s,
    );
  });

  it('bleeds the inner edge too only when the pane spans the page', () => {
    // In Split View the sheet sits beside the pane, so only the outer edge
    // reaches the window; the inner edge stops at the pane boundary.
    const rule = css.match(
      /\.fcb-workspace-content:not\(\.fcb-split-layout\)\s+\.fcb-workspace-tab\s*>\s*\.fcb-subtab-bar\s*\{([^}]*)\}/s,
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/margin-right:\s*calc\(0px - var\(--fcb-gutter\)\)/);
    expect(rule).toMatch(/padding-right:\s*var\(--fcb-gutter\)/);
  });

  it('treats the collapsed section rail as the same band', () => {
    // Below the pane's collapse width the rail becomes a horizontal strip in
    // the same navigation stack, so it bleeds and sits flush like the bar.
    const collapsed = css.slice(
      css.lastIndexOf('@container fcb-pane (max-width: 1080px)'),
    );
    expect(collapsed).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-left-nav\s*\{[^}]*margin-left:\s*calc\(0px - var\(--fcb-gutter\)\)/s,
    );
    expect(collapsed).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-left-nav\s*\{[^}]*padding-left:\s*var\(--fcb-gutter\)/s,
    );
    // Flush against the navigation above rather than floating below it.
    expect(collapsed).toMatch(
      /\.fcb-workspace-tab\.fcb-builder-layout\s*\{[^}]*padding-top:\s*0;/s,
    );
  });
});
