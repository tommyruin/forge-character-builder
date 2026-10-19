import { describe, expect, it } from 'vitest';
import { createCustomDraft } from '@forge-cb/engine/custom';
import {
  castAbilityIssues,
  defaultBucket,
  defaultCastAbility,
  describeBlock,
  makeChoice,
  makeGrant,
  makeModifier,
  parseUsage,
  sheetPreview,
  summarizeDraft,
  usageText,
} from '../draftModel';

describe('usage text', () => {
  it('round-trips every recharge a limited-uses row offers', () => {
    for (const recharge of ['Short Rest', 'Long Rest', 'Dawn', 'Day', 'Never', 'Dice roll']) {
      expect(parseUsage(usageText(3, recharge))).toEqual({ count: 3, recharge });
    }
    expect(usageText(2, 'Short Rest')).toBe('2/Short Rest');
  });

  it('leaves text the author wrote alone', () => {
    expect(parseUsage('Once per moon')).toBeNull();
    expect(parseUsage('')).toBeNull();
  });
});

describe('plain-language summary', () => {
  it('reads a modifier with its mode, value and gates, never a stat key', () => {
    expect(describeBlock(makeModifier({ target: 'wisdom' }))).toBe('Wisdom score +1');
    expect(describeBlock(makeModifier({ target: 'strength', mode: 'setBase', value: { kind: 'number', value: 22 } }))).toBe(
      'Strength score: base becomes 22',
    );
    expect(describeBlock(makeModifier({ target: 'strength:max', mode: 'raiseMax', value: { kind: 'number', value: 2 } }))).toBe(
      'Strength maximum raised by 2',
    );
    expect(
      describeBlock(
        makeModifier({
          target: 'initiative',
          value: { kind: 'reference', ref: 'wisdom:modifier' },
          cap: { kind: 'number', value: 3 },
          gates: { level: 5, switch: 'Moonlit' },
        }),
      ),
    ).toBe('Initiative + Wisdom modifier, at most 3 (from level 5, only while Moonlit is on)');
    expect(describeBlock(makeModifier({ target: 'ac:misc', mode: 'bestOf', bucket: 'ward' }))).toContain('does not stack');
  });

  it('reads grants, spells and choices', () => {
    const spell = makeGrant('Spell', {
      target: { by: 'id', type: 'Spell', id: 'ID_X', label: 'Moonbeam' },
      spell: { prepared: true, caster: 'Druid', castAbility: 'wisdom' },
    });
    expect(describeBlock(spell)).toBe('Spell: Moonbeam (always prepared (Druid); cast with Wisdom)');
    expect(describeBlock(makeGrant('Language', { target: { by: 'id', type: 'Language', id: 'ID_L', label: 'Sylvan' } }))).toBe(
      'Language: Sylvan',
    );
    expect(describeBlock(makeGrant('Proficiency'))).toBe('Proficiency: not picked yet');
    expect(describeBlock(makeChoice({ name: 'Tongue', count: 2, supports: { kind: 'tag', value: 'Standard' } }))).toBe(
      'Player picks 2 languages matching Standard for "Tongue"',
    );
    expect(describeBlock(makeChoice({ type: 'List', name: 'Mark', items: ['Wolf', 'Owl'] }))).toBe(
      'Player picks 1 from your list: Wolf, Owl for "Mark"',
    );
  });

  it('lists every block, the usage line and the prerequisites', () => {
    const draft = {
      ...createCustomDraft('boon', 'Gift'),
      blocks: [makeModifier({ target: 'wisdom' })],
      sheet: { usage: '2/Short Rest' },
      requirements: { kind: 'level', min: 5 },
    };
    expect(summarizeDraft(draft)).toEqual([
      'Wisdom score +1',
      'Limited uses: 2/Short Rest',
      'Needs: Character level 5 or higher',
    ]);
  });
});

describe('sheet preview', () => {
  it('prints the title, the action and usage, and the text as the compiler would', () => {
    const draft = {
      ...createCustomDraft('boon', 'Moon Strike'),
      description: 'A silver arc.\n\nIt hums.',
      sheet: { action: 'bonusAction', usage: '1/Long Rest' },
    };
    expect(sheetPreview(draft)).toEqual({
      hidden: false,
      title: 'Moon Strike',
      meta: ['Bonus Action', '1/Long Rest'],
      text: 'A silver arc. It hums.',
    });
    expect(sheetPreview({ ...draft, sheet: { title: 'Lunar Arc', text: 'Short.', show: false } })).toMatchObject({
      hidden: true,
      title: 'Lunar Arc',
      text: 'Short.',
    });
  });

  it('falls back to a spell grant\'s free-cast allowance for the usage line', () => {
    const draft = {
      ...createCustomDraft('boon', 'Gift'),
      blocks: [makeGrant('Spell', { target: { by: 'id', type: 'Spell', id: 'ID_X' }, spell: { usage: '1/Long Rest' } })],
    };
    expect(sheetPreview(draft).meta).toEqual(['1/Long Rest']);
  });
});

describe('best-of group names', () => {
  it('uses the target\'s own bucket, else words from its label, never "base"', () => {
    expect(defaultBucket({ defaultBucket: 'extra attack', label: 'Attacks per Attack action' })).toBe('extra attack');
    expect(defaultBucket({ label: 'Armor class bonus' })).toBe('armor class bonus');
    expect(defaultBucket({ label: 'Base' })).toBe('custom bonus');
  });
});

describe('casting ability', () => {
  const spell = (castAbility) =>
    makeGrant('Spell', { target: { by: 'id', type: 'Spell', id: 'ID_X', label: 'X' }, spell: castAbility ? { castAbility } : {} });

  it('is the one the draft already uses, else the character\'s own', () => {
    const draft = { ...createCustomDraft('boon', 'T'), blocks: [spell('charisma')] };
    expect(defaultCastAbility(draft, 'wisdom')).toBe('charisma');
    expect(defaultCastAbility({ ...draft, blocks: [] }, 'wisdom')).toBe('wisdom');
    expect(defaultCastAbility({ ...draft, blocks: [] }, null)).toBeUndefined();
  });

  it('is required of every spell effect', () => {
    const draft = { ...createCustomDraft('boon', 'T'), blocks: [spell(undefined), spell('wisdom'), makeChoice({ type: 'Spell' })] };
    expect(castAbilityIssues(draft).map((issue) => issue.path)).toEqual(['blocks[0].spell.castAbility', 'blocks[2].castAbility']);
  });
});
