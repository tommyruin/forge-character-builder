import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const descriptionSource = readFileSync(
  new URL('../DescriptionPanel.jsx', import.meta.url),
  'utf8',
);
const sheetSource = readFileSync(
  new URL('../tabs/SheetTab.jsx', import.meta.url),
  'utf8',
);
const previewSource = readFileSync(
  new URL('../SheetPreviewPanel.jsx', import.meta.url),
  'utf8',
);
const manageSource = readFileSync(
  new URL('../tabs/ManageTab.jsx', import.meta.url),
  'utf8',
);

describe('desktop workspace scroll ownership', () => {
  it('provides pane-aware scroll registration instead of window preservation', () => {
    expect(workspaceSource).toContain('registerPrimaryScroll');
    expect(workspaceSource).toContain('registerDetailsScroll');
    expect(workspaceSource).toContain('primaryScrollPositions');
    expect(workspaceSource).not.toContain(
      'window.scrollTo(position.x, position.y)',
    );
  });

  it('gives split view sibling panes bounded by the workspace height', () => {
    expect(css).toMatch(
      /\.fcb-split-layout\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s,
    );
    expect(css).toMatch(
      /\.fcb-editor-pane\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-sheet-preview\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
    );
  });

  it('allows the workspace grid item to shrink to a narrow viewport', () => {
    expect(css).toMatch(
      /\.fcb-app-shell--workspace\s*>\s*\.fcb-workspace\s*\{[^}]*min-width:\s*0;/s,
    );
    expect(css).toMatch(
      /\.fcb-app-shell--workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
  });

  it('removes desktop inline vertical list owners', () => {
    expect(css).toMatch(
      /\.fcb-option-grid\s*\{[^}]*max-height:\s*none;[^}]*overflow-y:\s*visible;/s,
    );
    expect(css).toMatch(
      /\.fcb-scroll-panel\s*\{[^}]*max-height:\s*none;[^}]*overflow-y:\s*visible;/s,
    );
  });

  it('makes the sheet viewer the direct scroll owner instead of wrapping it', () => {
    expect(sheetSource).toMatch(
      /\{ready && bytes && \(\s*<PdfCanvasViewer[\s\S]*scrollRef=\{registerPrimaryScroll\}/,
    );
    expect(sheetSource).not.toContain('<div data-testid="sheet-canvas">');
  });

  it('gives both sheet viewers a bounded flex parent and direct scroll child', () => {
    expect(css).toMatch(
      /\.fcb-sheet-tab\s+\.fcb-sheet-body\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-sheet-tab\s+\.fcb-sheet-body\s*>\s*\.fcb-pdf-canvas\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.fcb-sheet-preview\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.fcb-sheet-preview\s*>\s*\.fcb-pdf-canvas\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s,
    );
    expect(previewSource).toMatch(
      /<aside className="fcb-panel fcb-sheet-preview">[\s\S]*\{state\.bytes \? \(\s*<PdfCanvasViewer/,
    );
  });

  it('anchors desktop sub-tabs to the workspace row above the pane scroller', () => {
    expect(css).toMatch(
      /\.fcb-workspace-tab\s*>\s*\.fcb-subtab-bar\s*\{[^}]*position:\s*static;[^}]*top:\s*auto;/s,
    );
  });

  it('places desktop sub-tabs directly below the workspace navigation bar', () => {
    // The side gutter sits on the content, not on the clipping workspace
    // element, so the sub-tab bar can bleed to the window edges like the
    // navigation above it.
    expect(css).toMatch(
      /\.fcb-app-shell--workspace\s+\.fcb-workspace-main\s*\{[^}]*padding:\s*0\s+0\s+var\(--fcb-gutter\);/s,
    );
    expect(css).toMatch(
      /\.fcb-workspace-content\s*\{[^}]*padding-inline:\s*var\(--fcb-gutter\);/s,
    );
    expect(css).toMatch(
      /\.fcb-editor-pane\s*\{[^}]*overflow:\s*clip;[^}]*overflow-clip-margin:\s*var\(--fcb-gutter\);/s,
    );
  });

  it('attaches banded tabs to the workspace bar with no pane-named spacing', () => {
    // How much gap a tab takes is I3, owned by workspaceLayoutContract.test.js.
    // What matters here is that no pane name reintroduces its own answer: that
    // is the drift the contract replaced.
    const desktopCss = css.slice(css.lastIndexOf('@media (min-width: 821px)'));
    expect(desktopCss).not.toMatch(
      /\.fcb-editor-pane--(build|manage|magic|sheet)\s*>\s*\.fcb-workspace-tab[^{]*\{[^}]*padding-top:/s,
    );
  });

  it('uses the usable-width split threshold', () => {
    expect(workspaceSource).toContain('SPLIT_MIN_WORKSPACE_WIDTH');
    expect(workspaceSource).toContain('1185');
  });

  it('keeps topbar actions compact when they are portaled into the shell', () => {
    expect(workspaceSource).toContain('fcb-level-up-icon');
    // Export moved to the top bar's storage group; the portal stays icon-only.
    expect(workspaceSource).not.toContain('<ExportMenu');
    expect(css).toContain('.fcb-export-icon-only');
  });

  it('keeps portrait controls on character cards instead of the compact workspace header', () => {
    expect(workspaceSource).not.toContain('PortraitControls');
    expect(workspaceSource).not.toContain('portraitBase64');
  });

  it('resets the registered description pane without relying on window scroll', () => {
    expect(descriptionSource).toContain('panelRef.current?.scrollTo');
    expect(descriptionSource).toContain('scrollRef(node)');
    expect(descriptionSource).not.toContain('scrollRef.current?.scrollTo');
  });

  it('keeps Character Manage content and Save Details in one tall sibling-pane layout', () => {
    expect(manageSource).toContain('fcb-manage-character-save');
    expect(manageSource).toMatch(/subTab !== ["']character["'] && \(/);
    expect(css).toMatch(
      /\.fcb-manage-content\s*>\s*\.fcb-two-panel-grid[^{]*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*auto;/s,
    );
  });

  it('keeps narrow Split View Build and Equipment rails above full-width grids', () => {
    const desktopCss = css.slice(css.lastIndexOf('@media (min-width: 821px)'));
    expect(desktopCss).toMatch(
      /@container fcb-pane \(max-width:\s*1080px\)\s*\{[\s\S]*\.fcb-builder-layout\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s,
    );
    expect(desktopCss).toMatch(
      // Wider than the pane: the collapsed rail bleeds through the page gutter
      // like the sub-tab bar it continues.
      /\.fcb-builder-layout\s*>\s*\.fcb-left-nav[^{]*\{[^}]*position:\s*static;[^}]*width:\s*calc\(100% \+ var\(--fcb-gutter\)\);[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
    );
    expect(desktopCss).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-builder-grid[^{]*\{[^}]*flex:\s*1 1 auto;/s,
    );
    expect(desktopCss).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-builder-grid[^{]*\{[^}]*height:\s*auto;/s,
    );
    expect(desktopCss).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-builder-grid[^{]*\{[^}]*min-height:\s*0;/s,
    );
    expect(desktopCss).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-builder-grid[^{]*\{[^}]*width:\s*100%;/s,
    );
  });

  it('keeps desktop workspace bars compact without changing pane ownership', () => {
    const desktopCss = css.slice(css.lastIndexOf('@media (min-width: 821px)'));
    expect(desktopCss).toMatch(
      /\.fcb-workspace-tab\s*>\s*\.fcb-subtab-bar\s*\{[^}]*margin:\s*0 0 8px;/s,
    );
    expect(desktopCss).toMatch(
      /@container fcb-pane \(max-width:\s*1080px\)\s*\{[\s\S]*\.fcb-builder-layout\s*,[\s\S]*gap:\s*8px;/s,
    );
    expect(desktopCss).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-left-nav[^{]*\{[^}]*margin:\s*0;/s,
    );
  });
});
