/**
 * Known Spell attack options: every known attacking spell, not just some.
 *
 * A level-3 Draconic Sorcerer knowing Mind Sliver, Sorcerous Burst and Flame
 * Blade (with Chromatic Orb from Draconic Spells) was offered Flame Blade
 * alone. Three gaps met there: a class caster's options read only its own
 * `<cantrips>`/`<spells>`, so subclass and DM grants never appeared; the gate
 * knew "make a ranged spell attack" but not the 2024 "make a ranged attack
 * roll"; and a saving-throw spell had no way to be expressed at all. Save
 * spells now project with a "DC N ABBR" bonus in the same column.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { parseSpellAttack, parseSpellSave, type MagicAttackSpellOptionDto } from "../magic/reconcile.js";
import { ATTACK_ROLL_RIDER_IDS } from "../magic/spell-riders.js";
import { seededRng, sharedLibrary } from "../testing/character-factory.js";

const DISINTEGRATE = "ID_WOTC_PHB24_SPELL_DISINTEGRATE";
const FINGER_OF_DEATH = "ID_WOTC_PHB24_SPELL_FINGER_OF_DEATH";
const CONTACT_OTHER_PLANE = "ID_WOTC_PHB24_SPELL_CONTACT_OTHER_PLANE";
const ICE_KNIFE = "ID_WOTC_PHB24_SPELL_ICE_KNIFE";
const SORCERER = "ID_WOTC_PHB24_CLASS_SORCERER";
const CLERIC = "ID_WOTC_PHB24_CLASS_CLERIC";
const DRACONIC = "ID_WOTC_PHB24_ARCHETYPE_SORCERER_DRACONIC_SORCERY";
const SORCEROUS_BURST = "ID_WOTC_PHB24_SPELL_SORCEROUS_BURST";
const MIND_SLIVER = "ID_WOTC_PHB24_SPELL_MIND_SLIVER";
const FLAME_BLADE = "ID_WOTC_PHB24_SPELL_FLAME_BLADE";
const CHROMATIC_ORB = "ID_WOTC_PHB24_SPELL_CHROMATIC_ORB";
const HOLD_PERSON = "ID_WOTC_PHB24_SPELL_HOLD_PERSON";
const CURE_WOUNDS = "ID_WOTC_PHB24_SPELL_CURE_WOUNDS";
const FIRE_BOLT = "ID_WOTC_PHB24_SPELL_FIRE_BOLT";
const SACRED_FLAME = "ID_WOTC_PHB24_SPELL_SACRED_FLAME";
const TOLL_THE_DEAD = "ID_WOTC_PHB24_SPELL_TOLL_THE_DEAD";
const FIREBALL = "ID_WOTC_PHB24_SPELL_FIREBALL";
const SPELL_SNIPER = "ID_WOTC_PHB24_FEAT_SPELLSNIPER";

/** Charisma 16 (+3): with proficiency 2 the DC is 13 and the attack +5. */
const ABILITIES = { strength: 8, dexterity: 14, constitution: 13, intelligence: 10, wisdom: 12, charisma: 16 };

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

const descriptionOf = (spellId: string): { xml: string; supports: string[] } => {
  const element = library.byId.get(spellId);
  if (element === undefined) throw new Error(`spell '${spellId}' missing from the corpus`);
  return { xml: element.descriptionXml ?? "", supports: element.supports };
};

/** A 2024 character of `classId` at `levels`, with `archetype` picked at level 3. */
function build2024(
  label: string,
  classId: string,
  levels: number,
  archetype?: string,
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
  pick("Background", "ID_WOTC_PHB24_BACKGROUND_SOLDIER");
  for (let level = 2; level <= levels; level++) {
    service.levelUp(id);
    if (level === 3 && archetype !== undefined) pick("Archetype", archetype);
  }
  return { service, id };
}

/** Resolves the first open Spell rule that offers `spellId`. */
function learn(service: CharacterService, id: string, spellId: string): void {
  const state = service.getCharacter(id);
  const rule = pendingSelectionRules(state).find(
    (candidate) =>
      candidate.type === "Spell" &&
      !candidate.hasSelection &&
      selectionOptions(state, library, candidate).some((option) => option.id === spellId),
  );
  if (!rule) throw new Error(`no open Spell rule offering '${spellId}'`);
  service.setSelection(id, rule.identifier, spellId);
}

