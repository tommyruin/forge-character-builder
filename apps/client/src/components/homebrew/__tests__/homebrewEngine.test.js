// Drives the editor's generated XML through the real engine: what the Homebrew forms write must
// do what the form promises on a character, not just parse.

import { beforeAll, describe, expect, it } from 'vitest';
import { computeStatistics, pendingSelectionRules, selectionOptions } from '@forge-cb/engine';
import { buildCharacter, buildFighter3 } from '../../../../../../packages/engine/src/testing/character-factory.ts';
import { baselineIds, libraryWithHomebrew } from './homebrewHarness.js';
import {
  ARMOR_GROUPS,
  FEAT_CATEGORIES,
  WEAPON_CATEGORIES,
  WEAPON_PROPERTIES,
  buildCollectionXml,
  createCollection,
  createElement,
  validateDraft,
} from '../xmlBuilder.js';

function collectionWith(...elements) {
  const collection = createCollection('Moon Forge');
  collection.elements = elements;
  return collection;
}

function armorElement({ name, group, armorClass }) {
  const element = createElement('Armor');
  element.name = name;
  element.supports = [group];
  element.setters = { ...element.setters, armorClass: String(armorClass) };
  return element;
}

function weaponElement({ name, category, damage = '1d8', slot = 'onehand', ...rest }) {
  const element = createElement('Weapon');
  element.name = name;
  element.supports = [category];
  element.setters = { ...element.setters, damage, slot, ...rest };
  return element;
}

function idOf(collection, element) {
  const match = buildCollectionXml(collection).match(new RegExp(`name="${element.name}"[^>]*id="([A-Z0-9_]+)"`));
  return match[1];
}

// A level 3 fighter (dexterity 14, +2) holding the item; the item is equipped where the engine
// puts it. Returns the service, id and the inventory record.
function fighterWith(library, itemId, location) {
  const { service, id } = buildFighter3(library, 'Hb');
  service.addItem(id, { itemId, amount: 1, baseElementId: null });
  let record = service.getInventory(id).items.find((item) => item.itemId === itemId);
  if (location && !record.isEquipped) {
    service.equipItem(id, record.identifier, location);
    record = service.getInventory(id).items.find((item) => item.itemId === itemId);
  }
  return { service, id, record };
}

let ids;
beforeAll(async () => {
  ids = await baselineIds();
}, 120_000);

describe('homebrew armor', () => {
  const medium = armorElement({ name: 'Moon Mail', group: 'ID_INTERNAL_ARMOR_GROUP_MEDIUM', armorClass: 15 });
  const heavy = armorElement({ name: 'Iron Moon', group: 'ID_INTERNAL_ARMOR_GROUP_HEAVY', armorClass: 18 });
  const shield = armorElement({ name: 'Moon Buckler', group: 'ID_INTERNAL_ARMOR_GROUP_SHIELD', armorClass: 3 });
  const collection = collectionWith(medium, heavy, shield);

  it('sets AC from its base value, honouring the medium dexterity cap', async () => {
    const library = await libraryWithHomebrew(collection);
    const { service, id, record } = fighterWith(library, idOf(collection, medium), 'armor');
    expect(record.isEquipped).toBe(true);
    // base 15 + dexterity (+2, capped at +2)
    expect(computeStatistics(service.getCharacter(id), library).ac).toBe(17);
  });

  it('ignores dexterity in heavy armor', async () => {
    const library = await libraryWithHomebrew(collection);
    const { service, id } = fighterWith(library, idOf(collection, heavy), 'armor');
    expect(computeStatistics(service.getCharacter(id), library).ac).toBe(18);
  });

  it('adds a shield bonus on top of the unarmored AC', async () => {
    const library = await libraryWithHomebrew(collection);
    const { service, id, record } = fighterWith(library, idOf(collection, shield), 'secondary');
    expect(record.isEquipped).toBe(true);
    // 10 + dexterity 2 + shield 3
    expect(computeStatistics(service.getCharacter(id), library).ac).toBe(15);
  });
});

describe('homebrew weapon', () => {
  const sword = weaponElement({ name: 'Moon Blade', category: 'ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE', slot: 'onehand' });
  const collection = collectionWith(sword);

  it('adds the proficiency bonus when the character is proficient with its category', async () => {
    const library = await libraryWithHomebrew(collection);
    const { service, id } = fighterWith(library, idOf(collection, sword), 'primary');
    const attack = service.getAttacks(id).find((row) => row.name === 'Moon Blade');
    // strength 15 (+2) plus proficiency (+2) for a level 3 fighter
    expect(attack.bonus).toMatch(/^\+4/);
  });
});

