/**
 * Item presentation: whether a carried item prints an item card
 * (`<details card="true">`) and whether its description goes into the
 * equipment page's inventory notes (`<item sidebar="true">`). Both are
 * per-record attributes of the `.dnd5e` document, so every edit here is held
 * to byte fidelity: a toggle changes exactly that attribute and nothing else,
 * and toggling back restores the imported bytes.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { seededRng } from "../testing/character-factory.js";
import type { InventoryDto, InventoryItemDto } from "./inventory.js";

const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));

const ROPE = "ID_WOTC_PHB_ITEM_ROPE_HEMPEN_50FEET";
const RATIONS = "ID_WOTC_PHB_ITEM_RATIONS_1DAY";
const WATERSKIN = "ID_WOTC_PHB_ITEM_WATERSKIN";
const THIEVES_TOOLS = "ID_WOTC_PHB_ITEM_TOOL_THIEVES_TOOLS";
const RING = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING";
const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";

// barbarian-8: Javelin and Shield carry `card="true"`, the Eldritch Claw
// Tattoo carries `sidebar="true"`; the file re-exports byte-identically.
const JAVELIN_RECORD = "2e906783-4f90-4436-80e8-b75fabb703b4";
const SHIELD_RECORD = "d44529ea-a842-4cc3-9c4a-f71d09de6a0c";
const TATTOO_RECORD = "4fc8e3df-f612-48b4-af48-be918ddbd3d7";
// cleric-7: the imported file has `card="false"` on its Rations record.
const CLERIC_RATIONS_RECORD = "319b3a89-f9dd-41d9-a898-42df78df80e2";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

const fixture = (name: string): Promise<string> => readFile(join(FIXTURE_ROOT, name), "utf8");

const recordOf = (dto: InventoryDto, identifier: string): InventoryItemDto => {
  const item = dto.items.find((entry) => entry.identifier === identifier);
  expect(item, identifier).toBeDefined();
  return item!;
};

const byItemId = (dto: InventoryDto, itemId: string): InventoryItemDto => {
  const item = dto.items.find((entry) => entry.itemId === itemId);
  expect(item, itemId).toBeDefined();
  return item!;
};

/** The source offset of a record's opening `<item` tag. */
const itemStart = (xml: string, identifier: string): number => {
  const at = xml.indexOf(`<item identifier="${identifier}"`);
  expect(at, identifier).toBeGreaterThanOrEqual(0);
  return at;
};

/** The document with one exact substring replaced, at its first occurrence after `from`. */
const replacedAfter = (xml: string, from: number, search: string, replacement: string): string => {
  const at = xml.indexOf(search, from);
  expect(at, search).toBeGreaterThanOrEqual(0);
  return `${xml.slice(0, at)}${replacement}${xml.slice(at + search.length)}`;
};

const importFixture = async (name: string): Promise<{ service: CharacterService; xml: string }> => {
  const xml = await fixture(name);
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  service.importCharacterXml(name, xml);
  expect(service.exportCharacterXml(name)).toBe(xml);
  return { service, xml };
};

const itemCardTitles = (service: CharacterService, id: string): string[] => {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  return model.pages
    .filter((page) => page.templateKind === "item-cards")
    .flatMap((page) => page.sections)
    .filter((section) => section.title === "item-description")
    .map((section) => {
      const first = section.rows[0];
      return first && first.kind === "tokens" ? first.tokens.join(" ") : "";
    });
};

describe("item presentation DTO", () => {
  it("exposes each record's card and sheet-notes choices", async () => {
    const { service } = await importFixture("barbarian-8.dnd5e");
    const dto = service.getInventory("barbarian-8.dnd5e");
    expect(recordOf(dto, JAVELIN_RECORD)).toMatchObject({ card: true, sidebar: false });
    expect(recordOf(dto, TATTOO_RECORD)).toMatchObject({ card: true, sidebar: true });
  });
});

