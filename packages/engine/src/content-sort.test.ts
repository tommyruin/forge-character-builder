import { describe, expect, it } from "vitest";
import { CharacterService } from "./character/service.js";
import type { ElementLibrary } from "./content/library.js";
import type { ParsedElement } from "./content/parser.js";
import { createEngineMethodHandlers } from "./worker-handlers.js";

// Synthetic weapons, deliberately loaded out of order, with a reprint (same name, two books).
const ROWS: Array<[id: string, name: string, source: string]> = [
  ["ID_T_ZEBRA", "Zebra spear", "Alpha Book"],
  ["ID_T_APPLE_B", "apple blade", "Zulu Book"],
  ["ID_T_MACE_2", "Mace", "Mid Book"],
  ["ID_T_APPLE_A", "Apple blade", "Alpha Book"],
  ["ID_T_MACE_1", "Mace", "Alpha Book"],
  ["ID_T_BOW", "Bow", "Zulu Book"],
];

function syntheticLibrary(): ElementLibrary {
  const byId = new Map<string, ParsedElement>();
  for (const [id, name, source] of ROWS) {
    byId.set(id, {
      identity: { id, name, type: "Weapon", source },
      setters: [], rules: [], supports: [], compendiumHidden: false,
    } as unknown as ParsedElement);
  }
  return {
    byId, byType: new Map(), typeCounts: {}, sources: new Map(), elementCount: byId.size, fileOrder: [],
    ruleset: new Map(), rulesetCounts: { rules2014Count: 0, rules2024Count: 0, sharedCount: 0 },
  } as unknown as ElementLibrary;
}

type Page = { items: Array<{ id: string }>; total: number };
const ids = (page: Page): string[] => page.items.map((item) => item.id);

describe("contentElements sort order", () => {
  const handlers = createEngineMethodHandlers(new CharacterService(undefined, syntheticLibrary()), syntheticLibrary());
  const query = (extra: Record<string, unknown>): Page =>
    handlers.contentElements!({ equipmentOnly: true, take: 100, ...extra }) as Page;

  it("defaults to name order, ignoring case and breaking ties on the id", () => {
    const expected = ["ID_T_APPLE_A", "ID_T_APPLE_B", "ID_T_BOW", "ID_T_MACE_1", "ID_T_MACE_2", "ID_T_ZEBRA"];
    expect(ids(query({}))).toEqual(expected);
    expect(ids(query({ sort: "name" }))).toEqual(expected);
    expect(ids(query({ sort: "nonsense" }))).toEqual(expected);
  });

  it("sorts by source display name, then name", () => {
    expect(ids(query({ sort: "source" }))).toEqual([
      "ID_T_APPLE_A", "ID_T_MACE_1", "ID_T_ZEBRA", // Alpha Book
      "ID_T_MACE_2", // Mid Book
      "ID_T_APPLE_B", "ID_T_BOW", // Zulu Book
    ]);
  });

  it("sorts before paging, so pages join up into the whole ordered list", () => {
    for (const sort of ["name", "source"]) {
      const whole = ids(query({ sort }));
      const pages = [0, 2, 4].flatMap((skip) => ids(query({ sort, skip, take: 2 })));
      expect(pages).toEqual(whole);
      expect(query({ sort, skip: 2, take: 2 }).total).toBe(ROWS.length);
    }
  });
});
