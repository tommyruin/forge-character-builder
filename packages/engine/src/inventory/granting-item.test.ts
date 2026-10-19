/**
 * An Item that grants a language, a feat or a proficiency is gear: it can be
 * added, worn, and while worn its grants are registered; taking it off removes
 * them. (The generated "Additional X" records are the only non-physical
 * grant-carrying Items.)
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";

const CHARM = "ID_TEST_ITEM_MOON_CHARM";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Moon Charm" type="Item" source="Granting Item Test" id="${CHARM}">
\t\t<description><p>A charm that teaches a tongue.</p></description>
\t\t<setters><set name="category">Adventuring Gear</set></setters>
\t\t<rules><grant type="Language" id="ID_LANGUAGE_ELVISH" /></rules>
\t</element>
</elements>
`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/granting-item-test.xml", PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

const sumIds = (xml: string): string[] => {
  const region = xml.slice(xml.indexOf("<sum "), xml.indexOf("</sum>"));
  return [...region.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
};

describe("a grant-carrying Item that is real gear", () => {
  it("is physical, wearable and applies its grants only while worn", () => {
    const { service, id } = buildFighter3(library, "Charm");
    const record = service.addItem(id, { itemId: CHARM, amount: 1, baseElementId: null }).items.find((item) => item.itemId === CHARM)!;
    expect(record.isPhysicalEquipment).toBe(true);
    expect(record.isEquippable).toBe(true);
    expect(sumIds(service.exportCharacterXml(id))).not.toContain("ID_LANGUAGE_ELVISH");

    service.equipItem(id, record.identifier, "worn");
    expect(sumIds(service.exportCharacterXml(id))).toContain("ID_LANGUAGE_ELVISH");

    service.equipItem(id, record.identifier, "none");
    expect(sumIds(service.exportCharacterXml(id))).not.toContain("ID_LANGUAGE_ELVISH");
  });
});
