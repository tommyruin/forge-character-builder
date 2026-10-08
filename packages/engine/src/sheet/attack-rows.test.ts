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
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildCharacterSheetModel, type CharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { DEFAULT_SHEET_FONTS } from "./template-contract.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";


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
  it("omits generated spell prose but preserves a custom note through reload", async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Concise spell notes").id;
    const row = await makeFireBoltWizard(service, id);
    expect(service.getAttacks(id).find((attack) => attack.id === row)!.description.length).toBeGreaterThan(0);
    expect(sheetAttackFields(service, lib, id)["details_attack1_description"]).toBe("");
    service.updateAttack(id, row, { description: "Aim at the rope" });
    expect(sheetAttackFields(service, lib, roundTrip(service, id))["details_attack1_description"]).toBe("Aim at the rope");
  });

  /** A character with seven displayed manual attacks and a note of the user's own. */
  const sevenAttacks = async () => {
    const lib = await library();
    const service = new CharacterService(undefined, lib);
    const id = service.createCharacter("Seven attacks").id;
    for (let index = 1; index <= 7; index += 1) {
      service.createAttack(id, {
        mode: "manual",
        name: `Blade ${index}`, range: "5 ft", bonus: "+4", damage: `1d${index + 3} slashing`, description: null,
      });
    }
    const state = { ...service.getCharacter(id), attacksDescription: "Aim for the knees." };
    const shown = service.getAttacks(id).filter((attack) => attack.isDisplayed).map((attack) => attack.name);
    return { lib, model: buildCharacterSheetModel(state, lib, { mode: "full", canonical: false }), shown };
  };

  /** The text the writer drew on the character page, and what it drew inside each field. */
  const renderDetails = async (model: CharacterSheetModel, layout: object) => {
    const bundle = localTemplateBundle("2014", DEFAULT_SHEET_FONTS, layout);
    const form = (await PDFDocument.load(bundle.details)).getForm();
    const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, bundle)) }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items
      .flatMap((item) => ("str" in item && item.str.trim() !== "" ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number }] : []));
    const inField = (name: string): string => {
      const box = form.getFields().find((field) => field.getName() === name)?.acroField.getWidgets()[0]?.getRectangle();
      if (box === undefined) return "";
      return items.filter((item) => item.x >= box.x - 0.5 && item.x <= box.x + box.width && item.y >= box.y - 0.5 && item.y <= box.y + box.height)
        .map((item) => item.str).join(" ").replace(/\s+/g, " ");
    };
    return { inField, rows: form.getFields().filter((field) => /^details_attack\d+_weapon$/.test(field.getName())).length };
  };

  it("lists attacks past the fourth row ahead of the free-text notes", async () => {
    const { model, shown } = await sevenAttacks();
    const fields = model.formValues ?? {};
    expect(shown).toHaveLength(7);
    expect(fields["details_attack4_weapon"]).toBe(shown[3]);
    expect(fields["details_attack5_weapon"]).toBeUndefined();
    const rest = shown.slice(4);
    expect(fields["details_attack_description"]).toMatch(/^More attacks: /);
    for (const name of rest) expect(fields["details_attack_description"]).toContain(name);
    expect(fields["details_attack_description"]).toContain("Blade 6: 5 ft, +4, 1d9 slashing");
    expect(fields["details_attack_description"]).toBe(
      "More attacks: Blade 5: 5 ft, +4, 1d8 slashing; Blade 6: 5 ft, +4, 1d9 slashing; Blade 7: 5 ft, +4, 1d10 slashing.\nAim for the knees.",
    );
    // The details page also carries every displayed attack and the user's own
    // notes apart, for a template with more rows.
    const details = model.pages.find((page) => page.templateKind === "details")!;
    expect(details.attacks?.map((attack) => attack.name)).toEqual(shown);
    expect(details.attacks?.[6]).toEqual({ name: "Blade 7", range: "5 ft", bonus: "+4", damage: "1d10 slashing", note: "" });
    expect(details.attackNotes).toBe("Aim for the knees.");
  });

  it("prints attacks past the fourth row in the notes on a four-row sheet", async () => {
    const { model } = await sevenAttacks();
    const page = await renderDetails(model, {});
    expect(page.rows).toBe(4);
    expect(page.inField("details_attack4_weapon")).toBe("Blade 4");
    expect(page.inField("details_attack_description")).toBe(
      "More attacks: Blade 5: 5 ft, +4, 1d8 slashing; Blade 6: 5 ft, +4, 1d9 slashing; Blade 7: 5 ft, +4, 1d10 slashing. Aim for the knees.",
    );
    // Renders the corpus-built character on the full page.
  }, 30_000);

  it("prints six attack rows on the readable 2014 sheet, and only the seventh in the notes", async () => {
    const { model } = await sevenAttacks();
    for (const layout of [{ readable: true }, { readable: true, top: true }]) {
      const page = await renderDetails(model, layout);
      expect(page.rows, JSON.stringify(layout)).toBe(6);
      for (let row = 1; row <= 6; row += 1) {
        expect(page.inField(`details_attack${row}_weapon`), `row ${row}`).toBe(`Blade ${row}`);
        expect(page.inField(`details_attack${row}_damage`), `row ${row}`).toBe(`1d${row + 3} slashing`);
      }
      expect(page.inField("details_attack5_range")).toBe("5 ft");
      expect(page.inField("details_attack6_attack")).toBe("+4");
      expect(page.inField("details_attack_description")).toBe("More attacks: Blade 7: 5 ft, +4, 1d10 slashing. Aim for the knees.");
    }
    // Two full renders of a corpus-built character.
  }, 30_000);

  it("leaves the readable rows' notes to the user when every attack has a row", async () => {
    const { model } = await sevenAttacks();
    const details = model.pages.find((page) => page.templateKind === "details")!;
    const six = { ...model, pages: model.pages.map((page) => (page === details ? { ...page, attacks: details.attacks!.slice(0, 6) } : page)) };
    const page = await renderDetails(six, { readable: true });
    expect(page.inField("details_attack6_weapon")).toBe("Blade 6");
    expect(page.inField("details_attack_description")).toBe("Aim for the knees.");
  }, 30_000);

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
    // Choosing Monk already added the automatic row; adding one by hand would be a duplicate.
    expect(service.getAttacks(id).filter((a) => a.kind === "unarmed")).toHaveLength(1);
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
