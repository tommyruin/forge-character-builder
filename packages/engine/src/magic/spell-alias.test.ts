/**
 * A spell alias: this character's own name and note for a spell, book or custom.
 * It changes what is printed, never what the spell is: the Magic tab leads with
 * the alias and keeps the real name beside it, the sheet's spell list, cards and
 * attack rows print it, and the spell's rules and numbers are untouched. The
 * alias lives in the builder's block of the character file, which a file that
 * uses no alias does not have.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { createCustomSpellDraft } from "../custom/schema.js";
import type { MagicAttackSpellOptionDto } from "./reconcile.js";
import { buildWizard4, seededRng, sharedLibrary } from "../testing/character-factory.js";

const BARKSKIN = "ID_PHB_SPELL_BARKSKIN";
const CURE_WOUNDS = "ID_PHB_SPELL_CURE_WOUNDS";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

let counter = 0;
const wizard = () => buildWizard4(library, `SpellAlias${counter++}`);

const known = (service: CharacterService, id: string, spellId: string) =>
  service.getSpellcasting(id).flatMap((caster) => caster.knownSpells).find((spell) => spell.id === spellId);

const pageText = (service: CharacterService, id: string, kind: string): string => {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const sections = model.pages.filter((page) => page.templateKind === kind).flatMap((page) => page.sections);
  const rows = sections.flatMap((section) => section.rows).flatMap((row) => (row.kind === "tokens" ? [...row.tokens] : []));
  // A card's text is laid out as positioned runs.
  const runs = sections.flatMap((section) => section.positionedRuns ?? []).map((run) => run.text);
  return [...rows, ...runs].join(" ");
};

describe("a spell's alias", () => {
  it("leads on the Magic tab with the real name kept beside it", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    expect(known(service, id, BARKSKIN)).not.toHaveProperty("alias");

    service.setSpellAlias(id, BARKSKIN, { name: "Moonlit Ward", note: "Silver light, not bark." });
    expect(known(service, id, BARKSKIN)).toMatchObject({
      name: "Barkskin",
      alias: { name: "Moonlit Ward", note: "Silver light, not bark." },
    });
  });

  it("changes nothing about what the spell is", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    const before = known(service, id, BARKSKIN)!;
    service.setSpellAlias(id, BARKSKIN, { name: "Moonlit Ward" });
    const after = known(service, id, BARKSKIN)!;
    const { alias: _alias, ...rest } = after;
    expect(rest).toEqual(before);
  });

  it("prints on the sheet: the list shows the alias, the card shows it with the real name and the note", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    service.setSpellAlias(id, BARKSKIN, { name: "Moonlit Ward", note: "Silver light, not bark." });
    const list = pageText(service, id, "spell-list");
    expect(list).toContain("Moonlit Ward");
    expect(list).not.toContain("Barkskin");
    expect(list).not.toContain("Moonlit Ward (Barkskin)");
    const cards = pageText(service, id, "spell-cards");
    expect(cards).toContain("Moonlit Ward (Barkskin)");
    expect(cards).toContain("Silver light, not bark.");
  });

  it("names the attack option and the attack row, with the real name in parentheses", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, {
      draft: {
        ...createCustomSpellDraft("Frost Lance"),
        level: 1,
        description: "A lance of ice.",
        mechanics: { roll: "attackRanged", damage: [{ dice: "2d8", type: "cold" }] },
      },
      caster: "Wizard",
    });
    const spellId = saved.entry.elementId;
    const option = () => (service.getAttackOptions(id).spells as MagicAttackSpellOptionDto[]).find((entry) => entry.spellId === spellId)!;
    service.createAttack(id, { mode: "spell", casterIdentifier: option().casterIdentifier, spellId });
    expect(service.getAttacks(id).find((row) => row.kind === "spell")!.name).toBe("Frost Lance");

    service.setSpellAlias(id, spellId, { name: "Rimebolt" });
    expect(option().spellName).toBe("Rimebolt (Frost Lance)");
    expect(service.getAttacks(id).find((row) => row.kind === "spell")).toMatchObject({
      name: "Rimebolt (Frost Lance)",
      bonus: "+5 INT vs AC",
      damage: "2d8 cold",
    });
    // The row in the file follows, so an export prints the same name.
    expect(service.exportCharacterXml(id)).toContain("Rimebolt (Frost Lance)");
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(model.pages[0]!.attacks?.[0]).toMatchObject({ name: "Rimebolt (Frost Lance)", damage: "2d8 cold" });

    service.setSpellAlias(id, spellId, { name: "" });
    expect(service.getAttacks(id).find((row) => row.kind === "spell")!.name).toBe("Frost Lance");
  });

  it("is removed by an empty name and note, leaving the file as it was", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    const before = service.exportCharacterXml(id);
    service.setSpellAlias(id, BARKSKIN, { name: "Moonlit Ward", note: "x" });
    expect(service.exportCharacterXml(id)).toContain("<spell-aliases");
    service.setSpellAlias(id, BARKSKIN, { name: "", note: "" });
    expect(service.exportCharacterXml(id)).toBe(before);
    expect(known(service, id, BARKSKIN)).not.toHaveProperty("alias");
  });

  it("can hold a note without a name, and a name without a note", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    service.setSpellAlias(id, BARKSKIN, { note: "Cast it at dusk." });
    expect(known(service, id, BARKSKIN)!.alias).toEqual({ name: "", note: "Cast it at dusk." });
    // An omitted field is left alone.
    service.setSpellAlias(id, BARKSKIN, { name: "Duskward" });
    expect(known(service, id, BARKSKIN)!.alias).toEqual({ name: "Duskward", note: "Cast it at dusk." });
    // A note alone leaves the printed name as the spell's own.
    service.setSpellAlias(id, BARKSKIN, { name: "" });
    expect(pageText(service, id, "spell-list")).toContain("Barkskin");
  });

  it("is kept in the builder block, survives a reload and does not disturb other spells", () => {
    const { service, id } = wizard();
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    service.addGrantedSpell(id, { spellId: CURE_WOUNDS, caster: "Wizard" });
    service.setSpellAlias(id, BARKSKIN, { name: "Moonlit Ward" });
    const exported = service.exportCharacterXml(id);
    expect(exported).toMatch(/<forge-builder version="1">[\s\S]*<spell-aliases schema="1">/);
    expect(exported.match(/<forge-builder\b/g)).toHaveLength(1);

    const other = new CharacterService(undefined, library, { rng: seededRng(5) });
    other.importCharacterXml("Reloaded", exported);
    expect(other.exportCharacterXml("Reloaded")).toBe(exported);
    expect(known(other, "Reloaded", BARKSKIN)!.alias).toEqual({ name: "Moonlit Ward", note: "" });
    expect(known(other, "Reloaded", CURE_WOUNDS)).not.toHaveProperty("alias");
  });

  it("sits beside the custom pack without disturbing it", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, {
      draft: { ...createCustomSpellDraft("Frost Lance"), level: 1, description: "A lance of ice." },
      caster: "Wizard",
    });
    service.setSpellAlias(id, saved.entry.elementId, { name: "Rimebolt" });
    expect(service.exportCharacterXml(id).match(/<forge-builder\b/g)).toHaveLength(1);
    service.deleteCustomDraft(id, { draftId: saved.entry.elementId });
    // The pack is gone, the alias block stays (the alias is not the pack's to delete).
    expect(service.exportCharacterXml(id)).toContain("<spell-aliases");
    expect(service.exportCharacterXml(id)).not.toContain("<custom-pack");
  });

  it("refuses an unknown spell, a name that is too long, and a damaged block", () => {
    const { service, id } = wizard();
    expect(() => service.setSpellAlias(id, "ID_NO_SUCH_SPELL", { name: "x" })).toThrow(/spell/i);
    expect(() => service.setSpellAlias(id, BARKSKIN, { name: "x".repeat(200) })).toThrow(/name/);
    service.setSpellAlias(id, BARKSKIN, { name: "Moonlit Ward" });
    const broken = service.exportCharacterXml(id).replace(/(<spell-aliases[^>]*>)<!\[CDATA\[.*?\]\]>/s, "$1<![CDATA[not json]]>");
    const other = new CharacterService(undefined, library, { rng: seededRng(5) });
    other.importCharacterXml("Broken", broken);
    expect(() => other.setSpellAlias("Broken", BARKSKIN, { name: "y" })).toThrow(/not changed/);
    expect(other.exportCharacterXml("Broken")).toBe(broken);
  });

  it("leaves a file that uses no alias byte-identical through other edits", () => {
    const { service, id } = wizard();
    const original = service.exportCharacterXml(id);
    service.addGrantedSpell(id, { spellId: BARKSKIN, caster: "Wizard" });
    service.removeGrantedSpell(id, { spellId: BARKSKIN });
    expect(service.exportCharacterXml(id)).toBe(original);
    expect(original).not.toContain("forge-builder");
  });
});
