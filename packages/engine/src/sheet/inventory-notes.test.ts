/**
 * The equipment page's notes column. It has always described attuned items and
 * items marked for the sheet notes (`sidebar`); the optional "item notes"
 * switch also describes the other magic items in full and the tools and useful
 * gear in brief. Off must leave the page exactly as it was.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ElementLibrary } from "../content/library.js";
import { isPhysicalEquipment } from "../content/equipment/categories.js";
import { CharacterService } from "../character/service.js";
import { buildFighter3, seededRng, sharedLibrary } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { sheetCanonical } from "./canonical.js";
import { buildCharacterSheetModel, inventoryColumnEntries, type CharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";

const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));

const ROPE = "ID_WOTC_PHB_ITEM_ROPE_HEMPEN_50FEET";
const RATIONS = "ID_WOTC_PHB_ITEM_RATIONS_1DAY";
const RING = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING";
const TOOLS = "ID_WOTC_PHB_ITEM_TOOL_THIEVES_TOOLS";
const CLOAK = "ID_WOTC_DMG_MAGIC_ITEM_CLOAK_OF_PROTECTION";
const POTION = "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING";

const ROPE_SENTENCE = "Rope, whether made of hemp or silk, has 2 hit points and can be burst with a DC 17 Strength check.";
const TOOLS_NOTE = [
  "Perhaps the most common tools used by adventurers, thieves’ tools are designed for picking locks and foiling traps.",
  "Set a Trap.",
  "The total of your check becomes the DC for someone else’s attempt to discover or disable the trap.",
  "The trap deals damage appropriate to the materials used in crafting it (such as poison or a weapon) or damage equal to half the total of your check, whichever the DM deems appropriate.",
].join(" ");
const RING_LATER_TEXT = "The spell cast from the ring is no longer stored in it, freeing up space.";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** A fighter carrying rope, rations, two rings, thieves' tools, an attuned cloak and a potion. */
function packedFighter(id = "Notes") {
  const { service } = buildFighter3(library, id);
  for (const itemId of [ROPE, RATIONS, RING, TOOLS, CLOAK, RING, POTION]) {
    service.addItem(id, { itemId, amount: 1, baseElementId: null });
  }
  const cloak = service.getInventory(id).items.find((item) => item.itemId === CLOAK)!;
  service.attuneItem(id, cloak.identifier, true);
  return { service, id };
}

const equipmentPage = (model: CharacterSheetModel) => model.pages.find((page) => page.templateKind === "equipment")!;
const inventorySection = (model: CharacterSheetModel) =>
  equipmentPage(model).sections.find((section) => section.title === "inventory")!;
const sidebarText = (model: CharacterSheetModel) =>
  (inventorySection(model).positionedRuns ?? [])
    .filter((run) => run.role === "sidebar")
    .map((run) => run.text)
    .join(" ");

describe("inventoryColumnEntries", () => {
  it("lists only attuned and sheet-notes items with the switch off", () => {
    const { service, id } = packedFighter("Off");
    const entries = inventoryColumnEntries(service.getCharacter(id), library, { notes: false });
    expect(entries.map((entry) => entry.title)).toEqual(["Cloak of Protection"]);
    expect(entries[0]!.text).toContain("You gain a +1 bonus to AC and saving throws while you wear this cloak.");
  });

  it("adds magic items in full, then tools and useful gear in brief, with the switch on", () => {
    const { service, id } = packedFighter("On");
    const entries = inventoryColumnEntries(service.getCharacter(id), library, { notes: true });
    // Attuned first, the other magic items next, then tools and useful gear,
    // each group in inventory order; the second ring is not repeated and the
    // rations never print.
    expect(entries.map((entry) => entry.title)).toEqual([
      "Cloak of Protection",
      "Ring of Spell Storing",
      "Potion of Healing",
      "Rope, Hempen (50 feet)",
      "Thieves’ Tools",
    ]);
    expect(entries[1]!.text).toContain(RING_LATER_TEXT);
    expect(entries[3]!.text).toBe(ROPE_SENTENCE);
    expect(entries[4]!.text).toBe(TOOLS_NOTE);
    expect(entries[4]!.html).toContain("<p><strong><em>Set a Trap.</em></strong> The total of your check");
  });

  it("keeps a sheet-notes item where it always printed, in full", () => {
    const { service, id } = packedFighter("Sidebar");
    const rope = service.getInventory(id).items.find((item) => item.itemId === ROPE)!;
    service.setItemPresentation(id, { identifier: rope.identifier, sidebar: true });
    const state = service.getCharacter(id);
    const off = inventoryColumnEntries(state, library, { notes: false });
    expect(off.map((entry) => entry.title)).toEqual(["Rope, Hempen (50 feet)", "Cloak of Protection"]);
    const on = inventoryColumnEntries(state, library, { notes: true });
    expect(on.slice(0, 2)).toEqual(off);
    expect(on.map((entry) => entry.title)).toEqual([
      "Rope, Hempen (50 feet)",
      "Cloak of Protection",
      "Ring of Spell Storing",
      "Potion of Healing",
      "Thieves’ Tools",
    ]);
  });
});

