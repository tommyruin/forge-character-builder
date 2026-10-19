/**
 * A plain Weapon or Armor registers its own selects and sensory grants while
 * it conveys its benefits, the way a worn magic item's content does: a choice
 * the weapon offers is pending only while it is wielded, and a sense it grants
 * shows only then. Weapons and armor with plain rule contributions (a stat, a
 * stealth-disadvantage marker) keep the registration they always had.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildFighter3, freshService, sharedLibrary } from "../testing/character-factory.js";
import type { InventoryItemDto } from "./inventory.js";

const WEAPON = "ID_TEST_WEAPON_SENTINEL_BLADE";
const ARMOR = "ID_TEST_ARMOR_SENTINEL_MAIL";
const PLAIN_ARMOR = "ID_TEST_ARMOR_PLAIN_MAIL";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Sentinel Blade" type="Weapon" source="Weapon Content Test" id="${WEAPON}">
\t\t<supports>ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE, ID_INTERNAL_DAMAGE_TYPE_SLASHING</supports>
\t\t<description><p>A test blade.</p></description>
\t\t<setters>
\t\t\t<set name="category">Weapons</set>
\t\t\t<set name="slot">onehand</set>
\t\t\t<set name="damage" type="slashing">1d8</set>
\t\t\t<set name="proficiency">ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_MELEE_WEAPONS</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Vision" id="ID_VISION_BLINDSIGHT" />
\t\t\t<grant type="Spell" id="ID_PHB_SPELL_BURNING_HANDS" />
\t\t\t<select type="Language" name="Sentinel Tongue" />
\t\t</rules>
\t</element>
\t<element name="Sentinel Mail" type="Armor" source="Weapon Content Test" id="${ARMOR}">
\t\t<supports>ID_INTERNAL_ARMOR_GROUP_HEAVY</supports>
\t\t<description><p>A test mail.</p></description>
\t\t<setters>
\t\t\t<set name="category">Armor</set>
\t\t\t<set name="slot">body</set>
\t\t\t<set name="armor">Heavy</set>
\t\t\t<set name="proficiency">ID_PROFICIENCY_ARMOR_PROFICIENCY_HEAVY_ARMOR</set>
\t\t</setters>
\t\t<rules>
\t\t\t<stat name="ac:armored:armor" value="16" />
\t\t\t<grant type="Vision" id="ID_VISION_BLINDSIGHT" />
\t\t\t<select type="Language" name="Sentinel Armor Tongue" />
\t\t</rules>
\t</element>
\t<element name="Plain Mail" type="Armor" source="Weapon Content Test" id="${PLAIN_ARMOR}">
\t\t<supports>ID_INTERNAL_ARMOR_GROUP_HEAVY</supports>
\t\t<description><p>A test mail with nothing extra.</p></description>
\t\t<setters>
\t\t\t<set name="category">Armor</set>
\t\t\t<set name="slot">body</set>
\t\t\t<set name="armor">Heavy</set>
\t\t</setters>
\t\t<rules>
\t\t\t<stat name="ac:armored:armor" value="16" />
\t\t\t<grant type="Grants" id="ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE" />
\t\t</rules>
\t</element>
</elements>
`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/weapon-content-test.xml", PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

const sumIds = (xml: string): string[] => {
  const region = xml.slice(xml.indexOf("<sum "), xml.indexOf("</sum>"));
  return [...region.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
};
const registeredCount = (xml: string): number => Number(/registered-count="(\d+)"/.exec(xml)![1]);

function visionTokens(service: ReturnType<typeof buildFighter3>["service"], id: string): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const tokens: string[] = [];
  for (const page of model.pages) {
    for (const section of page.sections) {
      if (section.title !== "conditions" && section.title !== "vision") continue;
      for (const row of section.rows) if (row.kind === "tokens") tokens.push(...row.tokens);
    }
  }
  return tokens;
}

const pendingNames = (service: ReturnType<typeof buildFighter3>["service"], id: string): string[] =>
  pendingSelectionRules(service.getCharacter(id)).map((rule) => rule.name ?? "");

function addAndEquip(itemId: string, location: string, name: string) {
  const built = buildFighter3(library, name);
  const dto = built.service.addItem(built.id, { itemId, amount: 1, baseElementId: null });
  let record: InventoryItemDto = dto.items.find((item) => item.itemId === itemId)!;
  if (!record.isEquipped) {
    record = built.service.equipItem(built.id, record.identifier, location).items.find((item) => item.itemId === itemId)!;
  }
  return { ...built, record };
}

describe("plain weapon content", () => {
  it("offers its choice and its sense only while it is wielded", () => {
    const { service, id, record } = addAndEquip(WEAPON, "primary", "WeaponContent");
    expect(record.isEquipped).toBe(true);
    expect(pendingNames(service, id)).toContain("Sentinel Tongue");
    expect(visionTokens(service, id)).toContain("Blindsight");
    // The spell it grants sits under the weapon's node, where the Magic tab reads granted spells.
    const wielded = service.exportCharacterXml(id);
    const node = wielded.slice(wielded.indexOf(`id="${WEAPON}"`));
    expect(node.slice(0, node.indexOf("</element>"))).toContain('id="ID_PHB_SPELL_BURNING_HANDS"');

    service.equipItem(id, record.identifier, "none");
    expect(pendingNames(service, id)).not.toContain("Sentinel Tongue");
    expect(sumIds(service.exportCharacterXml(id))).not.toContain("ID_PHB_SPELL_BURNING_HANDS");
    expect(visionTokens(service, id)).not.toContain("Blindsight");
    expect(sumIds(service.exportCharacterXml(id))).not.toContain("ID_VISION_BLINDSIGHT");
  });

  it("leaves the registered count where it was once the weapon is put away and removed", () => {
    const { service, id, record } = addAndEquip(WEAPON, "primary", "WeaponCount");
    service.removeItem(id, record.identifier);
    const afterRemove = service.exportCharacterXml(id);
    const baseline = buildFighter3(library, "WeaponCountBaseline");
    expect(registeredCount(afterRemove)).toBe(registeredCount(baseline.service.exportCharacterXml(baseline.id)));
    expect(sumIds(afterRemove)).not.toContain(WEAPON);
  });
});

describe("plain weapon content across edits", () => {
  it("registers one node however often the weapon is re-equipped, and reloads intact", () => {
    const { service, id, record } = addAndEquip(WEAPON, "primary", "WeaponReload");
    service.equipItem(id, record.identifier, "none");
    service.equipItem(id, record.identifier, "primary");
    const xml = service.exportCharacterXml(id);
    expect(xml.match(new RegExp(`<element type="Weapon" name="Sentinel Blade" id="${WEAPON}"`, "g"))).toHaveLength(1);
    expect(sumIds(xml).filter((entry) => entry === WEAPON)).toHaveLength(1);

    const reloaded = freshService(library);
    const copy = reloaded.importCharacterXml("WeaponReloadCopy", xml);
    expect(pendingNames(reloaded, copy.id)).toContain("Sentinel Tongue");
    expect(reloaded.exportCharacterXml(copy.id)).toBe(xml);
  });
});

describe("plain armor content", () => {
  it("offers its choice and its sense only while it is worn", () => {
    const { service, id, record } = addAndEquip(ARMOR, "armor", "ArmorContent");
    expect(record.isEquipped).toBe(true);
    expect(pendingNames(service, id)).toContain("Sentinel Armor Tongue");
    expect(visionTokens(service, id)).toContain("Blindsight");

    service.equipItem(id, record.identifier, "none");
    expect(pendingNames(service, id)).not.toContain("Sentinel Armor Tongue");
    expect(visionTokens(service, id)).not.toContain("Blindsight");
  });

  it("keeps the registration of armor with only plain contributions unchanged", () => {
    const { service, id } = addAndEquip(PLAIN_ARMOR, "armor", "PlainArmor");
    const xml = service.exportCharacterXml(id);
    expect(sumIds(xml)).toEqual(expect.arrayContaining([PLAIN_ARMOR, "ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE"]));
    expect(xml.match(new RegExp(`id="${PLAIN_ARMOR}"`, "g"))).toHaveLength(3);
  });
});
