/**
 * Attacks surface: DTO shape, automatic weapon rows (equip/unequip/ordering),
 * manual + calculated attacks, computation breakdown, visibility/move/delete,
 * and .dnd5e serialization. These expectations are the specification for the
 * attacks surface; changing one is a deliberate behaviour change, not a rebaseline.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildAttacksDto, type AttackDto } from "./attacks.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { parseSpellAttack } from "../magic/reconcile.js";
import { applySpellRiders } from "../magic/spell-riders.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CORPUS_ROOT = join(ROOT, "third-party", "elements");

let libraryPromise: Promise<ElementLibrary> | null = null;
const library = (): Promise<ElementLibrary> => {
  libraryPromise ??= buildLibrary(CORPUS_ROOT);
  return libraryPromise;
};

const freshService = async (): Promise<CharacterService> => new CharacterService(undefined, await library());

const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
const RAPIER = "ID_WOTC_PHB_WEAPON_RAPIER";
const QUARTERSTAFF = "ID_WOTC_PHB_WEAPON_QUARTERSTAFF";
const STAFF_OF_POWER = "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER";
const SHORTBOW = "ID_WOTC_PHB_WEAPON_SHORTBOW";
const BLOWGUN = "ID_WOTC_PHB_WEAPON_BLOWGUN";
const WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";
const WARLOCK = "ID_WOTC_PHB_CLASS_WARLOCK";
const ELDRITCH_BLAST = "ID_PHB_SPELL_ELDRITCH_BLAST";
const DRUID = "ID_WOTC_PHB_CLASS_DRUID";
const MONK_2014 = "ID_WOTC_PHB_CLASS_MONK";
const MONK_2024 = "ID_WOTC_PHB24_CLASS_MONK";
const ELDRITCH_CLAW_TATTOO = "ID_WOTC_UA20200326_MAGIC_ITEM_ELDRITCH_CLAW_TATTOO";
const INSIGNIA_OF_CLAWS = "ID_WOTC_HOTDQ_MAGIC_ITEM_INSIGNIA_OF_CLAWS";
const TCOE_CLAW_TATTOO = "ID_WOTC_TCOE_MAGIC_ITEM_TATTOO_ELDRITCH_CLAW_TATTOO";
const WRAPS_VERY_RARE = "ID_WOTC_BOMT_MAGIC_ITEM_WRAPS_OF_UNARMED_PROWESS_VERY_RARE";
const TAVERN_BRAWLER = "ID_PHB_FEAT_TAVERNBRAWLER";
const PHB24_UNARMED_FIGHTING = "ID_WOTC_PHB24_FEAT_UNARMED_FIGHTING";
const FIGHTER_2024 = "ID_WOTC_PHB24_CLASS_FIGHTER";
const MC_FIGHTER = "ID_WOTC_PHB_MULTICLASS_FIGHTER";
const OPTION_MULTICLASS = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";

const setScores = (service: CharacterService, id: string): void => {
  service.setAbilities(id, {
    strength: 15,
    dexterity: 13,
    constitution: 14,
    intelligence: 10,
    wisdom: 12,
    charisma: 8,
  });
};

/** Selects the Fighter class and levels to 3 (the scenario's build). */
const makeFighter = async (service: CharacterService, id: string): Promise<void> => {
  const lib = await library();
  const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
  const fighter = selectionOptions(service.getCharacter(id), lib, rule).find((o) => o.id === "ID_WOTC_PHB_CLASS_FIGHTER")!;
  service.setSelection(id, rule.identifier, fighter.id);
  service.levelUpMode(id, { mode: "main" });
  service.levelUpMode(id, { mode: "main" });
};

/** Selects Wizard and resolves the first Spell rule to `spellId`. */
const makeWizardKnowing = async (service: CharacterService, id: string, spellId: string): Promise<void> => {
  const lib = await library();
  const classRule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
  service.setSelection(id, classRule.identifier, WIZARD);
  const spellRule = pendingSelectionRules(service.getCharacter(id)).find(
    (r) => r.type === "Spell" && selectionOptions(service.getCharacter(id), lib, r).some((o) => o.id === spellId),
  );
  if (spellRule === undefined) throw new Error(`no Spell rule offering '${spellId}'`);
  service.setSelection(id, spellRule.identifier, spellId, 1);
};

const weaponRow = (rows: AttackDto[], name: string): AttackDto => {
  const row = rows.find((a) => a.name === name);
  if (!row) throw new Error(`attack row '${name}' missing`);
  return row;
};

const unarmedRow = (rows: AttackDto[]): AttackDto => {
  const row = rows.find((a) => a.kind === "unarmed");
  if (!row) throw new Error("unarmed attack row missing");
  return row;
};

/** Selects `classId` as the character's class. */
const makeClass = async (service: CharacterService, id: string, classId: string): Promise<void> => {
  const lib = await library();
  const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
  const chosen = selectionOptions(service.getCharacter(id), lib, rule).find((o) => o.id === classId);
  if (chosen === undefined) throw new Error(`class '${classId}' is not selectable`);
  service.setSelection(id, rule.identifier, chosen.id);
};

/** Adds main-class levels until the character reaches `target`. */
const levelTo = (service: CharacterService, id: string, target: number): void => {
  while (service.getCharacter(id).level < target) {
    service.levelUpMode(id, { mode: "main" });
  }
};

/** Registers a feat directly (the granted-feat path, not an ASI selection). */
const grantFeat = (service: CharacterService, id: string, featId: string): void => {
  service.addGrantedFeat(id, { featId });
};

/** Adds an item and turns on whatever gates its benefits (equipping, attuning). */
const wear = (service: CharacterService, id: string, itemId: string): void => {
  const added = service.addItem(id, { itemId, amount: 1, baseElementId: null });
  const item = added.items.find((i) => i.itemId === itemId);
  if (item === undefined) throw new Error(`item '${itemId}' was not added`);
  const location = item.equipLocations[0];
  if (item.isEquippable && location !== undefined) service.equipItem(id, item.identifier, location);
  if (item.isAttunable) service.attuneItem(id, item.identifier, true);
};

