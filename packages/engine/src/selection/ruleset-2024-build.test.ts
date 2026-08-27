/**
 * A character limited to the 2024 rules can be built from the shipped
 * content alone: every class, with its System Reference Document subclass,
 * reaches level 3 with no selection rule left without a candidate.
 *
 * This is the headline promise of shipping the SRD 5.2.1 subset. It also
 * guards the engine and patch work that made it possible: Alignment, Deity
 * and Proficiency elements are ruleset-shared, the shipped skill elements
 * carry the PHB24 class tags, the "Skill Expertise" proficiency elements
 * exist, and the Internal grants the 2024 content relies on ship with it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "./selection.js";
import { seededRng } from "../testing/character-factory.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const SYSTEM_ROOT = fileURLToPath(new URL("../../../../third-party/elements/system/", import.meta.url));

async function shippedLibrary(): Promise<ElementLibrary> {
  const { PUBLIC_BASE_PATHS } = (await import(
    fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url))
  )) as { PUBLIC_BASE_PATHS: Set<string> };
  const files = new Map<string, string>();
  for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), "utf8"));
  for (const name of ["system-proxies.xml", "system-unarmed-riders.xml"]) {
    files.set(`system/${name}`, await readFile(join(SYSTEM_ROOT, name), "utf8"));
  }
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}

const BUILDS = [
  { label: "Goliath Cleric (Life Domain)", race: "GOLIATH", cls: "CLERIC", archetype: "CLERIC_LIFE_DOMAIN", background: "ACOLYTE" },
  { label: "Human Fighter (Champion)", race: "HUMAN", cls: "FIGHTER", archetype: "FIGHTER_CHAMPION", background: "SOLDIER" },
  { label: "Elf Wizard (Evoker)", race: "ELF", cls: "WIZARD", archetype: "WIZARD_EVOKER", background: "SAGE" },
  { label: "Halfling Rogue (Thief)", race: "HALFLING", cls: "ROGUE", archetype: "ROGUE_THIEF", background: "CRIMINAL" },
  { label: "Dwarf Bard (College of Lore)", race: "DWARF", cls: "BARD", archetype: "BARD_COLLEGE_OF_LORE", background: "SAGE" },
  { label: "Orc Monk (Warrior of the Open Hand)", race: "ORC", cls: "MONK", archetype: "MONK_WARRIOR_OF_THE_OPEN_HAND", background: "SOLDIER" },
  { label: "Tiefling Warlock (Fiend Patron)", race: "TIEFLING", cls: "WARLOCK", archetype: "WARLOCK_FIEND_PATRON", background: "CRIMINAL" },
  { label: "Dragonborn Paladin (Oath of Devotion)", race: "DRAGONBORN", cls: "PALADIN", archetype: "PALADIN_OATH_OF_DEVOTION", background: "ACOLYTE" },
  { label: "Gnome Sorcerer (Draconic Sorcery)", race: "GNOME", cls: "SORCERER", archetype: "SORCERER_DRACONIC_SORCERY", background: "SAGE" },
  { label: "Human Druid (Circle of the Land)", race: "HUMAN", cls: "DRUID", archetype: "DRUID_CIRCLE_OF_THE_LAND", background: "ACOLYTE" },
  { label: "Elf Ranger (Hunter)", race: "ELF", cls: "RANGER", archetype: "RANGER_HUNTER", background: "CRIMINAL" },
  { label: "Goliath Barbarian (Path of the Berserker)", race: "GOLIATH", cls: "BARBARIAN", archetype: "BARBARIAN_BERSERKER", background: "SOLDIER" },
] as const;

const ABILITIES = { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 };

let library: ElementLibrary;
beforeAll(async () => {
  library = await shippedLibrary();
}, 120_000);

function build(spec: (typeof BUILDS)[number]) {
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  const id = service.createCharacter(spec.label).id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, ABILITIES);
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection);
    if (!rule) throw new Error(`${spec.label}: no pending ${type} rule to set ${elementId}`);
    service.setSelection(id, rule.identifier, elementId);
  };
  pick("Race", `ID_WOTC_PHB24_RACE_${spec.race}`);
  pick("Class", `ID_WOTC_PHB24_CLASS_${spec.cls}`);
  pick("Background", `ID_WOTC_PHB24_BACKGROUND_${spec.background}`);
  service.levelUp(id);
  service.levelUp(id);
  pick("Archetype", `ID_WOTC_PHB24_ARCHETYPE_${spec.archetype}`);
  return { service, id };
}

/** Pending rules that offer nothing to choose from. */
function starvedRules(service: CharacterService, id: string): string[] {
  const state = service.getCharacter(id);
  return pendingSelectionRules(state)
    .filter((rule) => !rule.hasSelection)
    .filter((rule) => selectionOptions(state, library, rule).length === 0)
    .map((rule) => `${rule.type}: ${rule.name}`);
}

describe("2024-rules characters built from the shipped content", () => {
  it("classifies the shipped 2024 content as 2024 and the 2014 content as 2014", () => {
    expect(library.ruleset.get("ID_WOTC_PHB24_CLASS_FIGHTER")).toBe("2024");
    expect(library.ruleset.get("ID_WOTC_PHB24_SPELL_MELFS_ACID_ARROW")).toBe("2024");
    expect(library.ruleset.get("ID_WOTC_PHB_CLASS_FIGHTER")).toBe("2014");
    expect(library.rulesetCounts.rules2024Count).toBeGreaterThan(1000);
  });

  it("offers only 2024 species, classes and backgrounds in 2024 mode", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter("Offerings").id;
    service.setRulesetMode(id, "2024");
    const state = service.getCharacter(id);
    const names = (type: string) => {
      const rule = pendingSelectionRules(state).find((r) => r.type === type);
      return selectionOptions(state, library, rule!).map((option) => option.name).sort();
    };
    expect(names("Race")).toEqual(["Dragonborn", "Dwarf", "Elf", "Gnome", "Goliath", "Halfling", "Human", "Orc", "Tiefling"]);
    expect(names("Class")).toHaveLength(12);
    expect(names("Background")).toEqual(["Acolyte", "Criminal", "Sage", "Soldier"]);
  });

  for (const spec of BUILDS) {
    it(`builds a ${spec.label} to level 3 with every rule satisfiable`, () => {
      const { service, id } = build(spec);
      const state = service.getCharacter(id);
      expect(state.rulesetMode).toBe("2024");
      expect(starvedRules(service, id)).toEqual([]);
    });
  }

  it("keeps the excluded subclasses, species and spells out of 2024 mode", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter("Exclusions").id;
    service.setRulesetMode(id, "2024");
    expect(library.byId.has("ID_WOTC_PHB24_RACE_AASIMAR")).toBe(false);
    expect(library.byId.has("ID_WOTC_PHB24_ARCHETYPE_FIGHTER_BATTLE_MASTER")).toBe(false);
    expect(library.byId.has("ID_WOTC_PHB24_SPELL_ARMOR_OF_AGATHYS")).toBe(false);
    // Renamed spells keep their corpus ids and carry the SRD name in both editions.
    expect(library.byId.get("ID_WOTC_PHB24_SPELL_BIGBYS_HAND")?.identity.name).toBe("Arcane Hand");
    expect(library.byId.get("ID_PHB_SPELL_BIGBYS_HAND")?.identity.name).toBe("Arcane Hand");
  });
});
