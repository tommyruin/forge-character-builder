/**
 * Generated per-spell Spell Scroll items carry the per-level metadata of the
 * corpus scroll templates: category Scrolls, type Scroll, stackable, zero
 * weight, and the level's rarity/cost, with the description quoting that
 * level's save DC, attack bonus, and rarity.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "./library.js";
import type { ParsedElement } from "./parser.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function setter(element: ParsedElement, name: string): { value: string; attrs?: Record<string, string> } | undefined {
  return element.setters.find((s) => s.name === name);
}

describe("generated spell-scroll proxies", () => {
  it("stamps cantrip scrolls as Common, 15 gp, DC 13 / +5", () => {
    const scroll = library.byId.get("ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_ACID_SPLASH")!;
    expect(setter(scroll, "category")?.value).toBe("Scrolls");
    expect(setter(scroll, "type")?.value).toBe("Scroll");
    expect(setter(scroll, "rarity")?.value).toBe("Common");
    expect(setter(scroll, "stackable")?.value).toBe("true");
    expect(setter(scroll, "cost")?.value).toBe("15");
    expect(setter(scroll, "cost")?.attrs?.currency).toBe("gp");
    expect(setter(scroll, "weight")?.attrs?.lb).toBe("0");
    expect(scroll.descriptionXml).toContain("DC (13) and attack bonus (+5)");
    expect(scroll.descriptionXml).toContain("rarity (Common)");
  });

  it("stamps 3rd-level scrolls as Uncommon, 500 gp, DC 15 / +7", () => {
    const scroll = library.byId.get("ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_FIREBALL")!;
    expect(setter(scroll, "rarity")?.value).toBe("Uncommon");
    expect(setter(scroll, "cost")?.value).toBe("500");
    expect(scroll.descriptionXml).toContain("DC (15) and attack bonus (+7)");
    expect(scroll.descriptionXml).toContain("rarity (Uncommon)");
  });

  it("stamps 9th-level scrolls as Legendary, 250000 gp, DC 19 / +11", () => {
    const scroll = library.byId.get("ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_WISH")!;
    expect(setter(scroll, "rarity")?.value).toBe("Legendary");
    expect(setter(scroll, "cost")?.value).toBe("250000");
    expect(scroll.descriptionXml).toContain("DC (19) and attack bonus (+11)");
    expect(scroll.descriptionXml).toContain("rarity (Legendary)");
  });
});