/** The reported level-3 Draconic Sorcerer. */
function draconicSorcerer(label: string, levels = 3): { service: CharacterService; id: string } {
  const built = build2024(label, SORCERER, levels, DRACONIC);
  learn(built.service, built.id, SORCEROUS_BURST);
  learn(built.service, built.id, MIND_SLIVER);
  learn(built.service, built.id, FLAME_BLADE);
  return built;
}

const spellOptions = (service: CharacterService, id: string): MagicAttackSpellOptionDto[] =>
  service.getAttackOptions(id).spells as MagicAttackSpellOptionDto[];

const optionFor = (service: CharacterService, id: string, spellId: string): MagicAttackSpellOptionDto => {
  const option = spellOptions(service, id).find((candidate) => candidate.spellId === spellId);
  if (option === undefined) throw new Error(`no attack option for '${spellId}'`);
  return option;
};

describe("the 2024 attack-roll wording", () => {
  it("accepts 'Make a ranged attack roll against the target'", () => {
    const text =
      "<p>You cast sorcerous energy at one creature or object within range. Make a ranged attack roll against the target. " +
      "On a hit, the target takes 1d8 damage of a type you choose: Acid, Cold, or Fire.</p>" +
      "<p><b><i>Cantrip Upgrade.</i></b> The damage increases by 1d8 when you reach levels 5 (2d8), 11 (3d8), and 17 (4d8).</p>";
    expect(parseSpellAttack(text, 1)).toMatchObject({ damage: "1d8 (chosen type)", beamCount: 1, warning: null });
    expect(parseSpellAttack(text, 5)!.damage).toBe("2d8 (chosen type)");
  });

  it("accepts 'Make a melee attack roll'", () => {
    const text = "<p>Make a melee attack roll against the target. On a hit, the target takes 2d6 Force damage.</p>";
    expect(parseSpellAttack(text, 1)!.damage).toBe("2d6 Force");
  });

  it("reads Sorcerous Burst from the corpus", () => {
    const { xml } = descriptionOf(SORCEROUS_BURST);
    expect([1, 5, 11, 17].map((level) => parseSpellAttack(xml, level)!.damage))
      .toEqual(["1d8 (chosen type)", "2d8 (chosen type)", "3d8 (chosen type)", "4d8 (chosen type)"]);
  });
});