describe("attacks DTO", () => {
  it("returns an empty list and the pinned options on a fresh character", async () => {
    const service = await freshService();
    const id = service.createCharacter("Fresh Attacks").id;
    expect(service.getAttacks(id)).toEqual([]);
    expect(service.getAttackOptions(id)).toEqual({
      abilities: [
        { name: "Strength", abbreviation: "STR" },
        { name: "Dexterity", abbreviation: "DEX" },
        { name: "Constitution", abbreviation: "CON" },
        { name: "Intelligence", abbreviation: "INT" },
        { name: "Wisdom", abbreviation: "WIS" },
        { name: "Charisma", abbreviation: "CHA" },
      ],
      casters: [],
      spells: [],
      unarmed: {
        name: "Unarmed Strike",
        range: "5 ft",
        bonus: "+2 vs AC",
        damage: "1+0 bludgeoning",
        description: "",
      },
    });
  });

  it("auto-creates a weapon row on equip with the pinned generated fields", async () => {
    const service = await freshService();
    const id = service.createCharacter("Sword Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const rows = service.getAttacks(id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toBe("Longsword");
    expect(row.range).toBe("5 ft");
    expect(row.bonus).toBe("+2 vs AC");
    expect(row.damage).toBe("1d8+2 slashing");
    expect(row.description).toBe("Versatile");
    expect(row.isDisplayed).toBe(true);
    expect(row.isAutomatic).toBe(true);
    expect(row.isCurrentlyEquipped).toBe(true);
    expect(row.sheetPosition).toBe(1);
    expect(row.kind).toBe("weapon");
    expect(row.abilityMode).toBe("default");
    expect(row.ability).toBe("Strength");
    expect(row.defaultAbility).toBe("Strength");
    expect(row.generated).toEqual({
      name: "Longsword",
      range: "5 ft",
      bonus: "+2 vs AC",
      damage: "1d8+2 slashing",
      description: "Versatile",
    });
    expect(row.overriddenFields).toEqual([]);
    expect(row.calculation).toBeNull();
    expect(row.source).toBeNull();
    expect(row.computation).toBeNull();
  });

  it("swaps to the versatile die while the weapon is wielded two-handed", async () => {
    const service = await freshService();
    const id = service.createCharacter("Versatile Attacks").id;
    setScores(service, id);
    const added = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const sword = added.items.find((i) => i.itemId === LONGSWORD)!;
    service.equipItem(id, sword.identifier, "primary-twohanded");
    expect(weaponRow(service.getAttacks(id), "Longsword").damage).toBe("1d10+2 slashing");
    service.equipItem(id, sword.identifier, "primary");
    expect(weaponRow(service.getAttacks(id), "Longsword").damage).toBe("1d8+2 slashing");
  });

  it("numbers displayed rows in stored order; a newly equipped weapon goes to position 1", async () => {
    const service = await freshService();
    const id = service.createCharacter("Order Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const staff = service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF }).items.find(
      (i) => i.name === "Staff of Power",
    )!;
    // staff added while the longsword holds primary: not equipped, no row yet
    expect(service.getAttacks(id).map((a) => a.name)).toEqual(["Longsword"]);
    service.equipItem(id, staff.identifier, "primary");
    let rows = service.getAttacks(id);
    expect(rows.map((a) => [a.name, a.sheetPosition, a.isCurrentlyEquipped])).toEqual([
      ["Staff of Power", 1, true],
      ["Longsword", 2, false],
    ]);
    // unequip keeps the automatic row
    service.equipItem(id, staff.identifier, "none");
    rows = service.getAttacks(id);
    expect(rows.map((a) => [a.name, a.sheetPosition, a.isCurrentlyEquipped])).toEqual([
      ["Staff of Power", 1, false],
      ["Longsword", 2, false],
    ]);
  });

  it("adds the staff's enhancement to attack and damage, and applies proficiency per weapon", async () => {
    const service = await freshService();
    const id = service.createCharacter("Magic Attacks").id;
    setScores(service, id);
    // staff of power auto-equips on a fresh character
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    // Unattuned, the attunement-requiring staff fights as a mundane
    // quarterstaff: str 15 (+2) only, no enhancement.
    const unattuned = weaponRow(service.getAttacks(id), "Staff of Power");
    expect(unattuned.bonus).toBe("+2 vs AC");
    expect(unattuned.damage).toBe("1d6+2 bludgeoning");
    service.attuneItem(id, service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier, true);
    const staff = weaponRow(service.getAttacks(id), "Staff of Power");
    // str 15 (+2) + prof 0 (no class) + enhancement 2
    expect(staff.bonus).toBe("+4 vs AC");
    expect(staff.damage).toBe("1d6+4 bludgeoning");
  });

  it("grants proficiency for weapons the character is proficient with", async () => {
    const service = await freshService();
    const lib = await library();
    const id = service.createCharacter("Wizard Attacks").id;
    setScores(service, id);
    const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
    const wizard = selectionOptions(service.getCharacter(id), lib, rule).find((o) => o.id === WIZARD)!;
    service.setSelection(id, rule.identifier, wizard.id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const staff = service.addItem(id, { itemId: QUARTERSTAFF, amount: 1, baseElementId: null }).items.find(
      (i) => i.itemId === QUARTERSTAFF,
    )!;
    service.equipItem(id, staff.identifier, "secondary");
    const rows = service.getAttacks(id);
    // longsword: martial, wizard not proficient -> no proficiency bonus
    expect(weaponRow(rows, "Longsword").bonus).toBe("+2 vs AC");
    // quarterstaff: simple, wizard proficient -> +2 proficiency
    expect(weaponRow(rows, "Quarterstaff").bonus).toBe("+4 vs AC");
  });

  it("recomputes weapon rows from current scores and picks the finesse default ability", async () => {
    const service = await freshService();
    const id = service.createCharacter("Finesse Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    let rows = service.getAttacks(id);
    expect(weaponRow(rows, "Longsword").bonus).toBe("+2 vs AC");
    service.setAbilities(id, { strength: 18, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    rows = service.getAttacks(id);
    expect(weaponRow(rows, "Longsword").bonus).toBe("+4 vs AC");
    expect(weaponRow(rows, "Longsword").damage).toBe("1d8+4 slashing");

    service.setAbilities(id, { strength: 10, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    const rapier = service.addItem(id, { itemId: RAPIER, amount: 1, baseElementId: null }).items.find(
      (i) => i.itemId === RAPIER,
    )!;
    service.equipItem(id, rapier.identifier, "secondary");
    const rapierRow = weaponRow(service.getAttacks(id), "Rapier");
    expect(rapierRow.ability).toBe("Dexterity");
    expect(rapierRow.bonus).toBe("+3 vs AC");
  });

  it("chooses a finesse weapon ability from final scores after content bonuses", async () => {
    const service = await freshService();
    const id = service.createCharacter("Final Finesse Attacks").id;
    service.setAbilities(id, {
      strength: 15,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 12,
      charisma: 8,
    });
    const lib = await library();
    const raceRule = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race")!;
    const elf = selectionOptions(service.getCharacter(id), lib, raceRule).find((option) => option.id === "ID_RACE_ELF")!;
    service.setSelection(id, raceRule.identifier, elf.id);

    service.addItem(id, { itemId: RAPIER, amount: 1, baseElementId: null });
    const rapier = weaponRow(service.getAttacks(id), "Rapier");

    expect(rapier.ability).toBe("Dexterity");
    expect(rapier.bonus).toBe("+3 vs AC");
    expect(rapier.damage).toBe("1d8+3 piercing");
  });

  it("uses the weapon range setter and property list for ranged weapons", async () => {
    const service = await freshService();
    const id = service.createCharacter("Ranged Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: SHORTBOW, amount: 1, baseElementId: null });
    const row = weaponRow(service.getAttacks(id), "Shortbow");
    expect(row.range).toBe("80/320");
    expect(row.description).toBe("Ammunition, Two-Handed");
    expect(row.ability).toBe("Dexterity");
    // dexterity 13 -> +1; no class -> no proficiency
    expect(row.bonus).toBe("+1 vs AC");
    expect(row.damage).toBe("1d6+1 piercing");
  });

  it("appends manual attacks at the end with all fields overridden", async () => {
    const service = await freshService();
    const id = service.createCharacter("Manual Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    const rows = service.createAttack(id, {
      mode: "manual",
      name: "Reference Bolt",
      range: "60 ft.",
      bonus: "+4 vs AC",
      damage: "1d8 force",
      description: "A fixture-only custom attack.",
    });
    expect(rows).toHaveLength(3);
    const row = rows[2]!;
    expect(row.name).toBe("Reference Bolt");
    expect(row.sheetPosition).toBe(3);
    expect(row.kind).toBe("manual");
    expect(row.isAutomatic).toBe(false);
    expect(row.isCurrentlyEquipped).toBe(false);
    expect(row.ability).toBeNull();
    expect(row.defaultAbility).toBeNull();
    expect(row.abilityMode).toBeNull();
    expect(row.generated).toBeNull();
    expect(row.overriddenFields).toEqual(["name", "range", "bonus", "damage", "description"]);
    expect(row.calculation).toBeNull();
    expect(row.computation).toBeNull();
  });

  it("creates calculated attacks with the pinned computation breakdown", async () => {
    const service = await freshService();
    const id = service.createCharacter("Calculated Attacks").id;
    setScores(service, id);
    const rows = service.createAttack(id, {
      mode: "calculated",
      name: "Calculated Strike",
      range: "5 ft.",
      calculationSource: "ability",
      abilityName: "Charisma",
      useProficiency: true,
      attackMiscBonus: 1,
      damageDice: "1d6",
      addAbilityToDamage: true,
      damageMiscBonus: 0,
      damageType: "force",
    });
    const row = rows[0]!;
    expect(row.name).toBe("Calculated Strike");
    expect(row.range).toBe("5 ft.");
    expect(row.bonus).toBe("+2 vs AC");
    expect(row.damage).toBe("1d6-1 force");
    expect(row.description).toBe("");
    expect(row.kind).toBe("calculated");
    expect(row.ability).toBe("Charisma");
    expect(row.abilityMode).toBeNull();
    expect(row.defaultAbility).toBeNull();
    expect(row.generated).toEqual({
      name: "",
      range: "",
      bonus: "+2 vs AC",
      damage: "1d6-1 force",
      description: "",
    });
    expect(row.overriddenFields).toEqual(["name", "range"]);
    expect(row.calculation).toEqual({
      source: "ability",
      ability: "Charisma",
      useProficiency: true,
      attackMiscBonus: 1,
      damageDice: "1d6",
      addAbilityToDamage: true,
      damageMiscBonus: 0,
      damageType: "force",
      casterIdentifier: null,
    });
    expect(row.source).toBeNull();
    expect(row.computation).toEqual({
      attackBonusContributions: [
        { label: "Charisma", value: -1 },
        { label: "Proficiency", value: 2 },
        { label: "Miscellaneous", value: 1 },
      ],
      appliedModifiers: [],
      sourceNotes: [],
      attackCount: 1,
      isPerHit: true,
    });
  });

  it("creates a linked attack row from a known spell and preserves it on reload", async () => {
    const service = await freshService();
    const id = service.createCharacter("spell-attacks").id;
    setScores(service, id);
    await makeWizardKnowing(service, id, "ID_PHB_SPELL_FIRE_BOLT");
    const option = service.getAttackOptions(id).spells.find(
      (candidate) => (candidate as { spellId?: string }).spellId === "ID_PHB_SPELL_FIRE_BOLT",
    ) as {
      casterIdentifier: string;
      spellId: string;
      spellName: string;
      range: string;
      bonus: string;
      damage: string;
      description: string;
      beamCount: number;
    };

    const rows = service.createAttack(id, {
      mode: "spell",
      casterIdentifier: option.casterIdentifier,
      spellId: option.spellId,
      name: null,
      range: null,
      bonus: null,
      damage: null,
      description: null,
    });

    const row = rows.at(-1)!;
    expect(row).toMatchObject({
      name: option.spellName,
      range: option.range,
      bonus: option.bonus,
      damage: option.damage,
      description: option.description,
      kind: "spell",
      generated: {
        name: option.spellName,
        range: option.range,
        bonus: option.bonus,
        damage: option.damage,
        description: option.description,
      },
      overriddenFields: [],
      calculation: null,
      source: {
        casterIdentifier: option.casterIdentifier,
        spellId: option.spellId,
        beamCount: option.beamCount,
      },
    });

    const overridden = service.updateAttack(id, row.id, {
      description: "A custom Fire Bolt description.",
      resetFields: [],
    }).at(-1)!;
    expect(overridden.description).toBe("A custom Fire Bolt description.");
    expect(overridden.overriddenFields).toEqual(["description"]);

    const restored = service.updateAttack(id, row.id, {
      description: null,
      resetFields: ["description"],
    }).at(-1)!;
    expect(restored.description).toBe(option.description);
    expect(restored.overriddenFields).toEqual([]);

    const exported = service.exportCharacterXml(id);
    expect(exported).toContain('kind="spell"');
    expect(exported).toContain(`spell-id="${option.spellId}"`);

    const reloaded = await freshService();
    reloaded.importCharacterXml("reloaded-spell-attacks", exported);
    reloaded.getAttackOptions("reloaded-spell-attacks");
    expect(reloaded.getAttacks("reloaded-spell-attacks").at(-1)).toMatchObject({
      name: option.spellName,
      kind: "spell",
      generated: { damage: option.damage },
      overriddenFields: [],
      source: { spellId: option.spellId },
    });
  });

  it("omits zero-value contributions and keeps a zero ability contribution", async () => {
    const service = await freshService();
    const id = service.createCharacter("Contribution Attacks").id;
    setScores(service, id);
    // charisma 8: -1; proficiency on; misc 0 -> contribution list has no Miscellaneous
    const withProf = service.createAttack(id, {
      mode: "calculated",
      name: "With Prof",
      calculationSource: "ability",
      abilityName: "Charisma",
      useProficiency: true,
      attackMiscBonus: 0,
      damageDice: "1d4",
      addAbilityToDamage: false,
      damageMiscBonus: 2,
      damageType: "fire",
    })[0]!;
    expect(withProf.computation!.attackBonusContributions).toEqual([
      { label: "Charisma", value: -1 },
      { label: "Proficiency", value: 2 },
    ]);
    expect(withProf.bonus).toBe("+1 vs AC");
    expect(withProf.damage).toBe("1d4+2 fire");
    // no proficiency, no misc: only the ability contribution; zero damage bonus is omitted
    const raw = service.createAttack(id, {
      mode: "calculated",
      name: "Raw",
      calculationSource: "ability",
      abilityName: "Strength",
      useProficiency: false,
      attackMiscBonus: 0,
      damageDice: "1d4",
      addAbilityToDamage: false,
      damageMiscBonus: 0,
      damageType: "cold",
    }).find((a) => a.name === "Raw")!;
    expect(raw.computation!.attackBonusContributions).toEqual([{ label: "Strength", value: 2 }]);
    expect(raw.damage).toBe("1d4 cold");
  });

  it("updates a weapon row with an explicit ability override without marking bonus/damage overridden", async () => {
    const service = await freshService();
    const id = service.createCharacter("Override Attacks").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    service.attuneItem(id, service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier, true);
    const rows = service.getAttacks(id);
    const staff = weaponRow(rows, "Staff of Power");
    expect(staff.bonus).toBe("+6 vs AC");
    expect(staff.damage).toBe("1d6+4 bludgeoning");
    const updated = service.updateAttack(id, staff.id, {
      abilityMode: "explicit",
      abilityName: "Charisma",
      description: "Pact weapon ability override.",
    });
    const after = weaponRow(updated, "Staff of Power");
    expect(after.bonus).toBe("+3 vs AC");
    expect(after.damage).toBe("1d6+1 bludgeoning");
    expect(after.ability).toBe("Charisma");
    expect(after.defaultAbility).toBe("Strength");
    expect(after.abilityMode).toBe("explicit");
    expect(after.overriddenFields).toEqual(["description"]);
    // the generated block is the item's own row with the effective ability
    expect(after.generated).toEqual({
      name: "Staff of Power",
      range: "5 ft",
      bonus: "+3 vs AC",
      damage: "1d6+1 bludgeoning",
      description: "Versatile",
    });
    // resetting to default restores the default ability
    const reset = weaponRow(service.updateAttack(id, staff.id, { abilityMode: "default" }), "Staff of Power");
    expect(reset.ability).toBe("Strength");
    expect(reset.abilityMode).toBe("default");
    expect(reset.bonus).toBe("+6 vs AC");
  });

  it("resets nullable generated weapon overrides without changing Staff calculations or custom attacks", async () => {
    const service = await freshService();
    const id = service.createCharacter("Nullable Attack Overrides").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    service.attuneItem(id, service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier, true);

    const staff = weaponRow(service.getAttacks(id), "Staff of Power");
    const customized = weaponRow(service.updateAttack(id, staff.id, {
      abilityMode: "explicit",
      abilityName: "Charisma",
      name: "Homebrew Staff",
      range: "30 ft",
    }), "Homebrew Staff");
    expect(customized.bonus).toBe("+3 vs AC");
    expect(customized.damage).toBe("1d6+1 bludgeoning");
    expect(customized.overriddenFields).toEqual(["name", "range"]);

    const reset = weaponRow(service.updateAttack(id, staff.id, {
      name: null,
      range: null,
    }), "Staff of Power");
    expect(reset).toMatchObject({
      name: "Staff of Power",
      range: "5 ft",
      bonus: "+3 vs AC",
      damage: "1d6+1 bludgeoning",
      overriddenFields: [],
    });

    service.updateAttack(id, staff.id, { name: "Homebrew Staff", range: "30 ft" });
    const undefinedReset = weaponRow(service.updateAttack(id, staff.id, {
      name: undefined,
      range: undefined,
    }), "Staff of Power");
    expect(undefinedReset.overriddenFields).toEqual([]);

    service.createAttack(id, {
      mode: "manual",
      name: "Homebrew Burst",
      range: "10 ft",
      bonus: "+3 vs AC",
      damage: "1d6 thunder",
      description: "A custom burst attack.",
    });
    const exported = service.exportCharacterXml(id);
    expect(exported).not.toMatch(/(?:name|range|attack|damage)="(?:null|NULL)"/);
    expect(exported).toContain('name="Staff of Power" range="5 ft"');
    expect(exported).toContain('name="Homebrew Burst"');

    const reloaded = await freshService();
    reloaded.importCharacterXml("nullable-attack-reload", exported);
    expect(weaponRow(reloaded.getAttacks("nullable-attack-reload"), "Staff of Power")).toMatchObject({
      name: "Staff of Power",
      range: "5 ft",
      bonus: "+3 vs AC",
      damage: "1d6+1 bludgeoning",
      overriddenFields: [],
    });
    expect(reloaded.getAttacks("nullable-attack-reload")).toContainEqual(
      expect.objectContaining({
        name: "Homebrew Burst",
        range: "10 ft",
        bonus: "+3 vs AC",
        damage: "1d6 thunder",
      }),
    );
  });

  it("hides a row (sheetPosition null, others renumber) and restores it on show", async () => {
    const service = await freshService();
    const id = service.createCharacter("Hide Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    service.createAttack(id, { mode: "manual", name: "Reference Bolt", range: "60 ft.", bonus: "+4 vs AC", damage: "1d8 force", description: "x" });
    const staff = weaponRow(service.getAttacks(id), "Staff of Power");
    const hidden = service.setAttackVisibility(id, staff.id, false);
    expect(weaponRow(hidden, "Staff of Power").isDisplayed).toBe(false);
    expect(weaponRow(hidden, "Staff of Power").sheetPosition).toBeNull();
    expect(weaponRow(hidden, "Longsword").sheetPosition).toBe(1);
    expect(weaponRow(hidden, "Reference Bolt").sheetPosition).toBe(2);
    const shown = service.setAttackVisibility(id, staff.id, true);
    expect(weaponRow(shown, "Staff of Power").sheetPosition).toBe(1);
    expect(weaponRow(shown, "Longsword").sheetPosition).toBe(2);
    expect(weaponRow(shown, "Reference Bolt").sheetPosition).toBe(3);
  });

  it("moves rows by swapping stored order; edge moves are no-ops", async () => {
    const service = await freshService();
    const id = service.createCharacter("Move Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    let rows = service.getAttacks(id);
    const staff = weaponRow(rows, "Staff of Power");
    rows = service.moveAttack(id, staff.id, "down");
    expect(rows.map((a) => [a.name, a.sheetPosition])).toEqual([
      ["Longsword", 1],
      ["Staff of Power", 2],
    ]);
    rows = service.moveAttack(id, staff.id, "up");
    expect(rows.map((a) => [a.name, a.sheetPosition])).toEqual([
      ["Staff of Power", 1],
      ["Longsword", 2],
    ]);
    // moving the first row up is a no-op
    rows = service.moveAttack(id, staff.id, "up");
    expect(rows.map((a) => a.name)).toEqual(["Staff of Power", "Longsword"]);
  });

  it("rejects deleting an automatic attack while its weapon is equipped", async () => {
    const service = await freshService();
    const id = service.createCharacter("Delete Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const row = service.getAttacks(id)[0]!;
    expect(() => service.deleteAttack(id, row.id)).toThrow(/automatic attack cannot be deleted/i);
    service.equipItem(id, service.getInventory(id).items[0]!.identifier, "none");
    const rows = service.deleteAttack(id, row.id);
    expect(rows).toEqual([]);
  });

  it("removes the automatic row when its item is removed from inventory", async () => {
    const service = await freshService();
    const id = service.createCharacter("Item Remove Attacks").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(service.getAttacks(id)).toHaveLength(1);
    service.removeItem(id, service.getInventory(id).items[0]!.identifier);
    expect(service.getAttacks(id)).toEqual([]);
  });

  it("requires a name when creating attacks", async () => {
    const service = await freshService();
    const id = service.createCharacter("Validate Attacks").id;
    expect(() => service.createAttack(id, { mode: "manual" })).toThrow(/name is required/i);
    expect(() => service.createAttack(id, { mode: "spell" })).toThrow(/known attack spell/i);
  });

  it("serializes the attacks section with the exact node shape", async () => {
    const service = await freshService();
    const id = service.createCharacter("Serialize Attacks").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    // Attune first: the auto-inserted row bakes its values at equip time.
    service.attuneItem(id, service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier, true);
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    service.createAttack(id, {
      mode: "manual",
      name: "Reference Bolt",
      range: "60 ft.",
      bonus: "+4 vs AC",
      damage: "1d8 force",
      description: "A fixture-only custom attack.",
    });
    service.createAttack(id, {
      mode: "calculated",
      name: "Calculated Strike",
      range: "5 ft.",
      calculationSource: "ability",
      abilityName: "Charisma",
      useProficiency: true,
      attackMiscBonus: 1,
      damageDice: "1d6",
      addAbilityToDamage: true,
      damageMiscBonus: 0,
      damageType: "force",
    });
    const xml = service.exportCharacterXml(id);
    const section = xml.match(/<attacks>[\s\S]*?<\/attacks>/)?.[0]!;
    const normalized = section
      .replace(/ id="[0-9a-f]{32}"/g, ' id="<opaque-id>"')
      .replace(/ identifier="[0-9a-f-]{36}"/g, ' identifier="<session-guid>"')
      .replace(/ identifier=""/g, ' identifier=""');
    expect(normalized).toContain(
      '<attack id="<opaque-id>" identifier="<session-guid>" name="Staff of Power" range="5 ft" attack="+6 vs AC" damage="1d6+4 bludgeoning" displayed="true" kind="weapon" ability-mode="default" proficient="false" attack-misc="0" ability-damage="false" damage-misc="0" ability="Strength">',
    );
    expect(normalized).toContain(
      '<attack id="<opaque-id>" identifier="" name="Reference Bolt" range="60 ft." attack="+4 vs AC" damage="1d8 force" displayed="true" kind="manual" ability-mode="default" proficient="false" attack-misc="0" ability-damage="false" damage-misc="0">',
    );
    expect(normalized).toContain(
      '<attack id="<opaque-id>" identifier="" name="Calculated Strike" range="5 ft." attack="+2 vs AC" damage="1d6-1 force" displayed="true" kind="calculated" ability-mode="default" calculation-source="ability" proficient="true" attack-misc="1" damage-dice="1d6" ability-damage="true" damage-misc="0" damage-type="force" ability="Charisma">',
    );
    expect(section.match(/<attack /g)).toHaveLength(4);
    expect(section).toContain("<description><![CDATA[Versatile]]></description>");
    expect(section).toContain("<description><![CDATA[A fixture-only custom attack.]]></description>");
    expect(section).toContain("<description><![CDATA[]]></description>");
  });

  it("re-serializes rows on mutation, keeping unmutated rows byte-identical", async () => {
    const service = await freshService();
    const id = service.createCharacter("Stable Rows").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    const before = service.exportCharacterXml(id);
    const longswordBefore = before.match(/<attack [^>]*name="Longsword"[^>]*>[\s\S]*?<\/attack>/)?.[0]!;
    const staff = weaponRow(service.getAttacks(id), "Staff of Power");
    service.updateAttack(id, staff.id, { description: "Override desc." });
    const after = service.exportCharacterXml(id);
    const longswordAfter = after.match(/<attack [^>]*name="Longsword"[^>]*>[\s\S]*?<\/attack>/)?.[0]!;
    const staffAfter = after.match(/<attack [^>]*name="Staff of Power"[^>]*>[\s\S]*?<\/attack>/)?.[0]!;
    expect(longswordAfter).toBe(longswordBefore);
    expect(staffAfter).toContain("CDATA[Override desc.]]>");
    expect(after).not.toContain('ability="Charisma">');
    expect(after).toContain('ability="Strength">');
  });
});

describe("attacks document round-trip", () => {
  it("round-trips a character carrying attacks byte-identically", async () => {
    const service = await freshService();
    const id = service.createCharacter("round-trip").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const shortbow = service.addItem(id, { itemId: SHORTBOW, amount: 1, baseElementId: null })
      .items.find((i) => i.itemId === SHORTBOW)!;
    service.equipItem(id, shortbow.identifier, "secondary");
    expect(service.getAttacks(id).length).toBeGreaterThan(0);

    const exported = service.exportCharacterXml(id);
    const reader = new CharacterService(undefined, await library());
    reader.importCharacterXml(id, exported);
    expect(reader.exportCharacterXml(id)).toBe(exported);
  });

  it("builds imported rows with kind/ability derived from the file", async () => {
    const service = await freshService();
    const id = service.createCharacter("imported-rows").id;
    setScores(service, id);
    await makeFighter(service, id);
    for (const itemId of [LONGSWORD, RAPIER, SHORTBOW]) {
      const added = service.addItem(id, { itemId, amount: 1, baseElementId: null })
        .items.find((i) => i.itemId === itemId)!;
      service.equipItem(id, added.identifier, "secondary");
    }
    const exported = service.exportCharacterXml(id);

    const reader = new CharacterService(undefined, await library());
    reader.importCharacterXml(id, exported);
    const rows = buildAttacksDto(reader.getCharacter(id), await library());

    expect(rows.map((a) => a.kind)).toEqual(["weapon", "weapon", "weapon"]);
    expect([...rows].map((a) => a.name).sort()).toEqual(["Longsword", "Rapier", "Shortbow"]);
    expect(rows.map((a) => a.sheetPosition)).toEqual([1, 2, 3]);
  });

  it("uses final ability scores and proficiency for imported weapon rows", async () => {
    const service = await freshService();
    const id = service.createCharacter("imported-weapons").id;
    service.setAbilities(id, { strength: 10, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    await makeFighter(service, id);
    const blowgun = service.addItem(id, { itemId: BLOWGUN, amount: 1, baseElementId: null })
      .items.find((i) => i.itemId === BLOWGUN)!;
    service.equipItem(id, blowgun.identifier, "secondary");

    const before = weaponRow(service.getAttacks(id), "Blowgun");
    // dex +3, proficiency +2 (fighter is proficient with simple weapons).
    expect(before.bonus).toBe("+5 vs AC");
    expect(before.damage).toBe("1+3 piercing");
    expect(before.computation).toBeNull();

    const exported = service.exportCharacterXml(id);
    const reader = new CharacterService(undefined, await library());
    reader.importCharacterXml(id, exported);

    const after = weaponRow(reader.getAttacks(id), "Blowgun");
    expect(after.bonus).toBe(before.bonus);
    expect(after.damage).toBe(before.damage);
    expect(after.generated?.bonus).toBe(before.bonus);
    expect(after.generated?.damage).toBe(before.damage);
    expect(after.overriddenFields).toEqual([]);

    // The row is derived, not stored: raising Dexterity moves it.
    reader.setAbilities(id, { strength: 10, dexterity: 20, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    expect(weaponRow(reader.getAttacks(id), "Blowgun").bonus).toBe("+7 vs AC");
  });

  it("keeps automatic rows in stored order with hidden rows keeping their position", async () => {
    const service = await freshService();
    const id = service.createCharacter("Hidden Order").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    service.equipItem(
      id,
      service.getInventory(id).items.find((i) => i.name === "Staff of Power")!.identifier,
      "primary",
    );
    service.createAttack(id, { mode: "manual", name: "M1", range: "", bonus: "", damage: "", description: "" });
    const staff = weaponRow(service.getAttacks(id), "Staff of Power");
    const hidden = service.setAttackVisibility(id, staff.id, false);
    expect(hidden.map((a) => [a.name, a.sheetPosition])).toEqual([
      ["Staff of Power", null],
      ["Longsword", 1],
      ["M1", 2],
    ]);
  });
});

describe("unarmed strike rows", () => {
  it("previews the row it would create in the attack options", async () => {
    const service = await freshService();
    const id = service.createCharacter("Preview Fists").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2014);
    levelTo(service, id, 5);
    // The editor shows these before the row exists, so "Add" is not a blind action.
    expect(service.getAttackOptions(id).unarmed).toEqual({
      name: "Unarmed Strike",
      range: "5 ft",
      bonus: "+7 vs AC",
      damage: "1d6+4 bludgeoning",
      description: "",
    });
  });

  it("previews a flat 1 for a character with no unarmed content", async () => {
    const service = await freshService();
    const id = service.createCharacter("Plain Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    expect(service.getAttackOptions(id).unarmed).toEqual({
      name: "Unarmed Strike",
      range: "5 ft",
      bonus: "+4 vs AC",
      damage: "1+2 bludgeoning",
      description: "",
    });
  });

  it("creates a flat 1 bludgeoning row with proficiency for a non-monk", async () => {
    const service = await freshService();
    const id = service.createCharacter("Bare Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    const rows = service.createAttack(id, { mode: "unarmed" });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("unarmed");
    expect(row.name).toBe("Unarmed Strike");
    expect(row.range).toBe("5 ft");
    // STR 15 (+2) + proficiency +2 at level 3; damage is the flat base 1 + 2.
    expect(row.bonus).toBe("+4 vs AC");
    expect(row.damage).toBe("1+2 bludgeoning");
    expect(row.isAutomatic).toBe(false);
    expect(row.isCurrentlyEquipped).toBe(false);
    expect(row.ability).toBe("Strength");
    expect(row.defaultAbility).toBe("Strength");
    expect(row.computation?.attackBonusContributions).toEqual([
      { label: "Strength", value: 2 },
      { label: "Proficiency", value: 2 },
    ]);
  });

  it("adds proficiency even when the class lacks the simple-weapon grant", async () => {
    // Druids receive a specific weapon list rather than Simple Weapons, so the
    // corpus never grants them the unarmed-strike proficiency element. Every
    // character is proficient with unarmed strikes, so the bonus still applies.
    const service = await freshService();
    const id = service.createCharacter("Druid Fists").id;
    setScores(service, id);
    await makeClass(service, id, DRUID);
    expect(service.getAttacks(id)).toEqual([]);
    const row = service.createAttack(id, { mode: "unarmed" })[0]!;
    expect(row.bonus).toBe("+4 vs AC");
  });

  it("follows the 2014 monk martial arts die and the higher of STR/DEX", async () => {
    const service = await freshService();
    const id = service.createCharacter("Monk 2014").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2014);
    service.createAttack(id, { mode: "unarmed" });
    const dieAt = (): string => unarmedRow(service.getAttacks(id)).damage;
    expect(dieAt()).toBe("1d4+4 bludgeoning");
    expect(unarmedRow(service.getAttacks(id)).ability).toBe("Dexterity");
    levelTo(service, id, 5);
    expect(dieAt()).toBe("1d6+4 bludgeoning");
    levelTo(service, id, 11);
    expect(dieAt()).toBe("1d8+4 bludgeoning");
    levelTo(service, id, 17);
    expect(dieAt()).toBe("1d10+4 bludgeoning");
  });

  it("follows the 2024 monk martial arts die", async () => {
    const service = await freshService();
    const id = service.createCharacter("Monk 2024").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2024);
    service.createAttack(id, { mode: "unarmed" });
    const dieAt = (): string => unarmedRow(service.getAttacks(id)).damage;
    expect(dieAt()).toBe("1d6+4 bludgeoning");
    levelTo(service, id, 5);
    expect(dieAt()).toBe("1d8+4 bludgeoning");
    levelTo(service, id, 11);
    expect(dieAt()).toBe("1d10+4 bludgeoning");
    levelTo(service, id, 17);
    expect(dieAt()).toBe("1d12+4 bludgeoning");
  });

  it("applies the attuned Eldritch Claw Tattoo rider to bonus and damage", async () => {
    const service = await freshService();
    const id = service.createCharacter("Tattooed Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    const before = service.createAttack(id, { mode: "unarmed" })[0]!;
    expect(before.bonus).toBe("+4 vs AC");
    wear(service, id, ELDRITCH_CLAW_TATTOO);
    const after = unarmedRow(service.getAttacks(id));
    expect(after.bonus).toBe("+5 vs AC");
    expect(after.damage).toBe("1+3 bludgeoning");
  });

  it("adds the Eldritch Claw Tattoo rider on top of a monk's martial arts die", async () => {
    const service = await freshService();
    const id = service.createCharacter("Tattooed Monk").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2014);
    levelTo(service, id, 5);
    service.createAttack(id, { mode: "unarmed" });
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1d6+4 bludgeoning");
    wear(service, id, ELDRITCH_CLAW_TATTOO);
    const row = unarmedRow(service.getAttacks(id));
    // The rider stacks with the ability modifier; the die still comes from Martial Arts.
    expect(row.damage).toBe("1d6+5 bludgeoning");
    expect(row.bonus).toBe("+8 vs AC");
  });

  it("applies the Insignia of Claws rider written with the other key spelling", async () => {
    const service = await freshService();
    const id = service.createCharacter("Insignia Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.createAttack(id, { mode: "unarmed" });
    wear(service, id, INSIGNIA_OF_CLAWS);
    const row = unarmedRow(service.getAttacks(id));
    expect(row.bonus).toBe("+5 vs AC");
    expect(row.damage).toBe("1+3 bludgeoning");
  });

  it("keeps a manual damage die override while the ability modifier stays live", async () => {
    const service = await freshService();
    const id = service.createCharacter("Tavern Brawler").id;
    setScores(service, id);
    await makeFighter(service, id);
    const created = service.createAttack(id, { mode: "unarmed" })[0]!;
    const overridden = service.updateAttack(id, created.id, { damageDice: "1d4" })[0]!;
    expect(overridden.damage).toBe("1d4+2 bludgeoning");
    service.setAbilities(id, {
      strength: 18, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8,
    });
    const after = unarmedRow(service.getAttacks(id));
    expect(after.damage).toBe("1d4+4 bludgeoning");
    expect(after.bonus).toBe("+6 vs AC");
  });

  it("round-trips the row and its die override through the .dnd5e document", async () => {
    const service = await freshService();
    const id = service.createCharacter("Round Trip Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    const created = service.createAttack(id, { mode: "unarmed" })[0]!;
    service.updateAttack(id, created.id, { damageDice: "1d6" });
    const document = service.exportCharacterXml(id);
    const reloaded = await freshService();
    const reloadedId = reloaded.importCharacterXml("Round Trip Fists", document).id;
    const row = unarmedRow(reloaded.getAttacks(reloadedId));
    expect(row.kind).toBe("unarmed");
    expect(row.damage).toBe("1d6+2 bludgeoning");
    expect(row.bonus).toBe("+4 vs AC");
  });

  it("honours an explicit ability override and returns to the default", async () => {
    const service = await freshService();
    const id = service.createCharacter("Odd Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    const created = service.createAttack(id, { mode: "unarmed" })[0]!;
    const explicit = service.updateAttack(id, created.id, { abilityName: "Constitution" })[0]!;
    expect(explicit.abilityMode).toBe("explicit");
    expect(explicit.ability).toBe("Constitution");
    expect(explicit.bonus).toBe("+4 vs AC");
    const back = service.updateAttack(id, created.id, { abilityMode: "default" })[0]!;
    expect(back.ability).toBe("Strength");
  });

  it("applies the Tasha's printing of the Eldritch Claw Tattoo", async () => {
    // Upstream ships that printing as prose only; system-unarmed-riders.xml
    // appends the rules the Unearthed Arcana printing already carries.
    const service = await freshService();
    const id = service.createCharacter("Tasha Tattoo").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.createAttack(id, { mode: "unarmed" });
    expect(unarmedRow(service.getAttacks(id)).bonus).toBe("+4 vs AC");
    wear(service, id, TCOE_CLAW_TATTOO);
    const row = unarmedRow(service.getAttacks(id));
    expect(row.bonus).toBe("+5 vs AC");
    expect(row.damage).toBe("1+3 bludgeoning");
  });

  it("applies the Wraps of Unarmed Prowess by rarity", async () => {
    const service = await freshService();
    const id = service.createCharacter("Wrapped Fists").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.createAttack(id, { mode: "unarmed" });
    wear(service, id, WRAPS_VERY_RARE);
    const row = unarmedRow(service.getAttacks(id));
    expect(row.bonus).toBe("+7 vs AC");
    expect(row.damage).toBe("1+5 bludgeoning");
  });

  it("gives Tavern Brawler its d4 without a manual override", async () => {
    const service = await freshService();
    const id = service.createCharacter("Brawler").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.createAttack(id, { mode: "unarmed" });
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1+2 bludgeoning");
    grantFeat(service, id, TAVERN_BRAWLER);
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1d4+2 bludgeoning");
  });

  it("upgrades the 2024 Unarmed Fighting die only while both hands are free", async () => {
    // The feat writes two rules to one key (d6, and d8 with nothing in hand).
    // They share a bonus bucket, so the larger applies rather than the two
    // summing to a d14.
    const service = await freshService();
    const id = service.createCharacter("Unarmed Fighter").id;
    setScores(service, id);
    await makeClass(service, id, FIGHTER_2024);
    service.createAttack(id, { mode: "unarmed" });
    grantFeat(service, id, PHB24_UNARMED_FIGHTING);
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1d8+2 bludgeoning");

    const added = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const sword = added.items.find((i) => i.itemId === LONGSWORD)!;
    service.equipItem(id, sword.identifier, "primary");
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1d6+2 bludgeoning");
  });

  it("names the feature behind the damage die rather than the key", async () => {
    const service = await freshService();
    const id = service.createCharacter("Named Sources").id;
    setScores(service, id);
    await makeFighter(service, id);
    service.createAttack(id, { mode: "unarmed" });
    grantFeat(service, id, TAVERN_BRAWLER);
    expect(unarmedRow(service.getAttacks(id)).computation?.sourceNotes).toEqual([
      "Tavern Brawler sets the damage die to 1d4.",
    ]);
  });

  it("names the monk feature and lists the items behind the flat bonuses", async () => {
    const service = await freshService();
    const id = service.createCharacter("Monk Sources").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2014);
    levelTo(service, id, 5);
    service.createAttack(id, { mode: "unarmed" });
    wear(service, id, TCOE_CLAW_TATTOO);
    const computation = unarmedRow(service.getAttacks(id)).computation!;
    expect(computation.sourceNotes).toEqual([
      "Martial Arts sets the damage die to 1d6.",
      "Eldritch Claw Tattoo adds +1 to hit and +1 damage.",
    ]);
    expect(computation.appliedModifiers).toEqual([
      {
        id: TCOE_CLAW_TATTOO,
        name: "Eldritch Claw Tattoo",
        field: "attack and damage",
        effect: "+1 to hit, +1 damage",
      },
    ]);
  });

  it("says what a hand-set die replaced", async () => {
    const service = await freshService();
    const id = service.createCharacter("Overridden Sources").id;
    setScores(service, id);
    await makeFighter(service, id);
    const created = service.createAttack(id, { mode: "unarmed" })[0]!;
    grantFeat(service, id, TAVERN_BRAWLER);
    const notes = () => unarmedRow(service.getAttacks(id)).computation!.sourceNotes;
    service.updateAttack(id, created.id, { damageDice: "2d6" });
    expect(notes()).toEqual([
      "Damage die set to 2d6 by hand, replacing 1d4 from Tavern Brawler.",
    ]);
    service.updateAttack(id, created.id, { damageDice: "" });
    expect(notes()).toEqual(["Tavern Brawler sets the damage die to 1d4."]);
  });

  it("gates the martial arts die on the monk level, not the character level", async () => {
    // Monk 4 / Fighter 1 is character level 5, so the proficiency bonus rises,
    // but the die upgrade waits for monk level 5.
    const service = await freshService();
    const id = service.createCharacter("Monk Dip").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2014);
    levelTo(service, id, 4);
    service.createAttack(id, { mode: "unarmed" });
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1d4+4 bludgeoning");

    service.setCharacterOption(id, { optionId: OPTION_MULTICLASS, enabled: true });
    service.startMulticlass(id, MC_FIGHTER);
    service.levelUpMode(id, { mode: "multiclass", classId: MC_FIGHTER });

    expect(service.getCharacter(id).level).toBe(5);
    const row = unarmedRow(service.getAttacks(id));
    // Still the monk-4 die, but the level-5 proficiency bonus.
    expect(row.damage).toBe("1d4+4 bludgeoning");
    expect(row.bonus).toBe("+7 vs AC");
  });

  it("keeps the row working across a ruleset mode change", async () => {
    const service = await freshService();
    const id = service.createCharacter("Mode Switch").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await makeClass(service, id, MONK_2014);
    levelTo(service, id, 5);
    service.createAttack(id, { mode: "unarmed" });
    expect(unarmedRow(service.getAttacks(id)).damage).toBe("1d6+4 bludgeoning");

    service.setRulesetMode(id, "2014");
    const row = unarmedRow(service.getAttacks(id));
    expect(row.kind).toBe("unarmed");
    expect(row.damage).toBe("1d6+4 bludgeoning");
  });

  it("can be hidden, moved, and deleted like any non-automatic row", async () => {
    const service = await freshService();
    const id = service.createCharacter("Managed Fists").id;
    setScores(service, id);
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const created = service.createAttack(id, { mode: "unarmed" }).find((a) => a.kind === "unarmed")!;
    expect(service.setAttackVisibility(id, created.id, false).find((a) => a.id === created.id)!.sheetPosition).toBeNull();
    service.setAttackVisibility(id, created.id, true);
    expect(service.moveAttack(id, created.id, "up").map((a) => a.kind)).toEqual(["unarmed", "weapon"]);
    expect(service.deleteAttack(id, created.id).some((a) => a.kind === "unarmed")).toBe(false);
  });
});

/**
 * Cantrip level scaling. Attack cantrips upgrade with the character's total level:
 * Fire Bolt gains damage dice, Eldritch Blast gains beams. Both printings word the
 * upgrade differently, so these cases are pinned against the real corpus text.
 */
describe("attack-roll spell scaling", () => {
  const descriptionOf = async (spellId: string): Promise<string> => {
    const element = (await library()).byId.get(spellId);
    if (element === undefined) throw new Error(`spell '${spellId}' missing from the corpus`);
    return element.descriptionXml ?? "";
  };

  const beamsByLevel = async (spellId: string, levels: number[]): Promise<number[]> => {
    const description = await descriptionOf(spellId);
    return levels.map((level) => parseSpellAttack(description, level)!.beamCount);
  };

  const damageByLevel = async (spellId: string, levels: number[]): Promise<string[]> => {
    const description = await descriptionOf(spellId);
    return levels.map((level) => parseSpellAttack(description, level)!.damage);
  };

  it("scales Eldritch Blast beams with character level (2014 wording)", async () => {
    expect(await beamsByLevel("ID_PHB_SPELL_ELDRITCH_BLAST", [1, 4, 5, 10, 11, 16, 17, 20]))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("scales Eldritch Blast beams with character level (2024 wording)", async () => {
    expect(await beamsByLevel("ID_WOTC_PHB24_SPELL_ELDRITCH_BLAST", [1, 4, 5, 10, 11, 16, 17, 20]))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("reports beams as the unit for a level-scaled cantrip and rays for Scorching Ray", async () => {
    const blast = parseSpellAttack(await descriptionOf("ID_PHB_SPELL_ELDRITCH_BLAST"), 5)!;
    expect(blast).toMatchObject({ beamCount: 2, beamUnit: "beams", warning: null });
    const ray = parseSpellAttack(await descriptionOf("ID_PHB_SPELL_SCORCHING_RAY"), 5)!;
    expect(ray).toMatchObject({ beamCount: 3, beamUnit: "rays" });
  });

  it("leaves Scorching Ray's slot-driven ray count untouched by character level", async () => {
    expect(await beamsByLevel("ID_PHB_SPELL_SCORCHING_RAY", [1, 5, 11, 17, 20]))
      .toEqual([3, 3, 3, 3, 3]);
    expect(parseSpellAttack(await descriptionOf("ID_PHB_SPELL_SCORCHING_RAY"), 20)!.warning)
      .toBe("Higher-level slots create one additional ray per slot level above 2nd.");
  });

  it("scales cantrip damage through every tier (2014 wording)", async () => {
    expect(await damageByLevel("ID_PHB_SPELL_FIRE_BOLT", [1, 4, 5, 10, 11, 16, 17, 20]))
      .toEqual(["1d10 fire", "1d10 fire", "2d10 fire", "2d10 fire", "3d10 fire", "3d10 fire", "4d10 fire", "4d10 fire"]);
  });

  it("scales cantrip damage through every tier (2024 wording)", async () => {
    expect(await damageByLevel("ID_WOTC_PHB24_SPELL_FIRE_BOLT", [1, 4, 5, 10, 11, 16, 17, 20]))
      .toEqual(["1d10 Fire", "1d10 Fire", "2d10 Fire", "2d10 Fire", "3d10 Fire", "3d10 Fire", "4d10 Fire", "4d10 Fire"]);
  });

  it("leaves Eldritch Blast's damage unscaled while its beams grow", async () => {
    expect(await damageByLevel("ID_PHB_SPELL_ELDRITCH_BLAST", [1, 5, 11, 17]))
      .toEqual(["1d10 force", "1d10 force", "1d10 force", "1d10 force"]);
  });

  it("reads scaling cantrips whose hit sentence does not say 'the target takes'", async () => {
    expect(await damageByLevel("ID_PHB_SPELL_RAY_OF_FROST", [1, 5, 11, 17]))
      .toEqual(["1d8 cold", "2d8 cold", "3d8 cold", "4d8 cold"]);
    expect(await damageByLevel("ID_WOTC_PHB24_SPELL_RAY_OF_FROST", [1, 5, 11, 17]))
      .toEqual(["1d8 Cold", "2d8 Cold", "3d8 Cold", "4d8 Cold"]);
    expect(await damageByLevel("ID_PHB_SPELL_THORN_WHIP", [1, 5, 11, 17]))
      .toEqual(["1d6 piercing", "2d6 piercing", "3d6 piercing", "4d6 piercing"]);
  });

  it("recognises the attack sentence regardless of its capitalisation or count", async () => {
    expect(await damageByLevel("ID_WOTC_PHB24_SPELL_CHILL_TOUCH", [1, 5, 11, 17]))
      .toEqual(["1d10 Necrotic", "2d10 Necrotic", "3d10 Necrotic", "4d10 Necrotic"]);
    expect(await damageByLevel("ID_WOTC_PHB24_SPELL_GUIDING_BOLT", [1]))
      .toEqual(["4d6 Radiant"]);
    expect(await damageByLevel("ID_WOTC_PHB24_SPELL_SPIRITUAL_WEAPON", [1]))
      .toEqual(["1d8 Force"]);
    expect(parseSpellAttack(await descriptionOf("ID_WOTC_PHB24_SPELL_SPIRITUAL_WEAPON"), 1)!.addsSpellcastingModifier)
      .toBe(true);
  });

  it("reads compound, chosen-type, and 'deals' damage wordings", async () => {
    expect(await damageByLevel("ID_XGTE_SPELL_CHAOS_BOLT", [1])).toEqual(["2d8+1d6"]);
    expect(await damageByLevel("ID_PHB_SPELL_CHROMATIC_ORB", [1])).toEqual(["3d8 (chosen type)"]);
    expect(await damageByLevel("ID_WOTC_PHB24_SPELL_CHROMATIC_ORB", [1])).toEqual(["3d8 (chosen type)"]);
    expect(await damageByLevel("ID_WOTC_ACQINC_SPELL_JIMS_MAGIC_MISSILE", [1])).toEqual(["2d4 force"]);
    expect(await damageByLevel("ID_XGTE_SPELL_WRATH_OF_NATURE", [1])).toEqual(["3d8 nonmagical bludgeoning"]);
  });

  it("counts the 2024 Scorching Ray's rays and warns about upcasting", async () => {
    const ray = parseSpellAttack(await descriptionOf("ID_WOTC_PHB24_SPELL_SCORCHING_RAY"), 5)!;
    expect(ray).toMatchObject({
      damage: "2d6 Fire",
      beamCount: 3,
      beamUnit: "rays",
      warning: "Higher-level slots create one additional ray per slot level above 2nd.",
    });
    const darts = parseSpellAttack(await descriptionOf("ID_WOTC_ACQINC_SPELL_JIMS_MAGIC_MISSILE"), 5)!;
    expect(darts).toMatchObject({ beamCount: 3, beamUnit: "darts" });
    expect(darts.warning).toContain("one additional dart per slot level above 1st");
  });

  it("names the unit 'attacks' for a single-attack spell", async () => {
    expect(parseSpellAttack(await descriptionOf("ID_PHB_SPELL_FIRE_BOLT"), 1)!.beamUnit).toBe("attacks");
  });

  it("surfaces secondary damage and upcast damage as notes and warnings", async () => {
    const arrow = parseSpellAttack(await descriptionOf("ID_PHB_SPELL_MELFS_ACID_ARROW"), 5)!;
    expect(arrow.damage).toBe("4d4 acid");
    expect(arrow.notes.some((note) => note.includes("2d4 acid damage at the end of its next turn"))).toBe(true);
    expect(arrow.warning).toBe("Higher-level slots add 1d4 per slot level above 2nd.");
    const bolt = parseSpellAttack(await descriptionOf("ID_PHB_SPELL_GUIDING_BOLT"), 1)!;
    expect(bolt.warning).toBe("Higher-level slots add 1d6 per slot level above 1st.");
    expect(bolt.notes).toEqual([]);
    const fireBolt = parseSpellAttack(await descriptionOf("ID_PHB_SPELL_FIRE_BOLT"), 1)!;
    expect(fireBolt.notes).toEqual([]);
    expect(fireBolt.warning).toBeNull();
  });

  it("flags an attack-roll spell with no damage roll", async () => {
    const ray = parseSpellAttack(await descriptionOf("ID_PHB_SPELL_RAY_OF_ENFEEBLEMENT"), 1)!;
    expect(ray.damage).toBe("");
    expect(ray.warning).toBe("No damage roll was found in the description; check the spell text.");
  });

  it("scales every attack cantrip in the corpus that has an upgrade clause", async () => {
    const lib = await library();
    const stuck: string[] = [];
    let scaling = 0;
    for (const element of lib.byType.get("Spell") ?? []) {
      if (element.identity.id.includes("ELDRITCH_BLAST")) continue;
      const info = lib.byId.get(element.identity.id)!;
      const level = info.setters.find((setter) => setter.name === "level")?.value ?? "0";
      if (level !== "0") continue;
      const text = (element.descriptionXml ?? "").replace(/<[^>]+>/g, " ");
      if (!/spell attack/i.test(text) || !/when you reach/i.test(text)) continue;
      const low = parseSpellAttack(element.descriptionXml, 1);
      const high = parseSpellAttack(element.descriptionXml, 17);
      if (low === null || high === null || low.damage === "" || low.damage === high.damage) {
        stuck.push(element.identity.id);
      } else {
        scaling++;
      }
    }
    expect(stuck).toEqual([]);
    // Both printings' attack cantrips with an upgrade clause (Fire Bolt, Ray of
    // Frost, Chill Touch, Shocking Grasp, Produce Flame, Thorn Whip, ...).
    expect(scaling).toBeGreaterThanOrEqual(15);
  });

  it("grows an existing Eldritch Blast attack row from one beam to two on level-up", async () => {
    const service = await freshService();
    const id = service.createCharacter("Beam Warlock").id;
    setScores(service, id);
    const lib = await library();
    const classRule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
    service.setSelection(id, classRule.identifier, WARLOCK);
    const spellRule = pendingSelectionRules(service.getCharacter(id)).find(
      (r) => r.type === "Spell" && selectionOptions(service.getCharacter(id), lib, r).some((o) => o.id === ELDRITCH_BLAST),
    );
    if (spellRule === undefined) throw new Error("no Spell rule offering Eldritch Blast");
    service.setSelection(id, spellRule.identifier, ELDRITCH_BLAST, 1);
    levelTo(service, id, 4);

    const option = service.getAttackOptions(id).spells.find(
      (candidate) => (candidate as { spellId?: string }).spellId === ELDRITCH_BLAST,
    ) as { casterIdentifier: string; spellId: string; beamCount: number };
    expect(option.beamCount).toBe(1);
    const created = service.createAttack(id, {
      mode: "spell",
      casterIdentifier: option.casterIdentifier,
      spellId: option.spellId,
      name: null, range: null, bonus: null, damage: null, description: null,
    }).at(-1)!;
    expect(created.computation!.attackCount).toBe(1);

    // The row re-derives on read, so the count follows the level regardless of
    // what the file holds.
    levelTo(service, id, 5);
    const levelled = service.getAttacks(id).find((row) => row.id === created.id)!;
    expect(levelled.computation!.attackCount).toBe(2);
    expect(levelled.computation!.sourceNotes).toContain("2 beams; damage is shown per hit.");
  });
});

describe("spell attack riders", () => {
  const AGONIZING_2014 = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_AGONIZING_BLAST";
  const SPEAR_2014 = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_Eldritch_Spear";
  const WARLOCK_2024 = "ID_WOTC_PHB24_CLASS_WARLOCK";
  const ELDRITCH_BLAST_2024 = "ID_WOTC_PHB24_SPELL_ELDRITCH_BLAST";
  const AGONIZING_2024 = "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_AGONIZING_BLAST";
  const SPELL_SNIPER_2014 = "ID_PHB_FEAT_SPELLSNIPER";

  type SpellOption = {
    spellId: string;
    range: string;
    damage: string;
    casterIdentifier: string;
    computation: { appliedModifiers: { id: string; name: string; field: string; effect: string }[]; sourceNotes: string[] };
  };

  /** Resolves whichever pending rule offers `elementId` to that element. */
  const selectOffering = async (service: CharacterService, id: string, elementId: string): Promise<void> => {
    const lib = await library();
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) =>
      selectionOptions(service.getCharacter(id), lib, candidate).some((option) => option.id === elementId),
    );
    if (rule === undefined) throw new Error(`no pending rule offers '${elementId}'`);
    service.setSelection(id, rule.identifier, elementId, 1);
  };

  const spellOption = (service: CharacterService, id: string, spellId: string): SpellOption => {
    const option = service.getAttackOptions(id).spells.find(
      (candidate) => (candidate as { spellId?: string }).spellId === spellId,
    );
    if (option === undefined) throw new Error(`no attack option for '${spellId}'`);
    return option as SpellOption;
  };

  /** A level-2 warlock (CHA 17) knowing Eldritch Blast, ready to pick invocations. */
  const warlockWithBlast = async (service: CharacterService, id: string, classId = WARLOCK, blastId = ELDRITCH_BLAST): Promise<void> => {
    service.setAbilities(id, {
      strength: 8, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 17,
    });
    await makeClass(service, id, classId);
    await selectOffering(service, id, blastId);
    levelTo(service, id, 2);
  };

  it("adds Agonizing Blast's Charisma modifier to every Eldritch Blast beam", async () => {
    const service = await freshService();
    const id = service.createCharacter("Agonizing Warlock").id;
    await warlockWithBlast(service, id);
    expect(spellOption(service, id, ELDRITCH_BLAST).damage).toBe("1d10 force");

    await selectOffering(service, id, AGONIZING_2014);
    const option = spellOption(service, id, ELDRITCH_BLAST);
    expect(option.damage).toBe("1d10+3 force");
    expect(option.computation.appliedModifiers).toEqual([
      { id: AGONIZING_2014, name: "Agonizing Blast", field: "damage", effect: "+3 damage" },
    ]);
    expect(option.computation.sourceNotes).toContain("Agonizing Blast adds +3 damage.");

    const row = service.createAttack(id, {
      mode: "spell", casterIdentifier: option.casterIdentifier, spellId: ELDRITCH_BLAST,
      name: null, range: null, bonus: null, damage: null, description: null,
    }).at(-1)!;
    expect(row.damage).toBe("1d10+3 force");
    levelTo(service, id, 5);
    const levelled = service.getAttacks(id).find((candidate) => candidate.id === row.id)!;
    expect(levelled.damage).toBe("1d10+3 force");
    expect(levelled.computation!.attackCount).toBe(2);
    expect(service.exportCharacterXml(id)).toContain('damage="1d10+3 force"');
  });

  it("sets Eldritch Spear's 300-foot range on Eldritch Blast", async () => {
    const service = await freshService();
    const id = service.createCharacter("Spear Warlock").id;
    await warlockWithBlast(service, id);
    expect(spellOption(service, id, ELDRITCH_BLAST).range).toBe("120 feet");

    await selectOffering(service, id, SPEAR_2014);
    const option = spellOption(service, id, ELDRITCH_BLAST);
    expect(option.range).toBe("300 feet");
    expect(option.computation.appliedModifiers).toEqual([
      { id: SPEAR_2014, name: "Eldritch Spear", field: "range", effect: "range 300 feet" },
    ]);
  });

  it("only notes the 2024 Agonizing Blast, whose chosen cantrip the file does not record", async () => {
    const service = await freshService();
    const id = service.createCharacter("Agonizing Warlock 2024").id;
    await warlockWithBlast(service, id, WARLOCK_2024, ELDRITCH_BLAST_2024);
    await selectOffering(service, id, AGONIZING_2024);
    const option = spellOption(service, id, ELDRITCH_BLAST_2024);
    expect(option.damage).toBe("1d10 Force");
    expect(option.computation.appliedModifiers).toEqual([]);
    expect(option.computation.sourceNotes).toContain(
      "Agonizing Blast (2024) applies to one chosen Warlock cantrip; add your Charisma modifier to its damage if this is the one.",
    );
  });

  it("doubles an attack spell's range for the 2014 Spell Sniper feat", async () => {
    const service = await freshService();
    const id = service.createCharacter("Sniper Wizard").id;
    setScores(service, id);
    await makeWizardKnowing(service, id, "ID_PHB_SPELL_FIRE_BOLT");
    grantFeat(service, id, SPELL_SNIPER_2014);
    const option = spellOption(service, id, "ID_PHB_SPELL_FIRE_BOLT");
    expect(option.range).toBe("240 feet");
    expect(option.damage).toBe("1d10 fire");
    expect(option.computation.appliedModifiers).toEqual([
      { id: SPELL_SNIPER_2014, name: "Spell Sniper", field: "range", effect: "range 240 feet" },
    ]);
  });

  describe("table", () => {
    const POTENT = "ID_WOTC_PHB_ARCHETYPE_FEATURE_LIGHT_DOMAIN_POTENT_SPELLCASTING";
    const EMPOWERED = "ID_WOTC_PHB_ARCHETYPE_FEATURE_WIZARD_EVOCATION_EMPOWERED_EVOCATION";
    const base = {
      spellId: "ID_PHB_SPELL_FIRE_BOLT",
      level: 0,
      school: "Evocation",
      casterName: "Cleric",
      range: "120 feet",
      damage: "1d10 fire",
      beamCount: 1,
      statistics: { "wisdom:modifier": 3, "intelligence:modifier": 4 },
      nameOf: () => undefined,
    };

    it("applies Potent Spellcasting to the cleric block's cantrips only", () => {
      const registered = new Set([POTENT]);
      expect(applySpellRiders({ ...base, registered }).damage).toBe("1d10+3 fire");
      expect(applySpellRiders({ ...base, registered, level: 1, damage: "4d6 radiant" }).damage).toBe("4d6 radiant");
      expect(applySpellRiders({ ...base, registered, casterName: "Wizard" }).damage).toBe("1d10 fire");
      expect(applySpellRiders({ ...base, registered }).appliedModifiers).toEqual([
        { id: POTENT, name: "Potent Spellcasting", field: "damage", effect: "+3 damage" },
      ]);
    });

    it("adds Empowered Evocation to single-hit evocations and notes multi-ray ones", () => {
      const registered = new Set([EMPOWERED]);
      const wizard = { ...base, registered, casterName: "Wizard" };
      expect(applySpellRiders(wizard).damage).toBe("1d10+4 fire");
      expect(applySpellRiders({ ...wizard, school: "Necromancy" }).damage).toBe("1d10 fire");
      const rays = applySpellRiders({ ...wizard, level: 2, damage: "2d6 fire", beamCount: 3 });
      expect(rays.damage).toBe("2d6 fire");
      expect(rays.sourceNotes).toEqual([
        "Empowered Evocation adds your Intelligence modifier to one damage roll of the spell, not to every hit.",
      ]);
    });

    it("stacks range riders and leaves non-distance ranges alone", () => {
      const registered = new Set(["ID_WOTC_PHB24_FEAT_SPELLSNIPER", "ID_WOTC_PHB24_CLASS_FEATURE_DRUID_IMPROVED_ELEMENTAL_FURY"]);
      const druid = applySpellRiders({ ...base, registered, casterName: "Druid" });
      expect(druid.range).toBe("480 feet");
      expect(druid.appliedModifiers.map((modifier) => modifier.effect)).toEqual(["range 420 feet", "range 480 feet"]);
      expect(applySpellRiders({ ...base, registered, range: "Touch" }).range).toBe("Touch");
    });
  });
});

describe("attack rows in the exported file", () => {
  const FIRE_BOLT = "ID_PHB_SPELL_FIRE_BOLT";

  /** A level-4 wizard with a linked Fire Bolt row; returns the row id. */
  const fireBoltRow = async (service: CharacterService, id: string): Promise<string> => {
    await makeWizardKnowing(service, id, FIRE_BOLT);
    levelTo(service, id, 4);
    const option = service.getAttackOptions(id).spells.find(
      (candidate) => (candidate as { spellId?: string }).spellId === FIRE_BOLT,
    ) as { casterIdentifier: string; spellId: string };
    return service.createAttack(id, {
      mode: "spell",
      casterIdentifier: option.casterIdentifier,
      spellId: option.spellId,
      name: null, range: null, bonus: null, damage: null, description: null,
    }).at(-1)!.id;
  };

  it("refreshes a spell row's stored damage when a level-up changes it", async () => {
    const service = await freshService();
    const id = service.createCharacter("File Wizard").id;
    await fireBoltRow(service, id);
    expect(service.exportCharacterXml(id)).toContain('damage="1d10 fire"');

    levelTo(service, id, 5);
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain('damage="2d10 fire"');
    expect(xml).not.toContain('damage="1d10 fire"');
  });

  it("leaves a pinned spell-row damage alone when the file is refreshed", async () => {
    const service = await freshService();
    const id = service.createCharacter("Pinned File Wizard").id;
    const rowId = await fireBoltRow(service, id);
    service.updateAttack(id, rowId, { damage: "9d9 pinned" });

    levelTo(service, id, 5);
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain('damage="9d9 pinned"');
    expect(xml).toContain('overridden-fields="damage"');
    expect(service.getAttacks(id).find((row) => row.id === rowId)!.damage).toBe("9d9 pinned");
  });

  it("levels up a character whose imported attack row has no id", async () => {
    const service = await freshService();
    const id = service.createCharacter("Imported Rows").id;
    await fireBoltRow(service, id);
    service.createAttack(id, {
      mode: "manual", name: "Thrown Rock", range: "20 ft", bonus: "+2", damage: "1d4", description: "",
    });
    const stripped = service.exportCharacterXml(id).replace(/<attack id="[^"]*" /g, "<attack ");
    expect(stripped).not.toMatch(/<attack id=/);

    service.importCharacterXml("imported-rows", stripped);
    expect(() => levelTo(service, "imported-rows", 5)).not.toThrow();
    const rows = service.getAttacks("imported-rows");
    expect(rows.map((row) => row.name)).toEqual(["Fire Bolt", "Thrown Rock"]);
    expect(rows[0]!.damage).toBe("2d10 fire");
  });
});
