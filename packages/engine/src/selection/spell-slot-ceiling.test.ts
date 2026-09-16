/**
 * The `$(spellcasting:slots)` ceiling of a spell select. A known-spells caster
 * (the 2024 Sorcerer, Bard, Warlock, Paladin and Ranger; their 2014
 * counterparts; the Eldritch Knight and Arcane Trickster) may fill any of its
 * spell choices with a spell of any level it has slots for NOW, so the ceiling
 * follows the caster's current level in its own class — not the level at which
 * the select was gained, not the character level, and not the combined
 * multiclass slot table. The wizard's spellbook is the exception: spells are
 * copied in when the level is gained, so its selects keep the ceiling of the
 * level that granted them.
 *
 * The same ceiling bounds the Magic tab's browse projection, and a delevel
 * that lowers it takes back the picks above it for re-picking.
 *
 * Built from the shipped content (which carries the 2024 Bard level-1 select
 * patched to use the slots token); the subclass casters come from the corpus.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "./selection.js";
import { wrapperSnapshots } from "../progression/delevel-replay.js";
import { buildRangerRogue8, seededRng } from "../testing/character-factory.js";
import { SYSTEM_ROOT, buildCorpusLibrary } from "../testing/corpus.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));

const SORCERER = "ID_WOTC_PHB24_CLASS_SORCERER";
const WIZARD = "ID_WOTC_PHB24_CLASS_WIZARD";
const BARD = "ID_WOTC_PHB24_CLASS_BARD";
const MC_WIZARD = "ID_WOTC_PHB24_MULTICLASS_WIZARD";
const OPTION_MULTICLASS = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";

/** 1st: Magic Missile; 2nd: Scorching Ray, Shatter (also Bard); 3rd: Fireball. */
const MAGIC_MISSILE = "ID_WOTC_PHB24_SPELL_MAGIC_MISSILE";
const SCORCHING_RAY = "ID_WOTC_PHB24_SPELL_SCORCHING_RAY";
const SHATTER = "ID_WOTC_PHB24_SPELL_SHATTER";
const FIREBALL = "ID_WOTC_PHB24_SPELL_FIREBALL";

async function shippedLibrary(transform?: (name: string, xml: string) => string): Promise<ElementLibrary> {
  const { PUBLIC_BASE_PATHS } = (await import(
    fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url))
  )) as { PUBLIC_BASE_PATHS: Set<string> };
  const files = new Map<string, string>();
  for (const name of PUBLIC_BASE_PATHS) {
    const xml = await readFile(join(PUBLIC_ROOT, name), "utf8");
    files.set(name, transform?.(name, xml) ?? xml);
  }
  for (const name of ["system-proxies.xml", "system-unarmed-riders.xml"]) {
    files.set(`system/${name}`, await readFile(join(SYSTEM_ROOT, name), "utf8"));
  }
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}

let library: ElementLibrary;
beforeAll(async () => {
  library = await shippedLibrary();
}, 120_000);

interface Built {
  service: CharacterService;
  id: string;
  library: ElementLibrary;
}