describe("saving-throw damage spells", () => {
  it.each([
    "ID_PHB_SPELL_GEAS", "ID_WOTC_PHB24_SPELL_GEAS",
    "ID_PHB_SPELL_DREAM", "ID_WOTC_PHB24_SPELL_DREAM",
    "ID_PHB_SPELL_HEAT_METAL", "ID_WOTC_PHB24_SPELL_HEAT_METAL",
    "ID_PHB_SPELL_SEARING_SMITE", "ID_WOTC_PHB24_SPELL_SEARING_SMITE",
    "ID_PHB_SPELL_PRISMATIC_WALL", "ID_PHB_SPELL_PRISMATIC_SPRAY", "ID_PHB_SPELL_SYMBOL",
  ])("does not invent one save/damage result for conditional spell %s", (spellId) => {
    const { xml, supports } = descriptionOf(spellId);
    expect(parseSpellSave(xml, 9, supports)).toBeNull();
  });

  const MIND_SLIVER_TEXT =
    "<p>You try to temporarily sliver the mind of one creature you can see within range. The target must succeed on an " +
    "Intelligence saving throw or take 1d6 psychic damage and subtract 1d4 from the next saving throw it makes.</p>" +
    "<p><b><i>Cantrip Upgrade.</i></b> The damage increases by 1d6 when you reach levels 5 (2d6), 11 (3d6), and 17 (4d6).</p>";

  it("reads the save ability and the damage, scaling the cantrip", () => {
    expect(parseSpellAttack(MIND_SLIVER_TEXT, 1)).toBeNull();
    expect(parseSpellSave(MIND_SLIVER_TEXT, 1)).toMatchObject({ ability: "Intelligence", damage: "1d6 psychic" });
    expect(parseSpellSave(MIND_SLIVER_TEXT, 5)!.damage).toBe("2d6 psychic");
  });

  it("reads Sacred Flame and Mind Sliver from the corpus", () => {
    const flame = descriptionOf(SACRED_FLAME);
    expect(parseSpellSave(flame.xml, 1, flame.supports)).toMatchObject({ ability: "Dexterity", damage: "1d8 Radiant" });
    expect(parseSpellSave(flame.xml, 17, flame.supports)!.damage).toBe("4d8 Radiant");
    const sliver = descriptionOf(MIND_SLIVER);
    expect(parseSpellSave(sliver.xml, 11, sliver.supports)).toMatchObject({ ability: "Intelligence", damage: "3d6 Psychic" });
  });

  it("scales Toll the Dead's 'one die' upgrade and quotes its second damage roll", () => {
    const toll = descriptionOf(TOLL_THE_DEAD);
    const low = parseSpellSave(toll.xml, 1, toll.supports)!;
    expect(low).toMatchObject({ ability: "Wisdom", damage: "1d8 Necrotic" });
    expect(low.notes.some((note) => note.includes("1d12 Necrotic"))).toBe(true);
    expect(parseSpellSave(toll.xml, 5, toll.supports)!.damage).toBe("2d8 Necrotic");
  });

  it("reads 'taking' damage with half on a success and the upcast warning", () => {
    const fireball = descriptionOf(FIREBALL);
    expect(parseSpellSave(fireball.xml, 5, fireball.supports)).toMatchObject({
      ability: "Dexterity",
      damage: "8d6 Fire",
      halfOnSuccess: true,
      warning: "Higher-level slots add 1d6 per slot level above 3rd.",
    });
  });

  it("reads a flat bonus after the dice in both printings", () => {
    const disintegrate = descriptionOf(DISINTEGRATE);
    expect(parseSpellSave(disintegrate.xml, 11, disintegrate.supports)).toMatchObject({
      ability: "Dexterity",
      damage: "10d6+40 Force",
      halfOnSuccess: false,
    });
    const finger = descriptionOf(FINGER_OF_DEATH);
    expect(parseSpellSave(finger.xml, 13, finger.supports)).toMatchObject({
      ability: "Constitution",
      damage: "7d8+30 Necrotic",
      halfOnSuccess: true,
    });
    const disintegrate2014 = descriptionOf("ID_PHB_SPELL_DISINTEGRATE");
    expect(parseSpellSave(disintegrate2014.xml, 11, disintegrate2014.supports)!.damage).toBe("10d6+40 force");
    const finger2014 = descriptionOf("ID_PHB_SPELL_FINGER_OF_DEATH");
    expect(parseSpellSave(finger2014.xml, 13, finger2014.supports)!.damage).toBe("7d8+30 necrotic");
  });

  it("does not count damage the caster takes (Contact Other Plane)", () => {
    for (const spellId of [CONTACT_OTHER_PLANE, "ID_PHB_SPELL_CONTACT_OTHER_PLANE"]) {
      const { xml, supports } = descriptionOf(spellId);
      expect(parseSpellSave(xml, 9, supports), spellId).toBeNull();
    }
    // Other subjects of a bare "take" are still the targets.
    const lure = descriptionOf("ID_WOTC_TCOE_SPELL_LIGHTNING_LURE");
    expect(parseSpellSave(lure.xml, 1, lure.supports)).toMatchObject({ ability: "Strength", damage: "1d8 lightning" });
    const catapult = descriptionOf("ID_XGTE_SPELL_CATAPULT");
    expect(parseSpellSave(catapult.xml, 1, catapult.supports)).toMatchObject({ ability: "Dexterity", damage: "3d8 bludgeoning" });
    // The attack roll still wins for a spell that also forces a save.
    const iceKnife = descriptionOf(ICE_KNIFE);
    expect(parseSpellAttack(iceKnife.xml, 1)!.damage).toBe("1d10 Piercing");
  });

  it("offers neither a save spell without damage nor a healing spell", () => {
    for (const spellId of [HOLD_PERSON, CURE_WOUNDS, "ID_PHB_SPELL_HOLD_PERSON", "ID_PHB_SPELL_CURE_WOUNDS"]) {
      const { xml, supports } = descriptionOf(spellId);
      expect(parseSpellAttack(xml, 5), spellId).toBeNull();
      expect(parseSpellSave(xml, 5, supports), spellId).toBeNull();
    }
  });
});