describe("the item notes switch on the sheet model", () => {
  it("prints the extra notes in the column and the notes field", () => {
    const { service, id } = packedFighter("Model");
    const state = service.getCharacter(id);
    const model = buildCharacterSheetModel(state, library, { mode: "full", inventoryNotes: true });
    expect(sidebarText(model)).toContain("Thieves’ Tools.");
    expect(sidebarText(model)).toContain("Set a Trap.");
    expect(model.formValues?.["equipment_page_magic_items"]).toContain(`Rope, Hempen (50 feet). ${ROPE_SENTENCE}`);
    expect(model.formValues?.["equipment_page_magic_items"]).not.toContain("Rations");

    const off = buildCharacterSheetModel(state, library, { mode: "full" });
    expect(sidebarText(off)).not.toContain("Thieves’ Tools.");
    expect(off.formValues?.["equipment_page_magic_items"]).toBe(
      "Cloak of Protection. " + inventoryColumnEntries(state, library, { notes: false })[0]!.text,
    );
  });

  const sidebarRunsWith = (count: number) => {
    const { service, id } = buildFighter3(library, `Overflow ${count}`);
    const wondrous = (library.byType.get("Magic Item") ?? [])
      .filter((element) => element.identity.id.startsWith("ID_WOTC_DMG_MAGIC_ITEM_"))
      .filter((element) => isPhysicalEquipment(element))
      .filter((element) => !element.setters.some((setter) => setter.name === "weapon" || setter.name === "armor"))
      .filter((element) => (element.descriptionXml ?? "").length > 600)
      .slice(0, count);
    expect(wondrous).toHaveLength(count);
    for (const element of wondrous) service.addItem(id, { itemId: element.identity.id, amount: 1, baseElementId: null });
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", inventoryNotes: true, canonical: true });
    expect(inventorySection(model).canonicalRuns?.length).toBeGreaterThan(0);
    expect(sheetCanonical(model).pageCount).toBe(model.pageCount);
    return (inventorySection(model).positionedRuns ?? []).filter((run) => run.role === "sidebar");
  };

  it("shrinks the column through the existing layout when the notes run long", () => {
    const runs = sidebarRunsWith(6);
    expect(runs.length).toBeGreaterThan(0);
    expect(Math.max(...runs.map((run) => run.page ?? 0))).toBe(0);
    expect(Math.min(...runs.map((run) => run.fontSize ?? 7))).toBeLessThan(7);
  });

  it("continues the column onto further pages when shrinking cannot fit it", () => {
    const runs = sidebarRunsWith(60);
    expect(Math.max(...runs.map((run) => run.page ?? 0))).toBeGreaterThan(0);
  });

  it("renders the magic item's notes on the equipment page of the PDF", async () => {
    const { service, id } = packedFighter("Render");
    const model = buildCharacterSheetModel(service.getCharacter(id), library, {
      mode: "full",
      include: { background: false },
      inventoryNotes: true,
    });
    const pageNumber = equipmentPage(model).page;
    expect(pageNumber).toBe(2);
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle("2014"));
    const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
    const content = await (await document.getPage(pageNumber)).getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Ring of Spell Storing");
    expect(text).toContain("freeing up space");
  });
});

