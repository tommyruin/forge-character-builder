/**
 * Renaming and annotating an inventory record: any record, book or custom, can
 * carry its own name and notes on this character. The name changes what is
 * printed, never what the item is: the base element, its rules and its attack
 * math stay exactly as they were.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";

const SCIMITAR = "ID_WOTC_PHB_WEAPON_SCIMITAR";
const ROPE = "ID_WOTC_PHB_ITEM_ROPE_HEMPEN_50FEET";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** Every string value under a key, anywhere in the sheet model. */
function sheetValues(service: CharacterService, id: string, key: RegExp): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", canonical: false });
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.test(name) && typeof value === "string") found.push(value);
      else walk(value);
    }
  };
  walk(model);
  return found;
}

function scimitar(name = "Renamer") {
  const built = buildFighter3(library, name);
  const dto = built.service.addItem(built.id, { itemId: SCIMITAR, amount: 1, baseElementId: null });
  return { ...built, record: dto.items.find((item) => item.itemId === SCIMITAR)! };
}

describe("a renamed record", () => {
  it("keeps the scimitar's rules and prints its own name, with the notes kept", () => {
    const { service, id, record } = scimitar();
    const before = service.getAttacks(id).find((row) => row.name === "Scimitar")!;
    expect(before).toBeDefined();

    const dto = service.setItemDetails(id, record.identifier, {
      name: "Grandfather's Blade",
      notes: "Hilt wrapped in green leather. A gift from Old Thornwood.",
    });
    const renamed = dto.items.find((item) => item.identifier === record.identifier)!;
    expect(renamed).toMatchObject({
      name: "Grandfather's Blade",
      customName: "Grandfather's Blade",
      baseName: "Scimitar",
      notes: "Hilt wrapped in green leather. A gift from Old Thornwood.",
      itemId: SCIMITAR,
    });

    // The rules are the scimitar's: same numbers, and the row is the same row.
    const after = service.getAttacks(id).find((row) => row.name === "Grandfather's Blade")!;
    expect(after.id).toBe(before.id);
    expect(after.bonus).toBe(before.bonus);
    expect(after.damage).toBe(before.damage);
    expect(after.description).toBe(before.description);
    expect(after.overriddenFields).not.toContain("name");
    expect(service.getAttacks(id).some((row) => row.name === "Scimitar")).toBe(false);
  });

  it("prints on the sheet: attack row, equipment line with the base beside it", () => {
    const { service, id, record } = scimitar("SheetName");
    service.setItemDetails(id, record.identifier, { name: "Grandfather's Blade" });
    expect(sheetValues(service, id, /^details_attack\d_weapon$/)).toContain("Grandfather's Blade");
    expect(sheetValues(service, id, /^Equipment$/).join("\n")).toContain("Grandfather's Blade (Scimitar)");
    expect(sheetValues(service, id, /^Equipment$/).join("\n")).not.toMatch(/^Scimitar$/m);
  });

  it("prints on the item card", () => {
    const { service, id, record } = scimitar("CardName");
    service.setItemPresentation(id, { identifier: record.identifier, card: true });
    service.setItemDetails(id, record.identifier, { name: "Grandfather's Blade" });
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", canonical: false });
    const titles = model.pages
      .filter((page) => page.templateKind === "item-cards")
      .flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "tokens" ? [row.tokens.join(" ")] : []))));
    expect(titles).toContain("Grandfather's Blade");
  });

  it("survives export and import", () => {
    const { service, id, record } = scimitar("RoundTrip");
    service.setItemDetails(id, record.identifier, { name: "Grandfather's Blade", notes: "Green leather." });
    const exported = service.exportCharacterXml(id);

    const other = new CharacterService(undefined, library);
    other.importCharacterXml("Elsewhere", exported);
    const item = other.getInventory("Elsewhere").items.find((entry) => entry.itemId === SCIMITAR)!;
    expect(item).toMatchObject({ name: "Grandfather's Blade", baseName: "Scimitar", notes: "Green leather." });
    expect(other.getAttacks("Elsewhere").some((row) => row.name === "Grandfather's Blade")).toBe(true);
    expect(other.exportCharacterXml("Elsewhere")).toBe(exported);
  });

  it("restores the original bytes when the name and notes are cleared again", () => {
    const { service, id, record } = scimitar("Restore");
    const original = service.exportCharacterXml(id);
    service.setItemDetails(id, record.identifier, { name: "Grandfather's Blade", notes: "Green & gold <leather>." });
    expect(service.exportCharacterXml(id)).toContain("Green &amp; gold &lt;leather&gt;.");
    service.setItemDetails(id, record.identifier, { name: "", notes: "" });
    expect(service.exportCharacterXml(id)).toBe(original);
    const dto = service.getInventory(id).items.find((item) => item.identifier === record.identifier)!;
    expect(dto).toMatchObject({ name: "Scimitar", customName: "", notes: "" });
  });

  it("changes only what it is given", () => {
    const { service, id, record } = scimitar("Partial");
    service.setItemDetails(id, record.identifier, { name: "Blade", notes: "Old." });
    const dto = service.setItemDetails(id, record.identifier, { notes: "New." });
    expect(dto.items.find((item) => item.identifier === record.identifier)).toMatchObject({ name: "Blade", notes: "New." });
  });

  it("leaves a row name the player typed by hand alone", () => {
    const { service, id, record } = scimitar("HandNamed");
    const row = service.getAttacks(id).find((entry) => entry.name === "Scimitar")!;
    service.updateAttack(id, row.id, { name: "My Curved Sword" });
    service.setItemDetails(id, record.identifier, { name: "Grandfather's Blade" });
    const after = service.getAttacks(id).find((entry) => entry.id === row.id)!;
    expect(after.name).toBe("My Curved Sword");
    expect(after.overriddenFields).toContain("name");
  });

  it("works on gear that has no attack row, and on a stack", () => {
    const { service, id } = buildFighter3(library, "Gear");
    const rope = service
      .addItem(id, { itemId: ROPE, amount: 2, baseElementId: null })
      .items.find((item) => item.itemId === ROPE)!;
    const dto = service.setItemDetails(id, rope.identifier, { name: "Climbing line", notes: "Knotted every ten feet." });
    expect(dto.items.find((item) => item.itemId === ROPE)).toMatchObject({
      name: "Climbing line",
      baseName: "Rope, Hempen (50 feet)",
      amount: 2,
    });
    expect(sheetValues(service, id, /^Equipment$/).join("\n")).toContain("Climbing line (Rope, Hempen (50 feet)) x2");
  });

  it("refuses a name or notes it cannot store", () => {
    const { service, id, record } = scimitar("Refuse");
    expect(() => service.setItemDetails(id, record.identifier, { name: "x".repeat(121) })).toThrow(/name/i);
    expect(() => service.setItemDetails(id, record.identifier, { notes: "y".repeat(2001) })).toThrow(/notes/i);
    expect(() => service.setItemDetails(id, "missing", { name: "x" })).toThrow(/not found/i);
    expect(() => service.setItemDetails(id, record.identifier, { name: "a\u0000b" })).toThrow(/name/i);
  });
});
