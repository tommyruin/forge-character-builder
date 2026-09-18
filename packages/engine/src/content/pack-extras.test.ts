/**
 * The shipped 2024 equipment packs carry the structured <extras> the Extract
 * surface reads: the fixed items and gold the pack's prose note says it omits,
 * and the choice candidates the picker offers. These expectations mirror the
 * 2024 equipment notes; changing one is a deliberate content change.
 *
 * The table is the regression net for the reviewed packExtras table in
 * third-party/srd-5.2/srd-5.2.1.map.json: every pack whose description says
 * "doesn't include" must carry an <extras> block, and every referenced item id
 * must resolve (the generator's build already rejects dangling references).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseElementsFile } from "./parser.js";

const PACKS_PATH = fileURLToPath(
  new URL("../../../../apps/client/public/content/srd-5.2.1/items/items-packs.xml", import.meta.url),
);
const P = "ID_WOTC_PHB24_ITEM_";

interface ExpectedPack {
  gold: number;
  items: string[];
  /** Choice label -> candidate count (0 when the pack has no choice). */
  choices: Record<string, number>;
}

const EXPECTED: Record<string, ExpectedPack> = {
  [`${P}BACKGROUND_EQUIPMENT_PACK_ACOLYTE`]: {
    gold: 8,
    items: [],
    choices: { "Holy Symbol": 3 },
  },
  [`${P}BACKGROUND_EQUIPMENT_PACK_CRIMINAL`]: { gold: 15, items: [], choices: {} },
  [`${P}BACKGROUND_EQUIPMENT_PACK_SAGE`]: { gold: 8, items: [], choices: {} },
  [`${P}BACKGROUND_EQUIPMENT_PACK_SOLDIER`]: {
    gold: 14,
    items: [],
    choices: { "Gaming Set": 2 },
  },
  [`${P}CLASS_EQUIPMENT_PACK_BARBARIAN`]: { gold: 15, items: [], choices: {} },
  [`${P}CLASS_EQUIPMENT_PACK_BARD`]: {
    gold: 19,
    items: ["ID_WOTC_PHB24_ARMOR_LIGHT_LEATHER"],
    choices: { "Musical Instrument": 10 },
  },
  [`${P}CLASS_EQUIPMENT_PACK_CLERIC`]: {
    gold: 7,
    items: ["ID_WOTC_PHB24_ARMOR_MEDIUM_CHAIN_SHIRT", "ID_WOTC_PHB24_ARMOR_SHIELD"],
    choices: { "Holy Symbol": 3 },
  },
  [`${P}CLASS_EQUIPMENT_PACK_DRUID`]: {
    gold: 9,
    items: ["ID_WOTC_PHB24_ARMOR_LIGHT_LEATHER", "ID_WOTC_PHB24_ARMOR_SHIELD"],
    choices: {},
  },
  [`${P}CLASS_EQUIPMENT_PACK_FIGHTER_1`]: {
    gold: 4,
    items: ["ID_WOTC_PHB24_ARMOR_HEAVY_CHAIN_MAIL"],
    choices: {},
  },
  [`${P}CLASS_EQUIPMENT_PACK_FIGHTER_2`]: {
    gold: 11,
    items: ["ID_WOTC_PHB24_ARMOR_LIGHT_STUDDED_LEATHER"],
    choices: {},
  },
  [`${P}CLASS_EQUIPMENT_PACK_MONK`]: {
    gold: 11,
    items: [],
    choices: { "Artisan's Tools or Musical Instrument": 27 },
  },
  [`${P}CLASS_EQUIPMENT_PACK_PALADIN`]: {
    gold: 9,
    items: ["ID_WOTC_PHB24_ARMOR_HEAVY_CHAIN_MAIL", "ID_WOTC_PHB24_ARMOR_SHIELD"],
    choices: { "Holy Symbol": 3 },
  },
  [`${P}CLASS_EQUIPMENT_PACK_RANGER`]: {
    gold: 7,
    items: ["ID_WOTC_PHB24_ARMOR_LIGHT_STUDDED_LEATHER"],
    choices: {},
  },
  [`${P}CLASS_EQUIPMENT_PACK_ROGUE`]: {
    gold: 8,
    items: ["ID_WOTC_PHB24_ARMOR_LIGHT_LEATHER"],
    choices: {},
  },
  [`${P}CLASS_EQUIPMENT_PACK_SORCERER`]: { gold: 28, items: [], choices: {} },
  [`${P}CLASS_EQUIPMENT_PACK_WARLOCK`]: {
    gold: 15,
    items: ["ID_WOTC_PHB24_ARMOR_LIGHT_LEATHER"],
    choices: {},
  },
  [`${P}CLASS_EQUIPMENT_PACK_WIZARD`]: { gold: 5, items: [], choices: {} },
};

describe("shipped 2024 pack extras", () => {
  it("carries the noted gold, fixed items, and choices for every pack", async () => {
    const elements = parseElementsFile(await readFile(PACKS_PATH, "utf8"), PACKS_PATH);
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const element = elements.find((candidate) => candidate.identity.id === id);
      expect(element, id).toBeDefined();
      expect(element!.extras?.gold, id).toBe(expected.gold);
      expect((element!.extras?.items ?? []).map((entry) => entry.id), id).toEqual(expected.items);
      const choices = Object.fromEntries(
        (element!.extras?.choices ?? []).map((choice) => [choice.label, choice.candidates.length]),
      );
      expect(choices, id).toEqual(expected.choices);
    }
  });

  it("covers every pack whose description says what it leaves out", async () => {
    const elements = parseElementsFile(await readFile(PACKS_PATH, "utf8"), PACKS_PATH);
    const noted = elements
      .filter((element) => element.descriptionXml?.includes("doesn't include"))
      .map((element) => element.identity.id)
      .sort();
    expect(noted).toEqual(Object.keys(EXPECTED).sort());
    for (const element of elements.filter((candidate) => noted.includes(candidate.identity.id))) {
      expect(element.extras?.gold, element.identity.id).toBeGreaterThan(0);
    }
  });
});
