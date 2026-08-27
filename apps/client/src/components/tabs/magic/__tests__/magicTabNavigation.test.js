import { describe, expect, it } from 'vitest';
import { buildMagicTabs, resolveMagicTabKey } from '../magicTabNavigation.js';

const caster = (overrides = {}) => ({
  identifier: 'caster-cleric',
  name: 'Cleric',
  requiresPreparation: true,
  ...overrides,
});

const spellRule = (overrides = {}) => ({
  identifier: 'rule-cantrips',
  isOptional: false,
  selectionCount: 3,
  selectedElementIds: [null, null, null],
  ...overrides,
});

describe('Magic tab navigation', () => {
  it('starts an unfinished prepared caster in Choose spells', () => {
    const casters = [caster()];
    const spellRules = [spellRule()];
    const tabs = buildMagicTabs({ spellRules, casters, hasCompanion: false });

    expect(tabs).toEqual([
      {
        key: 'choose',
        label: 'Choose spells',
        compactLabel: 'Choose',
        ariaLabel: 'Choose spells',
      },
      {
        key: 'caster-cleric',
        label: 'Prepare spells',
        compactLabel: 'Prepare',
        ariaLabel: 'Prepare Cleric spells',
      },
    ]);
    expect(resolveMagicTabKey({ tabs, spellRules, casters })).toBe('choose');
  });

  it('opens the caster list once required spell choices are complete', () => {
    const casters = [caster()];
    const spellRules = [
      spellRule({
        selectedElementIds: ['spell-1', 'spell-2', 'spell-3'],
      }),
    ];
    const tabs = buildMagicTabs({ spellRules, casters, hasCompanion: false });

    expect(resolveMagicTabKey({ tabs, spellRules, casters })).toBe(
      'caster-cleric',
    );
  });

  it('does not create an empty Choose tab for a preparation-only caster', () => {
    const casters = [caster({ name: 'Paladin', identifier: 'caster-paladin' })];
    const tabs = buildMagicTabs({
      spellRules: [],
      casters,
      hasCompanion: false,
    });

    expect(tabs).toEqual([
      {
        key: 'caster-paladin',
        label: 'Prepare spells',
        compactLabel: 'Prepare',
        ariaLabel: 'Prepare Paladin spells',
      },
    ]);
    expect(resolveMagicTabKey({ tabs, spellRules: [], casters })).toBe(
      'caster-paladin',
    );
  });

  it('labels known-spell and multiclass caster destinations accurately', () => {
    const casters = [
      caster(),
      caster({
        identifier: 'caster-bard',
        name: 'Bard',
        requiresPreparation: false,
      }),
    ];
    const tabs = buildMagicTabs({
      spellRules: [spellRule()],
      casters,
      hasCompanion: true,
    });

    expect(tabs.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'choose', label: 'Choose spells' },
      { key: 'caster-cleric', label: 'Prepare: Cleric' },
      { key: 'caster-bard', label: 'Known: Bard' },
      { key: 'companion', label: 'Familiar & Companion' },
    ]);
  });

  it('preserves a valid user-selected tab as character data refreshes', () => {
    const casters = [caster()];
    const spellRules = [
      spellRule({
        selectedElementIds: ['spell-1', 'spell-2', 'spell-3'],
      }),
    ];
    const tabs = buildMagicTabs({ spellRules, casters, hasCompanion: false });

    expect(
      resolveMagicTabKey({
        requestedKey: 'caster-cleric',
        tabs,
        spellRules,
        casters,
      }),
    ).toBe('caster-cleric');
  });
});
