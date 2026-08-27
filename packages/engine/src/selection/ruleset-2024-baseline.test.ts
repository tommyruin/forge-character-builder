/**
 * 2024 mode against the content the browser actually ships.
 *
 * The shipped baseline defines Alignment, Deity and every Proficiency
 * (skills, tools, instruments) once, under the 2014 core-book source names.
 * With those classified as 2014 content, a character limited to the 2024
 * rules lost its required Alignment choice and every skill pick — 2024 mode
 * could not complete a character. They are ruleset-shared now, and the
 * authored 2024 patch files supply the PHB24 skill tags and the
 * "Skill Expertise" proficiency elements the 2024 classes select from.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "./selection.js";
import { seededRng } from "../testing/character-factory.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const SYSTEM_ROOT = fileURLToPath(new URL("../../../../third-party/elements/system/", import.meta.url));

/** The library exactly as the shipped browser build assembles it. */
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

let library: ElementLibrary;
beforeAll(async () => {
  library = await shippedLibrary();
}, 120_000);

describe("2024 mode against the shipped content", () => {
  it("classifies Alignment, Deity and Proficiency elements as shared", () => {
    expect(library.ruleset.get("ID_ALIGNMENT_LAWFUL_GOOD")).toBe("shared");
    expect(library.ruleset.get("ID_PROFICIENCY_SKILL_ACROBATICS")).toBe("shared");
    const deity = library.byType.get("Deity")?.[0];
    expect(deity).toBeDefined();
    expect(library.ruleset.get(deity!.identity.id)).toBe("shared");
  });

  it("offers an Alignment to a character limited to the 2024 rules", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(1) });
    const id = service.createCharacter("Rules 2024").id;
    service.setRulesetMode(id, "2024");
    const state = service.getCharacter(id);
    const alignment = pendingSelectionRules(state).find((rule) => rule.type === "Alignment");
    expect(alignment).toBeDefined();
    expect(selectionOptions(state, library, alignment!).length).toBeGreaterThan(0);
  });

  it("carries the PHB24 skill tags on the shipped skill elements", () => {
    const stealth = library.byId.get("ID_PROFICIENCY_SKILL_STEALTH");
    const arcana = library.byId.get("ID_PROFICIENCY_SKILL_ARCANA");
    expect(stealth?.supports).toContain("PHB24 Rogue");
    expect(arcana?.supports).toContain("PHB24 Wizard");
    expect(arcana?.supports).not.toContain("PHB24 Rogue");
  });

  it("ships the Skill Expertise proficiency elements the 2024 classes select", () => {
    const expertise = (library.byType.get("Proficiency") ?? []).filter((element) =>
      element.supports.includes("Skill Expertise"),
    );
    expect(expertise).toHaveLength(18);
    for (const element of expertise) {
      expect(element.identity.id.startsWith("ID_INTERNAL_PROFICIENCY_SKILL_EXPERTISE_")).toBe(true);
      expect(library.ruleset.get(element.identity.id)).toBe("shared");
      expect(element.requirements).toBeTruthy();
    }
    // The 2024 Wizard's Scholar feature names these by id.
    expect(library.byId.has("ID_INTERNAL_PROFICIENCY_SKILL_EXPERTISE_ARCANA")).toBe(true);
    expect(library.byId.has("ID_INTERNAL_PROFICIENCY_SKILL_EXPERTISE_SLEIGHT_OF_HAND")).toBe(true);
  });
});