describe("what the equipment tables cannot hold", () => {
  const isGear = (element: ElementLibrary["byId"] extends Map<string, infer E> ? E : never): boolean =>
    element.identity.id.startsWith("ID_WOTC_PHB_ITEM_") && isPhysicalEquipment(element);

  /** A fighter carrying `gear` distinct mundane items and `magic` distinct magic items. */
  function loaded(gear: number, magic: number, name: string) {
    const { service, id } = buildFighter3(library, name);
    const gearIds = (library.byType.get("Item") ?? []).filter(isGear).map((element) => element.identity.id);
    const magicIds = (library.byType.get("Magic Item") ?? [])
      .filter((element) => element.identity.id.startsWith("ID_WOTC_DMG_MAGIC_ITEM_") && isPhysicalEquipment(element))
      .map((element) => element.identity.id);
    for (const itemId of [...gearIds.slice(0, gear), ...magicIds.slice(0, magic)]) {
      service.addItem(id, { itemId, amount: 1, baseElementId: null });
    }
    return structuredClone(service.getCharacter(id));
  }

  const tableNames = (model: CharacterSheetModel, prefix: string): string[] =>
    Object.entries(model.formValues ?? {})
      .filter(([key, value]) => key.startsWith(`${prefix}_name.`) && value !== "")
      .map(([, value]) => String(value));
  const overflowItems = (model: CharacterSheetModel, title: RegExp): number =>
    String(model.formValues?.["equipment_page_magic_items"] ?? "")
      .split("\n\n")
      .filter((entry) => title.test(entry))
      .reduce((sum, entry) => sum + entry.split("; ").length, 0);

  it("prints nothing extra for an inventory the tables hold", () => {
    const state = loaded(10, 3, "Fits");
    expect(inventoryColumnEntries(state, library, { notes: false })).toEqual([]);
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    expect(model.formValues?.["equipment_page_magic_items"]).toBe("");
  });

  it("lists gear past the table's 40 rows in the notes column, with or without the notes switch", () => {
    const state = loaded(46, 0, "Gear");
    for (const inventoryNotes of [false, true]) {
      const model = buildCharacterSheetModel(state, library, { mode: "full", inventoryNotes });
      expect(tableNames(model, "equipment_page_gear")).toHaveLength(40);
      expect(overflowItems(model, /^Adventuring gear \(continued\)\./)).toBe(6);
      expect(sidebarText(model)).toContain("Adventuring gear (continued).");
    }
  });

  it("lists magic items and valuables that neither their table nor a full gear table can hold", () => {
    const state = loaded(46, 24, "Magic");
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    expect(tableNames(model, "equipment_page_magic_gear")).toHaveLength(20);
    expect(overflowItems(model, /^Magic items \(continued\)\./)).toBe(4);
    // Every item sits in a table row or in an overflow list, once.
    const placed = tableNames(model, "equipment_page_gear").length + 20
      + overflowItems(model, /^(?:Adventuring gear|Magic items|Valuables) \(continued\)\./);
    expect(placed).toBe(46 + 24);
  });

  it("continues magic items in the gear table while it has room, and lists only what is left", () => {
    const state = loaded(30, 24, "Spill");
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    const gear = tableNames(model, "equipment_page_gear");
    expect(gear).toHaveLength(35);
    expect(gear).toContain("MAGIC ITEMS — CONTINUED");
    expect(overflowItems(model, /^Magic items \(continued\)\./)).toBe(0);
  });

  it("lists a third container, and a container's items past its ten rows", () => {
    const state = loaded(30, 0, "Cargo");
    state.storages = ["Saddlebags", "#2", "Cart"];
    state.items.slice(0, 14).forEach((record) => { record.storage = "Saddlebags"; });
    state.items.slice(14, 17).forEach((record) => { record.storage = "Cart"; });
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    expect(tableNames(model, "equipment_page_vehicle_1_cargo")).toHaveLength(10);
    expect(overflowItems(model, /^Saddlebags, stowed \(continued\)\./)).toBe(4);
    expect(overflowItems(model, /^Cart, stowed\./)).toBe(3);
  });

  /** Every name a table row or an overflow list prints, separator rows left out. */
  const placedNames = (model: CharacterSheetModel): string[] => [
    ...["equipment_page_gear", "equipment_page_magic_gear", "equipment_page_valuable",
      "equipment_page_vehicle_1_cargo", "equipment_page_vehicle_2_cargo"]
      .flatMap((prefix) => tableNames(model, prefix))
      .filter((name) => !/ — CONTINUED$/.test(name)),
    ...String(model.formValues?.["equipment_page_magic_items"] ?? "")
      .split("\n\n")
      .filter((entry) => /^[^.]*(?:\(continued\)|, stowed)\./.test(entry))
      .flatMap((entry) => entry.replace(/^[^.]*\.\s*/, "").replace(/\.$/, "").split("; "))
      .map((name) => name.replace(/ \([^)]*\)$/, "")),
  ].map((name) => name.replace(/^\[(.*)\]$/, "$1"));

  it("prints an item stowed in a container with cargo rows in those rows only", () => {
    const state = loaded(6, 2, "Stowed");
    const baseline = placedNames(buildCharacterSheetModel(state, library, { mode: "full" }));
    state.storages = ["Saddlebags", "Backpack"];
    // The last gear item and both magic items go in the saddlebags, the
    // gear item before them in the backpack.
    const added = state.items.slice(-8);
    for (const record of added.slice(-3)) record.storage = "Saddlebags";
    added[4]!.storage = "Backpack";
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    const cargo1 = tableNames(model, "equipment_page_vehicle_1_cargo");
    const cargo2 = tableNames(model, "equipment_page_vehicle_2_cargo");
    expect(cargo1).toHaveLength(3);
    expect(cargo2).toHaveLength(1);
    const tables = ["equipment_page_gear", "equipment_page_magic_gear", "equipment_page_valuable"]
      .flatMap((prefix) => tableNames(model, prefix))
      .map((name) => name.replace(/^\[(.*)\]$/, "$1"));
    for (const name of [...cargo1, ...cargo2]) expect(tables, name).not.toContain(name);
    // Nothing is lost or repeated: the same items print, each once.
    expect(placedNames(model).sort()).toEqual(baseline.sort());
  });

  it("prints items in a container without cargo rows once, under that container's name", () => {
    const state = loaded(12, 0, "Wagons");
    const baseline = placedNames(buildCharacterSheetModel(state, library, { mode: "full" }));
    state.storages = ["Saddlebags", "#2", "Cart", "Wagon"];
    const added = state.items.slice(-12);
    // Stowed out of container order, and one item in a container the
    // character no longer lists.
    added.slice(0, 2).forEach((record) => { record.storage = "Wagon"; });
    added.slice(2, 5).forEach((record) => { record.storage = "Cart"; });
    added[5]!.storage = "Lost chest";
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    const notes = String(model.formValues?.["equipment_page_magic_items"] ?? "").split("\n\n");
    // One heading per extra container, in the character's container order.
    expect(notes.map((entry) => entry.split(".")[0])).toEqual(["Cart, stowed", "Wagon, stowed", "Lost chest, stowed"]);
    expect(overflowItems(model, /^Cart, stowed\./)).toBe(3);
    expect(overflowItems(model, /^Wagon, stowed\./)).toBe(2);
    expect(overflowItems(model, /^Lost chest, stowed\./)).toBe(1);
    const gear = tableNames(model, "equipment_page_gear").map((name) => name.replace(/^\[(.*)\]$/, "$1"));
    expect(gear).toHaveLength(baseline.length - 6);
    expect(placedNames(model).sort()).toEqual(baseline.sort());
  });

  it("prints the overflow in the column of the rendered sheet", async () => {
    const model = buildCharacterSheetModel(loaded(46, 0, "Render"), library, {
      mode: "full",
      include: { background: false },
    });
    expect(sidebarText(model)).toContain("Adventuring gear (continued).");
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle("2014"));
    const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
    const content = await (await document.getPage(equipmentPage(model).page)).getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Adventuring gear (continued).");
  }, 60_000);
});

