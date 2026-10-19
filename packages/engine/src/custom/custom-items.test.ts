/**
 * Custom items on a character, end to end: an item made through the service is
 * stored in the character file, compiled, installed in the library and added to
 * the inventory through the ordinary add path, and from then on equipping,
 * attuning, attack rows, statistics, the spell pages and the sheet treat it like
 * any book item.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { isCharacterPackElement } from "../content/character-packs.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { buildFighter3, sharedLibrary, type BuiltCharacter } from "../testing/character-factory.js";
import {
  createCustomDraft,
  createCustomItemDraft,
  newCustomBlockId,
  type CustomBlock,
  type CustomDraft,
  type CustomItemDraft,
  type SpellGrantOptions,
} from "./schema.js";

const LONGSWORD = { id: "ID_WOTC_PHB_WEAPON_LONGSWORD", name: "Longsword" };
const RAPIER = { id: "ID_WOTC_PHB_WEAPON_RAPIER", name: "Rapier" };
const SCIMITAR = "ID_WOTC_PHB_WEAPON_SCIMITAR";
const COLD_RESISTANCE = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_COLD";
const FIRE_RESISTANCE = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE";
const RAY_OF_FROST = "ID_PHB_SPELL_RAY_OF_FROST";

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map(base.fileContents ?? []));
}, 120_000);

let counter = 0;
const fighter = (): BuiltCharacter => buildFighter3(library, `CustomItems${counter++}`);

const grant = (type: string, id: string, spell?: SpellGrantOptions): CustomBlock => ({
  kind: "grant",
  id: newCustomBlockId(),
  target: { by: "id", type, id },
  ...(spell === undefined ? {} : { spell }),
});

function frostbite(extra: Partial<CustomItemDraft> = {}): CustomItemDraft {
  return {
    ...createCustomItemDraft("weapon", "Frostbite"),
    description: "Rime gathers on the edge.",
    base: LONGSWORD,
    bonus: 1,
    rarity: "Rare",
    attunement: true,
    weapon: { extraDamage: [{ dice: "1d6", type: "cold" }] },
    blocks: [grant("Condition", COLD_RESISTANCE), grant("Spell", RAY_OF_FROST, { castAbility: "wisdom" })],
    ...extra,
  };
}

const sumIds = (xml: string): string[] => {
  const region = xml.slice(xml.indexOf("<sum "), xml.indexOf("</sum>"));
  return [...region.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
};

const record = (service: CharacterService, id: string, elementId: string) =>
  service.getInventory(id).items.find((item) => item.displayElementId === elementId || item.itemId === elementId)!;

const weaponRow = (service: CharacterService, id: string) => service.getAttacks(id).find((row) => row.kind === "weapon")!;

const effects = (service: CharacterService, id: string) => ({
  resistance: sumIds(service.exportCharacterXml(id)).includes(COLD_RESISTANCE),
  spell: service.getSpellcasting(id).some((caster) => caster.knownSpells.some((spell) => spell.id === RAY_OF_FROST)),
});

describe("a magic weapon on a real base", () => {
  it("adds to the inventory as the base plus a magic layer, and its effects follow attunement and use", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, { draft: frostbite() });
    expect(saved.diagnostics).toEqual([]);
    expect(saved.entry).toMatchObject({ kind: "item", type: "Magic Item", granted: true, installed: true });

    // The ordinary add path: the longsword is the record, the item is its adorner, and it is wielded.
    const dto = service.getInventory(id).items;
    expect(dto).toHaveLength(1);
    const frost = dto[0]!;
    expect(frost).toMatchObject({
      itemId: LONGSWORD.id,
      displayElementId: saved.entry.elementId,
      name: "Frostbite",
      defaultName: "Frostbite",
      baseName: "Longsword",
      isCustom: true,
      isAttunable: true,
      isEquipped: true,
      isAttuned: false,
    });

    // Not attuned: the mundane longsword (Strength +2, proficiency +2).
    expect(weaponRow(service, id)).toMatchObject({ name: "Frostbite", bonus: "+4 vs AC", damage: "1d8+2 slashing" });
    expect(effects(service, id)).toEqual({ resistance: false, spell: false });

    // Attuned: +1, the extra cold die, a resistance and a spell.
    service.attuneItem(id, frost.identifier, true);
    expect(weaponRow(service, id)).toMatchObject({ bonus: "+5 vs AC", damage: "1d8+3 slashing + 1d6 cold" });
    expect(effects(service, id)).toEqual({ resistance: true, spell: true });
    expect(service.getSpellcasting(id).find((caster) => caster.name === "Frostbite")).toMatchObject({ kind: "feature", ability: "Wisdom" });

    // Not attuned again, or no longer wielded: all of it goes.
    service.attuneItem(id, frost.identifier, false);
    expect(effects(service, id)).toEqual({ resistance: false, spell: false });
    expect(weaponRow(service, id).damage).toBe("1d8+2 slashing");
    service.attuneItem(id, frost.identifier, true);
    service.equipItem(id, frost.identifier, "none");
    expect(effects(service, id)).toEqual({ resistance: false, spell: false });
  });

  it("marks the spell it grants as the item's", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, { draft: frostbite() });
    service.attuneItem(id, record(service, id, saved.entry.elementId).identifier, true);
    const caster = service.getSpellcasting(id).find((entry) => entry.name === "Frostbite")!;
    expect(caster.knownSpells[0]).toMatchObject({
      id: RAY_OF_FROST,
      grantedBy: { elementId: saved.entry.elementId, name: "Frostbite", isCustom: true },
    });
  });

  it("can be kept in the pack without being added to the inventory", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, { draft: frostbite(), grant: false });
    expect(saved.entry).toMatchObject({ kind: "item", granted: false, installed: true });
    expect(service.getInventory(id).items).toEqual([]);
    // Adding it later is the ordinary add, naming the base.
    const dto = service.addItem(id, { itemId: saved.entry.elementId, amount: 1, baseElementId: LONGSWORD.id });
    expect(dto.items[0]).toMatchObject({ name: "Frostbite", itemId: LONGSWORD.id });
    expect(service.getCustomContent(id).entries[0]).toMatchObject({ granted: true });
  });
});

describe("a sword on a rapier with its own shape", () => {
  const spellblade = (): CustomItemDraft => ({
    ...createCustomItemDraft("weapon", "Spellblade"),
    base: RAPIER,
    bonus: 1,
    attunement: true,
    weapon: {
      extraDamage: [{ dice: "1d8", type: "force" }],
      attackAbility: "intelligence",
      damage: { dice: "1d10", type: "slashing" },
      range: "20/60",
      properties: [
        "ID_INTERNAL_WEAPON_PROPERTY_FINESSE",
        "ID_INTERNAL_WEAPON_PROPERTY_LIGHT",
        "ID_INTERNAL_WEAPON_PROPERTY_THROWN",
      ],
    },
    blocks: [
      { kind: "modifier", id: newCustomBlockId(), target: "spellcasting:attack", mode: "add", value: { kind: "number", value: 1 } },
      { kind: "modifier", id: newCustomBlockId(), target: "spellcasting:dc", mode: "add", value: { kind: "number", value: 1 } },
    ],
  });

  it("attacks with Intelligence and raises spell attack and save DC only while attuned", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, { draft: spellblade() });
    const blade = record(service, id, saved.entry.elementId);
    const stat = (key: string) => computeStatistics(service.getCharacter(id), library)[key] ?? 0;
    const before = { attack: stat("spellcasting:attack"), dc: stat("spellcasting:dc") };

    // Unattuned it is a rapier: Strength 15 / Dexterity 14 both +2, proficiency +2.
    expect(weaponRow(service, id)).toMatchObject({ bonus: "+4 vs AC", damage: "1d8+2 piercing", range: "5 ft", description: "Finesse" });
    expect(stat("spellcasting:attack")).toBe(before.attack);

    service.attuneItem(id, blade.identifier, true);
    // Intelligence 12 is +1; proficiency +2; enhancement +1.
    expect(weaponRow(service, id)).toMatchObject({
      name: "Spellblade",
      bonus: "+4 vs AC",
      damage: "1d10+2 slashing + 1d8 force",
      range: "20/60",
      description: "Finesse, Light, Thrown",
      ability: "Intelligence",
    });
    expect(stat("spellcasting:attack")).toBe(before.attack + 1);
    expect(stat("spellcasting:dc")).toBe(before.dc + 1);

    service.equipItem(id, blade.identifier, "none");
    expect(stat("spellcasting:attack")).toBe(before.attack);
    expect(stat("spellcasting:dc")).toBe(before.dc);
  });
});

describe("a worn item", () => {
  function boonDraft(): CustomDraft {
    return {
      ...createCustomDraft("boon", "Hearth Warmth"),
      description: "A warmth that never fades.",
      blocks: [{ kind: "modifier", id: newCustomBlockId(), target: "strength", mode: "add", value: { kind: "number", value: 1 } }],
    };
  }

  it("grants a custom feature while worn, and an item that needs no attunement applies when worn", () => {
    const { service, id } = fighter();
    const boon = service.saveCustomDraft(id, { draft: boonDraft(), grant: false });
    expect(boon.entry.granted).toBe(false);
    const pendant: CustomItemDraft = {
      ...createCustomItemDraft("worn", "Hearth Pendant"),
      slot: "neck",
      rarity: "Uncommon",
      blocks: [grant("Custom Feature", boon.entry.elementId)],
    };
    const saved = service.saveCustomDraft(id, { draft: pendant });
    const strength = () => computeStatistics(service.getCharacter(id), library)["strength:score"]!;
    const base = strength();
    const worn = record(service, id, saved.entry.elementId);
    expect(worn).toMatchObject({ type: "Magic Item", isEquippable: true, isEquipped: false, isAttunable: false });

    // Carried is not worn: nothing yet.
    expect(strength()).toBe(base);
    expect(sumIds(service.exportCharacterXml(id))).not.toContain(boon.entry.elementId);

    service.equipItem(id, worn.identifier, "worn");
    expect(strength()).toBe(base + 1);
    expect(sumIds(service.exportCharacterXml(id))).toContain(boon.entry.elementId);

    service.equipItem(id, worn.identifier, "none");
    expect(strength()).toBe(base);
    expect(sumIds(service.exportCharacterXml(id))).not.toContain(boon.entry.elementId);
  });

  it("applies modifiers and resistances only once an attunement-requiring item is attuned", () => {
    const { service, id } = fighter();
    const ring: CustomItemDraft = {
      ...createCustomItemDraft("worn", "Ring of Cold Wards"),
      slot: "ring",
      attunement: true,
      blocks: [
        { kind: "modifier", id: newCustomBlockId(), target: "ac:misc", mode: "add", value: { kind: "number", value: 1 } },
        grant("Condition", FIRE_RESISTANCE),
      ],
    };
    const saved = service.saveCustomDraft(id, { draft: ring });
    const worn = record(service, id, saved.entry.elementId);
    const armorClass = () => computeStatistics(service.getCharacter(id), library)["ac"]!;
    const before = armorClass();
    service.equipItem(id, worn.identifier, "worn");
    expect(armorClass()).toBe(before);
    service.attuneItem(id, worn.identifier, true);
    expect(armorClass()).toBe(before + 1);
    expect(sumIds(service.exportCharacterXml(id))).toContain(FIRE_RESISTANCE);
  });
});

describe("plain gear", () => {
  it("takes one line: a name, a quantity, a weight and notes, and no rules", () => {
    const { service, id } = fighter();
    const before = service.exportCharacterXml(id);
    const whistle: CustomItemDraft = {
      ...createCustomItemDraft("gear", "Signal Whistle"),
      weight: 0.25,
      cost: { amount: 5, currency: "sp" },
      stackable: true,
    };
    const saved = service.saveCustomDraft(id, { draft: whistle, amount: 3, notes: "Carved from bone." });
    expect(saved.entry).toMatchObject({ kind: "item", type: "Item" });

    const dto = service.getInventory(id);
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({
      name: "Signal Whistle",
      amount: 3,
      notes: "Carved from bone.",
      isCustom: true,
      isEquippable: false,
      isPhysicalEquipment: true,
      category: "Adventuring Gear",
    });
    expect(dto.equipmentWeight).toBe(0.75);
    // No rules means no registrations: the sum is what it was.
    expect(sumIds(service.exportCharacterXml(id))).toEqual(sumIds(before));

    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", canonical: false });
    const values: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "Equipment" && typeof value === "string") values.push(value);
        else walk(value);
      }
    };
    walk(model);
    expect(values.join("\n")).toContain("Signal Whistle x3");
  });

  it("keeps a stack's count when the quantity changes", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, {
      draft: { ...createCustomItemDraft("gear", "Chalk"), stackable: true, weight: 0.1 },
      amount: 2,
    });
    const chalk = record(service, id, saved.entry.elementId);
    expect(service.setItemAmount(id, chalk.identifier, 10).items[0]).toMatchObject({ amount: 10 });
  });
});

describe("editing and removing a custom item", () => {
  it("applies an edit to the item already carried: numbers, name and granted effects", () => {
    const { service, id } = fighter();
    const draft = frostbite();
    const saved = service.saveCustomDraft(id, { draft });
    const frost = record(service, id, saved.entry.elementId);
    service.attuneItem(id, frost.identifier, true);
    expect(effects(service, id)).toEqual({ resistance: true, spell: true });

    const edited: CustomItemDraft = {
      ...draft,
      name: "Emberbite",
      bonus: 2,
      weapon: { extraDamage: [{ dice: "2d4", type: "fire" }] },
      blocks: [grant("Condition", FIRE_RESISTANCE)],
    };
    const result = service.saveCustomDraft(id, { draft: edited });
    expect(result.entry).toMatchObject({ kind: "item", granted: true });

    // Still one record, still wielded and attuned, now the edited item.
    const items = service.getInventory(id).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Emberbite", isEquipped: true, isAttuned: true });
    expect(weaponRow(service, id)).toMatchObject({ name: "Emberbite", bonus: "+6 vs AC", damage: "1d8+4 slashing + 2d4 fire" });
    // The old effects are gone and the new one is in; the file names the item as it is now.
    const xml = service.exportCharacterXml(id);
    expect(sumIds(xml)).not.toContain(COLD_RESISTANCE);
    expect(sumIds(xml)).toContain(FIRE_RESISTANCE);
    expect(service.getSpellcasting(id).some((caster) => caster.name === "Frostbite" || caster.name === "Emberbite")).toBe(false);
    expect(xml).toContain('name="Emberbite"');
    expect(xml).not.toContain('name="Frostbite"');
  });

  it("keeps a name the player gave this record when the item is edited", () => {
    const { service, id } = fighter();
    const draft = frostbite();
    const saved = service.saveCustomDraft(id, { draft });
    const frost = record(service, id, saved.entry.elementId);
    service.setItemDetails(id, frost.identifier, { name: "Grandfather's Edge" });
    service.saveCustomDraft(id, { draft: { ...draft, name: "Emberbite" } });
    expect(service.getInventory(id).items[0]).toMatchObject({ name: "Grandfather's Edge", defaultName: "Emberbite" });
    expect(weaponRow(service, id).name).toBe("Grandfather's Edge");
  });

  it("refuses to move a carried item onto another base", () => {
    const { service, id } = fighter();
    const draft = frostbite();
    service.saveCustomDraft(id, { draft });
    expect(() => service.saveCustomDraft(id, { draft: { ...draft, base: RAPIER } })).toThrow(/base/i);
    // The refusal changed nothing.
    expect(service.getCustomContent(id).entries[0]!.draft).toEqual(draft);
  });

  it("removes every record, its effects and its stored copy", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    const saved = service.saveCustomDraft(id, { draft: frostbite() });
    const frost = record(service, id, saved.entry.elementId);
    service.attuneItem(id, frost.identifier, true);

    service.deleteCustomDraft(id, { draftId: saved.entry.elementId });
    expect(service.getInventory(id).items).toEqual([]);
    expect(service.getAttacks(id).some((row) => row.kind === "weapon")).toBe(false);
    expect(effects(service, id)).toEqual({ resistance: false, spell: false });
    expect(service.getCustomContent(id).entries).toEqual([]);
    expect(isCharacterPackElement(library, saved.entry.elementId)).toBe(false);
    expect(service.exportCharacterXml(id)).toBe(original);
  });
});

describe("a custom item travels with the character", () => {
  it("survives export and import with its pack, its record and its effects", () => {
    const { service, id } = fighter();
    const draft = frostbite();
    const saved = service.saveCustomDraft(id, { draft });
    service.attuneItem(id, record(service, id, saved.entry.elementId).identifier, true);
    service.setItemDetails(id, record(service, id, saved.entry.elementId).identifier, { notes: "Found in the barrow." });
    const exported = service.exportCharacterXml(id);

    const other = new CharacterService(undefined, library);
    other.importCharacterXml("Elsewhere", exported);
    expect(other.getCustomContent("Elsewhere").entries.map((entry) => entry.draft)).toEqual([draft]);
    expect(other.getInventory("Elsewhere").items[0]).toMatchObject({ name: "Frostbite", notes: "Found in the barrow.", isAttuned: true });
    expect(weaponRow(other, "Elsewhere")).toMatchObject({ bonus: "+5 vs AC", damage: "1d8+3 slashing + 1d6 cold" });
    expect(effects(other, "Elsewhere")).toEqual({ resistance: true, spell: true });
    expect(other.exportCharacterXml("Elsewhere")).toBe(exported);
  });

  it("promotes to a homebrew pack with the same id", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, { draft: frostbite() });
    const promoted = service.promoteCustomDraft(id, { draftId: saved.entry.elementId, source: "Moonwell Campaign" });
    expect(promoted.id).toBe(saved.entry.elementId);
    expect(promoted.xml).toContain('source="Moonwell Campaign"');
    expect(promoted.xml).toContain(`id="${saved.entry.elementId}"`);
    expect(promoted.xml).toContain('type="Magic Item"');
    expect(promoted.element).toMatchObject({ id: saved.entry.elementId, idLocked: true, type: "Magic Item", name: "Frostbite" });
  });
});

describe("what an item draft may not do", () => {
  it("refuses a draft the compiler would refuse, naming the field", () => {
    const { service, id } = fighter();
    expect(() => service.saveCustomDraft(id, { draft: { ...frostbite(), bonus: 99 } })).toThrow(/bonus/);
    expect(service.getCustomContent(id).entries).toEqual([]);
    expect(service.getInventory(id).items).toEqual([]);
  });

  it("is a different template from the item already stored under its id", () => {
    const { service, id } = fighter();
    const draft = frostbite();
    service.saveCustomDraft(id, { draft });
    const asGear: CustomItemDraft = { ...createCustomItemDraft("gear", "Frostbite"), id: draft.id };
    expect(() => service.saveCustomDraft(id, { draft: asGear })).toThrow(/template|weapon/i);
  });

  it("leaves scimitars alone: renaming a book item needs no custom draft", () => {
    const { service, id } = fighter();
    const dto = service.addItem(id, { itemId: SCIMITAR, amount: 1, baseElementId: null });
    expect(dto.items[0]!.isCustom).toBe(false);
  });
});

describe("previewing an item before it is saved", () => {
  it("shows the attack row the item would give, attuned, without touching the character", () => {
    const { service, id } = fighter();
    const before = service.exportCharacterXml(id);
    const preview = service.previewCustomItem(id, { draft: frostbite() });
    expect(preview.attack).toEqual({
      name: "Frostbite",
      range: "5 ft",
      bonus: "+5 vs AC",
      damage: "1d8+3 slashing + 1d6 cold",
      description: "Versatile",
    });
    expect(service.exportCharacterXml(id)).toBe(before);
    expect(service.getCustomContent(id).entries).toEqual([]);
    expect(service.getInventory(id).items).toEqual([]);
  });

  it("previews an edit against the stored item and leaves the stored definition alone", () => {
    const { service, id } = fighter();
    const draft = frostbite();
    service.saveCustomDraft(id, { draft });
    const stored = service.exportCharacterXml(id);
    const preview = service.previewCustomItem(id, { draft: { ...draft, bonus: 3 } });
    expect(preview.attack?.bonus).toBe("+7 vs AC");
    expect(preview.attack?.damage).toBe("1d8+5 slashing + 1d6 cold");
    expect(service.exportCharacterXml(id)).toBe(stored);
    // The real item still has the stored numbers.
    service.attuneItem(id, service.getInventory(id).items[0]!.identifier, true);
    expect(weaponRow(service, id).bonus).toBe("+5 vs AC");
  });

  it("has no attack row to show for anything but a weapon, and refuses a bad draft", () => {
    const { service, id } = fighter();
    expect(service.previewCustomItem(id, { draft: createCustomItemDraft("gear", "Whistle") }).attack).toBeNull();
    expect(() => service.previewCustomItem(id, { draft: { ...frostbite(), bonus: 99 } })).toThrow(/bonus/);
  });
});
