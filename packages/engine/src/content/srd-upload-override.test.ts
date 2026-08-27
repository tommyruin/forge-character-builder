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

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const SYSTEM_ROOT = fileURLToPath(new URL("../../../../third-party/elements/system/", import.meta.url));
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
});
