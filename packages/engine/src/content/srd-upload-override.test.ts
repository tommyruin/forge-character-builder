/**
 * The shipped baseline is exactly what the System Reference Documents cover;
 * importing the Player's Handbook brings the rest back in place. Uploads sit
 * above the bundle in ingest order and share its element ids, so the
 * handbook's spells appear and its prose replaces the trimmed descriptions
 * without duplicating anything.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "./library.js";
import { ingestContentFiles } from "./ingestion.js";
import { encodeBase64 } from "../platform.js";
import { SYSTEM_ROOT } from "../testing/corpus.js";
import { CharacterService } from "../character/service.js";
import { createEngineMethodHandlers } from "../worker-handlers.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const PHB_2014 = fileURLToPath(new URL("../../../../third-party/elements/testdata/core/players-handbook/", import.meta.url));
const PHB_2024 = fileURLToPath(new URL("../../../../third-party/elements/testdata/core/players-handbook-2024/", import.meta.url));

async function shippedLibrary(): Promise<ElementLibrary> {
  const { PUBLIC_BASE_PATHS } = (await import(
    fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url))
  )) as { PUBLIC_BASE_PATHS: Set<string> };
  const files = new Map<string, string>();
  for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), "utf8"));
  for (const name of ["system-proxies.xml", "system-unarmed-riders.xml"]) {
    files.set(`system/${name}`, await readFile(join(SYSTEM_ROOT, name), "utf8"));
  }
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}

async function upload(library: ElementLibrary, root: string, relative: string): Promise<void> {
  const xml = await readFile(join(root, relative), "utf8");
  await ingestContentFiles(library, [{ path: `imports/phb/${relative}`, base64: encodeBase64(new TextEncoder().encode(xml)) }]);
}

let library: ElementLibrary;
beforeAll(async () => {
  library = await shippedLibrary();
}, 120_000);

describe("importing the Player's Handbook over the shipped SRD content", () => {
  it("ships the 2014 set without the handbook's spells and prose", () => {
    expect(library.byId.has("ID_PHB_SPELL_ARMOR_OF_AGATHYS")).toBe(false);
    expect(library.byId.get("ID_PHB_SPELL_BIGBYS_HAND")?.identity.name).toBe("Arcane Hand");
    expect(library.byId.get("ID_WOTC_PHB_CLASS_FIGHTER")?.descriptionXml).not.toContain("clanging plate armor");
    expect(library.byId.get("ID_SRD_RACE_DWARF")?.descriptionXml).not.toContain("SHORT AND STOUT");
  });

  it("restores the 2014 handbook's spells and prose in place", async () => {
    const before = library.elementCount;
    await upload(library, PHB_2014, "spells.xml");
    await upload(library, PHB_2014, "classes/class-fighter.xml");
    expect(library.byId.has("ID_PHB_SPELL_ARMOR_OF_AGATHYS")).toBe(true);
    expect(library.byId.get("ID_PHB_SPELL_BIGBYS_HAND")?.identity.name).toBe("Bigby’s Hand");
    expect(library.byId.get("ID_WOTC_PHB_CLASS_FIGHTER")?.descriptionXml).toContain("clanging plate armor");
    // Same ids: the handbook replaced elements rather than adding a second copy.
    expect((library.byType.get("Class") ?? []).filter((element) => element.identity.name === "Fighter" && element.identity.source !== "Player’s Handbook (2024)")).toHaveLength(1);
    expect(library.elementCount).toBeGreaterThan(before);
  });

  it("restores the 2024 handbook's prose and content in place", async () => {
    expect(library.byId.get("ID_WOTC_PHB24_CLASS_WIZARD")?.descriptionXml).not.toContain("Most Wizards share a scholarly approach");
    expect(library.byId.has("ID_WOTC_PHB24_RACE_AASIMAR")).toBe(false);
    await upload(library, PHB_2024, "classes/class-wizard.xml");
    await upload(library, PHB_2024, "races/race-aasimar.xml");
    expect(library.byId.get("ID_WOTC_PHB24_CLASS_WIZARD")?.descriptionXml).toContain("Most Wizards share a scholarly approach");
    expect(library.byId.has("ID_WOTC_PHB24_RACE_AASIMAR")).toBe(true);
    expect((library.byType.get("Class") ?? []).filter((element) => element.identity.id === "ID_WOTC_PHB24_CLASS_WIZARD")).toHaveLength(1);
  });

  it("keeps the reviewed pack extras when an upload redefines the pack", async () => {
    const PACK = "ID_WOTC_PHB24_ITEM_CLASS_EQUIPMENT_PACK_CLERIC";
    expect(library.byId.get(PACK)?.extras?.gold).toBe(7);
    await upload(library, PHB_2024, "items/items-packs.xml");
    const pack = library.byId.get(PACK)!;
    // The upload replaced the element but the reviewed extras survive: the
    // corpus pack file has no <extras>, and stripping it would drop the
    // fixed items and gold the Extract surface grants.
    expect(pack.extras?.gold).toBe(7);
    expect(pack.extras?.items.map((entry) => entry.id)).toEqual([
      "ID_WOTC_PHB24_ARMOR_MEDIUM_CHAIN_SHIRT",
      "ID_WOTC_PHB24_ARMOR_SHIELD",
    ]);
    expect(pack.extras?.choices[0]?.label).toBe("Holy Symbol");
  });

  it("lets an upload's own extras override the inherited block", () => {
    const scratch = createEmptyLibrary();
    const shipped = `<elements><element name="Pack" type="Item" source="SRD" id="ID_PACK_X"><extras gold="7"><item>ID_A</item></extras></element></elements>`;
    const upload = `<elements><element name="Pack" type="Item" source="Homebrew" id="ID_PACK_X"><extras gold="3"><item>ID_B</item></extras></element></elements>`;
    replaceLibraryFiles(scratch, [
      ["srd-5.2.1/items-packs.xml", shipped],
      ["imports/homebrew/packs.xml", upload],
    ]);
    expect(scratch.byId.get("ID_PACK_X")!.extras).toEqual({
      gold: 3,
      items: [{ id: "ID_B", amount: 1 }],
      choices: [],
    });
  });

  it("inherits extras when the override restates the same extracted contents", () => {
    const scratch = createEmptyLibrary();
    const shipped = `<elements><element name="Pack" type="Item" source="SRD" id="ID_PACK_X"><extract><item>ID_A</item><item amount="2">ID_B</item></extract><extras gold="7"><item>ID_C</item></extras></element></elements>`;
    const upload = `<elements><element name="Pack" type="Item" source="Homebrew" id="ID_PACK_X"><extract><item amount="2">ID_B</item><item>ID_A</item></extract></element></elements>`;
    replaceLibraryFiles(scratch, [
      ["srd-5.2.1/items-packs.xml", shipped],
      ["imports/homebrew/packs.xml", upload],
    ]);
    expect(scratch.byId.get("ID_PACK_X")!.extras?.gold).toBe(7);
  });

  it("does not inherit extras when the override changes the extracted contents", () => {
    const scratch = createEmptyLibrary();
    const shipped = `<elements><element name="Pack" type="Item" source="SRD" id="ID_PACK_X"><extract><item>ID_A</item></extract><extras gold="7"><item>ID_B</item></extras></element></elements>`;
    const differentItems = `<elements><element name="Pack" type="Item" source="Homebrew" id="ID_PACK_X"><extract><item>ID_C</item></extract></element></elements>`;
    replaceLibraryFiles(scratch, [
      ["srd-5.2.1/items-packs.xml", shipped],
      ["imports/homebrew/packs.xml", differentItems],
    ]);
    expect(scratch.byId.get("ID_PACK_X")!.extras).toBeUndefined();

    const changedAmount = `<elements><element name="Pack" type="Item" source="Homebrew" id="ID_PACK_X"><extract><item amount="2">ID_A</item></extract></element></elements>`;
    replaceLibraryFiles(scratch, [
      ["srd-5.2.1/items-packs.xml", shipped],
      ["imports/homebrew/packs.xml", changedAmount],
    ]);
    expect(scratch.byId.get("ID_PACK_X")!.extras).toBeUndefined();
  });

  it("does not inherit extras across a type change", () => {
    const scratch = createEmptyLibrary();
    const shipped = `<elements><element name="Pack" type="Item" source="SRD" id="ID_PACK_X"><extract><item>ID_A</item></extract><extras gold="7"><item>ID_B</item></extras></element></elements>`;
    const upload = `<elements><element name="Pack" type="Magic Item" source="Homebrew" id="ID_PACK_X"><extract><item>ID_A</item></extract></element></elements>`;
    replaceLibraryFiles(scratch, [
      ["srd-5.2.1/items-packs.xml", shipped],
      ["imports/homebrew/packs.xml", upload],
    ]);
    expect(scratch.byId.get("ID_PACK_X")!.extras).toBeUndefined();
  });

  it("marks a source whose upload replaced the bundled core stub", async () => {
    const PHB24 = "ID_WOTC_SOURCE_PLAYERS_HANDBOOK_2024";
    const DMG = "ID_WOTC_SOURCE_DUNGEON_MASTERS_GUIDE";
    expect(library.sources.get(PHB24)?.overridesBundledCore).toBeUndefined();
    expect(library.sources.get(DMG)?.overridesBundledCore).toBeUndefined();

    await upload(library, PHB_2024, "source.xml");

    expect(library.sources.get(PHB24)?.overridesBundledCore).toBe(true);
    expect(library.sources.get(DMG)?.overridesBundledCore).toBeUndefined();

    // The Source panel DTO carries the mark so it can badge the row and ask
    // before disabling it.
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("override-source").id;
    const handlers = createEngineMethodHandlers(service, library);
    const response = handlers.getCharacterSources!(id) as {
      groups: Array<{ sources: Array<Record<string, unknown>> }>;
    };
    const flat = response.groups.flatMap((group) => group.sources);
    expect(flat.find((source) => source.id === PHB24)).toMatchObject({
      canToggle: true,
      overridesBundledCore: true,
    });
    expect(flat.find((source) => source.id === DMG)).toMatchObject({
      overridesBundledCore: false,
    });
  });

  it("clears the mark when the bundled stub is the only definition again", () => {
    const scratch = createEmptyLibrary();
    const stub = `<elements><element name="Book" type="Source" source="Core" id="ID_SOURCE_X"><setters><set name="core">true</set></setters></element></elements>`;
    const upload = `<elements><element name="Book" type="Source" source="Core" id="ID_SOURCE_X"><setters><set name="core">false</set></setters></element></elements>`;
    replaceLibraryFiles(scratch, [
      ["core/sources.xml", stub],
      ["imports/phb/source.xml", upload],
    ]);
    expect(scratch.byId.get("ID_SOURCE_X")!.overridesBundledCore).toBe(true);

    replaceLibraryFiles(scratch, [["core/sources.xml", stub]]);
    expect(scratch.byId.get("ID_SOURCE_X")!.overridesBundledCore).toBeUndefined();
  });
});
