/**
 * Every reference the shipped content makes resolves inside the shipped
 * library, apart from a short reviewed list.
 *
 * Ingestion reports missing grants only for the files a user uploads, so a
 * dangling reference in the bundled content would never surface on its own.
 * This loads the library exactly as the browser build assembles it (the
 * public-base profile: core, both SRD subsets and the shipped system files)
 * and pins the whole finding list.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "./library.js";
import { missingGrantDiagnostics } from "./missing-grants.js";
import { SYSTEM_ROOT } from "../testing/corpus.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const PROFILE_PATH = fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url));

/**
 * Reviewed findings, keyed `file | element id | missing reference`. Each one
 * resolves once the user uploads the book that defines its target.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    "system/system-proxies.xml | ID_DMG_INTERNAL_ITEM_PROFICIENCY_PROXY_PROFICIENCY_WEAPON_MODERN_FIREARMS_PISTOL_AUTOMATIC | ID_WOTC_DMG_PROFICIENCY_WEAPON_MODERN_FIREARMS_PISTOL_AUTOMATIC",
    "saved-character proxy; its firearm proficiency comes from an uploaded DMG",
  ],
  [
    "system/system-proxies.xml | ID_DMG_INTERNAL_ITEM_PROFICIENCY_PROXY_PROFICIENCY_WEAPON_MODERN_FIREARMS_SHOTGUN | ID_WOTC_DMG_PROFICIENCY_WEAPON_MODERN_FIREARMS_SHOTGUN",
    "saved-character proxy; its firearm proficiency comes from an uploaded DMG",
  ],
  [
    "system/system-proxies.xml | ID_DMG_INTERNAL_ITEM_PROFICIENCY_PROXY_PROFICIENCY_WEAPON_RENAISSANCE_FIREARMS_PISTOL | ID_WOTC_DMG_PROFICIENCY_WEAPON_RENAISSANCE_FIREARMS_PISTOL",
    "saved-character proxy; its firearm proficiency comes from an uploaded DMG",
  ],
  [
    "system/system-proxies.xml | ID_UA20200713_INTERNAL_ITEM_FEAT_PROXY_FIGHTING_INITIATE | ID_WOTC_UA20200713_FEAT_FIGHTING_INITIATE",
    "saved-character proxy; its feat comes from uploaded Unearthed Arcana content",
  ],
]);

/** The library exactly as the shipped browser build assembles it. */
async function shippedLibrary(): Promise<ElementLibrary> {
  const { CONTENT_PROFILES, PUBLIC_BASE_PATHS } = (await import(PROFILE_PATH)) as {
    CONTENT_PROFILES: Record<string, { includes(path: string): boolean }>;
    PUBLIC_BASE_PATHS: Set<string>;
  };
  const files = new Map<string, string>();
  for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), "utf8"));
  for (const name of ["system-elements.xml", "system-elements-extended.xml", "system-proxies.xml", "system-unarmed-riders.xml"]) {
    const path = `system/${name}`;
    if (CONTENT_PROFILES["public-base"]!.includes(path)) files.set(path, await readFile(join(SYSTEM_ROOT, name), "utf8"));
  }
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}

let library: ElementLibrary;
beforeAll(async () => {
  library = await shippedLibrary();
}, 120_000);

describe("missing grants in the shipped content", () => {
  it("loads the shipped system files", () => {
    expect(library.fileOrder).toContain("system/system-proxies.xml");
    expect(library.fileOrder).toContain("system/system-unarmed-riders.xml");
  });

  it("reports nothing beyond the reviewed list", () => {
    const found = missingGrantDiagnostics(library).map(
      (finding) => `${finding.file} | ${finding.elementId} | ${finding.missingId}`,
    );
    expect([...new Set(found)].sort()).toEqual([...ALLOWED.keys()].sort());
  });

  it("keeps the tool umbrella proficiencies free of grants", () => {
    // Each tool needs its own proficiency; an umbrella must never grant them all.
    for (const id of [
      "ID_PROFICIENCY_TOOL_PROFICIENCY_ARTISANS_TOOLS",
      "ID_PROFICIENCY_TOOL_PROFICIENCY_MUSICAL_INSTRUMENT",
      "ID_PROFICIENCY_GAMING_SET_PROFICIENCY_GAMING_SET",
    ]) {
      const element = library.byId.get(id);
      expect(element, id).toBeDefined();
      expect(element!.rules, id).toEqual([]);
    }
  });
});