describe("with the item notes switch off", () => {
  // Digests of the equipment page and its notes field, recorded from the
  // builder before the switch existed (re-recorded when the notes column's
  // first line took the shared top inset). Off, absent or false must
  // reproduce them.
  const BEFORE: Record<string, { plain: string; canonical: string }> = {
    "barbarian-8.dnd5e": {
      plain: "202ff9c1b726b5ca9c62da61cd0acba4df27475745711c4686fd2399384b3781",
      canonical: "c3144f73c468f6fbb13986190a5944e84d0bf349d4a8a1fbeba3a412f9967cee",
    },
    "paladin-7.dnd5e": {
      plain: "bed4618cf4fbee8a14595d83b4359779df7a72dbc631aa8e6e8386cf2750e244",
      canonical: "44ba7f16d78fcb106cc99e5ff9d6a9d0087c9af569e1d59ac1d9ca702e6d1171",
    },
    "cleric-7.dnd5e": {
      plain: "66133882de6624e610c7dd132cbceebfc8aba21dc905d41c33e5247f759db04e",
      canonical: "6d4cd8b57b805c7bba880877e9841d323ac5e95862af757adfd4b05bf12b0d1b",
    },
    "ranger-rogue-8.dnd5e": {
      plain: "ee05c11e9e31adab3f675524d5c4e7d3910b4dd7d34cc4a11b428ae89e8fce56",
      canonical: "067df79d61a508ffad6383c2619c96a6a01384a75da005d83ad4cfaaa53a8eb7",
    },
  };

  const digest = (model: CharacterSheetModel): string =>
    createHash("sha256")
      .update(JSON.stringify({ page: equipmentPage(model), notes: model.formValues?.["equipment_page_magic_items"] }))
      .digest("hex");

  it.each(Object.keys(BEFORE))("prints %s's equipment page exactly as before", async (name) => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const state = service.importCharacterXml(name, await readFile(join(FIXTURE_ROOT, name), "utf8"));
    for (const inventoryNotes of [undefined, false]) {
      const options = inventoryNotes === undefined ? {} : { inventoryNotes };
      expect(digest(buildCharacterSheetModel(state, library, { mode: "full", ...options }))).toBe(BEFORE[name]!.plain);
      expect(digest(buildCharacterSheetModel(state, library, { mode: "full", canonical: true, ...options }))).toBe(
        BEFORE[name]!.canonical,
      );
    }
  });
});