describe("setItemPresentation", () => {
  it("removes card=\"true\" whole and restores the imported bytes when switched back on", async () => {
    const { service, xml } = await importFixture("barbarian-8.dnd5e");
    const id = "barbarian-8.dnd5e";
    let dto = service.setItemPresentation(id, { identifier: JAVELIN_RECORD, card: false });
    expect(recordOf(dto, JAVELIN_RECORD).card).toBe(false);
    const off = service.exportCharacterXml(id);
    expect(off).toBe(replacedAfter(xml, itemStart(xml, JAVELIN_RECORD), '<details card="true">', "<details>"));

    // The choice survives export and import.
    const reimported = new CharacterService(undefined, library, { rng: seededRng(7) });
    reimported.importCharacterXml("again", off);
    expect(recordOf(reimported.getInventory("again"), JAVELIN_RECORD).card).toBe(false);
    expect(reimported.exportCharacterXml("again")).toBe(off);

    dto = service.setItemPresentation(id, { identifier: JAVELIN_RECORD, card: true });
    expect(recordOf(dto, JAVELIN_RECORD).card).toBe(true);
    expect(service.exportCharacterXml(id)).toBe(xml);
  });

  it("drops a record from the item-card page and adds it back", async () => {
    const { service } = await importFixture("barbarian-8.dnd5e");
    const id = "barbarian-8.dnd5e";
    expect(itemCardTitles(service, id)).toContain("Shield");
    service.setItemPresentation(id, { identifier: SHIELD_RECORD, card: false });
    expect(itemCardTitles(service, id)).not.toContain("Shield");
    service.setItemPresentation(id, { identifier: SHIELD_RECORD, card: true });
    expect(itemCardTitles(service, id)).toContain("Shield");
  });

  it("turns an imported card=\"false\" record on by rewriting only the value", async () => {
    const { service, xml } = await importFixture("cleric-7.dnd5e");
    const id = "cleric-7.dnd5e";
    expect(recordOf(service.getInventory(id), CLERIC_RATIONS_RECORD).card).toBe(false);
    service.setItemPresentation(id, { identifier: CLERIC_RATIONS_RECORD, card: true });
    const on = service.exportCharacterXml(id);
    expect(on).toBe(replacedAfter(xml, itemStart(xml, CLERIC_RATIONS_RECORD), '<details card="false">', '<details card="true">'));
    // Switching it off again never writes card="false": the attribute goes.
    service.setItemPresentation(id, { identifier: CLERIC_RATIONS_RECORD, card: false });
    expect(service.exportCharacterXml(id)).toBe(
      replacedAfter(xml, itemStart(xml, CLERIC_RATIONS_RECORD), '<details card="false">', "<details>"),
    );
  });

  it("toggles sheet notes on the item tag and restores the imported bytes", async () => {
    const { service, xml } = await importFixture("barbarian-8.dnd5e");
    const id = "barbarian-8.dnd5e";
    let dto = service.setItemPresentation(id, { identifier: TATTOO_RECORD, sidebar: false });
    expect(recordOf(dto, TATTOO_RECORD).sidebar).toBe(false);
    expect(service.exportCharacterXml(id)).toBe(replacedAfter(xml, itemStart(xml, TATTOO_RECORD), ' sidebar="true">', ">"));
    dto = service.setItemPresentation(id, { identifier: TATTOO_RECORD, sidebar: true });
    expect(recordOf(dto, TATTOO_RECORD).sidebar).toBe(true);
    expect(service.exportCharacterXml(id)).toBe(xml);

    // A record without the attribute gains it at the end of its opening tag.
    service.setItemPresentation(id, { identifier: JAVELIN_RECORD, sidebar: true });
    const javelinTag = `<item identifier="${JAVELIN_RECORD}" name="Javelin" id="ID_WOTC_PHB_WEAPON_JAVELIN">`;
    expect(service.exportCharacterXml(id)).toBe(
      replacedAfter(xml, 0, javelinTag, javelinTag.replace(/>$/, ' sidebar="true">')),
    );
    service.setItemPresentation(id, { identifier: JAVELIN_RECORD, sidebar: false });
    expect(service.exportCharacterXml(id)).toBe(xml);
  });

  it("changes nothing when the record already has the requested presentation", async () => {
    const { service, xml } = await importFixture("barbarian-8.dnd5e");
    const id = "barbarian-8.dnd5e";
    service.setItemPresentation(id, { identifier: JAVELIN_RECORD, card: true, sidebar: false });
    service.setItemPresentation(id, { identifier: TATTOO_RECORD, card: true, sidebar: true });
    service.setItemPresentation(id, { identifier: JAVELIN_RECORD });
    expect(service.exportCharacterXml(id)).toBe(xml);
  });

  it("sets both attributes in one call and keeps the record's identity", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Both").id;
    const added = byItemId(service.addItem(id, { itemId: ROPE, amount: 1, baseElementId: null }), ROPE);
    const dto = service.setItemPresentation(id, { identifier: added.identifier, card: false, sidebar: true });
    const rope = byItemId(dto, ROPE);
    expect(rope.identifier).toBe(added.identifier);
    expect(rope).toMatchObject({ card: false, sidebar: true });
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain(`<item identifier="${added.identifier}" name="Rope, Hempen (50 feet)" id="${ROPE}" sidebar="true">`);
  });

  it("gives a record without a details element one when its card is switched on", async () => {
    const service = new CharacterService(undefined, library);
    const source = service.createCharacter("No Details").id;
    const added = byItemId(service.addItem(source, { itemId: ROPE, amount: 1, baseElementId: null }), ROPE);
    const withDetails = service.exportCharacterXml(source);
    const stripped = withDetails.replace(/\r\n\t+<details card="true">[\s\S]*?<\/details>/, "");
    expect(stripped).not.toContain("<details");

    service.importCharacterXml("Stripped", stripped);
    expect(service.exportCharacterXml("Stripped")).toBe(stripped);
    expect(byItemId(service.getInventory("Stripped"), ROPE).card).toBe(false);

    // Off on a record with no details element is already the case: no edit.
    service.setItemPresentation("Stripped", { identifier: added.identifier, card: false });
    expect(service.exportCharacterXml("Stripped")).toBe(stripped);

    // On writes the same details element a new record carries.
    service.setItemPresentation("Stripped", { identifier: added.identifier, card: true });
    const on = service.exportCharacterXml("Stripped");
    expect(on).toBe(withDetails);
    service.importCharacterXml("Restored", on);
    expect(byItemId(service.getInventory("Restored"), ROPE).card).toBe(true);
    expect(service.exportCharacterXml("Restored")).toBe(on);
  });

  it("expands a self-closing record when it needs a details element", async () => {
    const service = new CharacterService(undefined, library);
    const source = service.createCharacter("Self Closing").id;
    const added = byItemId(service.addItem(source, { itemId: ROPE, amount: 1, baseElementId: null }), ROPE);
    const withDetails = service.exportCharacterXml(source);
    const selfClosing = withDetails.replace(
      /(<item identifier="[^"]+" name="Rope, Hempen \(50 feet\)" id="[^"]+")>\r\n\t+<details card="true">[\s\S]*?<\/details>\r\n\t+<\/item>/,
      "$1 />",
    );
    expect(selfClosing).toContain(" />");
    service.importCharacterXml("Self", selfClosing);
    service.setItemPresentation("Self", { identifier: added.identifier, card: true });
    expect(service.exportCharacterXml("Self")).toBe(withDetails);
  });

  it("rejects an unknown record", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Missing").id;
    expect(() => service.setItemPresentation(id, { identifier: "nope", card: true })).toThrow(/not found/);
  });
});

