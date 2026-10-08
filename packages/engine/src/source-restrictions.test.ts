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
import { isRequiredSource, normalizeSourceName } from "./content/sourceIdentity.js";

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

/**
 * Every switchable source id except those whose names `keep` admits — the
 * list the Sources panel can produce. Required books (Dungeon Master's Guide,
 * Monster Manual, Aurora Legacy Essentials) cannot be disabled.
 */
function restrictAllExcept(keep: (source: string) => boolean): string[] {
  return [...library.sources.values()]
    .filter((source) => !isRequiredSource(source) && !keep(source.identity.name))
    .map((source) => source.identity.id);
}

/** Normalized names of the required books, which stay enabled under any restriction. */
function requiredSourceNames(): Set<string> {
  return new Set(
    [...library.sources.values()]
      .filter((source) => isRequiredSource(source))
      .map((source) => normalizeSourceName(source.identity.name)),
  );
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

    // Fizban's Sapphire Buckler is gone; the required Dungeon Master's Guide
    // still supplies magic armor.
    const armor = page({ characterId: id, itemCategory: "Magic Armor" });
    expect(armor.items.some((item) => item.id === SAPPHIRE_BUCKLER)).toBe(false);
    expect(armor.items.length).toBeGreaterThan(0);
    const required = requiredSourceNames();
    expect(armor.items.filter((item) => !required.has(normalizeSourceName(item.source)))).toEqual([]);

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
    // Every corpus category also appears in a required book, so a synthetic
    // supplement carries the only items of its category.
    const synthetic = createEmptyLibrary();
    replaceLibraryFiles(synthetic, [
      [
        "test/books.xml",
        `<?xml version="1.0" encoding="utf-8"?>
<elements>
	<element name="Core Book" type="Source" source="Core Book" id="ID_TEST_SOURCE_CORE">
		<setters><set name="core">true</set></setters>
	</element>
	<element name="Supplement" type="Source" source="Supplement" id="ID_TEST_SOURCE_SUPPLEMENT" />
	<element name="Rope" type="Item" source="Core Book" id="ID_TEST_ITEM_ROPE">
		<setters><set name="category">Adventuring Gear</set></setters>
	</element>
	<element name="Sky Anchor" type="Item" source="Supplement" id="ID_TEST_ITEM_SKY_ANCHOR">
		<setters><set name="category">Ship Fittings</set></setters>
	</element>
</elements>`,
      ],
    ]);
    const service = new CharacterService(undefined, synthetic);
    const id = service.createCharacter("categories").id;
    const handlers = createEngineMethodHandlers(service, synthetic);
    const keys = (characterId?: string) =>
      (handlers.equipmentCategories!(characterId) as Array<{ key: string }>).map(
        (category) => category.key,
      );

    expect(keys(id)).toEqual(["item-adventuring-gear", "item-ship-fittings"]);
    service.getCharacter(id).restrictedSources = ["ID_TEST_SOURCE_SUPPLEMENT", "ID_TEST_SOURCE_CORE"];
    expect(keys()).toContain("item-ship-fittings");
    // The supplement's category goes; the required book's stays.
    expect(keys(id)).toEqual(["item-adventuring-gear"]);
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

interface SourceRecordDto {
  id: string;
  name: string;
  author: string;
  publisher: string;
  canToggle: boolean;
}
interface SourceGroupDto {
  name: string;
  canToggle: boolean;
  sources: SourceRecordDto[];
}

const PHB24_NAME = "Player’s Handbook (2024)";
const AI_SOURCE = "ID_WOTC_SOURCE_ACQUISITIONS_INCORPORATED";
const EGTW_SOURCE = "ID_WOTC_SOURCE_EXPLORERS_GUIDE_TO_WILDEMOUNT";
const ALE_SOURCE = "ID_SOURCE_AURORA_LEGACY_ESSENTIALS";
const DNDB_SOURCES = [
  "ID_WOTC_SOURCE_DESCENT_INTO_THE_LOST_CAVERNS_OF_TSOJCANTH",
  "ID_WOTC_SOURCE_HEROES_FEAST_SAVING_THE_CHILDRENS_MENU",
  "ID_WOTC_SOURCE_LEGENDARY_MAGIC_ITEMS",
  "ID_WOTC_SOURCE_MONSTROUS_COMPENDIUM_ONE",
  "ID_WOTC_SOURCE_MONSTROUS_COMPENDIUM_TWO",
  "ID_WOTC_SOURCE_MONSTROUS_COMPENDIUM_THREE",
  "ID_WOTC_SOURCE_VECNA_NEST_OF_THE_ELDRITCH_EYE",
];

function sourceGroupsFor(service: CharacterService, id: string, from: ElementLibrary = library): SourceGroupDto[] {
  return (createEngineMethodHandlers(service, from).getCharacterSources!(id) as { groups: SourceGroupDto[] }).groups;
}

describe("source groups by publisher", () => {
  it("keeps co-authored Wizards of the Coast books in the Wizards of the Coast group", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("publisher groups").id;
    const groups = sourceGroupsFor(service, id);

    const wotc = groups.find((group) => group.name === "Wizards of the Coast");
    expect(wotc).toBeDefined();
    const wotcIds = wotc!.sources.map((source) => source.id);
    expect(wotcIds).toEqual(expect.arrayContaining([AI_SOURCE, EGTW_SOURCE, ...DNDB_SOURCES]));
    expect(groups.filter((group) => group.name.startsWith("Wizards of the Coast"))).toHaveLength(1);
    expect(groups.some((group) => group.name.includes("Wizards of the Coast,"))).toBe(false);

    // Each row still credits the book's co-authors.
    const ai = wotc!.sources.find((source) => source.id === AI_SOURCE)!;
    expect(ai.author).toBe("Wizards of the Coast, Penny Arcade");
    expect(ai.publisher).toBe("WOTC");
    expect(wotc!.sources.find((source) => source.id === EGTW_SOURCE)!.author).toBe(
      "Wizards of the Coast, Matthew Mercer",
    );
  });

  it("keeps a homebrew author with a comma and no abbreviation in its own group", () => {
    const synthetic = createEmptyLibrary();
    replaceLibraryFiles(synthetic, [
      [
        "homebrew/source.xml",
        `<?xml version="1.0" encoding="utf-8"?>
<elements>
	<element name="Kitchen Sink" type="Source" source="Kitchen Sink" id="ID_HB_SOURCE_KITCHEN_SINK">
		<setters>
			<set name="author">Ann Example, Bo Example</set>
		</setters>
	</element>
	<element name="Official Book" type="Source" source="Official Book" id="ID_HB_SOURCE_OFFICIAL">
		<setters>
			<set name="author" abbreviation="WOTC">Wizards of the Coast</set>
		</setters>
	</element>
	<element name="Shared Book" type="Source" source="Shared Book" id="ID_HB_SOURCE_SHARED">
		<setters>
			<set name="author" abbreviation="WOTC">Wizards of the Coast, Guest Writer</set>
		</setters>
	</element>
</elements>`,
      ],
    ]);
    const service = new CharacterService(undefined, synthetic);
    const id = service.createCharacter("homebrew groups").id;
    const groups = sourceGroupsFor(service, id, synthetic).map((group) => ({
      name: group.name,
      ids: group.sources.map((source) => source.id),
    }));
    expect(groups).toEqual([
      { name: "Ann Example, Bo Example", ids: ["ID_HB_SOURCE_KITCHEN_SINK"] },
      { name: "Wizards of the Coast", ids: ["ID_HB_SOURCE_OFFICIAL", "ID_HB_SOURCE_SHARED"] },
    ]);
  });

  it("limits Race, Background and Deity options to PHB 2024 and required books after the UI's group restriction", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("phb 2024 only").id;
    service.setRulesetMode(id, "2024");
    const handlers = createEngineMethodHandlers(service, library);
    const groups = sourceGroupsFor(service, id);
    // The panel's group toggle: every switchable book in the Wizards of the
    // Coast group off, then Player's Handbook (2024) back on.
    const wotc = groups.find((group) => group.name === "Wizards of the Coast")!;
    const restrictedSourceIds = wotc.sources
      .filter((source) => source.canToggle && source.name !== PHB24_NAME)
      .map((source) => source.id);
    void handlers.setCharacterSources!(id, { restrictedSourceIds });

    const allowed = new Set(
      groups
        .flatMap((group) => group.sources)
        .filter((source) => !source.canToggle || source.name === PHB24_NAME)
        .map((source) => normalizeSourceName(source.name)),
    );
    const rules = service.getCharacterDetail(id).selectionRules;
    for (const type of ["Race", "Background", "Deity"]) {
      const rule = rules.find((candidate) => candidate.type === type);
      expect(rule, type).toBeDefined();
      const options = handlers.getSelectionOptions!(id, rule!.identifier) as Array<{ name: string; source: string }>;
      // Neither Player's Handbook (2024) nor a required book defines deities,
      // so that list may be empty; races and backgrounds must remain.
      if (type !== "Deity") expect(options.length, type).toBeGreaterThan(0);
      const outside = options.filter((option) => !allowed.has(normalizeSourceName(option.source)));
      expect(outside, type).toEqual([]);
    }
    const races = handlers.getSelectionOptions!(
      id,
      rules.find((rule) => rule.type === "Race")!.identifier,
    ) as Array<{ name: string }>;
    expect(races.some((option) => option.name === "Verdan")).toBe(false);
  });
});

