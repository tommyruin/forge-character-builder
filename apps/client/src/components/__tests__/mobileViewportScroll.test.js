import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const indexHtml = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

describe('mobile viewport scrolling', () => {
  it('keeps document overscroll from reaching the browser refresh gesture', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none;/s,
    );
  });

  it('uses a contained content scroller and an in-flow bottom navigation row', () => {
    expect(css).toMatch(
      /\.fcb-workspace-main\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*none;/s,
    );
    expect(css).toMatch(
      /\.fcb-workspace-content,\s*\.fcb-editor-pane\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s,
    );
    expect(css).toMatch(
      /\.fcb-mobile-workspace-nav\s*\{[^}]*position:\s*static;[^}]*flex:\s*0 0 auto;/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.fcb-app-shell--workspace\s*\{[^}]*height:\s*var\(--fcb-viewport-height\);[^}]*overflow:\s*hidden;/s,
    );
    expect(workspaceSource).toContain('mainRef.current?.scrollTo');
    expect(workspaceSource).not.toContain(
      "mainRef.current?.scrollIntoView({ block: 'start' })",
    );
  });

  it('extends the app background through mobile device safe areas', () => {
    expect(indexHtml).toMatch(
      /<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*"\s*\/?>/,
    );
    expect(css).toMatch(
      /\.fcb-mobile-workspace-nav\s*\{[^}]*min-height:\s*calc\(64px \+ var\(--dmf-safe-area-bottom\)\);[^}]*padding:\s*4px 6px calc\(4px \+ var\(--dmf-safe-area-bottom\)\);[^}]*background:/s,
    );
  });
});
