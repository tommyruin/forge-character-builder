/**
 * Item-owned registrations: an inventory item whose benefits are active
 * registers its OWN content element (the adorner of an adorned record, or a
 * worn slotless item) as a top-level subtree, the way a saved .dnd5e file
 * carries one. That is what puts an item's resistances, senses, languages,
 * proficiencies, spells and choices on the sheet, the Magic tab and the Build
 * tab; when the item stops conveying benefits the registration goes away
 * again. The physical base (Weapon/Armor) keeps its existing registration.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { featureSpellCasters } from "../magic/feature-casters.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { seededRng } from "../testing/character-factory.js";
import type { InventoryDto, InventoryItemDto } from "./inventory.js";

const SCALE_MAIL = "ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL";
const CHAIN_SHIRT = "ID_WOTC_ARMOR_MEDIUM_CHAIN_SHIRT";
const DRAGON_SCALE_MAIL_BLACK = "ID_WOTC_DMG_MAGIC_ITEM_DRAGON_SCALE_MAIL_BLACK";
const ELVEN_CHAIN = "ID_WOTC_DMG_MAGIC_ITEM_ELVEN_CHAIN";
const GOGGLES_OF_NIGHT = "ID_WOTC_DMG_MAGIC_ITEM_GOGGLES_OF_NIGHT";
const RING_OF_RESISTANCE_FIRE = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_RESISTANCE_FIRE";
const RING_OF_WARMTH = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_WARMTH";
const BELT_OF_DWARVENKIND = "ID_WOTC_DMG_MAGIC_ITEM_BELT_OF_DWARVENKIND";
const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";

const GRANTS_STEALTH = "ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE";
const CONDITION_ACID = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_ACID";
const CONDITION_FIRE = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE";
const CONDITION_COLD = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_COLD";
const CONDITION_POISON = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_POISON";
const PROFICIENCY_CHAIN_SHIRT = "ID_PROFICIENCY_ARMOR_PROFICIENCY_CHAIN_SHIRT";
const VISION_LESSER_DARKVISION = "ID_VISION_LESSER_DARKVISION";
const VISION_DARKVISION = "ID_VISION_DARKVISION";
const LANGUAGE_DWARVISH = "ID_LANGUAGE_DWARVISH";
const RACE_DWARF = "ID_SRD_RACE_DWARF";

const HOMEBREW_ITEM = "ID_TEST_MAGIC_ITEM_WHISPERING_FLAME";
const HOMEBREW_FEAT = "ID_TEST_FEAT_WHISPERING_FLAME";
const HOMEBREW_ABILITY = "ID_TEST_TRAIT_WHISPERING_FLAME_CHARISMA";
const BURNING_HANDS = "ID_PHB_SPELL_BURNING_HANDS";

/**
 * A magic dagger whose benefits chain down to a feat that nominates an
 * ability, grants a spell outright and offers a spell choice — the shape a
 * feature caster and a pending selection are read from.
 */
