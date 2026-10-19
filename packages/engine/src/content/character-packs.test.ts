/**
 * Character packs: a character's own compiled content installed in the shared
 * library as an overlay. It resolves like book content for its owners, never
 * replaces a book element, survives library rebuilds and snapshot boots, and
 * leaves no trace in a snapshot.
 */

import { describe, expect, it } from "vitest";
import { emptyCharacterState } from "../character/state.js";
import { createFastStartController } from "../snapshot/fast-start.js";
import { contentLibraryDigest, serializeContentLibrary } from "../snapshot/content-graph.js";
import { FAST_START_MANIFEST } from "../snapshot/identities.js";
import { encodeBase64 } from "../platform.js";
import { isContentAllowedForCharacter } from "./access.js";
import {
  characterPackIds,
  characterPackOwners,
  installCharacterPack,
  isCharacterPackElement,
  removeCharacterPack,
  withoutCharacterPacks,
} from "./character-packs.js";
import { ingestContentFiles } from "./ingestion.js";
import { createEmptyLibrary, type ElementLibrary } from "./library.js";

const file = (xml: string) => encodeBase64(new TextEncoder().encode(`<elements>${xml}</elements>`));

const BOOK = `
<element name="Book Feat" type="Feat" source="Test Book" id="ID_TEST_FEAT_BOOK"><description><p>x</p></description></element>
<element name="Other Feat" type="Feat" source="Test Book" id="ID_TEST_FEAT_OTHER"><description><p>x</p></description></element>`;

const pack = (...entries: Array<[id: string, type: string, extra?: string]>): string =>
  `<elements>${entries
    .map(([id, type, extra = ""]) => `<element name="Mine ${id}" type="${type}" source="Custom" id="${id}"><description><p>x</p></description>${extra}</element>`)
    .join("")}</elements>`;

async function libraryWithBook(): Promise<ElementLibrary> {
  const library = createEmptyLibrary();
  await ingestContentFiles(library, [{ path: "imports/book.xml", base64: file(BOOK) }]);
  return library;
}

describe("installing a pack", () => {
  it("makes its entries resolve and counts them", async () => {
    const library = await libraryWithBook();
    const before = { elements: library.elementCount, feats: library.typeCounts.Feat, shared: library.rulesetCounts.sharedCount };
    const report = installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"], ["ID_CUSTOM_B", "Custom Feature"]) });
    expect(report).toEqual({ installed: ["ID_CUSTOM_A", "ID_CUSTOM_B"], skipped: [] });
    expect(library.byId.get("ID_CUSTOM_A")?.identity.type).toBe("Feat");
    expect(library.byType.get("Custom Feature")).toHaveLength(1);
    expect(library.elementCount).toBe(before.elements + 2);
    expect(library.typeCounts.Feat).toBe(before.feats! + 1);
    expect(library.typeCounts["Custom Feature"]).toBe(1);
    expect(library.rulesetCounts.sharedCount).toBe(before.shared + 2);
    expect(library.ruleset.get("ID_CUSTOM_A")).toBe("shared");
    expect(characterPackIds(library, "Ada")).toEqual(["ID_CUSTOM_A", "ID_CUSTOM_B"]);
  });

  it("classifies an entry by its own ruleset setter", async () => {
    const library = await libraryWithBook();
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat", '<setters><set name="ruleset">2024</set></setters>']) });
    expect(library.ruleset.get("ID_CUSTOM_A")).toBe("2024");
    expect(library.rulesetCounts.rules2024Count).toBeGreaterThan(0);
  });

  it("never replaces a book element: the id is skipped and the book keeps it", async () => {
    const library = await libraryWithBook();
    const book = library.byId.get("ID_TEST_FEAT_BOOK");
    const report = installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_TEST_FEAT_BOOK", "Feat"], ["ID_CUSTOM_A", "Feat"]) });
    expect(report.installed).toEqual(["ID_CUSTOM_A"]);
    expect(report.skipped).toEqual([{ id: "ID_TEST_FEAT_BOOK", reason: expect.stringContaining("already defines") }]);
    expect(library.byId.get("ID_TEST_FEAT_BOOK")).toBe(book);
    expect(isCharacterPackElement(library, "ID_TEST_FEAT_BOOK")).toBe(false);
  });

  it("replaces a character's earlier pack and removes it cleanly", async () => {
    const library = await libraryWithBook();
    const baseline = library.elementCount;
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"]) });
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_B", "Feat"]) });
    expect(library.byId.has("ID_CUSTOM_A")).toBe(false);
    expect(library.byId.has("ID_CUSTOM_B")).toBe(true);
    removeCharacterPack(library, "Ada");
    expect(library.byId.has("ID_CUSTOM_B")).toBe(false);
    expect(library.elementCount).toBe(baseline);
    expect(library.byType.get("Feat")!.map((element) => element.identity.id)).toEqual(["ID_TEST_FEAT_BOOK", "ID_TEST_FEAT_OTHER"]);
  });
});

