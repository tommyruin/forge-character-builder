/**
 * Item and spell cards: which inventory entries earn a card, the order they
 * render in, and how cards paginate.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "./model.js";
import { sheetCanonical } from "./canonical.js";
import { SAMPLE_CASTER } from "../testing/dnd5e-samples.js";
import { ID, buildCharacter, buildFighter3, buildFullSheetCharacter, sharedLibrary } from "../testing/character-factory.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** The token text of every section with `title` across the model's pages. */
const sectionTitles = (
  model: ReturnType<typeof buildCharacterSheetModel>,
  title: string,
): string[] =>
  model.pages
    .flatMap((page) => page.sections)
    .filter((section) => section.title === title)
    .map((section) => (section.rows[0]?.kind === "tokens" ? section.rows[0].tokens.join(" ") : ""));

describe("spell and item cards", () => {
  it("preserves item card and sidebar presentation flags from .dnd5e metadata", () => {
    const service = new CharacterService(undefined, library);
    const state = service.importCharacterXml("sample", SAMPLE_CASTER);

    // The document marks the potion as a card and the greataxe for the
    // sidebar; the shortsword carries neither flag.
    expect(state.items.filter((item) => item.card).map((item) => item.name)).toEqual(["Potion of Healing"]);
    expect(state.items.filter((item) => item.sidebar).map((item) => item.name)).toEqual(["Greataxe"]);
  });

  it("keeps the flags through an export and re-import", () => {
    const service = new CharacterService(undefined, library);
    service.importCharacterXml("sample", SAMPLE_CASTER);
    const exported = service.exportCharacterXml("sample");

    const reader = new CharacterService(undefined, library);
    const state = reader.importCharacterXml("sample", exported);
    expect(state.items.filter((item) => item.card).map((item) => item.name)).toEqual(["Potion of Healing"]);
    expect(state.items.filter((item) => item.sidebar).map((item) => item.name)).toEqual(["Greataxe"]);
  });

  it("renders card items in inventory order", () => {
    const { service, id } = buildFighter3(library, "CardOrder");
    for (const itemId of [
      "ID_WOTC_PHB_WEAPON_LONGSWORD",
      "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING",
      "ID_WOTC_PHB_WEAPON_SHORTSWORD",
    ]) {
      service.addItem(id, { itemId, amount: 1, baseElementId: null });
    }

    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(sectionTitles(model, "item-description")).toEqual([
      "Longsword",
      "Potion of Healing",
      "Shortsword",
    ]);

    const inventory = model.pages.find((page) => page.templateKind === "equipment")!
      .sections.find((section) => section.title === "inventory")!;
    const tokens = inventory.rows.flatMap((row) => (row.kind === "tokens" ? [...row.tokens] : []));
    expect(tokens.join(" ")).toContain("Longsword");
    expect(sheetCanonical(model).pageCount).toBe(model.pageCount);
  });

  it("paginates spell cards nine to a page without dropping any", () => {
    const { service, id } = buildFullSheetCharacter(library, "CardPagination");
    const spellIds = (library.byType.get("Spell") ?? [])
      .map((element) => element.identity.id)
      .filter((spellId) => spellId.startsWith("ID_PHB_SPELL_"))
      .slice(0, 30);
    for (const spellId of spellIds) {
      try {
        service.addGrantedSpell(id, { spellId });
      } catch {
        // Already granted by the base build.
      }
    }

    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const cardPages = model.pages.filter((page) => page.templateKind === "spell-cards");
    expect(cardPages.length).toBeGreaterThan(1);

    // Every page but the last is full; none is empty or over-filled.
    for (const [index, page] of cardPages.entries()) {
      expect(page.sections.length).toBeGreaterThan(0);
      expect(page.sections.length).toBeLessThanOrEqual(9);
      if (index < cardPages.length - 1) expect(page.sections).toHaveLength(9);
    }

    // The cards account for every granted spell exactly once.
    const carded = sectionTitles(model, "spell-description");
    expect(new Set(carded).size).toBe(carded.length);
    expect(carded.length).toBe(cardPages.reduce((total, page) => total + page.sections.length, 0));
  });
});

/**
 * Control items are `type="Item"` elements the corpus uses as on/off switches
 * rather than gear: the Tasha's optional class features, the `Additional …`
 * grant proxies, Supernatural Gifts. They carry `inventory-hidden` and say so
 * in their own description ("It remains hidden from the inventory on your
 * character sheet"), but the sheet's only guard was an `INTERNAL_ITEM`
 * substring test on the id, which catches the engine's synthesized proxies and
 * nothing the corpus authors. So every one of them printed as gear.
 */
