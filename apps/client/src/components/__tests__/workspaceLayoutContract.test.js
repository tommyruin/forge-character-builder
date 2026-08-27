import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const TABS = ['BuildTab', 'MagicTab', 'EquipmentTab', 'ManageTab', 'SheetTab'];
const tabSource = Object.fromEntries(
  TABS.map((name) => [
    name,
    readFileSync(new URL(`../tabs/${name}.jsx`, import.meta.url), 'utf8'),
  ]),
);
const collapsed = css.slice(
  css.lastIndexOf('@container fcb-pane (max-width: 1080px)'),
);
// The pane collapses in two blocks — presentation in the first, scroll model
// in the second — so a rule about the collapsed pane may live in either.
const collapsedAny = css.slice(
  css.indexOf('@container fcb-pane (max-width: 1080px)'),
);

// The workspace layout contract. Every tab is built from the same roles, so
// each invariant is stated once and covers all of them — the alternative is
// what this codebase had: the same defect fixed five times in five tabs.
describe('I2 band stacking', () => {
  it('spans a band across the whole rail layout rather than one column', () => {
    // On a wide pane the shell is a two-column grid, rail then content. A band
    // is a sibling of both, so without this it takes the rail's cell and
    // pushes the rail into the content column and the content onto its own
    // row at rail width.
    expect(css).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-subtab-bar\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
    );
  });

  it('stretches what a band holds to the full height of the row', () => {
    // A tab strip has to run the band's full height or its active underline
    // floats above the band's bottom edge, leaving a sliver below the tabs.
    // On the band itself, not on one tab's bar: that is how Equipment and
    // Magic ended up with different answers.
    expect(css).toMatch(
      /\.fcb-subtab-bar\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*stretch;/s,
    );
    expect(css).not.toMatch(
      /\.fcb-magic-subbar\s*\{[^}]*align-items:\s*stretch;/s,
    );
  });

  it('paints every band on the navigation strip surface', () => {
    // The strip above them is --fcb-bg-soft. A band on --fcb-bg is a different
    // colour butted against it, which reads as a gap rather than as the same
    // navigation block continuing — obvious in the light theme.
    expect(css).toMatch(
      /\.fcb-subtab-bar\s*\{[^}]*background:\s*var\(--fcb-bg-soft\);/s,
    );
    expect(collapsedAny).toMatch(
      /\.fcb-builder-layout\s*>\s*\.fcb-left-nav\s*\{[^}]*background:\s*var\(--fcb-bg-soft\);/s,
    );
  });

  it('draws one edge under the whole band stack, not one per band', () => {
    // Two stacked bands each drawing a bottom hairline puts a line between
    // them, which is the "gap" between the sub-tab bar and the rail.
    // A general sibling, not an adjacent one: Equipment carries its hidden
    // narrow-viewport category select between the bar and the rail, and `+`
    // silently stops matching when a tab does that.
    expect(collapsedAny).toMatch(
      /\.fcb-subtab-bar:has\(\s*~\s*\.fcb-left-nav\s*\)\s*\{[^}]*border-bottom-color:\s*transparent;/s,
    );
  });
});

describe('I5 scroller inset', () => {
  it('strips the radius from an element it makes a scroll owner', () => {
    // A scrollbar paints on the border box, outside the radius, so a rounded
    // element that scrolls itself gets a straight track down its edge. Any
    // rule that turns something into the scroll owner has to answer for the
    // radius that element already carries.
    expect(css).toMatch(
      /\.fcb-equipment-catalog \.fcb-equipment-results\s*\{[^}]*overflow-y:\s*auto;[^}]*border-radius:\s*0;/s,
    );
  });
});