describe("setItemCards", () => {
  it("keeps cards for magic items, tools and useful gear only", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Bulk").id;
    for (const itemId of [ROPE, RATIONS, WATERSKIN, THIEVES_TOOLS, RING, LONGSWORD]) {
      service.addItem(id, { itemId, amount: 1, baseElementId: null });
    }
    const dto = service.setItemCards(id, { policy: "significant" });
    expect(byItemId(dto, ROPE).card).toBe(true);
    expect(byItemId(dto, THIEVES_TOOLS).card).toBe(true);
    expect(byItemId(dto, RING).card).toBe(true);
    expect(byItemId(dto, RATIONS).card).toBe(false);
    expect(byItemId(dto, WATERSKIN).card).toBe(false);
    expect(byItemId(dto, LONGSWORD).card).toBe(false);
    expect(service.exportCharacterXml(id)).not.toContain('card="false"');
  });

  it("switches every card off, and back on, in one operation", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Bulk Off").id;
    for (const itemId of [ROPE, RATIONS, RING]) service.addItem(id, { itemId, amount: 1, baseElementId: null });
    const before = service.exportCharacterXml(id);
    let dto = service.setItemCards(id, { policy: "none" });
    expect(dto.items.map((item) => item.card)).toEqual([false, false, false]);
    expect(service.exportCharacterXml(id)).toBe(before.replaceAll('<details card="true">', "<details>"));
    dto = service.setItemCards(id, { policy: "all" });
    expect(dto.items.map((item) => item.card)).toEqual([true, true, true]);
    expect(service.exportCharacterXml(id)).toBe(before);
  });

  it("leaves control records alone", async () => {
    const { service, xml } = await importFixture("barbarian-8.dnd5e");
    const id = "barbarian-8.dnd5e";
    service.setItemCards(id, { policy: "all" });
    // The hidden optional-class-feature record keeps its imported card="false".
    expect(service.exportCharacterXml(id)).toBe(xml);
  });

  it("rejects an unknown policy", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Bad Policy").id;
    expect(() => service.setItemCards(id, { policy: "some" as never })).toThrow(/policy/);
  });
});

