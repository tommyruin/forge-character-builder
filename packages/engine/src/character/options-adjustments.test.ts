/**
 * Item-granted adjustments.
 *
 * An active inventory item registers its own grant subtree as a top-level
 * `<elements>` node, so a control element it grants (a Supernatural Gift, a
 * proxy) lands in the `<sum>` without the character owning it in its own
 * right. The adjustments DTO has to tell the two apart: only an own
 * registration — a top-level node of the control's own, or a carried control
 * record — can be switched back off, and an adjustment reported as on that
 * the remove path cannot touch is a switch that does nothing.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "./service.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { seededRng } from "../testing/character-factory.js";
import type { CharacterAdjustmentDto } from "./options.js";

const DAGGER = "ID_WOTC_PHB_WEAPON_DAGGER";
const ARCANA = "ID_PROFICIENCY_SKILL_ARCANA";

const GIFT = "ID_TEST_MAGIC_ITEM_HEARTSTONE_GIFT";
const GIFT_NAME = "Heartstone Gift";
const WEAPON = "ID_TEST_MAGIC_ITEM_HEARTSTONE_BLADE";
const WEAPON_NAME = "Heartstone Blade";

/**
 * A Supernatural Gift and a magic dagger that grants it. The gift is a
 * control record — the adjustment surface offers it directly — while the
 * dagger is real equipment whose own registration carries the gift.
 */
const HOMEBREW_PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="${GIFT_NAME}" type="Magic Item" source="Adjustment Grants Test" id="${GIFT}">
\t\t<description><p>A test supernatural gift.</p></description>
\t\t<setters>
\t\t\t<set name="category">Supernatural Gifts</set>
\t\t\t<set name="type">Charm</set>
\t\t\t<set name="slot">gift</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Proficiency" id="${ARCANA}" />
\t\t\t<stat name="initiative" value="1" />
\t\t</rules>
\t</element>
\t<element name="${WEAPON_NAME}" type="Magic Item" source="Adjustment Grants Test" id="${WEAPON}">
\t\t<description><p>A test dagger that carries a gift.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="dagger">Weapon</set>
\t\t\t<set name="attunement">true</set>
\t\t\t<set name="rarity">Rare</set>
\t\t\t<set name="weapon">Dagger</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Magic Item" id="${GIFT}" />
\t\t</rules>
\t</element>
</elements>
`;

let libraryPromise: Promise<ElementLibrary> | null = null;
const homebrewLibrary = async (): Promise<ElementLibrary> => {
  libraryPromise ??= (async () => {
    const library = await buildCorpusLibrary();
    const files = new Map(library.fileContents);
    files.set("testdata/scratch/adjustment-grants-test.xml", HOMEBREW_PACK);
    replaceLibraryFiles(library, files);
    return library;
  })();
  return libraryPromise;
};

describe.each(["2014", "2024"])("item-granted adjustments (%s rules)", (mode) => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await homebrewLibrary();
  }, 120_000);

  function character(name: string): { service: CharacterService; id: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(11) });
    const id = service.createCharacter(`${name} ${mode}`).id;
    service.setRulesetMode(id, mode);
    return { service, id };
  }

  const gift = (service: CharacterService, id: string): CharacterAdjustmentDto =>
    service.getCharacterAdjustments(id).find((entry) => entry.elementId === GIFT)!;

  /** The top-level `<elements>` node ids of the exported document. */
  const topLevelIds = (service: CharacterService, id: string): string[] =>
    service.getCharacter(id).elements.map((node) => node.id);

  it("offers an ungranted gift as off with no granting item", () => {
    const { service, id } = character("Heartstone Offer");
    expect(gift(service, id)).toMatchObject({ enabled: false, grantedBy: [] });
  });

  it("reports a gift carried by an attuned item as granted, not enabled", () => {
    const { service, id } = character("Heartstone Granted");
    const dto = service.addItem(id, { itemId: WEAPON, amount: 1, baseElementId: DAGGER });
    const record = dto.items.find((item) => item.itemId === DAGGER)!;
    service.equipItem(id, record.identifier, "primary");
    service.attuneItem(id, record.identifier, true);

    expect(topLevelIds(service, id)).toContain(WEAPON);
    expect(service.getCharacter(id).sum.elements.some((entry) => entry.id === GIFT)).toBe(true);
    expect(gift(service, id)).toMatchObject({ enabled: false, grantedBy: [WEAPON_NAME] });
  });

  it("enables and disables the character's own copy without touching the item's", () => {
    const { service, id } = character("Heartstone Own");
    const dto = service.addItem(id, { itemId: WEAPON, amount: 1, baseElementId: DAGGER });
    const record = dto.items.find((item) => item.itemId === DAGGER)!;
    service.equipItem(id, record.identifier, "primary");
    service.attuneItem(id, record.identifier, true);

    service.setCharacterControl(id, { key: `item:${GIFT}`, enabled: true });
    expect(gift(service, id)).toMatchObject({ enabled: true, grantedBy: [WEAPON_NAME] });
    expect(topLevelIds(service, id)).toContain(GIFT);

    service.setCharacterControl(id, { key: `item:${GIFT}`, enabled: false });
    expect(gift(service, id)).toMatchObject({ enabled: false, grantedBy: [WEAPON_NAME] });
    expect(topLevelIds(service, id)).not.toContain(GIFT);
    expect(topLevelIds(service, id)).toContain(WEAPON);
  });
});
