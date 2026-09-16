/**
 * Feature spell casters: the spells a feat or trait grants outside any
 * spellcasting feature.
 *
 * Magic Initiate, the High Elf cantrip and their kin hang `<select
 * type="Spell">` rules off an ordinary feature with no `<spellcasting>` block
 * above them. Those selections never reach a caster block — a Fighter who took
 * the feat still has `state.magic === null` — so they were absent from the
 * spell pages, the spell cards and the attack options. They project as a
 * slotless "feature" caster instead.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules } from "../selection/selection.js";
import type { MagicAttackOptionsMerged } from "../attacks/attacks.js";
import { ID, buildCharacter, seededRng, sharedLibrary } from "../testing/character-factory.js";

const FIGHTER = "ID_WOTC_PHB24_CLASS_FIGHTER";
const CLERIC = "ID_WOTC_PHB24_CLASS_CLERIC";
/** Acolyte grants Magic Initiate (Cleric); Sage grants Magic Initiate (Wizard). */
const ACOLYTE = "ID_WOTC_PHB24_BACKGROUND_ACOLYTE";
const SAGE = "ID_WOTC_PHB24_BACKGROUND_SAGE";
const MI_CLERIC_WISDOM = "ID_WOTC_PHB24_FEAT_FEATURE_MAGIC_INITIATE_CLERIC_WISDOM";
const MI_WIZARD_INTELLIGENCE = "ID_WOTC_PHB24_FEAT_FEATURE_MAGIC_INITIATE_WIZARD_INTELLIGENCE";
const SACRED_FLAME = "ID_WOTC_PHB24_SPELL_SACRED_FLAME";
const GUIDANCE = "ID_WOTC_PHB24_SPELL_GUIDANCE";
const CURE_WOUNDS = "ID_WOTC_PHB24_SPELL_CURE_WOUNDS";
const FIRE_BOLT = "ID_WOTC_PHB24_SPELL_FIRE_BOLT";
const MAGE_HAND = "ID_WOTC_PHB24_SPELL_MAGE_HAND";
const MAGIC_MISSILE = "ID_WOTC_PHB24_SPELL_MAGIC_MISSILE";
const PALADIN = "ID_WOTC_PHB24_CLASS_PALADIN";
const WARLOCK = "ID_WOTC_PHB24_CLASS_WARLOCK";
const FEY_TOUCHED = "ID_WOTC_PHB24_FEAT_FEYTOUCHED";
const FEY_TOUCHED_CHARISMA = "ID_WOTC_PHB24_FEAT_FEATURE_FEYTOUCHED_CHARISMA";
const BLESS = "ID_WOTC_PHB24_SPELL_BLESS";
const MISTY_STEP = "ID_WOTC_PHB24_SPELL_MISTY_STEP";
const ARMOR_OF_SHADOWS = "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_ARMOR_OF_SHADOWS";
const MAGE_ARMOR = "ID_WOTC_PHB24_SPELL_MAGE_ARMOR";
const TIEFLING_2014 = "ID_RACE_TIEFLING";
const THAUMATURGY = "ID_PHB_SPELL_THAUMATURGY";

const ABILITIES = { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 };

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** A 2024 character of `classId` with `background`, at `levels`. */
function build2024(
  label: string,
  classId: string,
  background: string,
  levels = 1,
): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  const id = service.createCharacter(label).id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, ABILITIES);
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find(
      (candidate) => candidate.type === type && !candidate.hasSelection,
    );
    if (!rule) throw new Error(`${label}: no pending ${type} rule`);
    service.setSelection(id, rule.identifier, elementId);
  };
  pick("Race", "ID_WOTC_PHB24_RACE_HUMAN");
  pick("Class", classId);
  pick("Background", background);
  for (let level = 2; level <= levels; level++) service.levelUp(id);
  return { service, id };
}

/** Resolves the pending rule named `name` to `elementId`. */
function pickNamed(service: CharacterService, id: string, name: string, elementId: string): void {
  const rule = pendingSelectionRules(service.getCharacter(id)).find(
    (candidate) => candidate.name === name && !candidate.hasSelection,
  );
  if (!rule) throw new Error(`no pending rule named '${name}'`);
  service.setSelection(id, rule.identifier, elementId);
}

