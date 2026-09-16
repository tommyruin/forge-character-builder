/**
 * Sheet attack rows: the exported sheet must agree with the values the Attacks
 * panel shows. Weapon and unarmed rows are recomputed on every read, so the
 * sheet has to follow the resolved row rather than the attribute that was
 * written into the document when the row was created.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { buildCharacterSheetModel } from "./model.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let libraryPromise: Promise<ElementLibrary> | null = null;
const library = (): Promise<ElementLibrary> => {
  libraryPromise ??= buildCorpusLibrary();
  return libraryPromise;
};

beforeAll(async () => {
  await library();
}, 120_000);

/** Every `details_attack<n>_*` field of the sheet model, flattened. */
const sheetAttackFields = (
  service: CharacterService,
  library: ElementLibrary,
  id: string,
): Record<string, string> => {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", canonical: false });
  const fields: Record<string, string> = {};
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (/^details_attack\d_/.test(key) && typeof value === "string") fields[key] = value;
      else walk(value);
    }
  };
  walk(model);
  return fields;
};

/** Every token row of the canonical sheet model, joined into one searchable string. */
const sheetTokenText = (service: CharacterService, library: ElementLibrary, id: string): string => {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", canonical: true });
  const rows: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.tokens) && record.kind === "tokens") {
      rows.push((record.tokens as string[]).join(" "));
      return;
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(model);
  return rows.join("\n");
};

const selectClass = async (service: CharacterService, id: string, classId: string): Promise<void> => {
  const lib = await library();
  const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
  const option = selectionOptions(service.getCharacter(id), lib, rule).find((o) => o.id === classId)!;
  service.setSelection(id, rule.identifier, option.id);
};

const FIRE_BOLT = "ID_PHB_SPELL_FIRE_BOLT";

/** A level-4 wizard knowing Fire Bolt with a linked spell attack row. */
const makeFireBoltWizard = async (service: CharacterService, id: string): Promise<string> => {
  const lib = await library();
  service.setAbilities(id, {
    strength: 8, dexterity: 14, constitution: 14, intelligence: 16, wisdom: 12, charisma: 10,
  });
  await selectClass(service, id, "ID_WOTC_PHB_CLASS_WIZARD");
  const spellRule = pendingSelectionRules(service.getCharacter(id)).find(
    (r) => r.type === "Spell" && selectionOptions(service.getCharacter(id), lib, r).some((o) => o.id === FIRE_BOLT),
  );
  if (spellRule === undefined) throw new Error("no Spell rule offering Fire Bolt");
  service.setSelection(id, spellRule.identifier, FIRE_BOLT, 1);
  while (service.getCharacter(id).level < 4) service.levelUpMode(id, { mode: "main" });
  const option = service.getAttackOptions(id).spells.find(
    (candidate) => (candidate as { spellId?: string }).spellId === FIRE_BOLT,
  ) as { casterIdentifier: string; spellId: string };
  const created = service.createAttack(id, {
    mode: "spell",
    casterIdentifier: option.casterIdentifier,
    spellId: option.spellId,
    name: null, range: null, bonus: null, damage: null, description: null,
  }).at(-1)!;
  return created.id;
};

/** Exports `id` and imports the file as a new character, as a save/reload does. */
const roundTrip = (service: CharacterService, id: string): string => {
  const copy = `${id}-copy`;
  service.importCharacterXml(copy, service.exportCharacterXml(id));
  return copy;
};

