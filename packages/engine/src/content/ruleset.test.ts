/**
 * Ruleset classification is content-driven, not a literal source-name list:
 * an explicit "ruleset" setter (element first, then its Source element) wins,
 * then edition signals carried by the content itself (id markers, source id
 * suffix, source abbreviation, "(2024)" in the source name, "5.5e" in the
 * source information), then the legacy 2014 core-book names. Imported 2024
 * content must classify as 2024 without being on any hardcoded list.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, createEmptyLibrary, type ElementLibrary } from "./library.js";
import { ingestContentFiles } from "./ingestion.js";
import { encodeBase64 } from "../platform.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ingest = async (xml: string): Promise<ElementLibrary> => {
  const library = createEmptyLibrary();
  await ingestContentFiles(library, [
    { path: "imports/ruleset-test.xml", base64: encodeBase64(new TextEncoder().encode(xml)) },
  ]);
  return library;
};

describe("ruleset classification of imported content", () => {
  it("honors an explicit ruleset setter on the element", async () => {
    const library = await ingest(`<elements>
      <element name="A" type="Feat" source="Homebrew" id="ID_HB_FEAT_A"><setters><set name="ruleset">2024</set></setters></element>
      <element name="B" type="Feat" source="Homebrew" id="ID_HB_FEAT_B"><setters><set name="ruleset">2014</set></setters></element>
      <element name="C" type="Feat" source="Homebrew" id="ID_HB_FEAT_C"><setters><set name="ruleset">all</set></setters></element>
    </elements>`);
    expect(library.ruleset.get("ID_HB_FEAT_A")).toBe("2024");
    expect(library.ruleset.get("ID_HB_FEAT_B")).toBe("2014");
    expect(library.ruleset.get("ID_HB_FEAT_C")).toBe("shared");
  });

  it("classifies Alignment, Deity and Proficiency elements as shared regardless of source", async () => {
    const library = await ingest(`<elements>
      <element name="Lawful Good" type="Alignment" source="Player’s Handbook" id="ID_HB_ALIGNMENT_LG" />
      <element name="Pelor" type="Deity" source="System Reference Document" id="ID_HB_DEITY_PELOR" />
      <element name="Stealth" type="Proficiency" source="Player’s Handbook" id="ID_HB_PROFICIENCY_STEALTH" />
    </elements>`);
    expect(library.ruleset.get("ID_HB_ALIGNMENT_LG")).toBe("shared");
    expect(library.ruleset.get("ID_HB_DEITY_PELOR")).toBe("shared");
    expect(library.ruleset.get("ID_HB_PROFICIENCY_STEALTH")).toBe("shared");
  });

  it("lets the element's own setter override every other signal", async () => {
    const library = await ingest(`<elements>
      <element name="Legacy Copy" type="Feat" source="Homebrew" id="ID_HB_PHB24_FEAT_LEGACY"><setters><set name="ruleset">2014</set></setters></element>
    </elements>`);
    expect(library.ruleset.get("ID_HB_PHB24_FEAT_LEGACY")).toBe("2014");
  });

  it("inherits a ruleset setter from the element's Source element", async () => {
    const library = await ingest(`<elements>
      <element name="My 2024 Pack" type="Source" source="Homebrew" id="ID_HB_SOURCE_PACK"><setters><set name="ruleset">2024</set></setters></element>
      <element name="Packed Feat" type="Feat" source="My 2024 Pack" id="ID_HB_FEAT_PACKED" />
    </elements>`);
    expect(library.ruleset.get("ID_HB_FEAT_PACKED")).toBe("2024");
  });

  it("classifies by id markers when no setter exists", async () => {
    const library = await ingest(`<elements>
      <element name="Marked" type="Feat" source="Somewhere" id="ID_HB_PHB24_FEAT_MARKED" />
      <element name="Marked DMG" type="Magic Item" source="Somewhere" id="ID_HB_DMG24_ITEM_MARKED" />
    </elements>`);
    expect(library.ruleset.get("ID_HB_PHB24_FEAT_MARKED")).toBe("2024");
    expect(library.ruleset.get("ID_HB_DMG24_ITEM_MARKED")).toBe("2024");
  });

  it("classifies by source-element signals: id suffix, abbreviation, information", async () => {
    const library = await ingest(`<elements>
      <element name="Suffix Pack" type="Source" source="Homebrew" id="ID_HB_SOURCE_PACK_2024" />
      <element name="By Suffix" type="Feat" source="Suffix Pack" id="ID_HB_FEAT_SUFFIX" />
      <element name="Abbrev Pack" type="Source" source="Homebrew" id="ID_HB_SOURCE_ABBREV"><setters><set name="abbreviation">HBP24</set></setters></element>
      <element name="By Abbrev" type="Feat" source="Abbrev Pack" id="ID_HB_FEAT_ABBREV" />
      <element name="Info Pack" type="Source" source="Homebrew" id="ID_HB_SOURCE_INFO"><setters><set name="information">D&amp;D 5.5e supplement</set></setters></element>
      <element name="By Info" type="Feat" source="Info Pack" id="ID_HB_FEAT_INFO" />
    </elements>`);
    expect(library.ruleset.get("ID_HB_FEAT_SUFFIX")).toBe("2024");
    expect(library.ruleset.get("ID_HB_FEAT_ABBREV")).toBe("2024");
    expect(library.ruleset.get("ID_HB_FEAT_INFO")).toBe("2024");
  });

  it("classifies by '(2024)' in the source name even without a Source element", async () => {
    const library = await ingest(`<elements>
      <element name="Loose" type="Feat" source="Homebrew Handbook (2024)" id="ID_HB_FEAT_LOOSE" />
    </elements>`);
    expect(library.ruleset.get("ID_HB_FEAT_LOOSE")).toBe("2024");
  });

  it("classifies the straight-apostrophe DMG and the SRD as 2014", async () => {
    const library = await ingest(`<elements>
      <element name="DMG Thing" type="Magic Item" source="Dungeon Master's Guide" id="ID_HB_ITEM_DMG"><setters><set name="category">Wondrous Items</set></setters></element>
      <element name="SRD Thing" type="Feat" source="System Reference Document" id="ID_HB_FEAT_SRD" />
    </elements>`);
    expect(library.ruleset.get("ID_HB_ITEM_DMG")).toBe("2014");
    expect(library.ruleset.get("ID_HB_FEAT_SRD")).toBe("2014");
  });
});

describe("ruleset classification of the bundled corpus (regression)", () => {
  let library: ElementLibrary;
  beforeAll(async () => {
    library = await buildLibrary(CORPUS_ROOT);
  }, 120_000);

  it("keeps the classification for core books and the UA abbreviation quirk", () => {
    expect(library.ruleset.get("ID_WOTC_PHB24_CLASS_FIGHTER")).toBe("2024");
    expect(library.ruleset.get("ID_WOTC_PHB_CLASS_FIGHTER")).toBe("2014");
    // 2017/2020 playtest documents whose abbreviations end in "24" classify
    // as 2024 (UA20170424 / UA20200224) — intended behaviour.
    expect(library.ruleset.get("ID_WOTC_UA20170424_FEAT_BARBED_HIDE")).toBe("2024");
  });
});