/** Fills in a Magic Initiate chain: ability, two cantrips, one level-1 spell. */
function fillMagicInitiate(
  service: CharacterService,
  id: string,
  ability: string,
  cantrips: [string, string],
  spell: string,
): void {
  pickNamed(service, id, "Spellcasting Ability (Magic Initiate)", ability);
  pickNamed(service, id, "Cantrip (Magic Initiate)", cantrips[0]);
  pickNamed(service, id, "Cantrip (Magic Initiate)", cantrips[1]);
  pickNamed(service, id, "Level 1 Spell (Magic Initiate)", spell);
}

function sheetModel(service: CharacterService, id: string): ReturnType<typeof buildCharacterSheetModel> {
  return buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
}

function spellListText(model: ReturnType<typeof buildCharacterSheetModel>): string {
  return model.pages
    .filter((page) => page.templateKind === "spell-list")
    .flatMap((page) => page.sections)
    .flatMap((section) => section.rows)
    .flatMap((row) => (row.kind === "tokens" ? [...row.tokens] : []))
    .join(" ");
}

function spellCardTitles(model: ReturnType<typeof buildCharacterSheetModel>): string[] {
  return model.pages
    .filter((page) => page.templateKind === "spell-cards")
    .flatMap((page) => page.sections)
    .map((section) => (section.rows[0]?.kind === "tokens" ? section.rows[0].tokens.join(" ") : ""));
}

describe("a non-caster with Magic Initiate", () => {
  function fighterWithMagicInitiate(label: string): { service: CharacterService; id: string } {
    const built = build2024(label, FIGHTER, ACOLYTE);
    fillMagicInitiate(built.service, built.id, MI_CLERIC_WISDOM, [SACRED_FLAME, GUIDANCE], CURE_WOUNDS);
    return built;
  }

  it("projects one feature caster although the character has no caster block", () => {
    const { service, id } = fighterWithMagicInitiate("FighterMI");
    expect(service.getCharacter(id).magic?.casters ?? []).toEqual([]);

    const casters = service.getSpellcasting(id);
    expect(casters).toHaveLength(1);
    const caster = casters[0]!;
    expect(caster.kind).toBe("feature");
    // The ability sub-feature's <sheet alt> names the caster; its element name
    // is just "Wisdom".
    expect(caster.name).toBe("Magic Initiate (Cleric)");
    expect(caster.ability).toBe("Wisdom");
    expect(caster.requiresPreparation).toBe(false);
    expect(caster.prepareCount).toBe(0);
    expect(caster.slotsPerLevel).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Proficiency (2) + Wisdom modifier (0).
    expect(caster.attackModifier).toBe(2);
    expect(caster.saveDc).toBe(10);
    expect(caster.identifier).not.toBe("");
  });

  it("marks the level-1 spell always prepared with its free-cast usage", () => {
    const { service, id } = fighterWithMagicInitiate("FighterMIUsage");
    const caster = service.getSpellcasting(id)[0]!;

    expect(caster.knownSpells.map((spell) => spell.id)).toEqual([GUIDANCE, SACRED_FLAME, CURE_WOUNDS]);
    const cure = caster.knownSpells.find((spell) => spell.id === CURE_WOUNDS)!;
    expect(cure.isAlwaysPrepared).toBe(true);
    expect(cure.usage).toBe("1/Long Rest");
    // Cantrips are at-will, so they carry no allowance.
    expect(caster.knownSpells.find((spell) => spell.id === GUIDANCE)!.usage).toBeUndefined();
  });

  it("prints the feature caster on the spell pages with its usage and a card", () => {
    const { service, id } = fighterWithMagicInitiate("FighterMISheet");
    const model = sheetModel(service, id);
    const tokens = spellListText(model);

    expect(tokens).toContain("Magic");
    expect(tokens).toContain("Initiate");
    expect(tokens).toContain("Cure");
    // A feature caster has no slots, so its level block is admitted on the
    // known spells alone.
    expect(tokens).toContain("(1/Long");
    expect(spellCardTitles(model)).toContain("Cure Wounds");
  });

  it("files the spell card under the granting feature", () => {
    const { service, id } = fighterWithMagicInitiate("FighterMICard");
    const model = sheetModel(service, id);
    const cards = model.pages.find((page) => page.templateKind === "spell-cards")!;
    const text = cards.sections
      .flatMap((section) => section.rows)
      .flatMap((row) => (row.kind === "tokens" ? [...row.tokens] : []))
      .join(" ");
    expect(text).toContain("Magic Initiate (Cleric)");
  });

  it("leaves the exported document untouched", () => {
    const { service, id } = fighterWithMagicInitiate("FighterMIExport");
    const before = service.exportCharacterXml(id);
    service.getSpellcasting(id);
    buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(service.exportCharacterXml(id)).toBe(before);
  });
});

