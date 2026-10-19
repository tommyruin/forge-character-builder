/**
 * Custom spells on a character, end to end: a spell made through the service is
 * stored in the character file, compiled to a Spell element, installed in the
 * library and granted to a caster, and from then on the Magic tab, the attack
 * rows, the selection pickers and the sheet treat it like any book spell, with
 * its attack bonus, save DC and damage read from its structured fields.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import type { MagicAttackSpellOptionDto } from "../magic/reconcile.js";
import { buildPaladin3, buildWizard4, sharedLibrary, seededRng } from "../testing/character-factory.js";
import { createCustomSpellDraft, type CustomSpellDraft } from "./schema.js";

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map(base.fileContents ?? []));
}, 120_000);

let counter = 0;
const wizard = () => buildWizard4(library, `CustomSpell${counter++}`);
const paladin = () => buildPaladin3(library, `CustomSpell${counter++}`);

/** A ranged-attack spell that upcasts. */
function frostLance(extra: Partial<CustomSpellDraft> = {}): CustomSpellDraft {
  return {
    ...createCustomSpellDraft("Frost Lance"),
    description: "A lance of ice flies at a creature within range. Make a ranged spell attack.",
    level: 1,
    school: "Evocation",
    castingTime: "1 action",
    range: "120 feet",
    duration: "Instantaneous",
    components: { verbal: true, somatic: true },
    mechanics: {
      roll: "attackRanged",
      damage: [{ dice: "2d8", type: "cold" }],
      scaling: { kind: "slot", dice: "1d6" },
    },
    ...extra,
  };
}

const allKnown = (service: CharacterService, id: string) =>
  service.getSpellcasting(id).flatMap((caster) => caster.knownSpells.map((spell) => ({ caster: caster.name, spell })));

const optionFor = (service: CharacterService, id: string, spellId: string): MagicAttackSpellOptionDto | undefined =>
  (service.getAttackOptions(id).spells as MagicAttackSpellOptionDto[]).find((option) => option.spellId === spellId);

const tokensOf = (rows: Array<{ kind: string; tokens?: readonly string[] }>): string =>
  rows.flatMap((row) => (row.kind === "tokens" ? [...(row.tokens ?? [])] : [])).join(" ");