describe("Known Spell options for a level-3 Draconic Sorcerer", () => {
  it("offers every known attacking spell, the subclass grant included, once each", () => {
    const { service, id } = draconicSorcerer("DraconicAttacks");
    // Chromatic Orb is granted by Draconic Spells, so it is not in <spells>.
    const block = service.getCharacter(id).magic!.casters[0]!;
    expect(block.spells.map((spell) => spell.id)).not.toContain(CHROMATIC_ORB);

    const ids = spellOptions(service, id)
      .filter((option) => option.casterName === "Sorcerer")
      .map((option) => option.spellId);
    expect(ids).toEqual(expect.arrayContaining([SORCEROUS_BURST, MIND_SLIVER, FLAME_BLADE, CHROMATIC_ORB]));
    expect(ids.filter((spellId) => spellId === CHROMATIC_ORB)).toHaveLength(1);
  });

  it("keeps the attack-roll bonus for attack spells", () => {
    const { service, id } = draconicSorcerer("DraconicAttackBonus");
    expect(optionFor(service, id, FLAME_BLADE).bonus).toBe("+5 CHA vs AC");
    expect(optionFor(service, id, CHROMATIC_ORB)).toMatchObject({ bonus: "+5 CHA vs AC", damage: "3d8 (chosen type)" });
    expect(optionFor(service, id, SORCEROUS_BURST)).toMatchObject({ bonus: "+5 CHA vs AC", damage: "1d8 (chosen type)" });
  });

  it("gives a saving-throw spell the caster's DC and the target's save", () => {
    const { service, id } = draconicSorcerer("DraconicSave");
    const sliver = optionFor(service, id, MIND_SLIVER);
    expect(service.getSpellcasting(id)[0]!.saveDc).toBe(13);
    expect(sliver).toMatchObject({
      casterName: "Sorcerer",
      spellName: "Mind Sliver",
      level: 0,
      range: "60 feet",
      bonus: "DC 13 INT",
      damage: "1d6 Psychic",
      warning: null,
      beamCount: 1,
    });
    expect(sliver.computation).toMatchObject({
      attackBonusContributions: [
        { label: "Base", value: 8 },
        { label: "Charisma", value: 3 },
        { label: "Proficiency", value: 2 },
      ],
      attackCount: 1,
      isPerHit: false,
    });
  });

  it("scales the save cantrip and its DC at level 5", () => {
    const { service, id } = draconicSorcerer("DraconicSave5", 5);
    expect(optionFor(service, id, MIND_SLIVER)).toMatchObject({ bonus: "DC 14 INT", damage: "2d6 Psychic" });
  });

  it("leaves Spell Sniper's attack-roll range bonus off a saving-throw spell", () => {
    // The attack-roll-only riders are listed where the riders live.
    expect([...ATTACK_ROLL_RIDER_IDS].sort()).toEqual(["ID_PHB_FEAT_SPELLSNIPER", SPELL_SNIPER]);
    const { service, id } = draconicSorcerer("DraconicSniper");
    service.addGrantedFeat(id, { featId: SPELL_SNIPER });
    expect(optionFor(service, id, SORCEROUS_BURST).range).toBe("180 feet");
    expect(optionFor(service, id, MIND_SLIVER).range).toBe("60 feet");
  });

  it("offers neither Hold Person nor a DM-granted Cure Wounds, but does offer a DM-granted Fire Bolt", () => {
    const { service, id } = draconicSorcerer("DraconicNonDamaging");
    learn(service, id, HOLD_PERSON);
    service.addGrantedSpell(id, { spellId: CURE_WOUNDS });
    service.addGrantedSpell(id, { spellId: FIRE_BOLT });
    const ids = spellOptions(service, id).map((option) => option.spellId);
    expect(ids).not.toContain(HOLD_PERSON);
    expect(ids).not.toContain(CURE_WOUNDS);
    expect(optionFor(service, id, FIRE_BOLT)).toMatchObject({ casterName: "Sorcerer", bonus: "+5 CHA vs AC" });
  });

  it("creates a row from a saving-throw spell and keeps it through export and import", () => {
    const { service, id } = draconicSorcerer("DraconicSaveRow");
    const option = optionFor(service, id, MIND_SLIVER);
    const row = service.createAttack(id, {
      mode: "spell",
      casterIdentifier: option.casterIdentifier,
      spellId: option.spellId,
      name: null, range: null, bonus: null, damage: null, description: null,
    }).at(-1)!;
    expect(row).toMatchObject({
      name: "Mind Sliver",
      kind: "spell",
      bonus: "DC 13 INT",
      damage: "1d6 Psychic",
      overriddenFields: [],
      source: { spellId: MIND_SLIVER, casterIdentifier: option.casterIdentifier },
    });

    const exported = service.exportCharacterXml(id);
    expect(exported).toContain('attack="DC 13 INT"');
    expect(exported).toContain(`spell-id="${MIND_SLIVER}"`);
    const reloaded = new CharacterService(undefined, library, { rng: seededRng(7) });
    reloaded.importCharacterXml("DraconicSaveRowReloaded", exported);
    expect(reloaded.getAttacks("DraconicSaveRowReloaded").at(-1)).toMatchObject({
      name: "Mind Sliver",
      kind: "spell",
      bonus: "DC 13 INT",
      generated: { bonus: "DC 13 INT", damage: "1d6 Psychic" },
      overriddenFields: [],
      source: { spellId: MIND_SLIVER, warning: "" },
    });
  });
});

