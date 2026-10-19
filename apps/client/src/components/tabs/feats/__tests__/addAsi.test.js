// The Add-ASI dialog grants element ids by name; they must be ids the shipped content defines, or
// the engine answers "not found" and the dialog can never apply.

import { describe, expect, it } from 'vitest';
import { computeStatistics } from '@forge-cb/engine';
import { buildFighter3 } from '../../../../../../../packages/engine/src/testing/character-factory.ts';
import { baselineIds, libraryWithHomebrew } from '../../../homebrew/__tests__/homebrewHarness.js';
import { ASI_ABILITIES } from '../asiAbilities.js';

const score = (service, library, id) => computeStatistics(service.getCharacter(id), library)['strength:score'];

describe('Add ASI dialog ids', () => {
  it('names an element the shipped content defines for every ability', async () => {
    const ids = await baselineIds();
    expect(ASI_ABILITIES.filter(({ id }) => !ids.has(id))).toEqual([]);
  });

  it('grants +2 to one ability on a character built from the shipped content', async () => {
    const library = await libraryWithHomebrew();
    const { service, id } = buildFighter3(library, 'Asi');
    const strength = ASI_ABILITIES.find(({ key }) => key === 'Strength').id;
    const before = score(service, library, id);
    service.addGrantedAbilityScore(id, { abilityElementIds: [strength, strength] });
    expect(score(service, library, id)).toBe(before + 2);
  });
});
