import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { CharacterService } from "./character/service.js";
import { buildCorpusLibrary } from "./testing/corpus.js";
import type { ElementLibrary } from "./content/library.js";
import { pendingSelectionRules } from "./selection/selection.js";
import { createEngineMethodHandlers } from "./worker-handlers.js";
import { computeStatistics } from "./statistics/calculator.js";
import { isRequiredSource } from "./content/sourceIdentity.js";

let library: ElementLibrary;
beforeAll(async () => { library = await buildCorpusLibrary(); }, 120_000);

function character(className: string, level = 3) {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter("Feedback regression").id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
  const rule = pendingSelectionRules(service.getCharacter(id)).find(r => r.type === "Class")!;
  service.setSelection(id, rule.identifier, `ID_WOTC_PHB24_CLASS_${className}`);
  while (service.getCharacter(id).level < level) service.levelUp(id);
  return { service, id };
}

describe("feedback regressions with uploaded corpus content", () => {
  it("lets a level-3 Bard replace an original pick with a level-2 spell and clears it after lowering", () => {
    const { service, id } = character("BARD");
    const rule = () => pendingSelectionRules(service.getCharacter(id)).find(r => r.name === "Spell (Bard)" && r.requiredLevel === 1)!;
    const browse = service.getSpellBrowse(id, rule().identifier);
    expect(browse.maxSpellLevel).toBe(2);
    expect(browse.spells.find(s => s.id === "ID_WOTC_PHB24_SPELL_SHATTER")?.status).toBe("learnable");
    service.setSelection(id, rule().identifier, "ID_WOTC_PHB24_SPELL_HEALING_WORD", 1);
    service.setSelection(id, rule().identifier, "ID_WOTC_PHB24_SPELL_SHATTER", 1);
    const xml = service.exportCharacterXml(id);
    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml(id, xml);
    expect(reader.exportCharacterXml(id)).toBe(xml);
    expect(reader.getSpellcasting(id)[0]!.knownSpells.some(s => s.id === "ID_WOTC_PHB24_SPELL_SHATTER")).toBe(true);
    reader.delevel(id, { mode: "last" });
    expect(reader.getSpellcasting(id)[0]!.knownSpells.some(s => s.id === "ID_WOTC_PHB24_SPELL_SHATTER")).toBe(false);
  });

  it.each(["DRUID", "CLERIC", "PALADIN"])("limits the %s preparation list to PHB 2024", className => {
    const { service, id } = character(className);
    // Every switchable book except PHB 2024 — what the Sources panel can send;
    // required books (DMG, MM, Aurora Legacy Essentials) cannot be disabled.
    const restrictedSourceIds = [...library.sources.values()]
      .filter(s => !isRequiredSource(s) && s.identity.name !== "Player’s Handbook (2024)")
      .map(s => s.identity.id);
    expect(restrictedSourceIds).not.toContain("ID_WOTC_SOURCE_DUNGEON_MASTERS_GUIDE");
    expect(restrictedSourceIds).toContain("ID_WOTC_SOURCE_PLAYERS_HANDBOOK");
    void createEngineMethodHandlers(service, library).setCharacterSources!(id, { restrictedSourceIds });
    const spells = service.getSpellcasting(id)[0]!.knownSpells;
    expect(spells.length).toBeGreaterThan(0);
    expect([...new Set(spells.map(s => s.source))]).toEqual(["Player’s Handbook (2024)"]);
  });

  it("clears a prepared spell when its book is disabled and rejects a stale preparation request", () => {
    const { service, id } = character("DRUID");
    const spellId = "ID_POTA_SPELL_ABSORBELEMENTS";
    service.setPrepared(id, service.getSpellcasting(id)[0]!.identifier, { spellId, prepared: true });
    const source = [...library.sources.values()].find(s => s.identity.name === "Princes of the Apocalypse")!;
    const handlers = createEngineMethodHandlers(service, library);
    const response = handlers.setCharacterSources!(id, { restrictedSourceIds: [source.identity.id] }) as { removedSpellNames: string[] };
    expect(response.removedSpellNames).toContain("Absorb Elements");
    expect(service.exportCharacterXml(id)).not.toContain(spellId);
    expect(() => service.setPrepared(id, service.getSpellcasting(id)[0]!.identifier, { spellId, prepared: true })).toThrow();
    const xml = service.exportCharacterXml(id);
    service.importCharacterXml(id, xml);
    expect(service.exportCharacterXml(id)).toBe(xml);
    expect(service.getSpellcasting(id)[0]!.knownSpells.some(s => s.id === spellId)).toBe(false);
  });

  it("retains the Aurora registration total through a DM ability grant", async () => {
    const service = new CharacterService(undefined, library);
    const xml = await readFile(new URL("../../../fixtures/coverage/characters/paladin-7.dnd5e", import.meta.url), "utf8");
    service.importCharacterXml("paladin", xml);
    expect(service.getCharacter("paladin").registeredCount).toBe(31);
    const abilityElementId = "ID_INTERNAL_ASI_STRENGTH";
    service.addGrantedAbilityScore("paladin", { abilityElementIds: [abilityElementId] });
    expect(service.getCharacter("paladin").registeredCount).toBe(32);
    service.removeGrantedAbilityScore("paladin", { abilityElementId });
    expect(service.getCharacter("paladin").registeredCount).toBe(31);
  });

  it.each(["INTELLIGENCE", "WISDOM"])("Divine Oracle raises %s and its maximum by two", ability => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Oracle").id;
    const state = service.getCharacter(id);
    state.abilities[ability.toLowerCase() as "intelligence" | "wisdom"] = 20;
    state.elements.push({ type: "Magic Item", name: "Oracle", id: "ID_WOTC_MOOT_MAGIC_ITEM_GIFT_ORACLE", children: [] });
    state.sum.elements.push({ type: "Magic Item", id: "ID_WOTC_MOOT_MAGIC_ITEM_GIFT_ORACLE" });
    state.elements.push({ type: "Racial Trait", name: ability, id: `ID_WOTC_MOOT_RACIAL_TRAIT_ORACLE_DIVINE_ORACLE_${ability}`, children: [] });
    state.sum.elements.push({ type: "Racial Trait", id: `ID_WOTC_MOOT_RACIAL_TRAIT_ORACLE_DIVINE_ORACLE_${ability}` });
    const stats = computeStatistics(state, library);
    expect(stats[`${ability.toLowerCase()}:score`]).toBe(22);
    expect(stats[`${ability.toLowerCase()}:max`]).toBe(22);
  });
});


