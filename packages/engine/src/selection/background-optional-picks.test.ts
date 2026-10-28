/**
 * A background's descriptive picks never count as unfinished. A `List`
 * select (personality trait, ideal, bond, flaw, trinket and the like) only
 * stores a line of text: it grants nothing and the .dnd5e format does not
 * count it as a registration. The content marks these lists inconsistently,
 * so the detail reports a List pick as optional unless its select says
 * `optional="false"`. Choices with mechanical effect (a background's
 * languages, a 2024 background's ability scores and origin feat) stay
 * required.
 *
 * Synthetic content, plus the shipped SRD content loaded the way the client
 * loads it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterDetail, type SelectionRuleDetail } from "./detail.js";
import { pendingSelectionRules } from "./selection.js";
import { seededRng } from "../testing/character-factory.js";
import { SYSTEM_ROOT } from "../testing/corpus.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));

/** The rule types the client files under Build > Background. */
const BACKGROUND_SECTION_TYPES = new Set(["Background", "Background Variant", "Background Feature", "List"]);

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

function buildWith(
  library: ElementLibrary,
  mode: "2014" | "2024" | null,
  picks: readonly (readonly [type: string, elementId: string])[],
) {
  const service = new CharacterService(undefined, library, { rng: seededRng(3) });
  const id = service.createCharacter("Background picks").id;
  if (mode) service.setRulesetMode(id, mode);
  for (const [type, elementId] of picks) {
    const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection);
    if (!rule) throw new Error(`no pending ${type} rule for ${elementId}`);
    service.setSelection(id, rule.identifier, elementId);
  }
  return { service, id, rules: () => buildCharacterDetail(service.getCharacter(id), library).selectionRules };
}

/** Background-section rules that would keep the Build rail's reminder dot on. */
function openRequiredBackgroundRules(rules: readonly SelectionRuleDetail[]): string[] {
  return rules
    .filter((rule) => BACKGROUND_SECTION_TYPES.has(rule.type) && !rule.allocatesAbilityScores)
    .filter((rule) => !rule.isOptional && rule.hasAvailableOptions && !rule.hasSelection)
    .map((rule) => `${rule.type}: ${rule.name}`);
}

const byName = (rules: readonly SelectionRuleDetail[], name: string): SelectionRuleDetail => {
  const rule = rules.find((candidate) => candidate.name === name);
  if (!rule) throw new Error(`no rule named ${name}`);
  return rule;
};

