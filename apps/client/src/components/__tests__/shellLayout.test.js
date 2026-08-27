import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  new URL('../../App.jsx', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('compact sticky workspace shell', () => {
  it('marks the library and character surfaces as viewport-locked desktop shells', () => {
    expect(appSource).toContain('fcb-app-shell--workspace');
    expect(appSource).toContain('fcb-app-shell--library');
    expect(css).toMatch(
      /\.fcb-app-shell--workspace\s*\{[^}]*height:\s*var\(--fcb-viewport-height\);[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-workspace\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
    );
  });

  it('gives persistent library sections one desktop pane scroll owner', () => {
    expect(appSource).toContain('fcb-app-shell--library');
    expect(appSource).toContain('fcb-library-shell');
    expect(css).toMatch(
      /\.fcb-app-shell--library\s*\{[^}]*height:\s*var\(--fcb-viewport-height\);[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-app-shell--library\s*>\s*\.fcb-library-shell\s*\{[^}]*display:\s*grid;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-app-shell--library\s+\.fcb-library-main\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
    );
  });

  it('shows public attribution outside the active character workspace', () => {
    expect(appSource).toContain('isPublicRelease && !workspaceActive');
  });

  it('puts the site identity and utilities into the character bar', () => {
    expect(appSource).toContain('fcb-topbar-brand');
    expect(appSource).toContain('TopbarUtilities');
    expect(css).toContain('.fcb-topbar-utilities');
    expect(appSource).toContain('<shell.Logo');
    expect(appSource).toContain('<shell.VersionStamp');
    expect(appSource).toContain('fcb-app-shell--workspace');
  });

  it('keeps workspace actions on one top-bar row at compact desktop widths', () => {
    expect(css).toMatch(
      /\.fcb-topbar-actions\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
    expect(css).toMatch(
      /\.fcb-topbar-actions\s*>\s*\.fcb-toolbar\s*\{[^}]*flex-wrap:\s*nowrap;/s,
    );
    expect(css).toContain(
      '@media (min-width: 821px) and (max-width: 1280px)',
    );
  });

  it('keeps loading utilities right-aligned when the workspace action slot is empty', () => {
    expect(appSource).toMatch(
      /fcb-topbar-actions" id="fcb-topbar-actions"\s*\/?>[\s\S]*?<TopbarUtilities/s,
    );
    expect(css).toMatch(
      /\.fcb-topbar-actions:empty\s*\+\s*\.fcb-topbar-utilities\s*\{[^}]*margin-left:\s*auto;/s,
    );
  });

  it('fits all four global tabs into the remaining desktop header space', () => {
    expect(css).toMatch(
      /\.fcb-global-tabs\s*\{[^}]*flex:\s*1 1 0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-global-tabs\s+\.fcb-tab\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-global-tabs\s+\.fcb-tab-label--full,\s*\.fcb-global-tabs\s+\.fcb-tab-label--compact\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*820px\)[\s\S]*?\.fcb-global-tabs\s+\.fcb-tab-label--full\s*\{[^}]*display:\s*none;/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*820px\)[\s\S]*?\.fcb-global-tabs\s+\.fcb-tab-label--compact\s*\{[^}]*display:\s*block;/s,
    );
  });

  it('keeps global sections mounted after first use and restores the character workspace', () => {
    expect(appSource).toContain('getGlobalNavigationTabs(openCharacterId)');
    expect(appSource).toContain('visitedSections.content');
    expect(appSource).toContain('visitedSections.homebrew');
    expect(appSource).toContain('active={workspaceActive}');
    expect(appSource).toContain("tab.characterSurface === 'collection'");
    expect(appSource).toContain("tab.characterSurface === 'workspace'");
    expect(workspaceSource).not.toContain('All characters');
    expect(workspaceSource).not.toContain('fcb-collection-button');
    expect(appSource).not.toContain('>Start<');
  });

  it('shows live level and class beneath the retained character name', () => {
    expect(appSource).toContain('fcb-tab-character-metadata');
    expect(appSource).toContain('id="fcb-char-tab-detail"');
    expect(workspaceSource).toContain('tabDetailSlot');
    expect(workspaceSource).toContain(
      'Level {detail.level} — {detail.class}',
    );
    expect(css).toContain('.fcb-tab-character-metadata');
    expect(css).toMatch(
      /\.fcb-tab-character\s*\{[^}]*background:\s*color-mix\([^}]*var\(--fcb-teal\)/s,
    );
    expect(css).toMatch(
      /\.fcb-tab-character\.is-active\s*\{[^}]*border-color:\s*var\(--fcb-teal\);/s,
    );
  });

  it('uses opaque compact sticky navigation surfaces', () => {
    expect(css).toMatch(
      /\.fcb-topbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*background:\s*var\(--fcb-bg-soft\);/s,
    );
    expect(css).toMatch(
      /\.fcb-subbar\s*\{[^}]*position:\s*sticky;[^}]*background:\s*var\(--fcb-bg-soft\);/s,
    );
    expect(css).toMatch(
      /\.fcb-has-subtabs\s*\{[^}]*--fcb-subtab-h:\s*var\(--fcb-navstrip-h\);/s,
    );
    expect(css).toMatch(
      /\.fcb-subtab-bar\s*\{[^}]*margin:\s*calc\(0px - var\(--fcb-gutter\)\) 0 14px;[^}]*padding:\s*0;/s,
    );
    expect(css).toContain('--fcb-gutter: var(--dmf-page-gutter)');
    expect(css).toContain('--fcb-navstrip-h: var(--dmf-tool-nav-height)');
    expect(css).toContain('@container fcb-pane (max-width: 1080px)');
    expect(css).toContain('.fcb-global-tabs');
  });

  it('keeps the Fast Start activity toast out of the app grid', () => {
    expect(appSource).toContain('<FastStartActivityNotice />');
    expect(css).toMatch(
      /\.fcb-app-shell\s*>\s*:not\([^)]*\.fcb-fast-start-notice-stack[^)]*\)\s*\{[^}]*position:\s*relative;/s,
    );
    expect(css).toMatch(
      /\.fcb-toast-stack\s*\{[^}]*position:\s*fixed;/s,
    );
  });

  it('keeps the engine readiness marker out of the app grid', () => {
    expect(css).toMatch(
      /\.fcb-app-shell\s*>\s*:not\([^)]*\.fcb-engine-state-marker[^)]*\)\s*\{[^}]*position:\s*relative;/s,
    );
  });

  it('makes every desktop rail horizontal-only', () => {
    expect(css).toMatch(
      /\.fcb-primary-tabs,\s*\.fcb-secondary-tabs\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-subtab-bar\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
    );
  });
});