describe('I3 content offset', () => {
  it('offsets the content region of every tab shape by one band gap', () => {
    const rule = collapsed.match(
      /([^{}]*)\{\s*margin-top:\s*var\(--fcb-band-gap\)/s,
    )?.[1];
    expect(rule, 'a rule sets margin-top from --fcb-band-gap').toBeDefined();
    // Every wrapper a tab can put under its band stack, including the
    // two-panel grid Equipment/Inventory hangs directly off the tab root.
    for (const selector of [
      '.fcb-builder-layout > .fcb-builder-grid',
      '.fcb-builder-layout > .fcb-two-panel-grid',
      '.fcb-builder-layout > .fcb-manage-content',
      '.fcb-workspace-tab > .fcb-two-panel-grid',
    ]) {
      expect(rule, selector).toContain(selector);
    }
  });

  it('does not double the offset with a flex gap', () => {
    // A gap on the collapsed shell adds to the content margin. It has to be
    // zeroed on the compound selector too (it out-ranks any later reset, which
    // is how Build and Manage reached 16px while Magic sat at 8px), and it
    // cannot simply be dropped — that exposes the 18px base grid gap.
    const shell = collapsed.match(
      /\.fcb-builder-layout,\s*\.fcb-workspace-tab\.fcb-builder-layout\s*\{([^}]*)\}/s,
    )?.[1];
    expect(shell, 'the collapsed shell rule').toBeDefined();
    expect(shell).toMatch(/gap:\s*0;/);
  });

  it('declares the band gap once, as a property', () => {
    expect(css).toMatch(/--fcb-band-gap:\s*\d+px;/);
    expect(css.match(/--fcb-band-gap:/g)).toHaveLength(1);
  });

  it('offsets tab content from the navigation but keeps a band flush to it', () => {
    // The other half of I3. A band continues the workspace navigation, so it
    // sits against it; anything else is content and takes the gap. The
    // condition is what the tab renders, never which tab it is — Magic drops
    // its bar for a character with no caster, so a list of tab names cannot
    // describe it.
    const desktop = css.slice(css.lastIndexOf('@media (min-width: 821px)'));
    expect(desktop).toMatch(
      /\n\s*\.fcb-workspace-tab\s*\{[^}]*padding-top:\s*var\(--fcb-band-gap\);/s,
    );
    expect(desktop).toMatch(
      /\.fcb-workspace-tab\.fcb-has-subtabs\s*\{[^}]*padding-top:\s*0;/s,
    );
    expect(desktop).not.toMatch(
      /\.fcb-editor-pane--\w+\s*>\s*\.fcb-workspace-tab[^{]*\{[^}]*padding-top:/s,
    );
  });

  it('lets a collapsed rail count as a band and go flush', () => {
    // Collapsed, the rail is laid out as a band, so it takes the flush
    // treatment. This only works while the base offset above stays at one
    // class of specificity — a `:not()` chain there silently out-ranks this
    // and the gap comes back on Build and Manage.
    expect(collapsed).toMatch(
      /\.fcb-workspace-tab\.fcb-builder-layout\s*\{[^}]*padding-top:\s*0;/s,
    );
  });

  it('moves the frame, not its contents, when the tab root is the panel', () => {
    // Padding would indent the sheet inside its own border; the frame has to
    // move. It is sized to fill a pane that clips, so the gap comes back out
    // of its height or the bottom is cut off.
    const desktop = css.slice(css.lastIndexOf('@media (min-width: 821px)'));
    const rule = desktop.match(
      /\.fcb-workspace-tab\.fcb-panel\s*\{([^}]*)\}/s,
    )?.[1];
    expect(rule, 'the panel-rooted tab rule').toBeDefined();
    expect(rule).toMatch(/margin-top:\s*var\(--fcb-band-gap\);/);
    expect(rule).toMatch(/height:\s*calc\(100% - var\(--fcb-band-gap\)\);/);
  });
});

