import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../tabs/MagicTab.jsx', import.meta.url),
  'utf8',
);
const browserSource = readFileSync(
  new URL('../tabs/magic/SpellBrowser.jsx', import.meta.url),
  'utf8',
);
const detailSource = readFileSync(
  new URL('../tabs/magic/SpellDetails.jsx', import.meta.url),
  'utf8',
);
const resourceSource = readFileSync(
  new URL('../tabs/magic/spellResource.js', import.meta.url),
  'utf8',
);
const navigationSource = readFileSync(
  new URL('../tabs/magic/magicTabNavigation.js', import.meta.url),
  'utf8',
);
const descriptionSource = readFileSync(
  new URL('../DescriptionPanel.jsx', import.meta.url),
  'utf8',
);
const cssSource = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8',
);

describe('MagicTab compact layout', () => {
  it('reflows narrow prepared-spell columns inside Split View', () => {
    expect(cssSource).toMatch(
      /\.fcb-magic-stack\s*\{[^}]*container:\s*fcb-magic-primary\s*\/\s*inline-size;/s,
    );
    expect(cssSource).toMatch(
      /@container fcb-magic-primary \(max-width:\s*700px\)[\s\S]*?\.fcb-mobile-list-table,\s*\.fcb-mobile-list-table tbody\s*\{[^}]*display:\s*block;/s,
    );
    expect(cssSource).toMatch(
      /@container fcb-magic-primary \(max-width:\s*700px\)[\s\S]*?\.fcb-mobile-list-table tr\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(cssSource).toMatch(
      /@container fcb-magic-primary \(max-width:\s*700px\)[\s\S]*?\.fcb-mobile-list-table \.fcb-mobile-list-actions\s*\{[^}]*grid-column:\s*2;/s,
    );
  });

  it('separates spell choices from each caster prepared or known panel', () => {
    const chooseStart = source.indexOf("{activeTab === 'choose' && (");
    const casterStart = source.indexOf('{activeCaster && (', chooseStart);
    const companionStart = source.indexOf(
      "{activeTab === 'companion' && (",
      casterStart,
    );
    const chooseView = source.slice(chooseStart, casterStart);
    const casterView = source.slice(casterStart, companionStart);

    expect(navigationSource).toContain("key: 'choose'");
    expect(navigationSource).toContain("label: 'Choose spells'");
    expect(navigationSource).toContain(
      "caster.requiresPreparation ? 'Prepare' : 'Known'",
    );
    expect(chooseView).toContain('data-testid="choose-spells-view"');
    // The rail selects the rule and the panel renders its browser directly —
    // no accordion card, no group nesting.
    expect(chooseView).toContain('ruleGroups.find');
    expect(chooseView).toContain('<SpellBrowser');
    expect(source).not.toContain('fcb-rule-trigger');
    expect(source).not.toContain('fcb-rule-options');
    expect(chooseView).not.toContain("'Prepared spells'");
    expect(chooseView).not.toContain("'Known spells'");
    expect(casterView).toContain("'Prepared spells'");
    expect(casterView).toContain("'Known spells'");
    expect(casterView).not.toContain('<SpellBrowser');
    // The rail names the choice and the level it unlocks at, so the panel
    // repeats neither; only the pick count and the grant action sit above the
    // spells they apply to.
    expect(source).toContain('`level ${rule.requiredLevel}`');
    expect(chooseView).not.toContain('fcb-panel-header');
    // The pick count rides the browser's own facts row instead.
    expect(chooseView).toContain('status={');
    expect(browserSource).toContain('fcb-spell-browser-status');
    expect(source).not.toContain('activeCasterRules');
    expect(source).not.toContain("activeTab === 'other'");
    expect(source).not.toContain('aria-controls={`magic-panel-${t.key}`}');
  });

  it('keeps caster context and Add a spell with the caster destination', () => {
    const summaryStart = source.indexOf('className="fcb-caster-summary"');
    const summaryEnd = source.indexOf('</div>', summaryStart);
    const summary = source.slice(summaryStart, summaryEnd);
    const chooseBrowser = source.indexOf('<SpellBrowser');
    const chooseHeader = source.slice(
      chooseBrowser,
      source.indexOf('/>', chooseBrowser),
    );
    const casterHeading = source.indexOf("'Prepared spells'");
    const casterHeaderStart = source.lastIndexOf('<header', casterHeading);
    const casterHeaderEnd = source.indexOf('</header>', casterHeading);
    const casterHeader = source.slice(casterHeaderStart, casterHeaderEnd);
    const emptyHeading = source.indexOf('>No spellcasting</h2>');
    const emptyHeaderStart = source.lastIndexOf('<header', emptyHeading);
    const emptyHeaderEnd = source.indexOf('</header>', emptyHeading);
    const emptyHeader = source.slice(emptyHeaderStart, emptyHeaderEnd);

    expect(summary).toContain('ABILITY_ABBREVIATIONS');
    expect(summary).toContain('ATK');
    expect(summary).toContain('DC <strong>');
    // The summary sits in the Magic bar (top right, under the workspace stat
    // pills) and renders exactly once, on every view including Choose spells.
    expect(
      source.match(/<CasterSummary caster=\{summaryCaster\} \/>/g),
    ).toHaveLength(1);
    expect(source).toContain('const summaryCaster = activeCaster ?? liveCasters[0]');
    const summaryUsage = source.indexOf(
      '<CasterSummary caster={summaryCaster} />',
    );
    const barStart = source.indexOf('fcb-subtab-bar fcb-magic-subbar');
    expect(summaryUsage).toBeGreaterThan(barStart);
    expect(summary).not.toContain('addSpellAction');
    expect(summary).not.toContain('Add a spell');
    expect(chooseHeader).toContain(
      'liveCasters.length === 0 ? addSpellAction() : null',
    );
    expect(casterHeader).toContain('addSpellAction()');
    expect(emptyHeader).toContain('addSpellAction()');
  });

  it('navigates Magic through top view tabs and the shared section rail', () => {
    // Equipment's hybrid: views as a segmented top bar, in-view sections
    // (spell choices, spell levels) on the shared builder-layout rail.
    expect(source).toContain(
      'fcb-secondary-tabs fcb-segmented-tabs fcb-magic-tabs',
    );
    expect(source).toContain('<SectionNav');
    // The rail goes through the shell's slot, which derives the layout class;
    // a private wrapper around the rail is what would make rules written
    // against the tab root skip Magic.
    expect(source).toContain('<WorkspaceTabLayout');
    // The rail slot holds both forms of the rail, in this order: the
    // phone-width select first, then the strip it replaces. The CSS that hides
    // the strip keys on the two being adjacent siblings, so the order is load
    // bearing, not cosmetic.
    expect(source).toMatch(
      /rail=\{[\s\S]{0,400}fcb-mobile-category-select[\s\S]{0,600}<SectionNav/,
    );
    expect(source).not.toContain('fcb-magic-content');
    expect(source).not.toContain('fcb-builder-layout');
    // Spell levels moved from their own pill row onto the shared rail.
    expect(source).not.toContain('fcb-caster-level-tabs');
    expect(cssSource).not.toMatch(/\.fcb-caster-level-tabs/);
  });

  it('never leaves the pick count alone on a row of its own', () => {
    // The count sits opposite the spell facts when there are any (the max
    // spell level pill). With none, that row holds nothing but the count, so
    // it would float above the level pills instead of beside them.
    expect(browserSource).toContain('hasSpellFacts');
    expect(browserSource).toMatch(
      /hasSpellFacts\s*&&[\s\S]{0,400}fcb-spell-browser-status/,
    );
    // Window widened past the pills' own markup, which now also carries the
    // locked-level count that stands in for the locked pills on a phone. The
    // assertion is still that the status rides this row rather than its own.
    expect(browserSource).toMatch(
      /fcb-spell-level-row[\s\S]{0,600}fcb-spell-level-tabs[\s\S]{0,1200}!hasSpellFacts\s*&&[\s\S]{0,200}fcb-spell-browser-status/,
    );
    expect(cssSource).toMatch(
      /\.fcb-spell-level-row\s*\{[^}]*display:\s*flex;/s,
    );
  });

  it('renders one spell-pick count in the rule header', () => {
    expect(source).toContain('data-testid="spell-picks-available"');
    expect(source).toContain('{used} of {rule.selectionCount} selected');
    expect(source).not.toContain('to pick');
    expect(browserSource).not.toContain('spell-picks-available');
    expect(browserSource).not.toContain('Available{');
  });

  it('announces a learned spell only after both spell views refresh', () => {
    expect(browserSource).toContain(
      'const [browseResult, casterResult] = await Promise.all',
    );
    expect(browserSource).toContain(
      'if (!browseResult || (onLearned && !casterResult)) return;',
    );
    expect(browserSource.indexOf('if (!browseResult')).toBeLessThan(
      browserSource.indexOf('Learned <strong>'),
    );
  });

  it('keeps spell points optional while preserving the slot fallback', () => {
    expect(source).toContain('data-testid="spell-points-option"');
    expect(source).not.toContain('data-testid="spell-points-toggle"');
    expect(source).toContain('Enabled under Manage / Optional rules');
    expect(source).toContain('data-testid="spell-point-cost-table"');
    expect(source).toContain('<table');
    expect(source).toContain('<th scope="row">Cost</th>');
    expect(source).not.toContain('aria-label="Use spell points"');
    expect(source).toContain('spellResourceDisplay(caster)');
    expect(resourceSource).toContain("caster.resource?.mode === 'spellPoints'");
    expect(resourceSource).toContain('Shared spell point pool');
    expect(resourceSource).toContain("label: 'SLOTS'");
    expect(source).toContain('Pact Magic remains');
    expect(source).toContain('slot-based.');
  });

  it('preserves the primary pane position when changing known spell ranks', () => {
    expect(source).toContain('setSpellLevelTab(level);');
    expect(source).not.toMatch(
      /setSpellLevelTab\(level\);\s*resetPrimaryScroll\(\);/s,
    );
  });

  it('jumps mobile spell information into view and restores the spell-list position', () => {
    expect(source).toContain('useMobileDescriptionNavigation');
    expect(source).toContain('const {');
    expect(source).toContain('inspect: inspectSpell');
    expect(source).toContain('descriptionPanelProps');
    expect(source).toContain('returnLabel="Back to spell list"');
    expect(source).toContain('detailsLabel="Spell details"');
    expect(descriptionSource).toContain('onReturn');
    expect(descriptionSource).toContain('onContentReady');
    expect(descriptionSource).toContain('onContentReady(panelRef.current)');
    expect(descriptionSource).toContain('tabIndex={onReturn ? -1 : undefined}');
    expect(descriptionSource).toContain('aria-label={returnLabel}');
    expect(descriptionSource).toContain('data-testid="description-return"');
  });

  it('keeps the spell filter mounted while narrowing its results', () => {
    expect(browserSource).toContain(
      'const activeLevelSpells = browse.spells.filter',
    );
    expect(browserSource).toContain('activeLevelSpells.length > 8');
    expect(browserSource).not.toContain(
      'visible.length + (filter ? 1 : 0) > 8',
    );
  });

  it('renders complete spell detail metadata for a selected spell', () => {
    expect(source).toContain('<SpellDetails');
    expect(browserSource).toContain('onSpellDetails');
    expect(source).toContain('inspectedSpell');
    expect(source).toContain('Spell details');
    expect(detailSource).toContain('spell.range');
    expect(detailSource).toContain('spell.duration');
    expect(detailSource).toContain('spell.description');
    expect(detailSource).toContain('Casting Time');
    expect(detailSource).toContain('Components');
    expect(detailSource).toContain('Duration');
  });

  it('renders casting metadata inside the styled description, not a plain list below', () => {
    // The school/level headline and bold Casting Time / Range / Components /
    // Duration lines are composed into the ContentRenderer content so they get
    // the homebrewery styling; a separate unstyled dl below the card read as
    // dumped raw text.
    expect(detailSource).toContain('composedContent');
    expect(detailSource).toMatch(/content=\{composedContent\}/);
    expect(detailSource).toContain('<p class="spell-meta-line"><strong>${label}:</strong>');
    expect(detailSource).not.toContain('<dl');
    expect(detailSource).not.toContain('spell-detail-metadata');
    // The metadata block carries a styled gap before the spell text begins.
    expect(detailSource).toContain('<div class="spell-meta">');
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.fcb-rich-text \.fcb-spell-meta\s*\{[^}]*margin-bottom:/s);
    expect(css).toMatch(/:not\(\s*\.fcb-spell-meta-line\s*\)/s);
  });

  it('marks a feature caster as granted rather than prepared', () => {
    // Magic Initiate and its kin project as a slotless "feature" caster:
    // nothing to prepare and nothing to remove. The prepare counter, the
    // Prepared column and the toggles all key off requiresPreparation, which a
    // feature caster never sets; the remove action and the caption are the two
    // that need the kind guard.
    expect(source).toContain("activeCaster.kind === 'feature'");
    expect(source).toContain('Granted by feature. Always ready.');
    expect(source).toMatch(
      /activeCaster\.kind !== 'feature' \|\|[\s\S]*?dmSpellIds\.has\(spell\.id\)/,
    );
    expect(source).toContain('Free casting: ${spell.usage}');
  });

  it('keeps the remove action on the DM-grant block', () => {
    // A character with no class caster gets the engine's "Additional Spells"
    // block for spells the DM granted. It reports kind "feature" (no slots,
    // nothing to prepare), so the feature guard above would have hidden the
    // remove action that is the whole point of the block.
    expect(source).toContain("const GRANTED_CASTER_NAME = 'Additional Spells'");
    expect(source).toMatch(
      /activeCaster\.name === GRANTED_CASTER_NAME\s*\)\s*&&\s*dmSpellIds\.has\(spell\.id\)/,
    );
    // ...and its caption does not claim a feature granted them.
    expect(source).toContain('Granted spells. Always ready.');
  });

  it('derives the free-cast sentence from the spells that carry a usage', () => {
    // Only some feature grants promise a free cast: a tiefling's Infernal
    // Legacy, Armor of Shadows and the cantrip-only grants carry no usage, so
    // the old unconditional "the level 1 spell can be cast once per long rest"
    // claim was wrong for them. The sentence now hangs off the usage values
    // actually present on the caster's known spells.
    expect(source).not.toContain('the level 1 spell can');
    expect(source).toMatch(
      /const featureUsages = \[\s*\.\.\.new Set\(\s*\(activeCaster\?\.knownSpells \?\? \[\]\)\.map\(\(s\) => s\.usage\)\.filter\(Boolean\),/,
    );
    expect(source).toMatch(/featureUsages\.length > 0 &&/);
    expect(source).toContain('Spells marked ${featureUsages.join(');
    expect(source).toContain(
      'can be cast once per long rest without a spell slot.',
    );
  });

  it('keeps the prepared-spell limit warning visible on the client path', () => {
    expect(source).toContain('data-testid="prepare-limit-popup"');
    expect(source).toContain('can prepare at most');
    expect(source).toContain('currentPreparedCount >= caster.prepareCount');
  });

  it('pins the sub-tab row so short content cannot open a gap below the band', () => {
    // The sub-tabbed layouts fill their pane, and implicit auto grid rows
    // stretch into that height: with short content (Prepare Spells) the
    // leftover space landed in the band row as a large empty gap.
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(
      /\.fcb-builder-layout\.fcb-has-subtabs\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s,
    );
  });

  it('sits the school and source filters side by side in one row', () => {
    expect(browserSource).toMatch(
      /fcb-spell-filter-row[\s\S]{0,600}Filter by school[\s\S]{0,900}Filter by source/,
    );
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(
      /\.fcb-spell-filter-row\s*\{[^}]*display:\s*flex;/s,
    );
    expect(css).toMatch(
      /\.fcb-spell-filter-row\s*>\s*\.fcb-select\s*\{[^}]*flex:\s*1 1 0;/s,
    );
  });

  // The two below guard defects that only appear with content a default SRD
  // character does not have --- three view tabs needs a prepared companion,
  // and a second filter select needs a second spell source --- so the browser
  // sweep in scripts/verify-combined-browser.mjs cannot reach them. They are
  // layout contracts either way, so they are asserted against the source.

  it('never lets a view tab label paint outside its own segment', () => {
    // Segments split the row evenly, so a long label gets a fixed slice
    // however many tabs there are. `.fcb-tab` is `overflow: visible`, which
    // let "Familiar & Companion" run past the window instead of stopping at
    // the segment edge. The compact labels are the fix; the clip is the floor.
    expect(navigationSource).toContain('compactLabel');
    expect(source).toMatch(
      /fcb-tab-label--full[\s\S]{0,120}fcb-tab-label--compact/,
    );
    const segmentRule = cssSource.match(
      /\.fcb-segmented-tabs \.fcb-tab\s*\{([^}]*)\}/s,
    )?.[1];
    expect(segmentRule).toBeDefined();
    expect(segmentRule).toMatch(/overflow:\s*hidden;/);
    expect(segmentRule).toMatch(/text-overflow:\s*ellipsis;/);
    expect(segmentRule).toMatch(/min-width:\s*0;/);
  });

  it('lets the spell browser toolbar wrap rather than crush its search box', () => {
    // A blanket `.fcb-toolbar { flex-wrap: nowrap }` in the mobile block forced
    // the search field and the filter row onto one line. The field was the only
    // item that could shrink, so it collapsed to an untypable ~22px and the
    // trailing select was cut off past the window edge.
    const mobileBlock = cssSource.slice(
      cssSource.indexOf('@media (max-width: 820px)'),
    );
    expect(mobileBlock).not.toMatch(
      /(?<!-)\n\s*\.fcb-toolbar\s*\{[^}]*flex-wrap:\s*nowrap;/s,
    );
    // A floor under the field, and content-sized bases so the two share a line
    // when they fit and wrap when they do not.
    expect(cssSource).toMatch(
      /\.fcb-toolbar\s*>\s*\.fcb-input\s*\{[^}]*min-width:/s,
    );
    expect(cssSource).toMatch(
      /\.fcb-spell-filter-row\s*\{[^}]*min-width:\s*0;/s,
    );
  });
});
