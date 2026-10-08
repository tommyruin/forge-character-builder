/**
 * Item significance: which carried items are worth a card on the sheet. The
 * cases are real corpus items so the classifier is pinned against the data
 * players actually carry, not against hand-built stand-ins.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../library.js";
import type { ParsedElement } from "../parser.js";
import { buildReviewedLibrary } from "./reviewed-profile.test-support.js";
import { inventoryItemSignificance, itemSignificance } from "./significance.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildReviewedLibrary();
}, 120_000);

const significanceOf = (id: string) => {
  const element = library.byId.get(id);
  expect(element, id).toBeDefined();
  return itemSignificance(element);
};

describe("itemSignificance", () => {
  it.each([
    ["ring of spell storing", "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING"],
    ["potion of healing", "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING"],
    ["staff of power", "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER"],
  ])("classifies the %s as magic", (_name, id) => {
    expect(significanceOf(id)).toBe("magic");
  });

  it.each([
    ["thieves' tools", "ID_WOTC_PHB_ITEM_TOOL_THIEVES_TOOLS"],
    ["lute", "ID_WOTC_SRD_INSTRUMENT_LUTE"],
    ["crystal focus", "ID_WOTC_PHB_ITEM_CRYSTAL"],
  ])("classifies %s as a tool", (_name, id) => {
    expect(significanceOf(id)).toBe("tool");
  });

  it.each([
    ["hempen rope", "ID_WOTC_PHB_ITEM_ROPE_HEMPEN_50FEET"],
    ["oil", "ID_WOTC_PHB_ITEM_OIL_FLASK"],
    ["caltrops", "ID_WOTC_PHB_ITEM_CALTROPS_BAGOF20"],
    ["torch", "ID_WOTC_PHB_ITEM_TORCH"],
  ])("classifies %s as useful gear: its description reads as rules", (_name, id) => {
    expect(significanceOf(id)).toBe("useful-gear");
  });

  it.each([
    ["rations", "ID_WOTC_PHB_ITEM_RATIONS_1DAY"],
    ["a pouch", "ID_WOTC_PHB_ITEM_POUCH"],
    ["common clothes", "ID_WOTC_PHB_ITEM_CLOTHES_COMMON"],
    ["a waterskin", "ID_WOTC_PHB_ITEM_WATERSKIN"],
    ["an explorer's pack", "ID_WOTC_ITEM_EXPLORERS_PACK"],
    ["a longsword", "ID_WOTC_PHB_WEAPON_LONGSWORD"],
  ])("classifies %s as trivial", (_name, id) => {
    expect(significanceOf(id)).toBe("trivial");
  });

  it("treats a missing element and empty adventuring gear as trivial", () => {
    expect(itemSignificance(undefined)).toBe("trivial");
    const blank = {
      identity: { id: "ID_TEST_BLANK", name: "Blank", type: "Item", source: "Test" },
      setters: [{ name: "category", value: "Adventuring Gear" }],
      rules: [],
      supports: [],
      descriptionXml: "<p></p>",
    } as unknown as ParsedElement;
    expect(itemSignificance(blank)).toBe("trivial");
  });

  it("classifies an adorned record by its adorner, not its plain base", () => {
    expect(
      inventoryItemSignificance(library, {
        itemId: "ID_WOTC_PHB_WEAPON_QUARTERSTAFF",
        adorners: ["ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER"],
      }),
    ).toBe("magic");
    expect(inventoryItemSignificance(library, { itemId: "ID_WOTC_PHB_WEAPON_QUARTERSTAFF", adorners: [] })).toBe("trivial");
  });
});