describe("a class caster with Magic Initiate", () => {
  function clericWithMagicInitiate(label: string): { service: CharacterService; id: string } {
    const built = build2024(label, CLERIC, SAGE);
    fillMagicInitiate(built.service, built.id, MI_WIZARD_INTELLIGENCE, [FIRE_BOLT, MAGE_HAND], MAGIC_MISSILE);
    return built;
  }

  it("keeps the class caster first and the feature caster second", () => {
    const { service, id } = clericWithMagicInitiate("ClericMI");
    const casters = service.getSpellcasting(id);

    expect(casters.map((caster) => [caster.name, caster.kind])).toEqual([
      ["Cleric", "class"],
      ["Magic Initiate (Wizard)", "feature"],
    ]);
    // The feat's own ability, not the Cleric's.
    expect(casters[1]!.ability).toBe("Intelligence");
  });

  it("fills the details-page spellcasting block from the class caster", () => {
    const { service, id } = clericWithMagicInitiate("ClericMIDetails");
    const model = sheetModel(service, id);
    expect(model.formValues?.["Spellcasting Class 2"]).toBe("Cleric");
    expect(model.formValues?.["SpellcastingAbility 2"]).toBe("Wisdom");
  });

  it("offers the feature caster's attack cantrip as an attack option", () => {
    const { service, id } = clericWithMagicInitiate("ClericMIAttacks");
    // The attack-options DTO keeps the magic rows opaque (the spellcasting
    // domain owns their shape), so they are read back through their contract.
    const options = service.getAttackOptions(id) as unknown as MagicAttackOptionsMerged;

    expect(options.casters.map((caster) => caster.name)).toContain("Magic Initiate (Wizard)");
    const firebolt = options.spells.find((spell) => spell.spellId === FIRE_BOLT);
    expect(firebolt).toBeDefined();
    expect(firebolt!.casterName).toBe("Magic Initiate (Wizard)");
    // The caster identifier is the one the DTO reports, so createAttack can
    // resolve it.
    const caster = service.getSpellcasting(id).find((entry) => entry.kind === "feature")!;
    expect(firebolt!.casterIdentifier).toBe(caster.identifier);
  });
});