describe("background List picks are optional (synthetic)", () => {
  const BACKGROUND = "ID_TEST_BACKGROUND_WANDERER";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Wanderer" type="Background" source="Optional Test" id="${BACKGROUND}">
    <rules>
      <select type="Language" name="Language (Wanderer)" supports="Test Tongue" />
      <select type="Background Feature" name="Wanderer Variant" supports="Wanderer Variant" optional="true" />
      <select type="List" name="Habit" number="2">
        <item id="1">first habit</item><item id="2">second habit</item><item id="3">third habit</item>
      </select>
      <select type="List" name="Keepsake" optional="true">
        <item id="1">first keepsake</item><item id="2">second keepsake</item>
      </select>
      <select type="List" name="Oath">
        <item id="1">first oath</item><item id="2">second oath</item>
      </select>
      <select type="List" name="Calling" optional="false">
        <item id="1">first calling</item><item id="2">second calling</item>
      </select>
    </rules>
  </element>
  <element name="Variant Path" type="Background Feature" source="Optional Test" id="ID_TEST_BACKGROUND_FEATURE_VARIANT">
    <supports>Wanderer Variant</supports>
  </element>
  <element name="Test Speech" type="Language" source="Optional Test" id="ID_TEST_LANGUAGE_SPEECH">
    <supports>Test Tongue</supports>
  </element>
</elements>`;

  function wanderer() {
    const library = createEmptyLibrary();
    replaceLibraryFiles(library, new Map([["test/optional-picks.xml", xml]]));
    return buildWith(library, null, [["Background", BACKGROUND]]);
  }

  it("reports unmarked and optional-marked List picks as optional", () => {
    const rules = wanderer().rules();
    expect(byName(rules, "Habit")).toMatchObject({ type: "List", isList: true, isOptional: true, selectionCount: 2 });
    expect(byName(rules, "Oath")).toMatchObject({ type: "List", isOptional: true });
    expect(byName(rules, "Keepsake")).toMatchObject({ type: "List", isOptional: true });
  });

  it("keeps a List pick that its select marks optional=\"false\" required", () => {
    const rules = wanderer().rules();
    expect(byName(rules, "Calling")).toMatchObject({ type: "List", isOptional: false, hasSelection: false });
    expect(openRequiredBackgroundRules(rules)).toEqual(["List: Calling"]);
  });

  it("keeps the background's other choices as the content marks them", () => {
    const rules = wanderer().rules();
    expect(byName(rules, "Language (Wanderer)")).toMatchObject({ type: "Language", isOptional: false, hasSelection: false });
    expect(byName(rules, "Wanderer Variant")).toMatchObject({ type: "Background Feature", isOptional: true });
  });

  it("still records a List pick once made", () => {
    const { service, id, rules } = wanderer();
    service.setSelection(id, byName(rules(), "Oath").identifier, "2");
    expect(byName(rules(), "Oath")).toMatchObject({ isOptional: true, hasSelection: true, selectedElementNames: ["second oath"] });
  });
});

describe("background picks in the shipped SRD content", () => {
  let library: ElementLibrary;
  beforeAll(async () => {
    library = await shippedLibrary();
  }, 120_000);

  it("2014: the personality lists are optional; the background's languages stay required", () => {
    const { rules } = buildWith(library, "2014", [
      ["Race", "ID_RACE_HUMAN"],
      ["Class", "ID_WOTC_PHB_CLASS_FIGHTER"],
      ["Background", "ID_BACKGROUND_ACOLYTE"],
    ]);
    const all = rules();
    const lists = all.filter((rule) => rule.type === "List");
    expect(lists.length).toBeGreaterThanOrEqual(4);
    for (const list of lists) expect(list).toMatchObject({ isOptional: true, hasSelection: false, hasAvailableOptions: true });
    // Nothing left in the Background section keeps the reminder on.
    expect(openRequiredBackgroundRules(all)).toEqual([]);

    const language = all.find((rule) => rule.type === "Language" && /Acolyte/u.test(rule.name));
    expect(language).toMatchObject({ isOptional: false, hasSelection: false, selectionCount: 2 });
    const classSkills = all.find((rule) => rule.type === "Proficiency" && /Fighter/u.test(rule.name));
    expect(classSkills).toMatchObject({ isOptional: false, hasSelection: false });
  });

  it("2024: the background's ability scores and origin feat choices stay required", () => {
    const { rules } = buildWith(library, "2024", [
      ["Race", "ID_WOTC_PHB24_RACE_HUMAN"],
      ["Class", "ID_WOTC_PHB24_CLASS_FIGHTER"],
      ["Background", "ID_WOTC_PHB24_BACKGROUND_ACOLYTE"],
    ]);
    const all = rules();
    expect(openRequiredBackgroundRules(all)).toEqual([]);

    const abilityScores = all.filter((rule) => rule.allocatesAbilityScores);
    expect(abilityScores.length).toBeGreaterThan(0);
    for (const rule of abilityScores) expect(rule).toMatchObject({ isOptional: false, hasSelection: false });

    // The origin feat's own choices (its spellcasting ability and spells).
    const featChoices = all.filter((rule) => rule.type === "Feat Feature" || rule.type === "Spell");
    expect(featChoices.length).toBeGreaterThan(0);
    for (const rule of featChoices) expect(rule).toMatchObject({ isOptional: false, hasSelection: false });
  });
});
