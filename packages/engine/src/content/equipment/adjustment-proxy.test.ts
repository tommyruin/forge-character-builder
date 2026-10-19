/**
 * Only the generated "Additional X" adjustment records are non-physical. A
 * real Item (it has a category or a slot) that happens to grant a feat, a
 * language, a proficiency, a spell or an ability score improvement is gear: it
 * is listed, carried and equipped like a ring, and its grants apply while it
 * is worn.
 */

import { describe, expect, it } from "vitest";
import { parseElementsFile } from "../parser.js";
import { isPhysicalEquipment } from "./categories.js";

const XML = `<elements>
\t<element name="Moon Charm" type="Item" source="Test" id="ID_TEST_ITEM_MOON_CHARM">
\t\t<description><p>A charm.</p></description>
\t\t<setters><set name="category">Adventuring Gear</set></setters>
\t\t<rules><grant type="Feat" id="ID_TEST_FEAT_MOON" /><grant type="Language" id="ID_LANGUAGE_ELVISH" /></rules>
\t</element>
\t<element name="Moon Band" type="Item" source="Test" id="ID_TEST_ITEM_MOON_BAND">
\t\t<description><p>A band.</p></description>
\t\t<setters><set name="slot">ring</set></setters>
\t\t<rules><grant type="Proficiency" id="ID_PROFICIENCY_SKILL_ARCANA" /></rules>
\t</element>
\t<element name="Additional Feat, Moon" type="Item" source="Test" id="ID_TEST_INTERNAL_ITEM_FEAT_PROXY_MOON">
\t\t<description><p>A proxy.</p></description>
\t\t<rules><grant type="Feat" id="ID_TEST_FEAT_MOON" /></rules>
\t</element>
\t<element name="Additional Feat, Sun" type="Item" source="Test" id="ID_TEST_INTERNAL_ITEM_FEAT_PROXY_SUN">
\t\t<description><p>A proxy that carries a category.</p></description>
\t\t<setters><set name="category">Adventuring Gear</set></setters>
\t\t<rules><grant type="Feat" id="ID_TEST_FEAT_SUN" /></rules>
\t</element>
</elements>`;

const byId = new Map(parseElementsFile(XML, "test.xml").map((element) => [element.identity.id, element]));
const physical = (id: string): boolean => isPhysicalEquipment(byId.get(id)!);

describe("adjustment proxies versus gear that grants", () => {
  it("keeps a categorised item that grants a feat and a language physical", () => {
    expect(physical("ID_TEST_ITEM_MOON_CHARM")).toBe(true);
  });

  it("keeps a slotted item that grants a proficiency physical", () => {
    expect(physical("ID_TEST_ITEM_MOON_BAND")).toBe(true);
  });

  it("still treats an uncategorised Additional record as a proxy", () => {
    expect(physical("ID_TEST_INTERNAL_ITEM_FEAT_PROXY_MOON")).toBe(false);
  });

  it("still treats an Additional record that carries a category as a proxy", () => {
    expect(physical("ID_TEST_INTERNAL_ITEM_FEAT_PROXY_SUN")).toBe(false);
  });
});