describe("control items on the sheet", () => {
  const OCF_INSTINCTIVE_POUNCE = "ID_WOTC_TCOE_ITEM_OCF_BARBARIAN_INSTINCTIVE_POUNCE";
  /** The control item's own name, as it would print if it were treated as gear. */
  const CONTROL_ITEM_NAME = "Barbarian, LV07: Instinctive Pounce";

  /** Every item surface the sheet renders, joined: form fields plus page rows. */
  function itemSurfaceText(model: ReturnType<typeof buildCharacterSheetModel>): string {
    const values = model.formValues ?? {};
    const itemFields = Object.entries(values)
      .filter(([key]) =>
        key === "Equipment" ||
        key.startsWith("equipment_page_gear") ||
        key.startsWith("equipment_page_magic") ||
        key.startsWith("equipment_page_valuable") ||
        key.startsWith("equipment_page_vehicle"))
      .map(([, value]) => value);
    const pageRows = model.pages
      .filter((page) => page.templateKind === "equipment" || page.templateKind === "item-cards")
      .flatMap((page) => page.sections)
      .flatMap((section) => section.rows.flatMap((row) => (row.kind === "tokens" ? row.tokens : row.lines)));
    return [...itemFields, ...pageRows].join("\n");
  }

  const featuresBox = (model: ReturnType<typeof buildCharacterSheetModel>): string =>
    model.formValues?.["Features and Traits"] ?? "";

  function barbarianWithPounce(id: string, levels: number): ReturnType<typeof buildCharacterSheetModel> {
    const { service } = buildCharacter(library, { id, classId: ID.CLASS_BARBARIAN, levels });
    service.addItem(id, { itemId: OCF_INSTINCTIVE_POUNCE, amount: 1, baseElementId: null });
    return buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  }

  it("keeps an inventory-hidden control item off every item surface", () => {
    expect(itemSurfaceText(barbarianWithPounce("PounceHidden", 7))).not.toContain(CONTROL_ITEM_NAME);
  });

  it("earns the control item no item card", () => {
    expect(sectionTitles(barbarianWithPounce("PounceNoCard", 7), "item-description"))
      .not.toContain(CONTROL_ITEM_NAME);
  });

  it("renders the class feature the control item grants in Features and Traits", () => {
    expect(featuresBox(barbarianWithPounce("PounceFeature", 7))).toContain("Instinctive Pounce");
  });

  it("withholds a granted feature whose own requirements are not met", () => {
    // Instinctive Pounce is gated `[level:barbarian:7]`; at 6 it must stay off
    // the sheet even though the control record is present and active.
    expect(featuresBox(barbarianWithPounce("PounceTooEarly", 6))).not.toContain("Instinctive Pounce");
  });

  it("still renders ordinary slotless gear, which is equally locationless", () => {
    const { service, id } = buildCharacter(library, {
      id: "PounceGear",
      classId: ID.CLASS_BARBARIAN,
      levels: 7,
    });
    service.addItem(id, { itemId: OCF_INSTINCTIVE_POUNCE, amount: 1, baseElementId: null });
    service.addItem(id, { itemId: "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING", amount: 1, baseElementId: null });

    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(itemSurfaceText(model)).toContain("Potion of Healing");
    expect(itemSurfaceText(model)).not.toContain(CONTROL_ITEM_NAME);
  });
});

/**
 * A reader who prints the sheet can drop the pages they do not want. The build
 * must then skip the work, not blank the page, and the survivors must keep a
 * contiguous 1..n numbering.
 */
describe("optional sheet pages", () => {
  const kinds = (model: ReturnType<typeof buildCharacterSheetModel>): string[] =>
    model.pages.map((page) => page.templateKind);

  /** Every model, whatever is left out, numbers its pages 1..n in order. */
  const expectContiguous = (model: ReturnType<typeof buildCharacterSheetModel>): void => {
    expect(model.pages.map((page) => page.page)).toEqual(model.pages.map((_, index) => index + 1));
    expect(model.pageCount).toBe(model.pages.length);
  };

  function modelFor(
    id: string,
    include?: { background?: boolean; notes?: boolean; spellCards?: boolean; itemCards?: boolean },
  ): ReturnType<typeof buildCharacterSheetModel> {
    const { service } = buildFullSheetCharacter(library, id);
    service.updateDetails(id, { notes1: "Remember the sword in the lake." });
    return buildCharacterSheetModel(service.getCharacter(id), library, {
      mode: "full",
      ...(include ? { include } : {}),
    });
  }

  it("prints every optional page by default", () => {
    const model = modelFor("PagesAll");
    expect(kinds(model)).toContain("background");
    expect(kinds(model)).toContain("generic"); // the dedicated notes page
    expect(kinds(model)).toContain("spell-cards");
    expect(kinds(model)).toContain("item-cards");
    expectContiguous(model);
  });

  it("drops each excluded page and renumbers the rest", () => {
    const all = modelFor("PagesBaseline");
    for (const [flag, kind] of [
      ["background", "background"],
      ["notes", "generic"],
      ["spellCards", "spell-cards"],
      ["itemCards", "item-cards"],
    ] as const) {
      const model = modelFor(`PagesNo-${flag}`, { [flag]: false });
      expect(kinds(model)).not.toContain(kind);
      expect(model.pageCount).toBeLessThan(all.pageCount);
      expectContiguous(model);
    }
  });

  it("keeps the details page first and the remaining pages in order when several are dropped", () => {
    const all = modelFor("PagesKeepOrder");
    const trimmed = modelFor("PagesTrimmed", { background: false, notes: false, itemCards: false });
    expect(trimmed.pages[0]!.templateKind).toBe("details");
    expect(kinds(trimmed)).toEqual(
      kinds(all).filter((kind) => kind !== "background" && kind !== "generic" && kind !== "item-cards"),
    );
    expectContiguous(trimmed);
  });

  it("treats an explicit true and an absent flag alike", () => {
    expect(kinds(modelFor("PagesExplicit", { background: true, notes: true, spellCards: true, itemCards: true })))
      .toEqual(kinds(modelFor("PagesImplicit")));
  });
});
