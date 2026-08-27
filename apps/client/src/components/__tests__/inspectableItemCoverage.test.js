import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const selectionRule = read('../SelectionRuleCard.jsx');
const build = read('../tabs/BuildTab.jsx');
const magic = read('../tabs/MagicTab.jsx');
const spellBrowser = read('../tabs/magic/SpellBrowser.jsx');
const optionalRules = read('../tabs/manage/OptionalRulesPanel.jsx');
const equipment = read('../tabs/EquipmentTab.jsx');
const companion = read('../tabs/magic/CompanionSection.jsx');
const contentManager = read('../ContentManager.jsx');

describe('inspectable item coverage', () => {
  it('combines inspection with the existing choice actions', () => {
    expect(selectionRule).toContain('<InspectableItemButton');
    expect(selectionRule).toContain(
      'onActivate={() => selectOption(option, slot)}',
    );
    expect(spellBrowser).toContain('<InspectableItemButton');
    expect(spellBrowser).toContain(
      'onActivate={() => onSpellClick(spell)}',
    );
  });

  it('makes non-mutating item content inspectable across information lists', () => {
    for (const source of [
      build,
      magic,
      optionalRules,
      equipment,
      companion,
    ]) {
      expect(source).toContain('<InspectableItemButton');
    }
  });

  it('uses the shared inspection-only information button', () => {
    // ContentManager rows inspect via the dedicated info button only — the
    // row text is plain, per the content-library UX decision.
    for (const source of [
      selectionRule,
      build,
      magic,
      spellBrowser,
      optionalRules,
      equipment,
      companion,
      contentManager,
    ]) {
      expect(source).toContain('<InformationButton');
    }
  });
});