describe("a created ranged-attack spell", () => {
  it("is known to the chosen caster and prepared, with the attack bonus and damage its fields give", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance(), caster: "Wizard" });
    expect(saved.diagnostics).toEqual([]);
    expect(saved.entry).toMatchObject({ kind: "spell", type: "Spell", granted: true, installed: true });

    const known = allKnown(service, id).find((entry) => entry.spell.id === saved.entry.elementId)!;
    expect(known.caster).toBe("Wizard");
    expect(known.spell).toMatchObject({ name: "Frost Lance", source: "Custom", level: 1, school: "Evocation", isAlwaysPrepared: true });

    // Intelligence 16 (+3), proficiency +2.
    expect(optionFor(service, id, saved.entry.elementId)).toMatchObject({
      casterName: "Wizard",
      spellName: "Frost Lance",
      bonus: "+5 INT vs AC",
      damage: "2d8 cold",
      range: "120 feet",
      warning: "Higher-level slots add 1d6 per slot level above 1st.",
    });
  });

  it("prints on the attack rows and the sheet", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance(), caster: "Wizard" });
    const option = optionFor(service, id, saved.entry.elementId)!;
    service.createAttack(id, { mode: "spell", casterIdentifier: option.casterIdentifier, spellId: option.spellId });
    expect(service.getAttacks(id).find((row) => row.kind === "spell")).toMatchObject({
      name: "Frost Lance",
      bonus: "+5 INT vs AC",
      damage: "2d8 cold",
    });

    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(model.pages[0]!.attacks).toEqual([
      expect.objectContaining({ name: "Frost Lance", bonus: "+5 INT vs AC", damage: "2d8 cold" }),
    ]);
    const list = tokensOf(model.pages.filter((page) => page.templateKind === "spell-list").flatMap((page) => page.sections.flatMap((section) => section.rows)));
    expect(list).toContain("Frost");
    const cards = tokensOf(model.pages.filter((page) => page.templateKind === "spell-cards").flatMap((page) => page.sections.flatMap((section) => section.rows)));
    expect(cards).toContain("Frost Lance");
    expect(cards).toContain("lance of ice");
  });

  it("is a saving-throw spell with a DC when its fields say so, and a cantrip grows by tier", () => {
    const { service, id } = wizard();
    const flame = service.saveCustomDraft(id, {
      draft: {
        ...frostLance(),
        name: "Ember Burst",
        level: 0,
        mechanics: {
          roll: "save",
          saveAbility: "dexterity",
          halfOnSave: true,
          damage: [{ dice: "1d8", type: "fire" }],
          scaling: { kind: "cantrip", tiers: [{ level: 5, dice: "2d8" }, { level: 11, dice: "3d8" }] },
        },
      },
      caster: "Wizard",
    });
    expect(optionFor(service, id, flame.entry.elementId)).toMatchObject({ bonus: "DC 13 DEX", damage: "1d8 fire" });
    expect(optionFor(service, id, flame.entry.elementId)!.computation.sourceNotes).toContain("Half damage on a successful save.");
    // The wizard reaches level 5: the second tier.
    service.levelUp(id);
    expect(optionFor(service, id, flame.entry.elementId)).toMatchObject({ damage: "2d8 fire" });
  });

  it("reads the fields, not the text: a spell that is no attack has no row whatever its text says", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, {
      draft: frostLance({ mechanics: { roll: "none", damage: [{ dice: "2d8", type: "cold" }] } }),
      caster: "Wizard",
    });
    expect(optionFor(service, id, saved.entry.elementId)).toBeUndefined();
  });

  it("with no mechanics at all reads the text like a book spell", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, {
      draft: frostLance({
        mechanics: undefined,
        description: "Make a ranged spell attack against a creature. On a hit, the target takes 1d10 cold damage.",
      }),
      caster: "Wizard",
    });
    expect(optionFor(service, id, saved.entry.elementId)).toMatchObject({ damage: "1d10 cold", bonus: "+5 INT vs AC" });
  });

  it("can be kept in the pack without being granted, and granted later", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance(), grant: false });
    expect(saved.entry).toMatchObject({ granted: false, installed: true });
    expect(allKnown(service, id).some((entry) => entry.spell.id === saved.entry.elementId)).toBe(false);
    service.addGrantedSpell(id, { spellId: saved.entry.elementId, caster: "Wizard" });
    expect(service.getCustomContent(id).entries[0]).toMatchObject({ granted: true });
  });

  it("with no caster named gathers under Additional Spells", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance() });
    expect(allKnown(service, id).find((entry) => entry.spell.id === saved.entry.elementId)?.caster).toBe("Additional Spells");
  });

  it("refuses a caster the character does not have before storing anything", () => {
    const { service, id } = wizard();
    expect(() => service.saveCustomDraft(id, { draft: frostLance(), caster: "Warlock" })).toThrow(/Warlock/);
    expect(service.getCustomContent(id).entries).toEqual([]);
  });

  it("survives a name with an ampersand and quotes in the magic region", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance({ name: 'Frost & "Flame"' }), caster: "Wizard" });
    const xml = service.exportCharacterXml(id);
    const other = new CharacterService(undefined, library, { rng: seededRng(5) });
    other.importCharacterXml("Reloaded", xml);
    const known = other.getSpellcasting("Reloaded").flatMap((caster) => caster.knownSpells);
    expect(known.find((spell) => spell.id === saved.entry.elementId)?.name).toBe('Frost & "Flame"');
    const model = buildCharacterSheetModel(other.getCharacter("Reloaded"), library, { mode: "full" });
    const cards = tokensOf(model.pages.filter((page) => page.templateKind === "spell-cards").flatMap((page) => page.sections.flatMap((section) => section.rows)));
    expect(cards).not.toContain("&amp;");
  });
});

/** The pending spell rule of the character that offers first-level spells (Magic Missile). */
function leveledSpellRule(service: CharacterService, id: string) {
  const state = service.getCharacter(id);
  const rule = pendingSelectionRules(state).find(
    (candidate) => candidate.type === "Spell" && selectionOptions(state, library, candidate).some((option) => option.id === "ID_PHB_SPELL_MAGIC_MISSILE"),
  );
  if (rule === undefined) throw new Error("no pending rule offers first-level spells");
  return { rule, state };
}

describe("a class-list tag", () => {
  it("offers the spell to that class's picker", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance({ classes: ["Wizard"] }), grant: false });
    const tagged = leveledSpellRule(service, id);
    expect(selectionOptions(tagged.state, library, tagged.rule).map((option) => option.id)).toContain(saved.entry.elementId);

    const untagged = wizard();
    const plain = untagged.service.saveCustomDraft(untagged.id, { draft: frostLance(), grant: false });
    const other = leveledSpellRule(untagged.service, untagged.id);
    expect(selectionOptions(other.state, library, other.rule).map((option) => option.id)).not.toContain(plain.entry.elementId);
  });

  it("puts the spell on a full-list caster's list, ready to prepare, with the caster's attack bonus", () => {
    const { service, id } = paladin();
    const saved = service.saveCustomDraft(id, { draft: frostLance({ classes: ["Paladin"] }), grant: false });
    const listed = allKnown(service, id).find((entry) => entry.spell.id === saved.entry.elementId);
    expect(listed).toMatchObject({ caster: "Paladin", spell: { isPrepared: false } });
    expect(optionFor(service, id, saved.entry.elementId)).toBeUndefined();

    const paladinId = service.getSpellcasting(id).find((caster) => caster.name === "Paladin")!.identifier;
    service.setPrepared(id, paladinId, { spellId: saved.entry.elementId, prepared: true });
    // Charisma 14 (+2), proficiency +2.
    expect(optionFor(service, id, saved.entry.elementId)).toMatchObject({ casterName: "Paladin", bonus: "+4 CHA vs AC", damage: "2d8 cold" });
  });
});