describe('homebrew weapon details', () => {
  it('writes the versatile die and the property that goes with it', async () => {
    const blade = weaponElement({ name: 'Moon Edge', category: 'ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE', versatile: '1d10' });
    const collection = collectionWith(blade);
    const library = await libraryWithHomebrew(collection);
    const element = library.byId.get(idOf(collection, blade));
    expect(element.setters.find((setter) => setter.name === 'versatile')?.value).toBe('1d10');
    expect(element.supports).toContain('ID_INTERNAL_WEAPON_PROPERTY_VERSATILE');
  });

  it('uses the real two-handed property id', async () => {
    const maul = weaponElement({ name: 'Moon Maul', category: 'ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE', slot: 'twohand' });
    maul.supports.push('ID_INTERNAL_WEAPON_PROPERTY_TWO_HANDED'); // as an older draft stored it
    const collection = collectionWith(maul);
    const library = await libraryWithHomebrew(collection);
    expect(library.byId.get(idOf(collection, maul)).supports).toContain('ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED');
  });
});

describe('every id the editor can write exists in the shipped content', () => {
  it('covers the pickers, the derived setters and the stored legacy ids', async () => {
    const everything = collectionWith(
      armorElement({ name: 'A Light', group: 'ID_INTERNAL_ARMOR_CATEGORY_LIGHT', armorClass: 11 }),
      armorElement({ name: 'A Medium', group: 'ID_INTERNAL_ARMOR_GROUP_MEDIUM', armorClass: 13 }),
      armorElement({ name: 'A Heavy', group: 'ID_INTERNAL_ARMOR_GROUP_HEAVY', armorClass: 16 }),
      armorElement({ name: 'A Shield', group: 'ID_INTERNAL_ARMOR_GROUP_SHIELD', armorClass: 2 }),
      ...WEAPON_CATEGORIES.map(([category], index) => {
        const weapon = weaponElement({ name: `W${index}`, category, versatile: '1d10' });
        weapon.supports.push(...WEAPON_PROPERTIES.map(([property]) => property));
        return weapon;
      }),
    );
    for (const element of everything.elements) {
      if (element.type === 'Armor') { element.setters.strength = '13'; element.setters.stealth = 'true'; }
    }
    const feat = createElement('Feat');
    feat.name = 'F';
    feat.supports = FEAT_CATEGORIES.map(([tag]) => tag);
    const magicWeapon = createElement('Magic Item');
    magicWeapon.name = 'MW';
    magicWeapon.setters.baseKind = 'weapon';
    const magicArmor = createElement('Magic Item');
    magicArmor.name = 'MA';
    magicArmor.setters.baseKind = 'armor';
    everything.elements.push(feat, magicWeapon, magicArmor);

    const own = new Set();
    for (const match of buildCollectionXml(everything).matchAll(/\bid="(ID_[A-Z0-9_]+)"/g)) own.add(match[1]);
    const written = new Set();
    for (const match of buildCollectionXml(everything).matchAll(/\bID_[A-Z0-9_]+/g)) written.add(match[0]);
    for (const [id] of [...ARMOR_GROUPS, ...WEAPON_CATEGORIES, ...WEAPON_PROPERTIES]) written.add(id);

    expect(written.size).toBeGreaterThan(25);
    const missing = [...written].filter((id) => !own.has(id) && !ids.has(id));
    expect(missing).toEqual([]);
  });

  it('offers exactly the feat categories the bundled feat pickers use', async () => {
    const { baselineFiles } = await import('./homebrewHarness.js');
    const tags = new Set();
    for (const [path, text] of await baselineFiles()) {
      if (!/feats/.test(path)) continue;
      for (const match of text.matchAll(/<supports>([^<]*)<\/supports>/g)) {
        for (const tag of match[1].split(',')) tags.add(tag.trim());
      }
    }
    for (const [tag] of FEAT_CATEGORIES) expect(tags.has(tag), tag).toBe(true);
  });
});

