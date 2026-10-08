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
import { buildCharacterSheetModel, inventoryColumnEntries, itemNoteSummary, type CharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";

const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));

const ROPE = "ID_WOTC_PHB_ITEM_ROPE_HEMPEN_50FEET";
const RATIONS = "ID_WOTC_PHB_ITEM_RATIONS_1DAY";
const RING = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING";
const TOOLS = "ID_WOTC_PHB_ITEM_TOOL_THIEVES_TOOLS";
const CLOAK = "ID_WOTC_DMG_MAGIC_ITEM_CLOAK_OF_PROTECTION";
const POTION = "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING";

const ROPE_SENTENCE = "Rope, whether made of hemp or silk, has 2 hit points and can be burst with a DC 17 Strength check.";
const TOOLS_SENTENCE =
  "Perhaps the most common tools used by adventurers, thieves’ tools are designed for picking locks and foiling traps.";
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
    expect(entries[4]!.text).toBe(TOOLS_SENTENCE);
    expect(entries[4]!.html).toBe(`<p>${TOOLS_SENTENCE}</p>`);
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

describe("itemNoteSummary", () => {
  it("keeps the first sentence", () => {
    expect(itemNoteSummary("Short one. Second sentence here.")).toBe("Short one.");
    expect(itemNoteSummary("No full stop at all")).toBe("No full stop at all");
  });

  it("caps a long sentence near 200 characters at a word boundary", () => {
    const long = `${"word ".repeat(60).trim()}.`;
    const summary = itemNoteSummary(long);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.slice(0, -1)).toMatch(/word$/);
  });
});

describe("the item notes switch on the sheet model", () => {
  it("prints the extra notes in the column and the notes field", () => {
    const { service, id } = packedFighter("Model");
    const state = service.getCharacter(id);
    const model = buildCharacterSheetModel(state, library, { mode: "full", inventoryNotes: true });
    expect(sidebarText(model)).toContain("Thieves’ Tools.");
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

describe("with the item notes switch off", () => {
  // Digests of the equipment page and its notes field, recorded from the
  // builder before the switch existed. Off, absent or false must reproduce them.
  const BEFORE: Record<string, { plain: string; canonical: string }> = {
    "barbarian-8.dnd5e": {
      plain: "d1e0f29503228dd9ea3405e484555b46c59e719c2e41f0eb954f16d687912ec6",
      canonical: "955c1d96c23776032d64cf15d2c5de93c6f844994ebe53cde924c74162ca6af4",
    },
    "paladin-7.dnd5e": {
      plain: "b7d760ca729971a659fc8d910aac252a9616f0791f52f87f4ffcd68cb7301e82",
      canonical: "130aecc7fa55cc3e6a5dbf474fdb8e44b37015388ae59d8e4e2f66c2a6fcbd23",
    },
    "cleric-7.dnd5e": {
      plain: "7912b413730836c9b1811f9c75a0cea095cf0adb0e728ae02dec4e8ec5c5bed9",
      canonical: "d421a8cbfc406600d57cfe4c6dcd1bfcb3e0a6192ff9e123cf231178f6844d6a",
    },
    "ranger-rogue-8.dnd5e": {
      plain: "f65a6f5510eda1dd299b9810b1cef19b946653541d10cdbd99e0919821c1fcc6",
      canonical: "9878f614297717af19d3e8279f22c10d830e2ee988944c2a6f8ede8e753860e3",
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