describe("equipment shopping metadata", () => {
  it("reports price and proficiency and filters before paginating", () => {
    const { service, id } = character("BARD");
    const handlers = createEngineMethodHandlers(service, library);
    const query = { characterId: id, type: "Weapon", source: "Player’s Handbook (2024)", equipmentKind: "Simple weapon", maxPriceGp: 1, proficiency: "proficient" as const };
    const full = handlers.contentElements!({ ...query, take: 100 }) as { items: Array<{ displayPrice: string; priceGp: number; equipmentKind: string; isProficient: boolean }>; total: number };
    expect(full.total).toBeGreaterThan(1);
    expect(full.items.every(item => item.priceGp <= 1 && item.isProficient && item.equipmentKind.startsWith("Simple"))).toBe(true);
    const page = handlers.contentElements!({ ...query, take: 1, skip: 1 }) as typeof full;
    expect(page.total).toBe(full.total);
    expect(page.items).toEqual(full.items.slice(1, 2));
    expect(full.items.some(item => item.displayPrice === "0.1 gp")).toBe(true);
    const coins = { ...service.getCharacter(id).coins };
    service.addItem(id, { itemId: "ID_WOTC_PHB24_WEAPON_CLUB" });
    expect(service.getCharacter(id).coins).toEqual(coins);
    expect(service.getInventory(id).items[0]).toMatchObject({ priceGp: 0.1, isProficient: true, equipmentKind: "Simple melee weapon" });
  });
  it("keeps rarity and missing prices separate from zero cost", () => {
    const { service, id } = character("BARD");
    const handlers = createEngineMethodHandlers(service, library);
    const all = handlers.contentElements!({ characterId: id, equipmentOnly: true, rarity: "Rare", take: 10000 }) as { items: Array<{ rarity: string; priceGp: number | null; displayPrice: string }> };
    expect(all.items.length).toBeGreaterThan(0);
    expect(all.items.every(item => item.rarity === "Rare")).toBe(true);
    expect(all.items.some(item => item.priceGp === null && item.displayPrice === "Not listed")).toBe(true);
    const priced = handlers.contentElements!({ characterId: id, equipmentOnly: true, rarity: "Rare", maxPriceGp: 100, take: 10000 }) as typeof all;
    expect(priced.items.every(item => item.priceGp !== null && item.priceGp <= 100)).toBe(true);
  });
});