describe("a paladin with Magic Initiate", () => {
  it("describes Mantle of Majesty as an activation allowing repeated Commands", () => {
    const { service, id } = build2024("Majesty", "ID_WOTC_PHB24_CLASS_BARD", ACOLYTE, 6);
    const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Archetype")!;
    service.setSelection(id, rule.identifier, "ID_WOTC_PHB24_ARCHETYPE_BARD_COLLEGE_OF_GLAMOUR");
    const command = service.getSpellcasting(id)[0]!.knownSpells.find((s) => s.id === "ID_WOTC_PHB24_SPELL_COMMAND")!;
    expect(command.usage).toBe("1 use/Long Rest");
    expect(command.usageNote).toContain("1 minute");
    expect(command.usageNote).toContain("level 3+");
  });

  it("projects the Fathomless free cast even without a declared sheet usage", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Tentacles").id;
    const pick = (type: string, target: string): void => {
      service.setSelection(id, pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type)!.identifier, target);
    };
    pick("Class", "ID_WOTC_PHB_CLASS_WARLOCK");
    pick("Archetype", "ID_WOTC_TCOE_ARCHETYPE_WARLOCK_THE_FATHOMLESS");
    while (service.getCharacter(id).level < 10) service.levelUp(id);
    const spell = service.getSpellcasting(id)[0]!.knownSpells.find((s) => s.id === "ID_PHB_SPELL_EVARDS_BLACK_TENTACLES")!;
    expect(spell.usage).toBe("1/Long Rest");
  });

  it("marks only the selected Lunar phase's first-level spell and retains the choice on reload", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Lunar").id;
    const pick = (type: string, target: string): void => {
      service.setSelection(id, pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection)!.identifier, target);
    };
    pick("Class", "ID_WOTC_PHB_CLASS_SORCERER");
    pick("Archetype", "ID_WOTC_DSDQ_ARCHETYPE_SORCERER_LUNAR_MAGIC");
    while (service.getCharacter(id).level < 5) service.levelUp(id);
    const phase = pendingSelectionRules(service.getCharacter(id)).find((r) => r.name === "Lunar Phase")!;
    const prefix = "ID_WOTC_DSDQ_ARCHETYPE_FEATURE_LUNAR_MAGIC_LUNAR_EMBODIMENT_";
    const usages = (s: CharacterService, key: string) => s.getSpellcasting(key)[0]!.knownSpells.filter((spell) => spell.usage).map((spell) => [spell.id, spell.usage]);
    service.setSelection(id, phase.identifier, `${prefix}FULL_MOON`);
    expect(usages(service, id)).toEqual([["ID_PHB_SPELL_SHIELD", "1/Long Rest"]]);
    service.setSelection(id, phase.identifier, `${prefix}NEW_MOON`);
    expect(usages(service, id)).toEqual([["ID_PHB_SPELL_RAY_OF_SICKNESS", "1/Long Rest"]]);
    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml("reload", service.exportCharacterXml(id));
    expect(usages(reader, "reload")).toEqual(usages(service, id));
  });

  it("labels Fateful Naming as a shared pool for Bane and Bless", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Onomancer").id;
    service.setAbilities(id, { ...ABILITIES, intelligence: 16 });
    const pick = (type: string, target: string): void => {
      service.setSelection(id, pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection)!.identifier, target);
    };
    pick("Class", "ID_WOTC_PHB_CLASS_WIZARD");
    service.levelUp(id);
    pick("Archetype", "ID_WOTC_UA20191003_ARCHETYPE_ONOMANCY");
    const spells = service.getSpellcasting(id)[0]!.knownSpells.filter((spell) => spell.usage);
    expect(spells.map((spell) => [spell.id, spell.usage])).toEqual([
      ["ID_PHB_SPELL_BANE", "3 shared/Long Rest"],
      ["ID_PHB_SPELL_BLESS", "3 shared/Long Rest"],
    ]);
    expect(spells.every((spell) => spell.usageNote?.includes("true name"))).toBe(true);
  });

  it("keeps the playtest Lunar allowance per spell for the selected phase", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Playtest Lunar").id;
    const pick = (type: string, target: string): void => {
      service.setSelection(id, pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection)!.identifier, target);
    };
    pick("Class", "ID_WOTC_PHB_CLASS_SORCERER");
    pick("Archetype", "ID_WOTC_UA20220308_ARCHETYPE_SORCERER_LUNAR_MAGIC");
    while (service.getCharacter(id).level < 3) service.levelUp(id);
    const phase = pendingSelectionRules(service.getCharacter(id)).find((r) => r.name === "Lunar Phase")!;
    service.setSelection(id, phase.identifier, "ID_WOTC_UA20220308_ARCHETYPE_FEATURE_LUNAR_MAGIC_LUNAR_EMBODIMENT_FULL_MOON");
    const spells = service.getSpellcasting(id)[0]!.knownSpells.filter((spell) => spell.usage);
    expect(spells.map((spell) => [spell.id, spell.usage])).toEqual([
      ["ID_PHB_SPELL_FAERIE_FIRE", "1/Long Rest"],
      ["ID_PHB_SPELL_MOONBEAM", "1/Long Rest"],
    ]);
    expect(spells.every((spell) => spell.usageNote?.includes("once per spell"))).toBe(true);
  });

  const DIVINE_SMITE = "ID_WOTC_PHB24_SPELL_DIVINE_SMITE";

  function paladinWithMagicInitiate(label: string): { service: CharacterService; id: string } {
    const built = build2024(label, PALADIN, ACOLYTE, 3);
    fillMagicInitiate(built.service, built.id, MI_CLERIC_WISDOM, [SACRED_FLAME, GUIDANCE], CURE_WOUNDS);
    return built;
  }

  it("gives both casters' free casts their usage", () => {
    const { service, id } = paladinWithMagicInitiate("PaladinMIUsage");
    const casters = service.getSpellcasting(id);
    const paladin = casters.find((caster) => caster.name === "Paladin")!;
    const initiate = casters.find((caster) => caster.name === "Magic Initiate (Cleric)")!;

    // Paladin's Smite: "you can cast it without expending a spell slot, but you
    // must finish a Long Rest before you can cast it in this way again".
    const smite = paladin.knownSpells.find((spell) => spell.id === DIVINE_SMITE)!;
    expect(smite.isAlwaysPrepared).toBe(true);
    expect(smite.usage).toBe("1/Long Rest");
    // The rest of the Paladin list is cast from slots alone.
    expect(paladin.knownSpells.filter((spell) => spell.usage !== undefined).map((spell) => spell.id)).toEqual([DIVINE_SMITE]);
    expect(initiate.knownSpells.find((spell) => spell.id === CURE_WOUNDS)!.usage).toBe("1/Long Rest");
  });

  it("carries the usage onto the spell page layout", () => {
    const { service, id } = paladinWithMagicInitiate("PaladinMILayout");
    const layouts = sheetModel(service, id).pages
      .filter((page) => page.templateKind === "spell-list")
      .flatMap((page) => page.spellcasting ?? []);
    const entry = (caster: string, name: string) => layouts
      .filter((layout) => layout.name === caster)
      .flatMap((layout) => layout.sections)
      .flatMap((section) => section.spells)
      .find((spell) => spell.name === name);

    expect(entry("Paladin", "Divine Smite")?.usage).toBe("1/Long Rest");
    expect(entry("Magic Initiate (Cleric)", "Cure Wounds")?.usage).toBe("1/Long Rest");
    expect(entry("Magic Initiate (Cleric)", "Guidance")?.usage).toBeUndefined();
  });

  it("resolves a class grant's templated allowance", () => {
    // Favored Enemy declares usage="{{favored enemy:usage}}/Long Rest" and
    // casts Hunter's Mark "twice without expending a spell slot" at level 1.
    const { service, id } = build2024("RangerFavoredEnemy", "ID_WOTC_PHB24_CLASS_RANGER", "ID_WOTC_PHB24_BACKGROUND_SOLDIER");
    const ranger = service.getSpellcasting(id).find((caster) => caster.name === "Ranger")!;
    const mark = ranger.knownSpells.find((spell) => spell.id === "ID_WOTC_PHB24_SPELL_HUNTERS_MARK")!;
    expect(mark.usage).toBe("2/Long Rest");
  });
});

