/**
 * Source restrictions across the content surfaces. A character's disabled
 * sources must hide their content even when the content's `source` attribute
 * drifts from the Source element's display name (case, punctuation), and the
 * catalogue queries (equipment, adjustments, optional rules, base items) must
 * honour the same restriction the selection pickers already apply.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary, createEmptyLibrary, replaceLibraryFiles } from "./content/library.js";
import { buildCorpusLibrary } from "./testing/corpus.js";
import { CharacterService } from "./character/service.js";
import { getCharacterAdjustments, getOptionalRules } from "./character/options.js";
import { isRestrictedForCharacter } from "./selection/selection.js";
import { createEngineMethodHandlers } from "./worker-handlers.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

const PHB_SOURCE = "ID_WOTC_SOURCE_PLAYERS_HANDBOOK";
const VRGTR_SOURCE = "ID_WOTC_SOURCE_VAN_RICHTENS_GUIDE_TO_RAVENLOFT";
const TASHA_SOURCE = "ID_WOTC_SOURCE_TASHAS_CAULDRON_OF_EVERYTHING";
const FIZBAN_SOURCE = "ID_WOTC_FTOD_SOURCE_FIZBANS_TREASURY_OF_DRAGONS";

const CHANNEL_DIVINITY = "ID_WOTC_PHB_CLASS_FEATURE_PALADIN_CHANNEL_DIVINITY";
const WERERAVEN = "ID_WOTC_VRGTR_RACIAL_TRAIT_WERERAVEN";
const SAPPHIRE_BUCKLER = "ID_WOTC_FTOD_MAGIC_ITEM_SAPPHIRE_BUCKLER";
const FLAME_TONGUE = "ID_WOTC_DMG_MAGIC_ITEM_FLAME_TONGUE";

/** All loaded source ids except those whose names `keep` admits. */
function restrictAllExcept(keep: (source: string) => boolean): string[] {
  return [...library.sources.values()]
    .filter((source) => !keep(source.identity.name))
    .map((source) => source.identity.id);
}

function restrictedCharacter(name: string, restrictedSources: string[]): {
  service: CharacterService;
  id: string;
} {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter(name).id;
  service.getCharacter(id).restrictedSources = restrictedSources;
  return { service, id };
}

describe("source restrictions by identity", () => {
  it("restricts content whose source name drifts in case or punctuation", () => {
    const { service, id } = restrictedCharacter("drift", [VRGTR_SOURCE, PHB_SOURCE]);
    const state = service.getCharacter(id);

    // "Van Richten's Guide to Ravenloft" (element) vs "…Guide To Ravenloft" (source).
    expect(isRestrictedForCharacter(state, library, library.byId.get(WERERAVEN)!)).toBe(true);
    // "Player's Handbook" (element, straight apostrophe) vs "Player’s Handbook".
    expect(isRestrictedForCharacter(state, library, library.byId.get(CHANNEL_DIVINITY)!)).toBe(true);
  });

  it("classifies a drifted source name by its Source element's ruleset", () => {
    const synthetic = createEmptyLibrary();
    replaceLibraryFiles(synthetic, [
      [
        "test/source.xml",
        `<?xml version="1.0" encoding="utf-8"?>
<elements>
	<element name="Test Book" type="Source" source="Core" id="ID_TEST_SOURCE_BOOK">
		<setters>
			<set name="ruleset">2024</set>
		</setters>
	</element>
</elements>`,
      ],
      [
        "test/feat.xml",
        `<?xml version="1.0" encoding="utf-8"?>
<elements>
	<element name="Drifted Feat" type="Feat" source="TEST  BOOK" id="ID_TEST_FEAT_DRIFTED" />
</elements>`,
      ],
    ]);

    expect(synthetic.ruleset.get("ID_TEST_FEAT_DRIFTED")).toBe("2024");
  });
});

describe("source restrictions on catalogue queries", () => {
  it("creates the restricted-sources region on a document that has none", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("regionless").id;
    const withoutRegion = service
      .exportCharacterXml(id)
      .replace(/\t<!-- restricted sources -->\r?\n\t<sources>[\s\S]*?<\/sources>\r?\n/, "");
    expect(withoutRegion).not.toContain("<sources>");
    service.importCharacterXml(id, withoutRegion);

    const handlers = createEngineMethodHandlers(service, library);
    const response = handlers.setCharacterSources!(id, {
      restrictedSourceIds: [PHB_SOURCE],
    }) as { restrictedSourceIds: string[] };

    expect(response.restrictedSourceIds).toEqual([PHB_SOURCE]);
    expect(service.getCharacter(id).restrictedSources).toEqual([PHB_SOURCE]);
  });

  it("filters contentElements to the character's sources", () => {
    const onlyPhb = restrictAllExcept((name) => name === "Player’s Handbook");
    const { service, id } = restrictedCharacter("catalogue", onlyPhb);
    const handlers = createEngineMethodHandlers(service, library);
    const page = (args: Record<string, unknown>) =>
      handlers.contentElements!({ take: 5000, ...args }) as {
        items: Array<{ id: string; source: string }>;
      };

    const armor = page({ characterId: id, itemCategory: "Magic Armor" });
    expect(armor.items.some((item) => item.id === SAPPHIRE_BUCKLER)).toBe(false);
    expect(armor.items).toEqual([]);

    const spells = page({ characterId: id, type: "Spell" });
    expect(spells.items.length).toBeGreaterThan(0);
    expect(spells.items.every((item) => item.source === "Player’s Handbook")).toBe(true);

    // The same query without a character is the unfiltered library.
    expect(
      page({ itemCategory: "Magic Armor" }).items.some(
        (item) => item.id === SAPPHIRE_BUCKLER,
      ),
    ).toBe(true);
  });

  it("filters equipment categories to the character's sources", () => {
    const onlyPhb = restrictAllExcept((name) => name === "Player’s Handbook");
    const { service, id } = restrictedCharacter("categories", onlyPhb);
    const handlers = createEngineMethodHandlers(service, library);
    const keys = (characterId?: string) =>
      (handlers.equipmentCategories!(characterId) as Array<{ key: string }>).map(
        (category) => category.key,
      );

    expect(keys()).toContain("magic-armor");
    expect(keys()).toContain("item-poison");
    expect(keys(id)).toContain("armor");
    expect(keys(id)).not.toContain("magic-armor");
    expect(keys(id)).not.toContain("item-poison");
  });

  it("filters item base options to the character's sources", () => {
    const { service, id } = restrictedCharacter("bases", []);
    expect(service.getItemBaseOptions(id, FLAME_TONGUE).options.length).toBeGreaterThan(0);

    service.getCharacter(id).restrictedSources = restrictAllExcept(() => false);
    const after = service.getItemBaseOptions(id, FLAME_TONGUE);
    expect(after.slot).toBe("weapon");
    expect(after.options).toEqual([]);
  });

  it("filters adjustments and optional rules to the character's sources", () => {
    const { service, id } = restrictedCharacter("adjustments", [FIZBAN_SOURCE, TASHA_SOURCE]);
    const state = service.getCharacter(id);

    const adjustments = getCharacterAdjustments(state, library);
    expect(adjustments.some((entry) => entry.source.includes("Fizban"))).toBe(false);
    expect(adjustments.length).toBeGreaterThan(0);

    const optional = getOptionalRules(state, library);
    expect(optional.some((entry) => entry.source.includes("Tasha"))).toBe(false);
    expect(optional.length).toBeGreaterThan(0);
  });
});
