import { describe, expect, it } from 'vitest';
import {
  formatRequirementExpression,
  requirementDuplicatesPrerequisite,
} from '../requirementPresentation';

describe('requirement presentation', () => {
  it('turns element identifiers and boolean operators into readable text', () => {
    expect(
      formatRequirementExpression(
        'ID_PHB_SPELL_ELDRITCH_BLAST,!ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION'
      )
    ).toBe('Eldritch Blast and not Eldritch Invocation');

    expect(
      formatRequirementExpression(
        '!(ID_VISION_SUPERIORDARKVISION || ID_VISION_DARKVISION)'
      )
    ).toBe('Not (Superior Darkvision or Darkvision)');
  });

  it('describes negated multiclass controls without source-code wording', () => {
    expect(
      formatRequirementExpression('!ID_WOTC_PHB_MULTICLASS_BARD')
    ).toBe('Not multiclassed as Bard');
  });

  it('formats bracket predicates and unknown identifiers without leaking raw syntax', () => {
    const formatted = formatRequirementExpression(
      '[level:5],ID_VENDOR_BOOK_MYSTERIOUS_THING'
    );

    expect(formatted).toBe('Level 5 and Vendor Book Mysterious Thing');
    expect(formatted).not.toMatch(/!?ID_|&&|\|\||\[[^\]]+\]/);
  });

  it('recognises equivalent level prerequisites without hiding different details', () => {
    expect(
      requirementDuplicatesPrerequisite({
        prerequisite: '5th level',
        requirements: '[level:5]',
      })
    ).toBe(true);
    expect(
      requirementDuplicatesPrerequisite({
        prerequisite: 'eldritch blast cantrip',
        requirements: 'ID_PHB_SPELL_DANCING_LIGHTS',
      })
    ).toBe(false);
  });

  it('recognises equivalent authored and engine requirement forms', () => {
    const equivalentPairs = [
      ['Strength 13 or higher', '[str:13]'],
      ['Dexterity 13 and Wisdom 13', '([dex:13],[wis:13])'],
      ['Strength 13 or Dexterity 13', '([str:13]||[dex:13])'],
      ['eldritch blast cantrip', 'ID_PHB_SPELL_ELDRITCH_BLAST'],
      [
        'Pact of the Tome feature',
        'ID_WOTC_PHB_CLASS_FEATURE_WARLOCK_PACT_BOON_PACT_OF_THE_TOME',
      ],
      [
        '15th level, Pact of the Chain feature',
        '[level:15],ID_WOTC_PHB_CLASS_FEATURE_WARLOCK_PACT_BOON_PACT_OF_THE_CHAIN',
      ],
    ];

    for (const [prerequisite, requirements] of equivalentPairs) {
      expect(
        requirementDuplicatesPrerequisite({ prerequisite, requirements })
      ).toBe(true);
    }

    expect(
      requirementDuplicatesPrerequisite({
        prerequisite: '5th level',
        requirements:
          '[level:5],ID_WOTC_PHB_CLASS_FEATURE_WARLOCK_PACT_BOON_PACT_OF_THE_BLADE',
      })
    ).toBe(false);
  });
});