describe("addItem card policy", () => {
  it("cards every new item by default, as it always has", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Default Cards").id;
    service.addItem(id, { itemId: RATIONS, amount: 1, baseElementId: null });
    const dto = service.addItem(id, { itemId: ROPE, amount: 1, baseElementId: null });
    expect(byItemId(dto, RATIONS).card).toBe(true);
    expect(byItemId(dto, ROPE).card).toBe(true);
    expect(service.exportCharacterXml(id).match(/<details card="true">/g)).toHaveLength(2);
  });

  it("cards only significant new items under the significant policy", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Smart Cards").id;
    for (const itemId of [RATIONS, ROPE, THIEVES_TOOLS, RING, LONGSWORD]) {
      service.addItem(id, { itemId, amount: 1, baseElementId: null, cardPolicy: "significant" });
    }
    const dto = service.getInventory(id);
    expect(byItemId(dto, RATIONS).card).toBe(false);
    expect(byItemId(dto, LONGSWORD).card).toBe(false);
    expect(byItemId(dto, ROPE).card).toBe(true);
    expect(byItemId(dto, THIEVES_TOOLS).card).toBe(true);
    expect(byItemId(dto, RING).card).toBe(true);
    const xml = service.exportCharacterXml(id);
    expect(xml).not.toContain('card="false"');
    expect(xml.match(/<details>/g)).toHaveLength(2);
  });

  it("never changes an existing stack the new copies join", async () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Smart Stack").id;
    service.addItem(id, { itemId: RATIONS, amount: 1, baseElementId: null });
    const dto = service.addItem(id, { itemId: RATIONS, amount: 2, baseElementId: null, cardPolicy: "significant" });
    expect(dto.items).toHaveLength(1);
    expect(byItemId(dto, RATIONS)).toMatchObject({ amount: 3, card: true });
  });
});

describe("extractItem card policy", () => {
  const PACK = "ID_WOTC_ITEM_EXPLORERS_PACK";
  const SIGNIFICANT = ["ID_WOTC_PHB_ITEM_TINDERBOX", "ID_WOTC_PHB_ITEM_TORCH", ROPE];
  const TRIVIAL = [
    "ID_WOTC_PHB_ITEM_BACKPACK",
    "ID_WOTC_PHB_ITEM_BEDROLL",
    "ID_WOTC_PHB_ITEM_MESSKIT",
    RATIONS,
    WATERSKIN,
  ];
  // Record identifiers are random; everything else must match byte for byte.
  const normalized = (xml: string) => xml.replace(/identifier="[^"]+"/g, 'identifier="*"');

  const extracted = (options?: { cardPolicy?: "all" | "significant" }) => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Unpacker").id;
    const pack = byItemId(service.addItem(id, { itemId: PACK, amount: 1, baseElementId: null }), PACK);
    const dto =
      options === undefined
        ? service.extractItem(id, pack.identifier)
        : service.extractItem(id, pack.identifier, undefined, options);
    return { dto, xml: service.exportCharacterXml(id) };
  };

  it("cards every unpacked record by default, exactly as before", () => {
    const { dto, xml } = extracted();
    expect(dto.items).toHaveLength(8);
    expect(dto.items.every((item) => item.card)).toBe(true);
    expect(xml.match(/<details card="true">/g)).toHaveLength(8);
    expect(normalized(extracted({ cardPolicy: "all" }).xml)).toBe(normalized(xml));
  });

  it("cards only the useful gear under the significant policy", () => {
    const { dto, xml } = extracted({ cardPolicy: "significant" });
    for (const itemId of SIGNIFICANT) expect(byItemId(dto, itemId).card, itemId).toBe(true);
    for (const itemId of TRIVIAL) expect(byItemId(dto, itemId).card, itemId).toBe(false);
    expect(xml).not.toContain('card="false"');
    // Only the card attribute of the trivial records differs from the default.
    let expected = normalized(extracted().xml);
    for (const itemId of TRIVIAL) {
      expected = expected.replace(
        new RegExp(`(id="${itemId}"[^>]*>\\r\\n\\t+)<details card="true">`),
        "$1<details>",
      );
    }
    expect(normalized(xml)).toBe(expected);
  });

  it("rejects an unknown policy", () => {
    expect(() => extracted({ cardPolicy: "some" as never })).toThrow(/card policy/);
  });
});