describe("sheet attack rows", () => {
  it("prints a round-tripped spell row's current damage after a level-up", async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Sheet Wizard").id;
    const rowId = await makeFireBoltWizard(service, id);
    const copy = roundTrip(service, id);
    while (service.getCharacter(copy).level < 5) service.levelUpMode(copy, { mode: "main" });

    const row = service.getAttacks(copy).find((a) => a.id === rowId)!;
    expect(row.damage).toBe("2d10 fire");
    expect(row.overriddenFields).toEqual([]);
    const fields = sheetAttackFields(service, lib, copy);
    expect(fields["details_attack1_weapon"]).toBe("Fire Bolt");
    expect(fields["details_attack1_attack"]).toBe(row.bonus);
    expect(fields["details_attack1_damage"]).toBe("2d10 fire");
    const attackLine = sheetTokenText(service, lib, copy)
      .split("\n")
      .find((line) => line.startsWith("Fire Bolt 120 feet"));
    expect(attackLine).toBe(`Fire Bolt 120 feet ${row.bonus} 2d10 fire`);
  });

  it("keeps a pinned spell-row damage through a round-trip and level-up", async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Pinned Wizard").id;
    const rowId = await makeFireBoltWizard(service, id);
    service.updateAttack(id, rowId, { damage: "9d9 pinned" });
    const copy = roundTrip(service, id);
    while (service.getCharacter(copy).level < 5) service.levelUpMode(copy, { mode: "main" });

    const row = service.getAttacks(copy).find((a) => a.id === rowId)!;
    expect(row.damage).toBe("9d9 pinned");
    expect(row.overriddenFields).toContain("damage");
    const fields = sheetAttackFields(service, lib, copy);
    expect(fields["details_attack1_damage"]).toBe("9d9 pinned");
    expect(sheetTokenText(service, lib, copy)).toContain("9d9 pinned");
  });

  it("exports the monk's current unarmed die after a level-up", async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Sheet Monk").id;
    service.setAbilities(id, {
      strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
    });
    await selectClass(service, id, "ID_WOTC_PHB_CLASS_MONK");
    service.createAttack(id, { mode: "unarmed" });
    while (service.getCharacter(id).level < 5) service.levelUpMode(id, { mode: "main" });

    const row = service.getAttacks(id).find((a) => a.kind === "unarmed")!;
    expect(row.damage).toBe("1d6+4 bludgeoning");
    const fields = sheetAttackFields(service, lib, id);
    expect(fields["details_attack1_weapon"]).toBe("Unarmed Strike");
    expect(fields["details_attack1_attack"]).toBe(row.bonus);
    expect(fields["details_attack1_damage"]).toBe(row.damage);
  });

  it("exports a weapon row's current bonus after the proficiency bonus rises", async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Sheet Fighter").id;
    service.setAbilities(id, {
      strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8,
    });
    await selectClass(service, id, "ID_WOTC_PHB_CLASS_FIGHTER");
    service.addItem(id, { itemId: "ID_WOTC_PHB_WEAPON_LONGSWORD", amount: 1, baseElementId: null });
    while (service.getCharacter(id).level < 5) service.levelUpMode(id, { mode: "main" });

    const row = service.getAttacks(id).find((a) => a.kind === "weapon")!;
    // Level 5 raises the proficiency bonus to +3: STR +3 plus proficiency +3.
    expect(row.bonus).toBe("+6 vs AC");
    const fields = sheetAttackFields(service, lib, id);
    expect(fields["details_attack1_attack"]).toBe(row.bonus);
    expect(fields["details_attack1_damage"]).toBe(row.damage);
  });

  it("prints only the current 2024 weapon mastery before and after clearing and reimport", async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Sheet Cleaver").id;
    service.setRulesetMode(id, "2024");
    service.setAbilities(id, {
      strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8,
    });
    await selectClass(service, id, "ID_WOTC_PHB24_CLASS_FIGHTER");
    const mastery = pendingSelectionRules(service.getCharacter(id)).find(
      (r) => r.name === "Weapon Mastery (Fighter 1)",
    )!;
    service.setSelection(
      id,
      mastery.identifier,
      "ID_WOTC_PHB24_CLASS_FEATURE_MASTERY_PROPERTY_GREATAXE_CLEAVE",
    );
    service.addItem(id, { itemId: "ID_WOTC_PHB24_WEAPON_GREATAXE", amount: 1, baseElementId: null });

    const row = service.getAttacks(id).find((a) => a.kind === "weapon")!;
    expect(row.mastery).toEqual({ name: "Cleave", active: true });
    const fields = sheetAttackFields(service, lib, id);
    expect(fields["details_attack1_description"]).toContain("Mastery: Cleave");
    expect(sheetTokenText(service, lib, id)).toContain("Mastery: Cleave");

    service.clearSelection(id, mastery.identifier, 1);
    const copy = roundTrip(service, id);
    for (const characterId of [id, copy]) {
      const attack = service.getAttacks(characterId).find((a) => a.kind === "weapon")!;
      expect(attack.description).toBe("Heavy, Two-Handed");
      expect(sheetAttackFields(service, lib, characterId)["details_attack1_description"]).toBe(attack.description);
      expect(sheetTokenText(service, lib, characterId)).not.toContain("Mastery: Cleave");
    }
  });
});
