/**
 * Writing a loaded element back out as `<element>` XML: the start of a house
 * rule or a reflavour is a copy of the book element. A copy has to read back
 * as the same element, so it is checked against a broad slice of the library.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { parseElementsFile, type ParsedElement } from "../content/parser.js";
import { sharedLibrary } from "../testing/character-factory.js";
import { serializeElement } from "./element-xml.js";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/**
 * The parts of an element that mean something to the engine. The rules compared
 * are the ones the element's file wrote: the library adds rules of its own at
 * ingest (an append from another file, a class's multiclass grant), and those
 * belong to the loaded copy, not to the text of the element.
 */
function essence(element: ParsedElement) {
  return {
    identity: element.identity,
    descriptionXml: (element.descriptionXml ?? "").trim(),
    setters: element.setters,
    rulesXml: (element.rulesXml ?? "").trim(),
    supports: element.supports,
    requirements: element.requirements,
    prerequisite: element.prerequisite,
    compendiumHidden: element.compendiumHidden,
    sheets: element.sheets,
  };
}

const reparse = (xml: string): ParsedElement => {
  const [element] = parseElementsFile(`<elements>${xml}</elements>`, "copy.xml");
  return element!;
};

describe("serializeElement", () => {
  it.each(["Feat", "Racial Trait", "Class Feature", "Archetype Feature", "Background Feature", "Spell", "Language", "Magic Item", "Weapon", "Armor", "Option"])(
    "reads a %s back as the same element",
    (type) => {
      const sample = (library.byType.get(type) ?? []).filter((element) => element.declaredBy !== "").slice(0, 400);
      expect(sample.length).toBeGreaterThan(0);
      let copied = 0;
      for (const element of sample) {
        const result = serializeElement(element);
        if (result.xml === null) continue;
        copied += 1;
        expect(essence(reparse(result.xml))).toEqual(essence(element));
      }
      expect(copied).toBeGreaterThan(sample.length / 2);
    },
  );

  it("refuses an element with parts a copy would lose, and says which", () => {
    const klass = (library.byType.get("Class") ?? [])[0]!;
    const result = serializeElement(klass);
    expect(result.xml).toBeNull();
    expect(result.reason).toMatch(/class|multiclass|spellcasting|nested/i);
  });

  it("renames, re-sources and re-describes the copy without touching its rules", () => {
    const feat = (library.byType.get("Feat") ?? []).find((element) => element.rules.length > 0 && element.children.length === 0)!;
    const result = serializeElement(feat, { name: "House Feat", source: "House Pack", descriptionXml: "<p>New text &amp; more.</p>" });
    const copy = reparse(result.xml!);
    expect(copy.identity).toEqual({ id: feat.identity.id, name: "House Feat", type: feat.identity.type, source: "House Pack" });
    expect(copy.descriptionXml?.trim()).toBe("<p>New text &amp; more.</p>");
    expect(copy.rulesXml).toEqual(feat.rulesXml);
    expect(copy.setters).toEqual(feat.setters);
  });
});