const HOMEBREW_PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Whispering Flame" type="Magic Item" source="Item Grants Test" id="${HOMEBREW_ITEM}">
\t\t<description><p>A test dagger.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="dagger">Weapon</set>
\t\t\t<set name="attunement">true</set>
\t\t\t<set name="rarity">Rare</set>
\t\t\t<set name="weapon">Dagger</set>
\t\t\t<set name="name-format">{{parent}} of Whispering Flame</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Feat" id="${HOMEBREW_FEAT}" />
\t\t</rules>
\t</element>
\t<element name="Whispering Flame" type="Feat" source="Item Grants Test" id="${HOMEBREW_FEAT}">
\t\t<description><p>A test feat.</p></description>
\t\t<rules>
\t\t\t<grant type="Racial Trait" id="${HOMEBREW_ABILITY}" />
\t\t\t<grant type="Spell" id="${BURNING_HANDS}" />
\t\t\t<select type="Spell" name="Whispering Flame Cantrip" />
\t\t</rules>
\t</element>
\t<element name="Charisma" type="Racial Trait" source="Item Grants Test" id="${HOMEBREW_ABILITY}">
\t\t<description><p>Charisma is the spellcasting ability.</p></description>
\t</element>
</elements>
`;

let corpusPromise: Promise<ElementLibrary> | null = null;
const corpusLibrary = (): Promise<ElementLibrary> => {
  corpusPromise ??= buildCorpusLibrary();
  return corpusPromise;
};

let homebrewPromise: Promise<ElementLibrary> | null = null;
const homebrewLibrary = async (): Promise<ElementLibrary> => {
  homebrewPromise ??= (async () => {
    const base = await corpusLibrary();
    const files = new Map(base.fileContents);
    files.set("imports/item-grants-test.xml", HOMEBREW_PACK);
    const library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
    replaceLibraryFiles(library, files);
    return library;
  })();
  return homebrewPromise;
};

// ---------------------------------------------------------------------------
// Document readers
// ---------------------------------------------------------------------------

const region = (xml: string, open: string, close: string): string =>
  xml.slice(xml.indexOf(open), xml.indexOf(close) + close.length);

const elementsRegion = (xml: string): string => region(xml, "<elements ", "</elements>");
const sumRegion = (xml: string): string => region(xml, "<sum ", "</sum>");

const sumIds = (xml: string): string[] =>
  [...sumRegion(xml).matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);

const registeredCount = (xml: string): number => Number(/registered-count="(\d+)"/.exec(xml)![1]);

/** The top-level `<elements>` child nodes, as `type|id` keys. */
const topLevelNodes = (xml: string): string[] =>
  [...elementsRegion(xml).matchAll(/\n\t\t\t<element type="([^"]+)"[^>]*? id="([^"]+)"/g)].map(
    (match) => `${match[1]}|${match[2]}`,
  );

/** The subtree text of the top-level node with `id`, or null when absent. */
function nodeSubtree(xml: string, id: string): string | null {
  const elements = elementsRegion(xml);
  const open = new RegExp(`\\n\\t\\t\\t<element type="[^"]+" name="[^"]*" id="${id}"`).exec(elements);
  if (open === null) return null;
  const rest = elements.slice(open.index + 1);
  const end = rest.indexOf("\r\n\t\t\t<element ");
  const closing = rest.indexOf("\r\n\t\t</elements>");
  const stop = end === -1 ? (closing === -1 ? rest.length : closing) : Math.min(end, closing === -1 ? end : closing);
  return rest.slice(0, stop);
}

const childIds = (subtree: string): string[] =>
  [...subtree.matchAll(/\n\t\t\t\t<element [^>]*?id="([^"]+)"/g)].map((match) => match[1]!);

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

const byItemId = (dto: InventoryDto, itemId: string): InventoryItemDto =>
  dto.items.find((item) => item.itemId === itemId)!;

function conditionTokens(service: CharacterService, id: string, library: ElementLibrary): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const tokens: string[] = [];
  for (const page of model.pages) {
    for (const section of page.sections) {
      if (section.title !== "conditions" && section.title !== "vision") continue;
      for (const row of section.rows) {
        if (row.kind === "tokens") tokens.push(...row.tokens);
      }
    }
  }
  return tokens;
}

describe.each(["2014", "2024"])("item registrations (%s rules)", (mode) => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await corpusLibrary();
  }, 120_000);

  /** A fresh, classless character in the ruleset under test. */
  function character(name: string): { service: CharacterService; id: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter(`${name} ${mode}`).id;
    service.setRulesetMode(id, mode);
    return { service, id };
  }

  it("registers an adorner's grants only once the record is attuned", () => {
    const { service, id } = character("Dragon Scale");
    const dto = service.addItem(id, { itemId: DRAGON_SCALE_MAIL_BLACK, amount: 1, baseElementId: SCALE_MAIL });
    const record = byItemId(dto, SCALE_MAIL);
    expect(record.isEquipped).toBe(true);

    service.equipItem(id, record.identifier, "none");
    const carriedCount = registeredCount(service.exportCharacterXml(id));

    service.equipItem(id, record.identifier, "armor");
    const equippedXml = service.exportCharacterXml(id);
    expect(nodeSubtree(equippedXml, DRAGON_SCALE_MAIL_BLACK)).toBeNull();
    expect(sumIds(equippedXml)).not.toContain(CONDITION_ACID);
    expect(conditionTokens(service, id, library).join(" ")).not.toContain("Acid");
    // An adorned record is two registrations from the moment its base
    // registers, whether or not the adorner is yet conveying anything.
    const equippedCount = registeredCount(equippedXml);
    expect(equippedCount).toBe(carriedCount + 2);

    service.attuneItem(id, record.identifier, true);
    const attunedXml = service.exportCharacterXml(id);
    const subtree = nodeSubtree(attunedXml, DRAGON_SCALE_MAIL_BLACK);
    expect(subtree).not.toBeNull();
    expect(childIds(subtree!)).toEqual([CONDITION_ACID]);
    expect(sumIds(attunedXml).slice(-4)).toEqual([
      SCALE_MAIL,
      GRANTS_STEALTH,
      DRAGON_SCALE_MAIL_BLACK,
      CONDITION_ACID,
    ]);
    expect(registeredCount(attunedXml)).toBe(equippedCount);
    expect(conditionTokens(service, id, library).join(" ")).toContain("Acid");

    service.attuneItem(id, record.identifier, false);
    const unattunedXml = service.exportCharacterXml(id);
    expect(elementsRegion(unattunedXml)).toBe(elementsRegion(equippedXml));
    expect(sumRegion(unattunedXml)).toBe(sumRegion(equippedXml));
  });

  it("registers an adorner that needs no attunement while the base is equipped", () => {
    const { service, id } = character("Elven Chain");
    const dto = service.addItem(id, { itemId: ELVEN_CHAIN, amount: 1, baseElementId: CHAIN_SHIRT });
    const record = byItemId(dto, CHAIN_SHIRT);
    expect(record.isEquipped).toBe(true);

    const equippedXml = service.exportCharacterXml(id);
    expect(childIds(nodeSubtree(equippedXml, ELVEN_CHAIN)!)).toEqual([PROFICIENCY_CHAIN_SHIRT]);
    expect(sumIds(equippedXml)).toContain(PROFICIENCY_CHAIN_SHIRT);

    service.equipItem(id, record.identifier, "none");
    const unequippedXml = service.exportCharacterXml(id);
    expect(nodeSubtree(unequippedXml, ELVEN_CHAIN)).toBeNull();
    expect(sumIds(unequippedXml)).not.toContain(PROFICIENCY_CHAIN_SHIRT);
    expect(sumIds(unequippedXml)).not.toContain(ELVEN_CHAIN);
  });

  it("drops an adorner registration when another body armor evicts the record", () => {
    const { service, id } = character("Elven Chain Evicted");
    service.addItem(id, { itemId: ELVEN_CHAIN, amount: 1, baseElementId: CHAIN_SHIRT });
    const scale = service.addItem(id, { itemId: SCALE_MAIL, amount: 1, baseElementId: null });
    service.equipItem(id, byItemId(scale, SCALE_MAIL).identifier, "armor");

    const xml = service.exportCharacterXml(id);
    expect(nodeSubtree(xml, ELVEN_CHAIN)).toBeNull();
    expect(sumIds(xml)).not.toContain(PROFICIENCY_CHAIN_SHIRT);
  });

  it("registers a slotless item only once it is worn, not while carried", () => {
    const { service, id } = character("Goggles");
    let dto = service.addItem(id, { itemId: GOGGLES_OF_NIGHT, amount: 1, baseElementId: null });
    const goggles = byItemId(dto, GOGGLES_OF_NIGHT);
    expect(goggles.equipLocations).toEqual(["worn"]);
    expect(goggles.isEquippable).toBe(true);
    expect(goggles.isEquipped).toBe(false);

    const carriedXml = service.exportCharacterXml(id);
    expect(sumIds(carriedXml)).not.toContain(GOGGLES_OF_NIGHT);
    expect(computeStatistics(service.getCharacter(id), library)["darkvision:range"] ?? 0).toBe(0);
    const carriedCount = registeredCount(carriedXml);

    dto = service.equipItem(id, goggles.identifier, "worn");
    expect(byItemId(dto, GOGGLES_OF_NIGHT).isEquipped).toBe(true);
    expect(byItemId(dto, GOGGLES_OF_NIGHT).equippedLocation).toBeNull();

    const wornXml = service.exportCharacterXml(id);
    expect(wornXml).toContain("<equipped>true</equipped>");
    expect(childIds(nodeSubtree(wornXml, GOGGLES_OF_NIGHT)!)).toEqual([VISION_LESSER_DARKVISION]);
    expect(registeredCount(wornXml)).toBe(carriedCount + 1);
    // The gate under test is that the sense arrives at all; the range itself
    // is the sum of the granted Vision element's base and the item's own rule.
    expect(computeStatistics(service.getCharacter(id), library)["darkvision:range"]).toBeGreaterThanOrEqual(60);
    expect(conditionTokens(service, id, library)).toContain("Darkvision");

    service.setItemStorage(id, goggles.identifier, "#1");
    expect(sumIds(service.exportCharacterXml(id))).not.toContain(GOGGLES_OF_NIGHT);

    service.setItemStorage(id, goggles.identifier, null);
    expect(sumIds(service.exportCharacterXml(id))).not.toContain(GOGGLES_OF_NIGHT);

    service.equipItem(id, goggles.identifier, "worn");
    expect(sumIds(service.exportCharacterXml(id))).toContain(GOGGLES_OF_NIGHT);
    service.equipItem(id, goggles.identifier, "none");
    const removedXml = service.exportCharacterXml(id);
    expect(sumIds(removedXml)).not.toContain(GOGGLES_OF_NIGHT);
    expect(registeredCount(removedXml)).toBe(carriedCount);

    service.equipItem(id, goggles.identifier, "worn");
    service.removeItem(id, goggles.identifier);
    const goneXml = service.exportCharacterXml(id);
    expect(sumIds(goneXml)).not.toContain(GOGGLES_OF_NIGHT);
    expect(nodeSubtree(goneXml, GOGGLES_OF_NIGHT)).toBeNull();
    expect(registeredCount(goneXml)).toBe(carriedCount);
  });

  it("activates a slotless attunement item on attunement alone", () => {
    const { service, id } = character("Ring of Fire");
    const dto = service.addItem(id, { itemId: RING_OF_RESISTANCE_FIRE, amount: 1, baseElementId: null });
    const ring = byItemId(dto, RING_OF_RESISTANCE_FIRE);

    service.attuneItem(id, ring.identifier, true);
    const attunedXml = service.exportCharacterXml(id);
    expect(childIds(nodeSubtree(attunedXml, RING_OF_RESISTANCE_FIRE)!)).toEqual([CONDITION_FIRE]);
    expect(sumIds(attunedXml)).toContain(CONDITION_FIRE);
    expect(conditionTokens(service, id, library).join(" ")).toContain("Fire");

    service.setItemStorage(id, ring.identifier, "#1");
    const stowedXml = service.exportCharacterXml(id);
    expect(nodeSubtree(stowedXml, RING_OF_RESISTANCE_FIRE)).toBeNull();
    expect(sumIds(stowedXml)).not.toContain(CONDITION_FIRE);

    service.setItemStorage(id, ring.identifier, null);
    service.attuneItem(id, ring.identifier, false);
    const unattunedXml = service.exportCharacterXml(id);
    expect(nodeSubtree(unattunedXml, RING_OF_RESISTANCE_FIRE)).toBeNull();
    expect(sumIds(unattunedXml)).not.toContain(CONDITION_FIRE);
  });

  it("keeps one registration while any record of the same item is active", () => {
    const { service, id } = character("Two Rings");
    let dto = service.addItem(id, { itemId: RING_OF_WARMTH, amount: 1, baseElementId: null });
    const first = dto.items.at(-1)!.identifier;
    dto = service.addItem(id, { itemId: RING_OF_WARMTH, amount: 1, baseElementId: null });
    const second = dto.items.at(-1)!.identifier;

    service.attuneItem(id, first, true);
    service.attuneItem(id, second, true);
    let xml = service.exportCharacterXml(id);
    expect(sumIds(xml).filter((entry) => entry === RING_OF_WARMTH)).toHaveLength(1);
    expect(sumIds(xml).filter((entry) => entry === CONDITION_COLD)).toHaveLength(1);

    service.attuneItem(id, first, false);
    xml = service.exportCharacterXml(id);
    expect(sumIds(xml)).toContain(CONDITION_COLD);

    service.attuneItem(id, second, false);
    xml = service.exportCharacterXml(id);
    expect(sumIds(xml)).not.toContain(CONDITION_COLD);
    expect(sumIds(xml)).not.toContain(RING_OF_WARMTH);
  });

  it("removes a shared armor node once the last registered record gives it up", () => {
    const { service, id } = character("Shared Armor Node");
    let dto = service.addItem(id, { itemId: SCALE_MAIL, amount: 1, baseElementId: null });
    const worn = byItemId(dto, SCALE_MAIL).identifier;
    dto = service.addItem(id, { itemId: SCALE_MAIL, amount: 1, baseElementId: null });
    const spare = dto.items.at(-1)!.identifier;
    // The body slot is taken, so the spare registers through attunement.
    service.attuneItem(id, spare, true);
    expect(nodeSubtree(service.exportCharacterXml(id), SCALE_MAIL)).not.toBeNull();

    // Stowing takes the spare's registration away even though it stays bonded.
    service.setItemStorage(id, spare, "#1");
    expect(nodeSubtree(service.exportCharacterXml(id), SCALE_MAIL)).not.toBeNull();

    service.equipItem(id, worn, "none");
    const xml = service.exportCharacterXml(id);
    expect(nodeSubtree(xml, SCALE_MAIL)).toBeNull();
    expect(sumIds(xml)).not.toContain(SCALE_MAIL);
    expect(sumIds(xml)).not.toContain(GRANTS_STEALTH);
  });

  it("removes only one record's sum entries when two share a base id", () => {
    const { service, id } = character("Two Longswords");
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const first = byItemId(dto, LONGSWORD).identifier;
    dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const second = dto.items.at(-1)!.identifier;
    service.equipItem(id, second, "secondary");
    expect(sumIds(service.exportCharacterXml(id)).filter((entry) => entry === LONGSWORD)).toHaveLength(2);

    service.equipItem(id, first, "none");
    expect(sumIds(service.exportCharacterXml(id)).filter((entry) => entry === LONGSWORD)).toHaveLength(1);
  });

  it("leaves control items to the control planner", () => {
    const { service, id } = character("Controls");
    const before = service.exportCharacterXml(id);
    const control = service
      .getCharacterControls(id)
      .find((candidate) => candidate.key.startsWith("item:") && !candidate.enabled);
    // The shipped content carries "Additional Feature" adjustments, so a
    // control is always on offer; a missing one means the fixture changed.
    expect(control).toBeDefined();
    service.setCharacterControl(id, { key: control!.key, enabled: true });
    const enabledXml = service.exportCharacterXml(id);
    expect(topLevelNodes(enabledXml).some((node) => node.endsWith(`|${control!.elementId}`))).toBe(true);
    service.setCharacterControl(id, { key: control!.key, enabled: false });
    const afterXml = service.exportCharacterXml(id);
    // The registered-count formulas the control planner and the inventory
    // planners use already disagree; what matters here is that the sweep adds
    // no node and no sum entry of its own on either side of the toggle.
    expect(topLevelNodes(afterXml)).toEqual(topLevelNodes(before));
    expect(sumRegion(afterXml)).toBe(sumRegion(before));
  });
});

describe("requirement-gated item grants", () => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await corpusLibrary();
  }, 120_000);

  function character(name: string): { service: CharacterService; id: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter(name).id;
    service.setRulesetMode(id, "2014");
    return { service, id };
  }

  it("registers the gated grants for a non-dwarf and drops them when the race changes", () => {
    const { service, id } = character("Belt Non Dwarf");
    const dto = service.addItem(id, { itemId: BELT_OF_DWARVENKIND, amount: 1, baseElementId: null });
    const belt = dto.items.at(-1)!.identifier;
    service.attuneItem(id, belt, true);

    const xml = service.exportCharacterXml(id);
    expect(childIds(nodeSubtree(xml, BELT_OF_DWARVENKIND)!)).toEqual([
      CONDITION_POISON,
      VISION_DARKVISION,
      LANGUAGE_DWARVISH,
    ]);

    const raceRule = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race")!;
    service.setSelection(id, raceRule.identifier, RACE_DWARF);
    const dwarfXml = service.exportCharacterXml(id);
    expect(childIds(nodeSubtree(dwarfXml, BELT_OF_DWARVENKIND)!)).toEqual([]);
    expect(sumIds(dwarfXml)).not.toContain(LANGUAGE_DWARVISH);
  });

  it("writes an empty node when a dwarf attunes the belt", () => {
    const { service, id } = character("Belt Dwarf");
    const raceRule = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race")!;
    service.setSelection(id, raceRule.identifier, RACE_DWARF);
    const dto = service.addItem(id, { itemId: BELT_OF_DWARVENKIND, amount: 1, baseElementId: null });
    service.attuneItem(id, dto.items.at(-1)!.identifier, true);

    const xml = service.exportCharacterXml(id);
    expect(nodeSubtree(xml, BELT_OF_DWARVENKIND)).not.toBeNull();
    expect(childIds(nodeSubtree(xml, BELT_OF_DWARVENKIND)!)).toEqual([]);
    // Dwarvish is the race's, not the belt's: the belt adds no second copy.
    expect(sumIds(xml).filter((entry) => entry === LANGUAGE_DWARVISH)).toHaveLength(1);
  });
});

describe.each(["2014", "2024"])("item-granted spells and choices (%s rules)", (mode) => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await homebrewLibrary();
  }, 120_000);

  function attunedDagger(name: string): { service: CharacterService; id: string; identifier: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter(`${name} ${mode}`).id;
    service.setRulesetMode(id, mode);
    const dto = service.addItem(id, { itemId: HOMEBREW_ITEM, amount: 1, baseElementId: null });
    const identifier = dto.items.at(-1)!.identifier;
    service.attuneItem(id, identifier, true);
    return { service, id, identifier };
  }

  it("projects an item-granted spell as a feature caster with the nominated ability", () => {
    const { service, id, identifier } = attunedDagger("Whispering");
    const casters = featureSpellCasters(service.getCharacter(id), library);
    const caster = casters.find((candidate) => candidate.elementId === HOMEBREW_FEAT)!;
    expect(caster.ability).toBe("Charisma");
    expect(caster.spellIds).toContain(BURNING_HANDS);

    service.attuneItem(id, identifier, false);
    expect(
      featureSpellCasters(service.getCharacter(id), library).some((c) => c.elementId === HOMEBREW_FEAT),
    ).toBe(false);
  });

  it("offers the item's spell choice and takes a selection", () => {
    const { service, id, identifier } = attunedDagger("Choice");
    const rule = pendingSelectionRules(service.getCharacter(id)).find(
      (candidate) => candidate.name === "Whispering Flame Cantrip",
    )!;
    expect(rule).toBeDefined();
    const option = selectionOptions(service.getCharacter(id), library, rule)[0]!;
    service.setSelection(id, rule.identifier, option.id);
    expect(sumIds(service.exportCharacterXml(id))).toContain(option.id);

    service.attuneItem(id, identifier, false);
    expect(
      pendingSelectionRules(service.getCharacter(id)).some((c) => c.name === "Whispering Flame Cantrip"),
    ).toBe(false);

    service.attuneItem(id, identifier, true);
    expect(
      pendingSelectionRules(service.getCharacter(id)).some((c) => c.name === "Whispering Flame Cantrip"),
    ).toBe(true);
  });

  it("lets a DM grant an element an item already registered", () => {
    const { service, id } = attunedDagger("Duplicate");
    expect(() => service.addGrantedFeat(id, { featId: HOMEBREW_FEAT })).not.toThrow();
    const bothXml = service.exportCharacterXml(id);
    expect(sumIds(bothXml).filter((entry) => entry === HOMEBREW_FEAT)).toHaveLength(2);

    service.removeGrantedFeat(id, { featId: HOMEBREW_FEAT });
    const xml = service.exportCharacterXml(id);
    expect(sumIds(xml).filter((entry) => entry === HOMEBREW_FEAT)).toHaveLength(1);
    expect(childIds(nodeSubtree(xml, HOMEBREW_ITEM)!)).toContain(HOMEBREW_FEAT);
  });
});

const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));

describe("Aurora-saved characters", () => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await corpusLibrary();
  }, 120_000);

  // These files already carry the registrations the sweep writes, so importing
  // one must produce no edits at all: the item subtrees, their sum entries and
  // the registered count are exactly what the sweep would compute.
  it.each(["paladin-7.dnd5e", "ranger-rogue-8.dnd5e", "barbarian-8.dnd5e"])(
    "re-exports %s byte-identically",
    async (name) => {
      const xml = await readFile(join(FIXTURE_ROOT, name), "utf8");
      const service = new CharacterService(undefined, library, { rng: seededRng(7) });
      service.importCharacterXml(name, xml);
      expect(service.exportCharacterXml(name)).toBe(xml);
    },
  );
});

describe("legacy flat registrations", () => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await corpusLibrary();
  }, 120_000);

  it("migrates a flat item registration to the node form on import, once", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter("Legacy Source").id;
    const dto = service.addItem(id, { itemId: RING_OF_RESISTANCE_FIRE, amount: 1, baseElementId: null });
    service.attuneItem(id, dto.items.at(-1)!.identifier, true);
    // The shape the previous engine wrote: the item and its direct grants as
    // sum entries with no element node of their own.
    const flat = service
      .exportCharacterXml(id)
      .replace(/\r\n\t\t\t<element type="Magic Item" name="[^"]*" id="ID_WOTC_DMG_MAGIC_ITEM_RING_OF_RESISTANCE_FIRE">[\s\S]*?\r\n\t\t\t<\/element>/, "");
    expect(nodeSubtree(flat, RING_OF_RESISTANCE_FIRE)).toBeNull();
    expect(sumIds(flat)).toContain(CONDITION_FIRE);

    const migrated = new CharacterService(undefined, library, { rng: seededRng(7) });
    migrated.importCharacterXml("Legacy", flat);
    const once = migrated.exportCharacterXml("Legacy");
    expect(nodeSubtree(once, RING_OF_RESISTANCE_FIRE)).not.toBeNull();
    expect(sumIds(once).filter((entry) => entry === CONDITION_FIRE)).toHaveLength(1);
    expect(registeredCount(once)).toBe(registeredCount(flat));

    const again = new CharacterService(undefined, library, { rng: seededRng(7) });
    again.importCharacterXml("Legacy Again", once);
    expect(again.exportCharacterXml("Legacy Again")).toBe(once);
  });
});
