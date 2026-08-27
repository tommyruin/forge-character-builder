import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const navigation = read('../../hooks/useMobileDescriptionNavigation.js');
const description = read('../DescriptionPanel.jsx');
const build = read('../tabs/BuildTab.jsx');
const magic = read('../tabs/MagicTab.jsx');
const equipment = read('../tabs/EquipmentTab.jsx');
const manage = read('../tabs/ManageTab.jsx');
const optionalRules = read('../tabs/manage/OptionalRulesPanel.jsx');
const css = read('../../index.css');
const occurrences = (source, value) => source.split(value).length - 1;

describe('mobile description navigation', () => {
  it('captures the workspace position and restores the originating information button', () => {
    // The mobile threshold is declared once, in layoutBreakpoints.
    expect(navigation).toContain(
      "import { MOBILE_VIEWPORT_QUERY } from '../layoutBreakpoints'",
    );
    expect(navigation).toContain(
      'window.matchMedia(MOBILE_VIEWPORT_QUERY).matches',
    );
    expect(navigation).not.toContain('(max-width: 820px)');
    expect(navigation).toContain("source.closest('.fcb-workspace-main')");
    expect(navigation).toContain('scrollTop: scrollOwner.scrollTop');
    expect(navigation).toContain('scrollOwner.scrollTo');
    expect(navigation).toContain('source.focus({ preventScroll: true })');
    expect(navigation).toContain('source?.isConnected');
  });

  it('refocuses the equivalent information button when the list rerenders', () => {
    expect(navigation).toContain(
      "sourceLabel: source.getAttribute('aria-label')",
    );
    expect(navigation).toContain('returnState.sourceLabel');
    expect(navigation).toContain('querySelectorAll');
    expect(navigation).toContain('focus({ preventScroll: true })');
  });

  it('aligns the details panel again after asynchronous content is ready', () => {
    expect(navigation).toContain('panel.scrollIntoView({ block:');
    expect(navigation).toContain('panel.getBoundingClientRect()');
    expect(navigation).toContain('scrollOwner.getBoundingClientRect()');
    expect(navigation).toContain('onContentReady');
    expect(description).toContain('onContentReady(panelRef.current)');
    expect(css).toMatch(
      /@media \(max-width:\s*820px\)[\s\S]*?\.fcb-description-panel\s*\{[^}]*scroll-margin-top:\s*0;/s,
    );
    expect(description).toContain('is-mobile-navigation-target');
    expect(css).toMatch(
      /\.fcb-description-panel\.is-mobile-navigation-target\s*\{[^}]*min-height:\s*calc\(/s,
    );
    expect(css).toMatch(
      /\.fcb-description-panel\.is-mobile-navigation-target\s*\{[^}]*overflow:\s*visible;/s,
    );
  });

  it('uses the shared behavior for every workspace information-button surface', () => {
    for (const source of [build, magic, equipment, manage, optionalRules]) {
      expect(source).toContain('useMobileDescriptionNavigation');
      expect(source).toContain('{...descriptionPanelProps}');
    }
    expect(
      occurrences(build, 'onInspect={inspectItem}'),
    ).toBeGreaterThanOrEqual(3);
    expect(
      occurrences(equipment, 'onInspect={inspectItem}'),
    ).toBeGreaterThanOrEqual(5);
    expect(manage).toContain('onInspect={inspectItem}');
    expect(
      occurrences(optionalRules, 'onInspect={inspectItem}'),
    ).toBeGreaterThanOrEqual(2);
    expect(magic).toContain(
      '<CompanionSection rules={companionRules} onInspect={inspectSpell} />',
    );
  });

  it('keeps the details destination and return action explicitly labelled', () => {
    expect(description).toContain('detailsLabel');
    expect(description).toContain('aria-label={onReturn ? detailsLabel');
    expect(description).toContain('aria-label={returnLabel}');
  });

  it('floats only the return button over mobile description content', () => {
    const returnRules = [
      ...css.matchAll(/\.fcb-description-return\s*\{([^}]*)\}/gs),
    ].at(-1)?.[1];

    expect(description).toContain(
      'className="fcb-button fcb-description-return"',
    );
    expect(description).not.toContain(
      '<div className="fcb-description-return">',
    );
    expect(returnRules).toContain('position: sticky;');
    expect(returnRules).toContain('width: fit-content;');
    expect(returnRules).toContain('max-width: calc(100% - 20px);');
    expect(returnRules).toContain('margin: 10px auto;');
    expect(css).not.toContain('.fcb-description-return .fcb-button');
  });
});