describe("a class caster handed an attack spell by the DM", () => {
  it("uses an attuned caster-specific bonus in the Magic tab, row, breakdown and saved file", () => {
    const { service, id } = build2024("PactKeeper", "ID_WOTC_PHB24_CLASS_WARLOCK", 3);
    service.addGrantedSpell(id, { spellId: MIND_SLIVER });
    service.addItem(id, { itemId: "ID_WOTC_DMG_MAGIC_ITEM_ROD_OF_THE_PACT_KEEPER_1", amount: 1 });
    service.attuneItem(id, service.getCharacter(id).items.at(-1)!.identifier, true);
    const caster = service.getSpellcasting(id)[0]!;
    const option = optionFor(service, id, MIND_SLIVER);
    expect(caster.saveDc).toBe(14);
    expect(option.bonus).toBe("DC 14 INT");
    expect(option.computation.attackBonusContributions.reduce((n, c) => n + c.value, 0)).toBe(caster.saveDc);
    expect(service.getAttackOptions(id).casters[0]).toMatchObject({ attackModifier: caster.attackModifier });
    service.createAttack(id, { mode: "spell", casterIdentifier: option.casterIdentifier, spellId: MIND_SLIVER,
      name: null, range: null, bonus: null, damage: null, description: null });
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain('attack="DC 14 INT"');
    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml("reload", xml);
    expect(reader.getAttacks("reload").at(-1)!.bonus).toBe("DC 14 INT");
  });

  it("offers registered 2014 domain spells without borrowing higher-level grants from multiclass slots", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("LightDomain").id;
    service.setRulesetMode(id, "2014");
    service.setAbilities(id, { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
    const pick = (type: string, element: string): void => {
      const rule = service.getCharacterDetail(id).selectionRules.find((r) => r.type === type)!;
      service.setSelection(id, rule.identifier, element);
    };
    pick("Class", "ID_WOTC_PHB_CLASS_CLERIC");
    pick("Archetype", "ID_WOTC_PHB_ARCHETYPE_CLERIC_LIGHT_DOMAIN");
    const burningHands = "ID_PHB_SPELL_BURNING_HANDS";
    expect(service.getSpellcasting(id)[0]!.knownSpells.find((s) => s.id === burningHands)?.isAlwaysPrepared).toBe(true);
    expect(optionFor(service, id, burningHands).bonus).toBe("DC 12 DEX");
    service.levelUp(id);
    service.setCharacterOption(id, { optionId: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING", enabled: true });
    const wizard = "ID_WOTC_PHB_MULTICLASS_WIZARD";
    service.startMulticlass(id, wizard);
    for (let i = 0; i < 3; i++) service.levelUpMode(id, { mode: "multiclass", classId: wizard });
    expect(service.getCharacter(id).magic!.casters[0]!.slots.s3).toBe("2");
    expect(spellOptions(service, id).filter((s) => s.casterName === "Cleric").map((s) => s.spellId)).toEqual([burningHands]);
  });

  it("offers the grant on the first class caster and can add it as a row", () => {
    const { service, id } = build2024("ClericGrantAttack", CLERIC, 2);
    service.addGrantedSpell(id, { spellId: FIRE_BOLT });
    const caster = service.getSpellcasting(id)[0]!;
    const option = optionFor(service, id, FIRE_BOLT);
    expect(option).toMatchObject({ casterName: "Cleric", casterIdentifier: caster.identifier });
    const rows = service.createAttack(id, {
      mode: "spell",
      casterIdentifier: option.casterIdentifier,
      spellId: option.spellId,
      name: null, range: null, bonus: null, damage: null, description: null,
    });
    expect(rows.at(-1)).toMatchObject({ kind: "spell", source: { spellId: FIRE_BOLT } });
  });
});