describe("editing and removing", () => {
  it("re-reads a granted spell after an edit: new name, new numbers, one entry", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance(), caster: "Wizard" });
    const edited = service.saveCustomDraft(id, {
      draft: frostLance({ id: saved.entry.elementId, name: "Glacial Lance", level: 2, mechanics: { roll: "attackRanged", damage: [{ dice: "3d8", type: "cold" }] } }),
    });
    expect(edited.entry).toMatchObject({ granted: true });
    expect(service.getCustomContent(id).entries).toHaveLength(1);
    const option = optionFor(service, id, saved.entry.elementId)!;
    expect(option).toMatchObject({ spellName: "Glacial Lance", level: 2, damage: "3d8 cold", warning: null });
    // The stored line in the file follows the new name and level.
    expect(service.exportCharacterXml(id)).toContain('name="Glacial Lance" level="2"');
    expect(service.exportCharacterXml(id)).not.toContain("Frost Lance");
  });

  it("removes the grant, the stored copy and the element, including a pick made from a class list", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance({ classes: ["Wizard"] }), caster: "Wizard" });
    service.deleteCustomDraft(id, { draftId: saved.entry.elementId });
    expect(service.getCustomContent(id).entries).toEqual([]);
    expect(allKnown(service, id).some((entry) => entry.spell.id === saved.entry.elementId)).toBe(false);
    expect(service.exportCharacterXml(id)).not.toContain("forge-builder");
    expect(service.exportCharacterXml(id)).not.toContain(saved.entry.elementId);

    const picked = wizard();
    const draft = picked.service.saveCustomDraft(picked.id, { draft: frostLance({ classes: ["Wizard"] }), grant: false });
    const { rule } = leveledSpellRule(picked.service, picked.id);
    picked.service.setSelection(picked.id, rule.identifier, draft.entry.elementId);
    expect(picked.service.exportCharacterXml(picked.id)).toContain(`registered="${draft.entry.elementId}"`);
    picked.service.deleteCustomDraft(picked.id, { draftId: draft.entry.elementId });
    expect(picked.service.exportCharacterXml(picked.id)).not.toContain(draft.entry.elementId);
  });

  it("will not reuse a feature's or an item's id for a spell", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance(), caster: "Wizard" });
    const feature = { ...frostLance(), template: "boon", id: saved.entry.elementId, showsUnder: "other", blocks: [] };
    expect(() => service.saveCustomDraft(id, { draft: feature })).toThrow(/spell/);
  });
});

describe("a spell in the file", () => {
  it("is the same spell after a reload, and a file without custom spells is untouched", () => {
    const { service, id } = wizard();
    const original = service.exportCharacterXml(id);
    const saved = service.saveCustomDraft(id, { draft: frostLance(), caster: "Wizard" });
    const exported = service.exportCharacterXml(id);
    expect(exported).toContain("<forge-builder");

    const other = new CharacterService(undefined, library, { rng: seededRng(5) });
    other.importCharacterXml("Reloaded", exported);
    expect(other.exportCharacterXml("Reloaded")).toBe(exported);
    expect(optionFor(other, "Reloaded", saved.entry.elementId)).toMatchObject({ bonus: "+5 INT vs AC", damage: "2d8 cold" });
    expect(other.getCustomContent("Reloaded").entries[0]).toMatchObject({ kind: "spell", granted: true, installed: true });

    service.deleteCustomDraft(id, { draftId: saved.entry.elementId });
    expect(service.exportCharacterXml(id)).toBe(original);
  });

  it("promotes with a stable id and the collection's source name", () => {
    const { service, id } = wizard();
    const saved = service.saveCustomDraft(id, { draft: frostLance({ classes: ["Wizard"] }), caster: "Wizard" });
    const promoted = service.promoteCustomDraft(id, { draftId: saved.entry.elementId, source: "Moonwell Campaign" });
    expect(promoted.id).toBe(saved.entry.elementId);
    expect(promoted.xml).toContain('source="Moonwell Campaign"');
    expect(promoted.element).toMatchObject({ type: "Spell", name: "Frost Lance", supports: ["Wizard"], idLocked: true });
  });
});

describe("previewing a spell", () => {
  it("shows the row the spell would give this character without saving it", () => {
    const { service, id } = wizard();
    const preview = service.previewCustomSpell(id, { draft: frostLance(), caster: "Wizard" });
    expect(preview.attack).toMatchObject({ casterName: "Wizard", bonus: "+5 INT vs AC", damage: "2d8 cold", range: "120 feet" });
    expect(service.getCustomContent(id).entries).toEqual([]);
    expect(allKnown(service, id).some((entry) => entry.spell.name === "Frost Lance")).toBe(false);
  });

  it("has no row for a spell that is no attack", () => {
    const { service, id } = wizard();
    expect(service.previewCustomSpell(id, { draft: frostLance({ mechanics: { roll: "none" } }), caster: "Wizard" }).attack).toBeNull();
  });
});
