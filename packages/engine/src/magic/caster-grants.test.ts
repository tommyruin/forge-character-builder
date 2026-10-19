/**
 * A DM-granted spell can name the caster that casts it. The add-spell dialog
 * always offered a caster, but the call dropped it, so every grant landed in
 * the "Additional Spells" block with the character's best ability. A grant that
 * names a class caster now joins that caster's spells, ready without
 * preparation, and its attack row uses that caster's attack bonus and save DC.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { buildWizard4, sharedLibrary } from "../testing/character-factory.js";
import type { MagicAttackSpellOptionDto } from "./reconcile.js";

/** A cleric cantrip: not on the wizard's list. */
const SACRED_FLAME = "ID_PHB_SPELL_SACRED_FLAME";
const CURE_WOUNDS = "ID_PHB_SPELL_CURE_WOUNDS";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

let counter = 0;
const wizard = () => buildWizard4(library, `CasterGrant${counter++}`);

const spellsOf = (built: ReturnType<typeof wizard>, casterName: string) =>
  built.service.getSpellcasting(built.id).find((caster) => caster.name === casterName)?.knownSpells ?? [];

describe("a granted spell that names its caster", () => {
  it("joins that caster's spells, always prepared, where an unnamed grant gathers elsewhere", () => {
    const named = wizard();
    named.service.addGrantedSpell(named.id, { spellId: CURE_WOUNDS, caster: "Wizard" });
    expect(spellsOf(named, "Wizard").find((spell) => spell.id === CURE_WOUNDS)).toMatchObject({
      isAlwaysPrepared: true,
      isChosen: true,
    });
    expect(named.service.getSpellcasting(named.id).map((caster) => caster.name)).not.toContain("Additional Spells");

    const unnamed = wizard();
    unnamed.service.addGrantedSpell(unnamed.id, { spellId: CURE_WOUNDS });
    expect(spellsOf(unnamed, "Wizard").some((spell) => spell.id === CURE_WOUNDS)).toBe(false);
    expect(spellsOf(unnamed, "Additional Spells").some((spell) => spell.id === CURE_WOUNDS)).toBe(true);
  });

  it("is filed on its card under the caster", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: CURE_WOUNDS, caster: "Wizard" });
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const cards = model.pages.filter((page) => page.templateKind === "spell-cards").flatMap((page) => page.sections);
    const footers = cards.flatMap((section) => section.rows.flatMap((row) => (row.kind === "tokens" ? row.tokens : [])));
    expect(footers.join(" ")).toContain("Additional Spell, Cure Wounds (Wizard)");
  });

  it("casts an attack spell with that caster's attack bonus and save DC", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: SACRED_FLAME, caster: "Wizard" });
    const options = service.getAttackOptions(id).spells as MagicAttackSpellOptionDto[];
    // Intelligence 16 (+3) and proficiency +2.
    expect(options.find((option) => option.spellId === SACRED_FLAME)).toMatchObject({
      casterName: "Wizard",
      bonus: "DC 13 DEX",
    });
  });

  it("refuses a caster the character does not have", () => {
    const { service, id } = wizard();
    expect(() => service.addGrantedSpell(id, { spellId: CURE_WOUNDS, caster: "Warlock" })).toThrow(/Warlock/);
  });

  it("still removes as a DM grant", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: CURE_WOUNDS, caster: "Wizard" });
    expect(service.getDmGrants(id)).toEqual([expect.objectContaining({ kind: "spell", id: CURE_WOUNDS })]);
    service.removeGrantedSpell(id, { spellId: CURE_WOUNDS });
    const known = service.getSpellcasting(id).flatMap((caster) => caster.knownSpells);
    expect(known.some((spell) => spell.id === CURE_WOUNDS)).toBe(false);
  });
});