// Phase 6: what stops the tabs drifting apart again. A tab that hand-rolls its
// own shell is outside every rule above, which is exactly how the same defect
// came to be fixed five times in five tabs.
describe('shell adoption', () => {
  it.each(TABS)('%s is built from the shared shell', (name) => {
    expect(tabSource[name]).toContain('<WorkspaceTabLayout');
  });

  it.each(TABS)('%s does not hand-roll the structural classes', (name) => {
    // These are derived by the shell from what the tab passes it. A literal
    // means the tab decided for itself and can disagree with the others.
    const source = tabSource[name];
    expect(source).not.toContain('fcb-workspace-tab');
    expect(source).not.toContain('fcb-has-subtabs');
    expect(source).not.toContain('fcb-builder-layout');
  });

  it.each(TABS)('%s keeps its tab strip inside the band, not on it', (name) => {
    // A band that is also the .fcb-secondary-tabs strip centres its tabs at
    // their natural height rather than filling the row, which shows as a
    // sliver of band above and below them.
    expect(tabSource[name]).not.toMatch(
      /fcb-subtab-bar[^"'`]*fcb-secondary-tabs|fcb-secondary-tabs[^"'`]*fcb-subtab-bar/,
    );
    expect(tabSource[name]).not.toMatch(
      /<WorkspaceBand[^>]*className="[^"]*fcb-secondary-tabs/,
    );
  });

  it.each(TABS)('%s spells its band through WorkspaceBand', (name) => {
    // The band rules key on .fcb-subtab-bar, so a tab that writes the class
    // itself can spell it differently and fall out of them.
    const source = tabSource[name];
    if (!source.includes('fcb-subtab-bar')) return;
    expect(source).toContain('<WorkspaceBand');
  });

  it('leaves no tab-name list in the rail and band rules', () => {
    // No rule enumerates tabs by name: each is keyed on the role, so a sixth
    // tab is covered the moment it adopts the shell.
    expect(css).not.toMatch(/\.fcb-magic-content/);
    expect(css).not.toMatch(
      /\.fcb-build-tab \.fcb-left-nav,\s*\.fcb-magic-content/,
    );
  });

  it('states the sticky base sum exactly once', () => {
    // I6. Seven sites hand-copied topbar-plus-subbar with four different
    // trailing constants; a change to the stack meant finding them all. The
    // sum lives in the shared properties now: contexts change --fcb-subtab-h,
    // never the formula.
    expect(
      css.match(/var\(--fcb-topbar-h\)\s*\+\s*var\(--fcb-subbar-h\)/g),
    ).toHaveLength(1);
    expect(css.match(/--fcb-sticky-base:\s*calc/g)).toHaveLength(1);
    expect(css.match(/--fcb-sticky-top:\s*calc/g)).toHaveLength(1);
    expect(css.match(/--fcb-sticky-avail:\s*calc/g)).toHaveLength(1);
  });

  it('redeclares the formula at every --fcb-subtab-h switch point', () => {
    // A custom property built from var() freezes its inputs where it is
    // declared: defined only on :root, --fcb-sticky-top would keep the
    // subtab height at zero everywhere and .fcb-has-subtabs would stop
    // shifting anything below it. The one definition therefore lists every
    // element that switches --fcb-subtab-h.
    const definition = css.match(
      /([^{}]*)\{[^{}]*--fcb-sticky-top:\s*calc[^{}]*\}/s,
    )?.[1];
    expect(definition, 'the sticky-property definition rule').toBeDefined();
    for (const selector of [
      ':root',
      // The workspace carries the runtime-measured --fcb-subbar-h; without it
      // tabs outside a sub-tab context freeze on the :root fallback height.
      '.fcb-workspace',
      '.fcb-has-subtabs',
      '.fcb-magic-layout',
    ]) {
      expect(definition, selector).toContain(selector);
    }
  });

  it('derives every sticky height cap from --fcb-sticky-avail', () => {
    // The full-stack subtraction only — the mobile navigation target caps
    // against topbar + navstrip, a different stack, and keeps its own sum.
    expect(css).not.toMatch(
      /var\(--fcb-viewport-height\)\s*-\s*var\(--fcb-topbar-h\)\s*-\s*var\(--fcb-subbar-h\)/,
    );
  });

  it('carries no dead layout variables', () => {
    // Declared twice, consumed nowhere.
    expect(css).not.toContain('--fcb-equipment-search-height');
  });

  it('lets a rail scroll rather than spill past the pane, in every tab', () => {
    // A rail's length is content's to decide: Equipment publishes seventeen
    // categories from the SRD alone and a full caster's Magic rail reaches
    // ten. A rail that outgrows its column would spill past the pane, which
    // clips — and with neither the rail nor the pane scrolling, the entries
    // past the edge could not be reached at all. Keyed on the rail, not on
    // any one tab, so Equipment and Magic
    // still clipped a 9th-level row at 768px.
    const desktop = css.slice(css.lastIndexOf('@media (min-width: 821px)'));
    const wide = desktop.slice(
      desktop.indexOf('@container fcb-pane (min-width: 1081px)'),
    );
    const rule = wide.match(
      /\.fcb-builder-layout\s*>\s*\.fcb-left-nav\s*\{([^}]*)\}/s,
    )?.[1];
    expect(rule, 'the wide-pane rail rule').toBeDefined();
    expect(rule).toMatch(/overflow-y:\s*auto;/);
    // Without these the rail sizes to its content and the row grows with it,
    // so the scroll region has nothing to scroll inside.
    expect(rule).toMatch(/min-height:\s*0;/);
    expect(rule).toMatch(/max-height:\s*100%;/);
    // No tab may be carved out of it — that exception is what left Magic
    // clipping after Equipment was fixed.
    expect(desktop).not.toMatch(/\.fcb-left-nav:not\(/);
  });

  it('declares each desktop scroll owner in one shared I4 rule', () => {
    // Every pane scroller shares one behaviour block; only flex sizing stays
    // per-site. Separate copies are how the shape drifted into three variants.
    const owners = [
      '.fcb-editor-primary',
      '.fcb-description-scroll',
      '.fcb-inventory-scroll',
      '.fcb-equipment-results',
    ];
    const rules = [
      ...css.matchAll(
        /([^{}]*)\{[^{}]*overflow-y:\s*auto;[^{}]*overscroll-behavior:\s*contain;[^{}]*scrollbar-gutter:\s*stable;[^{}]*\}/gs,
      ),
    ].map((m) => m[1]);
    const shared = rules.find((r) => owners.every((o) => r.includes(o)));
    expect(shared, 'one rule naming every pane scroll owner').toBeDefined();
  });
});
