/**
 * DM-granted spells (`<magic><additional>`) on a character with no caster.
 *
 * A grant belongs to no single caster, so the spellcasting projection rides it
 * on the first caster block. A Barbarian has none, so the loop that carried the
 * grants never ran and the spell was dropped: it reached neither the Magic tab,
 * nor the spell pages, nor the attack options. Grants no class caster carries
 * now project as their own slotless block, shaped like a feature caster.
 *
 * A character who does have a class caster is untouched — the grant still rides
 * on that first block, in the same order, and no extra block appears.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules } from "../selection/selection.js";
import type { MagicAttackOptionsMerged } from "../attacks/attacks.js";
import { seededRng, sharedLibrary } from "../testing/character-factory.js";

const BARBARIAN = "ID_WOTC_PHB24_CLASS_BARBARIAN";
const CLERIC = "ID_WOTC_PHB24_CLASS_CLERIC";
const SOLDIER = "ID_WOTC_PHB24_BACKGROUND_SOLDIER";
const ACOLYTE = "ID_WOTC_PHB24_BACKGROUND_ACOLYTE";
const FIRE_BOLT = "ID_WOTC_PHB24_SPELL_FIRE_BOLT";
const MISTY_STEP = "ID_WOTC_PHB24_SPELL_MISTY_STEP";

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
  levels = 2,
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

function spellCardText(model: ReturnType<typeof buildCharacterSheetModel>): string {
  return model.pages
    .filter((page) => page.templateKind === "spell-cards")
    .flatMap((page) => page.sections)
    .flatMap((section) => section.rows)
    .flatMap((row) => (row.kind === "tokens" ? [...row.tokens] : []))
    .join(" ");
}

describe("a non-caster handed a spell by the DM", () => {
  function barbarianWithGrant(label: string, spellId = FIRE_BOLT): { service: CharacterService; id: string } {
    const built = build2024(label, BARBARIAN, SOLDIER);
    built.service.addGrantedSpell(built.id, { spellId });
    return built;
  }

  it("projects the grant as its own slotless block", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrant");
    const state = service.getCharacter(id);
    // The grant lives in <additional> and touches no caster block.
    expect(state.magic?.casters ?? []).toEqual([]);
    expect(state.magic?.additional.map((spell) => spell.id)).toEqual([FIRE_BOLT]);

    const casters = service.getSpellcasting(id);
    expect(casters).toHaveLength(1);
    const caster = casters[0]!;
    expect(caster.name).toBe("Additional Spells");
    expect(caster.kind).toBe("feature");
    expect(caster.requiresPreparation).toBe(false);
    expect(caster.allowReplace).toBe(false);
    expect(caster.prepareCount).toBe(0);
    expect(caster.slotsPerLevel).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(caster.identifier).not.toBe("");
    // The grant names no ability, so the block reports the character's best
    // casting ability: Intelligence (+1) over Wisdom (0) and Charisma (-1).
    expect(caster.ability).toBe("Intelligence");
    // Proficiency (2) + Intelligence modifier (1).
    expect(caster.attackModifier).toBe(3);
    expect(caster.saveDc).toBe(11);
  });

  it("keeps the granted spell always prepared and outside the preparation count", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantPrepared");
    const caster = service.getSpellcasting(id)[0]!;

    expect(caster.knownSpells.map((spell) => spell.id)).toEqual([FIRE_BOLT]);
    const firebolt = caster.knownSpells[0]!;
    expect(firebolt.isAlwaysPrepared).toBe(true);
    expect(firebolt.isPrepared).toBe(false);
    expect(firebolt.isChosen).toBe(true);
    expect(caster.currentPreparedCount).toBe(0);
  });

  it("reports a stable identifier across calls", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantIdentifier");
    const first = service.getSpellcasting(id)[0]!.identifier;
    expect(service.getSpellcasting(id)[0]!.identifier).toBe(first);
  });

  it("prints the granted spell on the spell pages and as a card", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantSheet");
    const model = sheetModel(service, id);
    const tokens = spellListText(model);

    expect(tokens).toContain("Additional");
    expect(tokens).toContain("Fire");
    expect(tokens).toContain("Bolt");
    expect(spellCardTitles(model)).toContain("Fire Bolt");
    // The card keeps filing the grant under its own <additional> source, the
    // origin it carried before this block existed.
    expect(spellCardText(model)).toContain("Additional Spell, Fire Bolt");
  });

  it("admits a levelled grant with no slots to spend", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantLevelled", MISTY_STEP);
    const caster = service.getSpellcasting(id)[0]!;
    expect(caster.maxSpellLevel).toBe(2);
    expect(caster.knownSpells[0]!.isAlwaysPrepared).toBe(true);

    // A block with no slots is admitted on its known spells alone.
    expect(spellListText(sheetModel(service, id))).toContain("Misty");
    expect(spellCardTitles(sheetModel(service, id))).toContain("Misty Step");
  });

  it("offers a granted attack spell as an attack option", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantAttack");
    // The attack-options DTO keeps the magic rows opaque (the spellcasting
    // domain owns their shape), so they are read back through their contract.
    const options = service.getAttackOptions(id) as unknown as MagicAttackOptionsMerged;

    const granted = options.casters.find((caster) => caster.name === "Additional Spells");
    expect(granted).toBeDefined();
    expect(granted!.ability).toBe("Intelligence");
    expect(granted!.attackModifier).toBe(3);
    const firebolt = options.spells.find((spell) => spell.spellId === FIRE_BOLT);
    expect(firebolt).toBeDefined();
    expect(firebolt!.casterName).toBe("Additional Spells");
    expect(firebolt!.casterIdentifier).toBe(service.getSpellcasting(id)[0]!.identifier);
  });

  it("takes the block away again when the grant is removed", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantRemove");
    expect(service.getSpellcasting(id)).toHaveLength(1);

    service.removeGrantedSpell(id, { spellId: FIRE_BOLT });

    expect(service.getCharacter(id).magic?.additional ?? []).toEqual([]);
    expect(service.getSpellcasting(id)).toEqual([]);
    expect(service.getAttackOptions(id).spells ?? []).toEqual([]);
    expect(spellCardTitles(sheetModel(service, id))).not.toContain("Fire Bolt");
  });

  it("gathers several grants into the one block, ordered by level then name", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantMany");
    service.addGrantedSpell(id, { spellId: MISTY_STEP });
    const casters = service.getSpellcasting(id);

    expect(casters).toHaveLength(1);
    expect(casters[0]!.knownSpells.map((spell) => spell.id)).toEqual([FIRE_BOLT, MISTY_STEP]);
  });

  it("leaves the exported document untouched", () => {
    const { service, id } = barbarianWithGrant("BarbarianGrantExport");
    const before = service.exportCharacterXml(id);
    service.getSpellcasting(id);
    service.getAttackOptions(id);
    buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(service.exportCharacterXml(id)).toBe(before);
  });
});

describe("a class caster handed a spell by the DM", () => {
  function clericWithGrant(label: string): { service: CharacterService; id: string } {
    const built = build2024(label, CLERIC, ACOLYTE);
    built.service.addGrantedSpell(built.id, { spellId: FIRE_BOLT });
    return built;
  }

  it("still rides the grant on the class caster, with no extra block", () => {
    const { service, id } = clericWithGrant("ClericGrant");
    const casters = service.getSpellcasting(id);

    expect(casters.map((caster) => [caster.name, caster.kind])).toEqual([["Cleric", "class"]]);
    const firebolt = casters[0]!.knownSpells.find((spell) => spell.id === FIRE_BOLT);
    expect(firebolt).toBeDefined();
    expect(firebolt!.isAlwaysPrepared).toBe(true);
    // Always-prepared grants never count against the preparation limit.
    expect(firebolt!.isPrepared).toBe(false);
  });

  it("appends the grant after the caster's own spells", () => {
    const { service, id } = clericWithGrant("ClericGrantOrder");
    const known = service.getSpellcasting(id)[0]!.knownSpells.map((spell) => spell.id);
    expect(known[known.length - 1]).toBe(FIRE_BOLT);
  });

  it("keeps the exported document byte-identical across the projections", () => {
    const { service, id } = clericWithGrant("ClericGrantExport");
    const before = service.exportCharacterXml(id);
    service.getSpellcasting(id);
    service.getAttackOptions(id);
    buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(service.exportCharacterXml(id)).toBe(before);
  });
});