describe("a 2014 racial spell select", () => {
  it("projects the High Elf cantrip as an Intelligence feature caster", () => {
    const { service, id } = buildCharacter(library, {
      id: "HighElfFighterFeature",
      raceId: ID.RACE_ELF,
      subRaceId: ID.SUB_RACE_HIGH_ELF,
      classId: ID.CLASS_FIGHTER,
    });
    pickNamed(service, id, "Wizard Cantrip (High Elf)", "ID_PHB_SPELL_FIRE_BOLT");

    const casters = service.getSpellcasting(id);
    expect(casters).toHaveLength(1);
    expect(casters[0]!.kind).toBe("feature");
    // No sub-feature nominates an ability and the character has no class
    // caster, so the projection falls back to Intelligence.
    expect(casters[0]!.ability).toBe("Intelligence");
    expect(casters[0]!.knownSpells.map((spell) => spell.id)).toEqual(["ID_PHB_SPELL_FIRE_BOLT"]);
  });
});

describe("caster-less spell grants", () => {
  it("puts a feat's granted and chosen spells under one banner with its usage", () => {
    const { service, id } = build2024("FeyTouched", FIGHTER, "ID_WOTC_PHB24_BACKGROUND_SOLDIER", 4);
    // Fey-Touched is a General feat, so it takes the level-4 ASI slot.
    const asi = pendingSelectionRules(service.getCharacter(id)).find(
      (rule) => rule.type === "Feat" && rule.name.startsWith("Ability Score Improvement") && !rule.hasSelection,
    )!;
    service.setSelection(id, asi.identifier, FEY_TOUCHED);
    pickNamed(service, id, "Ability Score Increase (Fey-Touched)", FEY_TOUCHED_CHARISMA);
    pickNamed(service, id, "Spell (Fey-Touched)", BLESS);

    const casters = service.getSpellcasting(id);
    expect(casters).toHaveLength(1);
    const caster = casters[0]!;
    expect(caster.name).toBe("Fey-Touched");
    expect(caster.ability).toBe("Charisma");
    // The chosen level-1 spell and the granted Misty Step share the caster.
    expect(caster.knownSpells.map((spell) => spell.id)).toEqual([BLESS, MISTY_STEP]);
    // "You can cast each of these spells without expending a spell slot ...
    // until you finish a Long Rest" earns both the allowance.
    expect(caster.knownSpells.map((spell) => spell.usage)).toEqual(["1/Long Rest", "1/Long Rest"]);
    expect(caster.knownSpells.every((spell) => spell.isAlwaysPrepared)).toBe(true);
  });

  it("projects a racial cantrip grant with no free-cast allowance", () => {
    const { service, id } = buildCharacter(library, {
      id: "TieflingFighterLegacy",
      raceId: TIEFLING_2014,
      subRaceId: "",
      classId: ID.CLASS_FIGHTER,
    });

    const casters = service.getSpellcasting(id);
    expect(casters).toHaveLength(1);
    expect(casters[0]!.name).toBe("Infernal Legacy");
    expect(casters[0]!.knownSpells.map((spell) => spell.id)).toEqual([THAUMATURGY]);
    // The trait's text never says the spell is cast without a spell slot, so
    // no allowance is claimed for it (and a cantrip never carries one).
    expect(casters[0]!.knownSpells[0]!.usage).toBeUndefined();
  });

  it("leaves an at-will invocation grant unmarked", () => {
    const { service, id } = build2024("ArmorOfShadows", WARLOCK, "ID_WOTC_PHB24_BACKGROUND_SOLDIER", 2);
    pickNamed(service, id, "Eldritch Invocation (Warlock 1)", ARMOR_OF_SHADOWS);

    const feature = service.getSpellcasting(id).find((caster) => caster.kind === "feature")!;
    expect(feature.name).toBe("Armor of Shadows");
    expect(feature.knownSpells.map((spell) => spell.id)).toEqual([MAGE_ARMOR]);
    // "You can cast Mage Armor on yourself without expending a spell slot" is
    // at-will: no rest recharges it, so it earns no per-rest allowance.
    expect(feature.knownSpells[0]!.usage).toBeUndefined();
  });

  it("leaves a grant that names a caster to that caster", () => {
    // Divine Smite is granted `spellcasting="Paladin"`, so it belongs to the
    // Paladin block (spelllist.ts) and must not spawn a feature caster.
    const { service, id } = build2024("PaladinNoFeature", PALADIN, "ID_WOTC_PHB24_BACKGROUND_SOLDIER", 2);
    const casters = service.getSpellcasting(id);
    expect(casters.map((caster) => caster.kind)).toEqual(["class"]);
    expect(casters[0]!.knownSpells.some((spell) => spell.id === "ID_WOTC_PHB24_SPELL_DIVINE_SMITE")).toBe(true);
  });
});
