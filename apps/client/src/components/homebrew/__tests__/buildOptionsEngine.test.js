// Drives the character-option forms' XML through the real engine with the shipped baseline: a pack of a
// class, a subclass of a shipped class, a species with a subspecies and a background loads without a
// finding and builds a character, and the pick list a subclass or subspecies answers to is found in
// the shipped rules of both rulesets.

import { beforeAll, describe, expect, it } from 'vitest';
import { pendingSelectionRules, selectionOptions } from '@forge-cb/engine';
import {
  createCustomBackgroundDraft,
  createCustomClassDraft,
  createCustomSpeciesDraft,
  createCustomSubclassDraft,
  createCustomSubspeciesDraft,
  createProgressionFeature,
  newCustomBlockId,
} from '@forge-cb/engine/custom';
import { ID, buildCharacter } from '../../../../../../packages/engine/src/testing/character-factory.ts';
import { libraryWithHomebrew } from './homebrewHarness.js';
import { findPickTag } from '../parentLookup.js';
import { elementForDraft, elementForFinding, elementIdsOf } from '../packModel.js';
import { createCollection } from '../xmlBuilder.js';

const grant = (type, id) => ({ kind: 'grant', id: newCustomBlockId(), target: { by: 'id', type, id } });
const withText = (entry, name, text) => ({ ...entry, draft: { ...entry.draft, name, description: text } });

const klass = {
  ...createCustomClassDraft('Moonwalker'),
  hitDie: 10,
  features: [withText(createProgressionFeature('class', 1, ''), 'Lunar Step', 'You step through moonlight.')],
  subclass: { level: 3, label: 'Moon Path' },
  asiLevels: [4],
  starting: [grant('Proficiency', 'ID_PROFICIENCY_SAVINGTHROW_WISDOM')],
};
const wellkeeper = {
  ...createCustomSubclassDraft({ id: klass.id, name: 'Moonwalker', tag: 'Moon Path' }, 'Wellkeeper'),
  features: [withText(createProgressionFeature('subclass', 3, ''), 'Well Gift', 'A well in your mind.')],
};
const selkie = { ...createCustomSpeciesDraft('Selkie'), size: 'Small', speed: 25, subspecies: { kind: 'Sub Race' } };
const grey = { ...createCustomSubspeciesDraft({ id: selkie.id, name: 'Selkie', tag: 'Selkie' }, 'Grey Selkie'), speedBonus: 5 };
const keeper = { ...createCustomBackgroundDraft('Lighthouse Keeper'), starting: [grant('Proficiency', 'ID_PROFICIENCY_SKILL_INSIGHT')], equipment: ['A brass lantern'] };

let library;
const pack = createCollection('Moon Forge');
beforeAll(async () => {
  const collection = { ...pack, elements: [klass, wellkeeper, selkie, grey, keeper].map((draft) => elementForDraft(draft, pack)) };
  library = await libraryWithHomebrew(collection);
});

const pending = (service, id, name) => pendingSelectionRules(service.getCharacter(id)).filter((rule) => rule.name === name);

describe('a pack of character options loads and builds', () => {
  it('loads without a finding against the shipped content', () => {
    const findings = (library.diagnostics ?? []).filter((entry) => entry.file.startsWith('homebrew/'));
    expect(findings).toEqual([]);
    expect(library.byId.get(klass.id).identity.type).toBe('Class');
    expect(library.byId.get(wellkeeper.id).identity.type).toBe('Archetype');
  });

  it('builds a level-4 moonwalker with its subclass, feature and improvement option', () => {
    const { service, id } = buildCharacter(library, { id: 'HbMoon', classId: klass.id, levels: 4 });
    const state = service.getCharacter(id);
    const rule = pending(service, id, 'Moon Path')[0];
    expect(selectionOptions(state, library, rule).map((option) => option.id)).toEqual([wellkeeper.id]);
    service.setSelection(id, rule.identifier, wellkeeper.id);
    const registered = service.getCharacter(id).sum.elements.map((entry) => entry.id);
    expect(registered).toContain(klass.features[0].draft.id);
    expect(registered).toContain(wellkeeper.features[0].draft.id);
    expect(pending(service, id, 'Improvement Option (Moonwalker 4)')).toHaveLength(1);
  });

  it('builds a selkie with its subspecies and a keeper with its proficiency', () => {
    const { service, id } = buildCharacter(library, { id: 'HbSelkie', raceId: selkie.id, subRaceId: grey.id, classId: ID.CLASS_FIGHTER, levels: 1 });
    const registered = service.getCharacter(id).sum.elements.map((entry) => entry.id);
    expect(registered).toContain('ID_SIZE_SMALL');
    expect(registered).toContain(grey.id);
    service.setSelection(id, pending(service, id, 'Background')[0].identifier, keeper.id);
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).toContain('ID_PROFICIENCY_SKILL_INSIGHT');
  });

  it('names every element a class wrote, so pack health can open the class for a finding about its feature', () => {
    const element = elementForDraft(klass, pack);
    const ids = elementIdsOf(element, pack);
    expect(ids[0]).toBe(klass.id);
    expect(ids).toContain(klass.features[0].draft.id);
    expect(ids).toContain(`${klass.id}_ASI`);
    // A finding about the class' feature opens the class.
    const withClass = { ...pack, elements: [element] };
    expect(elementForFinding({ elementId: klass.features[0].draft.id }, withClass)).toBe(element);
    expect(elementForFinding({ elementId: 'ID_SOMEWHERE_ELSE' }, withClass)).toBeNull();
  });
});

describe('the pick list a subclass or subspecies answers to is found in the shipped rules', () => {
  const api = { content: { element: async (id) => ({ rules: library.byId.get(id)?.rulesXml ?? null }) } };

  it.each([
    ['the 2014 wizard', 'ID_WOTC_PHB_CLASS_WIZARD', 'subclass', 'Arcane Tradition'],
    ['the 2024 wizard', 'ID_WOTC_PHB24_CLASS_WIZARD', 'subclass', 'Arcane Tradition||Wizard Subclass'],
    ['the 2014 fighter', 'ID_WOTC_PHB_CLASS_FIGHTER', 'subclass', 'Martial Archetype'],
    ['the elf', 'ID_RACE_ELF', 'subspecies', 'Elf'],
  ])('%s', async (_name, id, kind, tag) => {
    expect((await findPickTag(api, id, kind))?.tag).toBe(tag);
  });

  it('reads a homebrew class the same way once it is loaded', async () => {
    expect(await findPickTag(api, klass.id, 'subclass')).toEqual({ tag: 'Moon Path', kind: 'Archetype' });
    expect(await findPickTag(api, selkie.id, 'subspecies')).toEqual({ tag: 'Selkie', kind: 'Sub Race' });
  });

  it('finds none for a class that offers no subclass', async () => {
    expect(await findPickTag(api, keeper.id, 'subclass')).toBeNull();
  });
});