describe("required sources cannot be restricted", () => {
  const alignmentOptions = (service: CharacterService, id: string): unknown[] => {
    const handlers = createEngineMethodHandlers(service, library);
    const rule = service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === "Alignment");
    expect(rule).toBeDefined();
    return handlers.getSelectionOptions!(id, rule!.identifier) as unknown[];
  };

  it("drops a required source id from setCharacterSources and keeps alignments", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("required").id;
    const before = alignmentOptions(service, id).length;
    expect(before).toBeGreaterThan(0);
    const response = createEngineMethodHandlers(service, library).setCharacterSources!(id, {
      restrictedSourceIds: [ALE_SOURCE, AI_SOURCE, "missing-source"],
    }) as { restrictedSourceIds: string[] };
    expect(response.restrictedSourceIds).toEqual([AI_SOURCE, "missing-source"]);
    expect(service.getCharacter(id).restrictedSources).toEqual([AI_SOURCE, "missing-source"]);
    expect(service.exportCharacterXml(id)).not.toContain(ALE_SOURCE);
    expect(alignmentOptions(service, id)).toHaveLength(before);
  });

  it("ignores a required source id in an imported file", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("imported required").id;
    const before = alignmentOptions(service, id).length;
    void createEngineMethodHandlers(service, library).setCharacterSources!(id, { restrictedSourceIds: [AI_SOURCE] });
    const xml = service
      .exportCharacterXml(id)
      .replace(`<source id="${AI_SOURCE}" />`, `<source id="${AI_SOURCE}" /><source id="${ALE_SOURCE}" />`);
    expect(xml).toContain(ALE_SOURCE);

    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml(id, xml);
    // The file keeps the id (imports stay byte-identical); enforcement skips it.
    expect(reader.exportCharacterXml(id)).toBe(xml);
    expect(alignmentOptions(reader, id)).toHaveLength(before);
    const state = reader.getCharacter(id);
    const essentials = [...library.byId.values()].find(
      (element) => element.identity.type !== "Source" && element.identity.source === "Aurora Legacy Essentials",
    );
    if (essentials !== undefined) {
      expect(isRestrictedForCharacter(state, library, essentials)).toBe(false);
    }
  });
});