/** A character of the given class at level 1. */
function create(classId: string, lib: ElementLibrary = library, ruleset: "2014" | "2024" = "2024"): Built {
  const service = new CharacterService(undefined, lib, { rng: seededRng(11) });
  const id = service.createCharacter("ceiling").id;
  service.setRulesetMode(id, ruleset);
  service.setAbilities(id, { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
  pick({ service, id, library: lib }, "Class", classId);
  return { service, id, library: lib };
}

function pick(built: Built, type: string, elementId: string): void {
  const rule = pendingSelectionRules(built.service.getCharacter(built.id)).find((r) => r.type === type);
  if (rule === undefined) throw new Error(`no pending ${type} rule to set ${elementId}`);
  built.service.setSelection(built.id, rule.identifier, elementId);
}

function levelTo(built: Built, level: number): void {
  while (built.service.getCharacter(built.id).level < level) built.service.levelUp(built.id);
}

/** The first open select wrapper by name and granting level, on the current state. */
function spellRule(built: Built, name: string, requiredLevel: number): SelectionRule {
  const rule = pendingSelectionRules(built.service.getCharacter(built.id)).find(
    (r) => r.type === "Spell" && r.name === name && r.requiredLevel === requiredLevel,
  );
  if (rule === undefined) throw new Error(`no open ${name} select granted at level ${requiredLevel}`);
  return rule;
}

function optionIds(built: Built, name: string, requiredLevel: number): string[] {
  const state = built.service.getCharacter(built.id);
  return selectionOptions(state, built.library, spellRule(built, name, requiredLevel)).map((option) => option.id);
}

/** The spells chosen in every wrapper of a select. */
function picksOf(state: CharacterState, name: string, requiredLevel: number): string[] {
  return wrapperSnapshots(state)
    .filter((wrapper) => wrapper.type === "Spell" && wrapper.name === name && wrapper.requiredLevel === requiredLevel)
    .map((wrapper) => wrapper.registered);
}

describe("spell select slot ceiling (2024 Sorcerer)", () => {
  it("retains old Bard wrappers after the shipped select checksum changes", async () => {
    const oldLibrary = await shippedLibrary((name, xml) => name.endsWith("class-bard.xml")
      ? xml.replace('supports="$(spellcasting:list), $(spellcasting:slots)" number="4"', 'supports="$(spellcasting:list), 1" number="4"')
      : xml);
    const old = create(BARD, oldLibrary);
    levelTo(old, 3);
    const oldRule = spellRule(old, "Spell (Bard)", 1);
    old.service.setSelection(old.id, oldRule.identifier, "ID_WOTC_PHB24_SPELL_HEALING_WORD", 1);
    const xml = old.service.exportCharacterXml(old.id);
    const service = new CharacterService(undefined, library);
    service.importCharacterXml("old-bard", xml);
    const built = { service, id: "old-bard", library };
    expect(service.exportCharacterXml(built.id)).toBe(xml);
    const fresh = create(BARD);
    const checksumOf = (character: Built) => wrapperSnapshots(character.service.getCharacter(character.id))
      .find((wrapper) => wrapper.name === "Spell (Bard)" && wrapper.requiredLevel === 1)?.checksum;
    expect(checksumOf(old)).toBeTruthy();
    expect(checksumOf(fresh)).toBeTruthy();
    expect(checksumOf(fresh)).not.toBe(checksumOf(old));
    expect(picksOf(service.getCharacter(built.id), "Spell (Bard)", 1)).toContain("ID_WOTC_PHB24_SPELL_HEALING_WORD");
    service.setSelection(built.id, spellRule(built, "Spell (Bard)", 1).identifier, SHATTER, 1);
    service.levelUp(built.id);
    service.delevel(built.id, { mode: "last" });
    const result = service.delevel(built.id, { mode: "last" });
    expect(service.getCharacter(built.id).level).toBe(2);
    expect(picksOf(service.getCharacter(built.id), "Spell (Bard)", 1)).toHaveLength(4);
    expect(picksOf(service.getCharacter(built.id), "Spell (Bard)", 1)).not.toContain(SHATTER);
    expect(result.requiredRepicks.some((rule) => rule.selectedElementIds.includes(SHATTER))).toBe(true);
  });

  it("a level-1 sorcerer's level-1 select offers 1st-level spells only", () => {
    const built = create(SORCERER);
    const options = optionIds(built, "Spell (Sorcerer)", 1);
    expect(options).toContain(MAGIC_MISSILE);
    expect(options).not.toContain(SCORCHING_RAY);
  });

  it("a level-3 sorcerer's level-1 select offers 2nd-level spells but not 3rd", () => {
    const built = create(SORCERER);
    const { service, id } = built;
    // Expand the select at level 1 first: the ceiling cached for that state
    // must not survive the level-ups.
    expect(optionIds(built, "Spell (Sorcerer)", 1)).not.toContain(SCORCHING_RAY);
    levelTo(built, 3);

    const options = optionIds(built, "Spell (Sorcerer)", 1);
    expect(options).toContain(MAGIC_MISSILE);
    expect(options).toContain(SCORCHING_RAY);
    expect(options).not.toContain(FIREBALL);
    expect(optionIds(built, "Spell (Sorcerer)", 2)).toContain(SCORCHING_RAY);

    const rule = spellRule(built, "Spell (Sorcerer)", 1);
    expect(() => service.setSelection(id, rule.identifier, SCORCHING_RAY, 1)).not.toThrow();
    expect(() => service.setSelection(id, rule.identifier, FIREBALL, 2)).toThrowError(/not eligible/);
  });

  it("follows the sorcerer's own level, not the character level or the combined multiclass table", () => {
    // Sorcerer 3 / Wizard 2: character level 5 and multiclass caster level 5
    // would both reach 3rd-level slots; the sorcerer's own table stops at 2nd.
    const built = create(SORCERER);
    const { service, id } = built;
    levelTo(built, 4);
    service.setCharacterOption(id, { optionId: OPTION_MULTICLASS, enabled: true });
    service.startMulticlass(id, MC_WIZARD);
    service.levelUpMode(id, { mode: "multiclass", classId: MC_WIZARD });
    const state = service.getCharacter(id);
    expect(state.level).toBe(5);
    expect(state.spellcasting.some((casting) => Number(casting.slots.s3 ?? 0) > 0)).toBe(true);

    const options = optionIds(built, "Spell (Sorcerer)", 1);
    expect(options).toContain(SCORCHING_RAY);
    expect(options).not.toContain(FIREBALL);
  });
});

describe("spellbook selects keep the ceiling of the level that granted them (2024 Wizard)", () => {
  it("recognizes a renamed homebrew book by its caster metadata", async () => {
    const renamed = await shippedLibrary((name, xml) => name.endsWith("class-wizard.xml")
      ? xml.replaceAll('name="Spellbook (Wizard)"', 'name="Research Notes"') : xml);
    const built = create(WIZARD, renamed);
    levelTo(built, 5);
    expect(optionIds(built, "Research Notes", 1)).toContain(MAGIC_MISSILE);
    expect(optionIds(built, "Research Notes", 1)).not.toContain(SCORCHING_RAY);
    expect(optionIds(built, "Research Notes", 3)).toContain(SCORCHING_RAY);
    expect(optionIds(built, "Research Notes", 3)).not.toContain(FIREBALL);
  });

  it("keeps Savant spellbook additions at their acquisition level", () => {
    const built = create(WIZARD);
    levelTo(built, 3);
    pick(built, "Archetype", "ID_WOTC_PHB24_ARCHETYPE_WIZARD_EVOKER");
    levelTo(built, 9);
    const name = "Evocation Spell (Evocation Savant)";
    expect(optionIds(built, name, 3)).toContain(SCORCHING_RAY);
    expect(optionIds(built, name, 3)).not.toContain(FIREBALL);
    expect(optionIds(built, name, 5)).toContain(FIREBALL);
    expect(optionIds(built, name, 5)).not.toContain("ID_WOTC_PHB24_SPELL_CONE_OF_COLD");
    expect(built.service.getSpellBrowse(built.id, spellRule(built, name, 3).identifier).maxSpellLevel).toBe(2);
  });

  it("a level-3 wizard's level-1 spellbook select still offers 1st-level spells only", () => {
    const built = create(WIZARD);
    levelTo(built, 3);

    const first = optionIds(built, "Spellbook (Wizard)", 1);
    expect(first).toContain(MAGIC_MISSILE);
    expect(first).not.toContain(SCORCHING_RAY);
    expect(optionIds(built, "Spellbook (Wizard)", 3)).toContain(SCORCHING_RAY);
  });
});

describe("spell select slot ceiling (2024 Bard)", () => {
  it("a level-3 bard's level-1 select offers 2nd-level spells", () => {
    const built = create(BARD);
    levelTo(built, 3);

    const options = optionIds(built, "Spell (Bard)", 1);
    expect(options).toContain(SHATTER);
    expect(options).not.toContain(FIREBALL);
  });
});

describe("spell browse projection", () => {
  const statusOf = (browse: { spells: Array<{ id: string; status: string }> }, spellId: string): string | undefined =>
    browse.spells.find((spell) => spell.id === spellId)?.status;

  it("a level-3 sorcerer's level-1 spell choices browse 1st and 2nd level", () => {
    const built = create(SORCERER);
    levelTo(built, 3);

    const browse = built.service.getSpellBrowse(built.id, spellRule(built, "Spell (Sorcerer)", 1).identifier);
    expect(browse.maxSpellLevel).toBe(2);
    expect(browse.activeSpellLevels).toEqual([1, 2]);
    expect(statusOf(browse, SCORCHING_RAY)).toBe("learnable");
    expect(statusOf(browse, FIREBALL)).toBe("level");
  });

  it("a level-3 wizard's level-1 spellbook choices still browse 1st level only", () => {
    const built = create(WIZARD);
    levelTo(built, 3);

    const browse = built.service.getSpellBrowse(built.id, spellRule(built, "Spellbook (Wizard)", 1).identifier);
    expect(browse.maxSpellLevel).toBe(1);
    expect(browse.activeSpellLevels).toEqual([1]);
    expect(statusOf(browse, SCORCHING_RAY)).toBe("level");
  });
});

describe("delevel below a pick's level", () => {
  it.each(["last", "class"] as const)("counts secondary Sorcerer levels and clears high picks in %s mode", (mode) => {
    const built = create("ID_WOTC_PHB24_CLASS_FIGHTER");
    const { service, id } = built;
    levelTo(built, 2);
    service.setCharacterOption(id, { optionId: OPTION_MULTICLASS, enabled: true });
    const mc = "ID_WOTC_PHB24_MULTICLASS_SORCERER";
    service.startMulticlass(id, mc);
    service.levelUpMode(id, { mode: "multiclass", classId: mc });
    service.levelUpMode(id, { mode: "multiclass", classId: mc });
    const rule = spellRule(built, "Spell (Sorcerer)", 1);
    expect(service.getSpellBrowse(id, rule.identifier).maxSpellLevel).toBe(2);
    expect(optionIds(built, "Spell (Sorcerer)", 1)).toContain(SCORCHING_RAY);
    service.setSelection(id, rule.identifier, SCORCHING_RAY, 1);
    service.setSelection(id, rule.identifier, MAGIC_MISSILE, 2);
    const result = service.delevel(id, { mode, classId: SORCERER });
    expect(picksOf(service.getCharacter(id), "Spell (Sorcerer)", 1)).toEqual(["", MAGIC_MISSILE]);
    expect(result.requiredRepicks.some((r) => r.selectedElementIds.includes(SCORCHING_RAY))).toBe(true);
    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml("reload", service.exportCharacterXml(id));
    expect(picksOf(reader.getCharacter("reload"), "Spell (Sorcerer)", 1)).toEqual(["", MAGIC_MISSILE]);
  });

  it("lowers Sorcerer 3 / Wizard 1 without losing the replayed Wizard level", () => {
    const built = create(SORCERER);
    const { service, id } = built;
    levelTo(built, 4);
    service.setCharacterOption(id, { optionId: OPTION_MULTICLASS, enabled: true });
    service.startMulticlass(id, MC_WIZARD);
    service.setSelection(id, spellRule(built, "Spell (Sorcerer)", 1).identifier, SCORCHING_RAY, 1);
    const result = service.delevel(id, { mode: "class", classId: SORCERER });
    expect(service.getCharacter(id).levelHistory.map((r) => r.classId)).toEqual([SORCERER, SORCERER, MC_WIZARD]);
    expect(result.requiredRepicks.some((r) => r.selectedElementIds.includes(SCORCHING_RAY))).toBe(true);
    expect(service.getSpellcasting(id).map((c) => c.name)).toEqual(["Sorcerer", "Wizard"]);
  });

  it("takes back a 2nd-level spell chosen in the level-1 select when a level-3 sorcerer drops to level 2", () => {
    const built = create(SORCERER);
    const { service, id } = built;
    levelTo(built, 3);
    const ruleId = spellRule(built, "Spell (Sorcerer)", 1).identifier;
    service.setSelection(id, ruleId, SCORCHING_RAY, 1);
    service.setSelection(id, ruleId, MAGIC_MISSILE, 2);

    const result = service.delevel(id, { mode: "last" });

    const state = service.getCharacter(id);
    expect(state.level).toBe(2);
    // Like a choice granted above the new level: the pick is cleared and the
    // select is reported for re-picking. The 1st-level pick stands.
    const repicks = result.requiredRepicks.filter((rule) => rule.name === "Spell (Sorcerer)" && rule.requiredLevel === 1);
    expect(repicks).toHaveLength(1);
    expect(repicks[0]!.selectedElementIds).toEqual([SCORCHING_RAY]);
    expect(picksOf(state, "Spell (Sorcerer)", 1)).toEqual(expect.arrayContaining(["", MAGIC_MISSILE]));
    expect(state.sum.elements.map((element) => element.id)).not.toContain(SCORCHING_RAY);
    expect(state.sum.elements.map((element) => element.id)).toContain(MAGIC_MISSILE);
    expect(optionIds(built, "Spell (Sorcerer)", 1)).not.toContain(SHATTER);
  });

});

describe("corpus casters: delevel replay and subclass casters", () => {
  let corpus: ElementLibrary;
  beforeAll(async () => {
    corpus = await buildCorpusLibrary();
  }, 120_000);

  it("a delevel that unwinds and replays takes back a pick above the lowered class's ceiling", () => {
    // Ranger 5 / Rogue 3, lowering the ranger: its level-2 choice holds a
    // 2nd-level spell, and a 4th-level ranger has only 1st-level slots.
    const SPIKE_GROWTH = "ID_PHB_SPELL_SPIKE_GROWTH";
    const { service, id } = buildRangerRogue8(corpus, "CeilingReplay");
    const built: Built = { service, id, library: corpus };
    service.setSelection(id, spellRule(built, "Spellcasting (Ranger)", 2).identifier, SPIKE_GROWTH, 1);

    const result = service.delevel(id, { mode: "class", classId: "ID_WOTC_PHB_CLASS_RANGER" });

    const state = service.getCharacter(id);
    expect(state.level).toBe(7);
    expect(result.requiredRepicks.some((rule) => rule.name === "Spellcasting (Ranger)" && rule.requiredLevel === 2)).toBe(true);
    expect(picksOf(state, "Spellcasting (Ranger)", 2)).not.toContain(SPIKE_GROWTH);
    expect(state.sum.elements.map((element) => element.id)).not.toContain(SPIKE_GROWTH);
  });

  function subclassCaster(classId: string, archetypeId: string, ruleset: "2014" | "2024"): Built {
    const built = create(classId, corpus, ruleset);
    levelTo(built, 3);
    pick(built, "Archetype", archetypeId);
    return built;
  }

  it("a 2024 Eldritch Knight's level-3 select reaches 2nd level at fighter level 7", () => {
    const built = subclassCaster("ID_WOTC_PHB24_CLASS_FIGHTER", "ID_WOTC_PHB24_ARCHETYPE_FIGHTER_ELDRITCH_KNIGHT", "2024");
    expect(optionIds(built, "Spell (Eldritch Knight)", 3)).not.toContain(SCORCHING_RAY);
    levelTo(built, 7);

    const options = optionIds(built, "Spell (Eldritch Knight)", 3);
    expect(options).toContain(MAGIC_MISSILE);
    expect(options).toContain(SCORCHING_RAY);
    expect(options).not.toContain(FIREBALL);
  });

  it("a 2024 Arcane Trickster's level-3 select reaches 2nd level at rogue level 7", () => {
    const built = subclassCaster("ID_WOTC_PHB24_CLASS_ROGUE", "ID_WOTC_PHB24_ARCHETYPE_ROGUE_ARCANE_TRICKSTER", "2024");
    levelTo(built, 7);

    const options = optionIds(built, "Spell (Arcane Trickster)", 3);
    expect(options).toContain(SCORCHING_RAY);
    expect(options).not.toContain(FIREBALL);
  });

  it("a 2014 Eldritch Knight's level-4 select reaches 2nd level at fighter level 7; its fixed 1st-level choices stay", () => {
    const built = subclassCaster("ID_WOTC_PHB_CLASS_FIGHTER", "ID_WOTC_PHB_ARCHETYPE_FIGHTER_ELDRITCH_KNIGHT", "2014");
    levelTo(built, 7);

    const fourth = optionIds(built, "Spellcasting (Eldritch Knight)", 4);
    expect(fourth).toContain("ID_PHB_SPELL_SHATTER");
    expect(fourth).not.toContain("ID_PHB_SPELL_FIREBALL");
    expect(optionIds(built, "Spellcasting (Eldritch Knight)", 3)).not.toContain("ID_PHB_SPELL_SHATTER");
  });
});
