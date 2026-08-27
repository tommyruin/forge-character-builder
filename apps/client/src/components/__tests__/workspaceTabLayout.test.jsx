import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorkspaceTabLayout, {
  WorkspaceBand,
  WorkspacePanel,
  WorkspaceScroll,
} from '../WorkspaceTabLayout';
import SectionNav from '../SectionNav';

const rail = (
  <SectionNav
    ariaLabel="Sections"
    items={[{ key: 'a', label: 'A' }]}
    activeKey="a"
    onSelect={() => {}}
  />
);

describe('WorkspaceTabLayout', () => {
  it('marks a tab that renders a band, and one that does not', () => {
    // Which of these a tab is decides whether it sits flush against the
    // workspace navigation or takes the band gap, so the shell derives it
    // rather than letting each tab remember to say so.
    const banded = renderToStaticMarkup(
      <WorkspaceTabLayout bands={<WorkspaceBand>bar</WorkspaceBand>} />,
    );
    expect(banded).toContain('fcb-has-subtabs');

    const bare = renderToStaticMarkup(<WorkspaceTabLayout />);
    expect(bare).not.toContain('fcb-has-subtabs');
  });

  it('marks a tab with a rail as a builder layout', () => {
    // The class the container query switches on to turn the rail from a
    // sidebar column into a band.
    expect(renderToStaticMarkup(<WorkspaceTabLayout rail={rail} />)).toContain(
      'fcb-builder-layout',
    );
    expect(renderToStaticMarkup(<WorkspaceTabLayout />)).not.toContain(
      'fcb-builder-layout',
    );
  });

  it('orders the band stack above the rail above the content', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceTabLayout
        bands={<WorkspaceBand>bar</WorkspaceBand>}
        rail={rail}
        shape="split"
      >
        <p>body</p>
      </WorkspaceTabLayout>,
    );
    const band = markup.indexOf('data-layout-role="band"');
    const railAt = markup.indexOf('fcb-left-nav');
    const content = markup.indexOf('data-layout-role="content"');
    expect(band).toBeGreaterThan(-1);
    expect(railAt).toBeGreaterThan(band);
    expect(content).toBeGreaterThan(railAt);
  });

  it('keeps the content region one wrapper deep whatever its shape', () => {
    for (const [shape, cls] of [
      ['split', 'fcb-builder-grid'],
      ['two-panel', 'fcb-two-panel-grid'],
      ['stack', 'fcb-manage-content'],
    ]) {
      const markup = renderToStaticMarkup(
        <WorkspaceTabLayout shape={shape}>
          <p>body</p>
        </WorkspaceTabLayout>,
      );
      expect(markup, shape).toContain(
        `<div class="${cls}" data-layout-role="content"><p>body</p></div>`,
      );
    }
  });

  it('renders children directly when the tab owns its own content region', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceTabLayout>
        <p>body</p>
      </WorkspaceTabLayout>,
    );
    expect(markup).toBe(
      '<div class="fcb-workspace-tab" data-layout-role="shell"><p>body</p></div>',
    );
  });

  it('keeps the tab decoration class and forwards the element type', () => {
    // Tailwind utilities and per-tab hooks are interleaved throughout, so a
    // shell that dropped className would silently lose styling.
    const markup = renderToStaticMarkup(
      <WorkspaceTabLayout as="section" className="fcb-sheet-tab min-w-0" panel />,
    );
    expect(markup).toContain('<section');
    expect(markup).toContain('fcb-panel');
    expect(markup).toContain('fcb-sheet-tab min-w-0');
  });

  it('gives every band the same class so the band rules cannot miss one', () => {
    expect(
      renderToStaticMarkup(
        <WorkspaceBand className="fcb-magic-subbar">bar</WorkspaceBand>,
      ),
    ).toBe(
      '<div class="fcb-subtab-bar fcb-magic-subbar" data-layout-role="band">bar</div>',
    );
  });

  it('is a wrapper, so a tab strip inside it can fill the band height', () => {
    // The band sizes the row and centres its contents; a .fcb-secondary-tabs
    // strip stretches its tabs to fill whatever holds them. Collapsed onto one
    // element the tabs centre at their natural height instead, which shows as
    // a sliver of band above and below them — Equipment did exactly that.
    const markup = renderToStaticMarkup(
      <WorkspaceBand>
        <nav className="fcb-secondary-tabs">tabs</nav>
      </WorkspaceBand>,
    );
    expect(markup).toBe(
      '<div class="fcb-subtab-bar" data-layout-role="band"><nav class="fcb-secondary-tabs">tabs</nav></div>',
    );
  });
});

describe('WorkspacePanel', () => {
  it('emits the panel class names the stylesheet already targets', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePanel title="Race" actions={<button type="button">Add</button>}>
        <p>body</p>
      </WorkspacePanel>,
    );
    expect(markup).toContain('<section class="fcb-panel">');
    expect(markup).toContain('<header class="fcb-panel-header">');
    expect(markup).toContain('<h2 class="fcb-panel-title">Race</h2>');
    expect(markup).toContain('<div class="fcb-panel-body">');
  });

  it('omits the header when a panel has neither title nor actions', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePanel>
        <p>body</p>
      </WorkspacePanel>,
    );
    expect(markup).not.toContain('fcb-panel-header');
  });
});

describe('WorkspaceScroll', () => {
  it('never carries a border radius of its own', () => {
    // A scrollbar paints on the border box and is not clipped by an ancestor's
    // radius, so the scroller has to be inset inside a rounded panel rather
    // than be the rounded thing itself.
    const text = readFileSync(
      new URL('../WorkspaceTabLayout.jsx', import.meta.url),
      'utf8',
    );
    const scroll = text.slice(text.indexOf('WorkspaceScroll = forwardRef'));
    expect(scroll).not.toMatch(/rounded|border-radius/);
  });

  it('marks itself as the scroll region', () => {
    expect(
      renderToStaticMarkup(<WorkspaceScroll className="fcb-editor-primary" />),
    ).toContain('data-layout-role="scroll"');
  });
});
