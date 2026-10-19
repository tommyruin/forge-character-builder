/**
 * What a magic weapon can say about its own attack row. A Magic Item laid over
 * a base weapon may name extra damage dice, the ability its attacks use, and a
 * different damage die, range or property list; the row prints them while the
 * item conveys its benefits and falls back to the mundane base the moment it
 * does not (an attunement-requiring weapon that is not attuned).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { itemBaseOptions } from "../inventory/inventory.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";

const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
const RAPIER = "ID_WOTC_PHB_WEAPON_RAPIER";
const RIMEBLADE = "ID_TEST_MAGIC_RIMEBLADE";
const SPELLBLADE = "ID_TEST_MAGIC_SPELLBLADE";
const EMBERBRAND = "ID_TEST_MAGIC_EMBERBRAND";
const COLD_RESISTANCE = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_COLD";
const RAY_OF_FROST = "ID_PHB_SPELL_RAY_OF_FROST";

// Invented items. The fighter has Strength 15, Dexterity 14, Intelligence 12 and a +2 bonus.
const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Rimeblade" type="Magic Item" source="Weapon Setter Test" id="${RIMEBLADE}">
\t\t<description><p>Frost clings to the edge.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="Longsword">Weapon</set>
\t\t\t<set name="rarity">Rare</set>
\t\t\t<set name="attunement">true</set>
\t\t\t<set name="enhancement">1</set>
\t\t\t<set name="weapon">${LONGSWORD}</set>
\t\t\t<set name="extra damage" type="cold">1d6</set>
\t\t\t<set name="spellcasting ability">Wisdom</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Condition" id="${COLD_RESISTANCE}" />
\t\t\t<grant type="Spell" id="${RAY_OF_FROST}" />
\t\t</rules>
\t</element>
\t<element name="Spellblade" type="Magic Item" source="Weapon Setter Test" id="${SPELLBLADE}">
\t\t<description><p>A duelist's blade that answers to the mind.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="Rapier">Weapon</set>
\t\t\t<set name="rarity">Very Rare</set>
\t\t\t<set name="attunement">true</set>
\t\t\t<set name="enhancement">1</set>
\t\t\t<set name="weapon">${RAPIER}</set>
\t\t\t<set name="extra damage" type="force">1d8</set>
\t\t\t<set name="attack ability">Intelligence</set>
\t\t\t<set name="damage" type="slashing">1d10</set>
\t\t\t<set name="range">20/60</set>
\t\t\t<set name="weapon properties">ID_INTERNAL_WEAPON_PROPERTY_FINESSE, ID_INTERNAL_WEAPON_PROPERTY_LIGHT, ID_INTERNAL_WEAPON_PROPERTY_THROWN</set>
\t\t</setters>
\t\t<rules>
\t\t\t<stat name="spellcasting:attack" value="1" />
\t\t\t<stat name="spellcasting:dc" value="1" />
\t\t</rules>
\t</element>
\t<element name="Emberbrand" type="Magic Item" source="Weapon Setter Test" id="${EMBERBRAND}">
\t\t<description><p>No attunement, two kinds of fire.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="Longsword">Weapon</set>
\t\t\t<set name="rarity">Uncommon</set>
\t\t\t<set name="weapon">${LONGSWORD}</set>
\t\t\t<set name="extra damage" type="fire">1d4</set>
\t\t\t<set name="extra damage" type="radiant">1d4</set>
\t\t</setters>
\t</element>
</elements>
`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/weapon-setter-test.xml", PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

let counter = 0;
function wield(itemId: string, baseId: string, attune: boolean) {
  const built = buildFighter3(library, `WeaponSetters${counter++}`);
  const { service, id } = built;
  const record = service.addItem(id, { itemId, amount: 1, baseElementId: baseId }).items.find((item) => item.itemId === baseId)!;
  if (attune) service.attuneItem(id, record.identifier, true);
  const row = () => service.getAttacks(id).find((attack) => attack.kind === "weapon")!;
  return { ...built, record, row };
}

describe("extra damage dice", () => {
  it("prints after the weapon's own damage while the item is attuned", () => {
    const { row } = wield(RIMEBLADE, LONGSWORD, true);
    // Strength +2, proficiency +2, enhancement +1; damage is the die + 2 + 1, then the extra die.
    expect(row().bonus).toBe("+5 vs AC");
    expect(row().damage).toBe("1d8+3 slashing + 1d6 cold");
    expect(row().name).toBe("Rimeblade");
  });

  it("falls back to the mundane base while the item is not attuned", () => {
    const { row, service, id, record } = wield(RIMEBLADE, LONGSWORD, false);
    expect(row().bonus).toBe("+4 vs AC");
    expect(row().damage).toBe("1d8+2 slashing");
    service.attuneItem(id, record.identifier, true);
    expect(row().damage).toBe("1d8+3 slashing + 1d6 cold");
    service.attuneItem(id, record.identifier, false);
    expect(row().damage).toBe("1d8+2 slashing");
  });

  it("lists several extra dice in order, and applies without attunement when none is required", () => {
    const { row } = wield(EMBERBRAND, LONGSWORD, false);
    expect(row().damage).toBe("1d8+2 slashing + 1d4 fire + 1d4 radiant");
  });

  it("is written into the stored row, not only the live view", () => {
    const { service, id } = wield(RIMEBLADE, LONGSWORD, true);
    expect(service.exportCharacterXml(id)).toMatch(/damage="1d8\+3 slashing \+ 1d6 cold"/);
  });
});

describe("a weapon that names its own attack ability and shape", () => {
  it("attacks and deals damage with the named ability, with its own die, range and properties", () => {
    const { row } = wield(SPELLBLADE, RAPIER, true);
    // Intelligence 12 -> +1; proficiency +2; enhancement +1.
    expect(row().bonus).toBe("+4 vs AC");
    // The overridden die and type replace the rapier's, then the extra die.
    expect(row().damage).toBe("1d10+2 slashing + 1d8 force");
    expect(row().range).toBe("20/60");
    expect(row().description).toBe("Finesse, Light, Thrown");
    expect(row().ability).toBe("Intelligence");
    expect(row().defaultAbility).toBe("Intelligence");
  });

  it("is the mundane rapier until attuned", () => {
    const { row, service, id, record } = wield(SPELLBLADE, RAPIER, false);
    // Finesse takes the better of Strength 15 and Dexterity 14 (both +2); proficiency +2.
    expect(row().bonus).toBe("+4 vs AC");
    expect(row().damage).toBe("1d8+2 piercing");
    expect(row().range).toBe("5 ft");
    expect(row().description).toBe("Finesse");
    expect(row().defaultAbility).toBe("Strength");
    service.attuneItem(id, record.identifier, true);
    expect(row().defaultAbility).toBe("Intelligence");
  });

  it("yields to an ability the player chose on the row", () => {
    const { row, service, id } = wield(SPELLBLADE, RAPIER, true);
    service.updateAttack(id, row().id, { abilityMode: "explicit", abilityName: "Dexterity" });
    expect(row().ability).toBe("Dexterity");
    expect(row().defaultAbility).toBe("Intelligence");
    // Dexterity 14 is +2, plus the +1 enhancement.
    expect(row().damage).toBe("1d10+3 slashing + 1d8 force");
  });
});

describe("item rules that apply while attuned", () => {
  it("adds to the spell attack and save DC only while attuned, and drops with the item", () => {
    const { service, id, record } = wield(SPELLBLADE, RAPIER, false);
    const stat = (key: string) => computeStatistics(service.getCharacter(id), library)[key] ?? 0;
    const base = { attack: stat("spellcasting:attack"), dc: stat("spellcasting:dc") };

    service.attuneItem(id, record.identifier, true);
    expect(stat("spellcasting:attack")).toBe(base.attack + 1);
    expect(stat("spellcasting:dc")).toBe(base.dc + 1);

    service.equipItem(id, record.identifier, "none");
    expect(stat("spellcasting:attack")).toBe(base.attack);
    expect(stat("spellcasting:dc")).toBe(base.dc);

    // Taking the item off also ends the attunement, so putting it back on is not enough.
    service.equipItem(id, record.identifier, "primary");
    expect(stat("spellcasting:attack")).toBe(base.attack);
    service.attuneItem(id, record.identifier, true);
    expect(stat("spellcasting:attack")).toBe(base.attack + 1);
    service.attuneItem(id, record.identifier, false);
    expect(stat("spellcasting:attack")).toBe(base.attack);
  });
});

describe("a base named by element id", () => {
  it("offers exactly that element as the item's base", () => {
    const options = itemBaseOptions(library, RIMEBLADE);
    expect(options.slot).toBe("weapon");
    expect(options.options.map((option) => option.id)).toEqual([LONGSWORD]);
  });
});

const sumIds = (xml: string): string[] => {
  const region = xml.slice(xml.indexOf("<sum "), xml.indexOf("</sum>"));
  return [...region.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
};

describe("grants of a magic weapon", () => {
  it("register a resistance and a spell only while the weapon is wielded and attuned", () => {
    const { service, id, record } = wield(RIMEBLADE, LONGSWORD, false);
    const granted = () => ({
      resistance: sumIds(service.exportCharacterXml(id)).includes(COLD_RESISTANCE),
      spell: service.getSpellcasting(id).some((caster) => caster.knownSpells.some((spell) => spell.id === RAY_OF_FROST)),
    });
    // Equipped but not attuned: the mundane longsword and nothing else.
    expect(granted()).toEqual({ resistance: false, spell: false });

    service.attuneItem(id, record.identifier, true);
    expect(granted()).toEqual({ resistance: true, spell: true });
    const caster = service.getSpellcasting(id).find((entry) => entry.name === "Rimeblade")!;
    expect(caster).toMatchObject({ kind: "feature", ability: "Wisdom" });

    service.attuneItem(id, record.identifier, false);
    expect(granted()).toEqual({ resistance: false, spell: false });

    service.attuneItem(id, record.identifier, true);
    service.equipItem(id, record.identifier, "none");
    expect(granted()).toEqual({ resistance: false, spell: false });
  });

  it("add a base named by id without being told which element it sits on", () => {
    const built = buildFighter3(library, "ByIdNoBase");
    const dto = built.service.addItem(built.id, { itemId: RIMEBLADE, amount: 1, baseElementId: null });
    expect(dto.items.map((item) => item.itemId)).toEqual([LONGSWORD]);
    expect(dto.items[0]!.name).toBe("Rimeblade");
  });
});