describe("who can see an entry", () => {
  it("offers it to the characters that carry it and to nobody else", async () => {
    const library = await libraryWithBook();
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"]) });
    const element = library.byId.get("ID_CUSTOM_A")!;
    expect(isContentAllowedForCharacter(emptyCharacterState("Ada"), library, element)).toBe(true);
    expect(isContentAllowedForCharacter(emptyCharacterState("Bea"), library, element)).toBe(false);
    expect(isContentAllowedForCharacter(emptyCharacterState("Bea"), library, library.byId.get("ID_TEST_FEAT_BOOK")!)).toBe(true);
  });

  it("shares one definition between two characters carrying the same entry, and keeps it until both are gone", async () => {
    const library = await libraryWithBook();
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"]) });
    installCharacterPack(library, { characterId: "Bea", xml: pack(["ID_CUSTOM_A", "Feat"]) });
    expect([...characterPackOwners(library, "ID_CUSTOM_A")!].sort()).toEqual(["Ada", "Bea"]);
    expect(library.byType.get("Feat")!.filter((element) => element.identity.id === "ID_CUSTOM_A")).toHaveLength(1);
    removeCharacterPack(library, "Ada");
    expect(library.byId.has("ID_CUSTOM_A")).toBe(true);
    expect([...characterPackOwners(library, "ID_CUSTOM_A")!]).toEqual(["Bea"]);
    removeCharacterPack(library, "Bea");
    expect(library.byId.has("ID_CUSTOM_A")).toBe(false);
  });
});

describe("rebuilds and snapshots", () => {
  it("survives a library rebuild, even one that now defines the id itself", async () => {
    const library = await libraryWithBook();
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"]) });
    await ingestContentFiles(library, [{ path: "imports/more.xml", base64: file('<element name="More" type="Feat" source="Test Book" id="ID_TEST_FEAT_MORE" />') }]);
    expect(characterPackIds(library, "Ada")).toEqual(["ID_CUSTOM_A"]);
    // A collection later defines the same id: the collection's element is the one in force.
    await ingestContentFiles(library, [{ path: "imports/promoted.xml", base64: file('<element name="Promoted" type="Feat" source="Camp" id="ID_CUSTOM_A" />') }]);
    expect(library.byId.get("ID_CUSTOM_A")?.identity.source).toBe("Camp");
    expect(characterPackIds(library, "Ada")).toEqual([]);
  });

  it("is left out of the serialized library, whatever is installed", async () => {
    const library = await libraryWithBook();
    const digest = () => contentLibraryDigest(serializeContentLibrary(library));
    const plain = await digest();
    installCharacterPack(library, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"], ["ID_CUSTOM_B", "Custom Feature"]) });
    expect(await digest()).toBe(plain);
    expect(library.byId.has("ID_CUSTOM_A")).toBe(true);
    expect(withoutCharacterPacks(library, () => library.byId.has("ID_CUSTOM_A"))).toBe(false);
    expect(library.byId.has("ID_CUSTOM_A")).toBe(true);
  });

  it("goes back on top after a Fast Start boot replaces the library's maps", async () => {
    const source = await libraryWithBook();
    const controller = createFastStartController(source);
    await controller.prepare();
    const body = controller.takeBuffer();

    const target = createEmptyLibrary();
    installCharacterPack(target, { characterId: "Ada", xml: pack(["ID_CUSTOM_A", "Feat"]) });
    await createFastStartController(target).boot({ manifest: FAST_START_MANIFEST, expectedIdentity: FAST_START_MANIFEST, body });
    expect(target.byId.has("ID_TEST_FEAT_BOOK")).toBe(true);
    expect(characterPackIds(target, "Ada")).toEqual(["ID_CUSTOM_A"]);
    expect(target.elementCount).toBe(source.elementCount + 1);
  });
});