describe('homebrew feats', () => {
  function featElement(name, patch) {
    const feat = createElement('Feat');
    feat.name = name;
    Object.assign(feat, patch);
    return feat;
  }

  async function fightingStyleOptions(collection, strength) {
    const library = await libraryWithHomebrew(collection);
    const { service, id } = buildCharacter(library, {
      id: 'Hb', raceId: 'ID_WOTC_PHB24_RACE_DWARF', subRaceId: '', classId: 'ID_WOTC_PHB24_CLASS_FIGHTER',
      abilities: { strength, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
    });
    const state = service.getCharacter(id);
    const rule = pendingSelectionRules(state).find((candidate) => candidate.name === 'Fighting Style (Fighter 1)');
    return selectionOptions(state, library, rule).map((option) => option.name);
  }

  it('are offered by the picker for the category they are tagged with, and only that picker', async () => {
    const tagged = featElement('Moon Stance', { supports: ['Fighting Style'] });
    const untagged = featElement('Moon Whim', { supports: [] });
    const offered = await fightingStyleOptions(collectionWith(tagged, untagged), 15);
    expect(offered).toContain('Moon Stance');
    expect(offered).not.toContain('Moon Whim');
  });

  it('are gated by the requirements the builder writes, not just described by them', async () => {
    const gated = featElement('Moon Strike', {
      supports: ['Fighting Style'],
      requirementRows: [{ kind: 'ability', ability: 'str', min: '15' }],
    });
    const collection = collectionWith(gated);
    expect(await fightingStyleOptions(collection, 16)).toContain('Moon Strike');
    expect(await fightingStyleOptions(collection, 10)).not.toContain('Moon Strike');
  });

  it('write a readable display line next to the expression when none is typed', async () => {
    const gated = featElement('Moon Strike', { requirementRows: [{ kind: 'ability', ability: 'str', min: '15' }] });
    const xml = buildCollectionXml(collectionWith(gated));
    expect(xml).toContain('<prerequisite>Strength 15 or higher</prerequisite>');
    expect(xml).toContain('<requirements>[str:15]</requirements>');
  });

  it('reject a requirements expression the engine cannot read', () => {
    const broken = featElement('Moon Strike', { requirements: '[str:15' });
    const errors = validateDraft({ ...collectionWith(broken), name: 'Moon Forge', slug: 'moon-forge' });
    expect(errors.some((error) => /Requirements are not a valid expression/.test(error.message))).toBe(true);
  });
});

describe('homebrew stat bonuses', () => {
  it('accept the +N form authors write and the engine reads', () => {
    const feat = createElement('Feat');
    feat.name = 'Bonus';
    feat.stats = [{ name: 'ac:misc', value: '+2' }];
    expect(validateDraft({ ...collectionWith(feat), name: 'Moon Forge', slug: 'moon-forge' })).toEqual([]);
  });
});

describe('homebrew magic items on a base', () => {
  function magicItem(patch) {
    const item = createElement('Magic Item');
    item.name = 'Moon Edge';
    item.setters = { ...item.setters, ...patch };
    return item;
  }

  it('lay over a base weapon and equip to a hand', async () => {
    const edge = magicItem({ baseKind: 'weapon', baseScope: 'ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE' });
    const collection = collectionWith(edge);
    const library = await libraryWithHomebrew(collection);
    const { service, id } = buildFighter3(library, 'Hb');
    const itemId = idOf(collection, edge);

    const options = service.getItemBaseOptions(id, itemId);
    expect(options.slot).toBe('weapon');
    expect(options.options.map((option) => option.name)).toContain('Longsword');
    expect(options.options.map((option) => option.name)).not.toContain('Dagger');

    service.addItem(id, { itemId, amount: 1, baseElementId: 'ID_WOTC_PHB_WEAPON_LONGSWORD' });
    const record = service.getInventory(id).items.find((item) => item.itemId === 'ID_WOTC_PHB_WEAPON_LONGSWORD');
    expect(record.isEquipped).toBe(true);
    expect(record.displayElementId).toBe(itemId);
  });

  it('pick their base by name when one is given', async () => {
    const edge = magicItem({ baseKind: 'armor', baseName: 'Chain Mail' });
    const collection = collectionWith(edge);
    const library = await libraryWithHomebrew(collection);
    const { service, id } = buildFighter3(library, 'Hb');
    expect(service.getItemBaseOptions(id, idOf(collection, edge)).options.map((option) => option.name)).toEqual(expect.arrayContaining(['Chain Mail']));
    expect(new Set(service.getItemBaseOptions(id, idOf(collection, edge)).options.map((option) => option.name))).toEqual(new Set(['Chain Mail']));
  });

  it('read an older Weapon-typed draft as based on any weapon', async () => {
    const edge = magicItem({ type: 'Weapon' });
    const collection = collectionWith(edge);
    const library = await libraryWithHomebrew(collection);
    const { service, id } = buildFighter3(library, 'Hb');
    expect(service.getItemBaseOptions(id, idOf(collection, edge)).slot).toBe('weapon');
  });

  it('never write the type addition attribute the engine does not read', () => {
    const edge = magicItem({ baseKind: 'weapon' });
    expect(buildCollectionXml(collectionWith(edge))).not.toContain('addition=');
  });
});
