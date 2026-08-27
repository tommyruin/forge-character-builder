/**
 * Optional class feature (OCF) offering gaps:
 *
 *  - Gap 1: the OCF offering list ignored the character's ruleset mode
 *    (state.rulesetMode), unlike every other eligibility surface in the
 *    engine (see selection.ts isEligible).
 *  - Gap 2: an OCF enabled on the character (its Item element registered)
 *    whose grant requirements later stop holding (e.g. the granting class
 *    level is delevelled away) silently vanished from the optional-rules
 *    DTO while its granted effects kept applying, leaving the user unable
 *    to see or disable it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "./service.js";
import { pendingSelectionRules } from "../selection/selection.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_BARBARIAN = "ID_WOTC_PHB_CLASS_BARBARIAN";
const ID_OCF_PRIMAL_KNOWLEDGE = "ID_WOTC_TCOE_ITEM_OCF_BARBARIAN_PRIMAL_KNOWLEDGE";
const ID_FEATURE_PRIMAL_KNOWLEDGE = "ID_WOTC_TCOE_CLASS_FEATURE_BARBARIAN_PRIMAL_KNOWLEDGE";

/**
 * Test-only OCF item pinned into the 2024 ruleset directly through
 * `library.ruleset` (the per-element classification map documented on
 * `ElementLibrary`), rather than through source-string heuristics: the
 * corpus's own Optional Class Features (Tasha's Cauldron of Everything) all
 * classify as "shared", so a marker element is needed to exercise the mode
 * filter at all, and pinning the map entry keeps the test independent of
 * exactly which sources those heuristics treat as 2014/2024-exclusive.
 */
const ID_TEST_OCF_2024 = "ID_TEST_ITEM_OCF_2024_MARKER";
const ID_TEST_FEATURE_2024 = "ID_TEST_CLASS_FEATURE_2024_MARKER";
const SCRATCH_FILE = `<?xml version="1.0" encoding="utf-8" ?>
<elements>
	<element name="2024 Marker Feature" type="Class Feature" source="Test Fixture" id="${ID_TEST_FEATURE_2024}">
		<description><p>Test-only class feature used to exercise OCF ruleset filtering.</p></description>
	</element>
	<element name="Barbarian, LV01: 2024 Marker Feature" type="Item" source="Test Fixture" id="${ID_TEST_OCF_2024}">
		<description><p>Test-only optional class feature item.</p></description>
		<setters>
			<set name="category">Optional Class Features</set>
			<set name="inventory-hidden">true</set>
		</setters>
		<rules>
			<grant type="Class Feature" id="${ID_TEST_FEATURE_2024}" />
		</rules>
	</element>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
  const files = new Map(library.fileContents);
  files.set("testdata/scratch/ocf-ruleset-marker.xml", SCRATCH_FILE);
  replaceLibraryFiles(library, files);
  library.ruleset.set(ID_TEST_OCF_2024, "2024");
}, 120_000);

/**
 * Selecting a class already fills its level-1 wrapper, so `extraLevelUps`
 * additional levelUp() calls land the character at level `1 + extraLevelUps`.
 */
function build(extraLevelUps: number): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter("OCF");
  service.setAbilities("OCF", {
    strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14,
  });
  const state = service.getCharacter("OCF");
  const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
  service.setSelection("OCF", classRule.identifier, ID_BARBARIAN);
  for (let i = 0; i < extraLevelUps; i++) service.levelUp("OCF");
  return service;
}

describe("optional class feature ruleset filtering (gap 1)", () => {
  it("excludes a 2024-tagged OCF from the offering when ruleset mode is 2014", () => {
    const service = build(0);
    service.setRulesetMode("OCF", "2014");
    const rules = service.getOptionalRules("OCF");
    expect(rules.some((r) => r.elementId === ID_TEST_OCF_2024)).toBe(false);
  });

  it("includes a 2024-tagged OCF in the offering when ruleset mode is 2024", () => {
    const service = build(0);
    service.setRulesetMode("OCF", "2024");
    const rules = service.getOptionalRules("OCF");
    expect(rules.some((r) => r.elementId === ID_TEST_OCF_2024)).toBe(true);
  });

  it("includes the OCF regardless of tag when ruleset mode is 'all'", () => {
    const service = build(0);
    const rules = service.getOptionalRules("OCF");
    expect(rules.some((r) => r.elementId === ID_TEST_OCF_2024)).toBe(true);
  });
});

describe("optional class feature ineligible-but-enabled visibility (gap 2)", () => {
  it("keeps an enabled OCF visible with a disable reason once its requirements no longer hold, and lets it be disabled", () => {
    const service = build(2); // Barbarian level 3

    const eligibleRules = service.getOptionalRules("OCF");
    const beforeDisable = eligibleRules.find((r) => r.elementId === ID_OCF_PRIMAL_KNOWLEDGE);
    expect(beforeDisable?.eligible).toBe(true);

    service.setCharacterControl("OCF", { key: `item:${ID_OCF_PRIMAL_KNOWLEDGE}`, enabled: true });

    service.delevel("OCF", { mode: "last" });

    const afterDelevel = service.getOptionalRules("OCF");
    const stillListed = afterDelevel.find((r) => r.elementId === ID_OCF_PRIMAL_KNOWLEDGE);
    expect(stillListed).toBeDefined();
    expect(stillListed?.enabled).toBe(true);
    expect(stillListed?.eligible).toBe(false);
    expect(stillListed?.unavailableReason).toBe("No longer applies to this character. Disable it to remove its effects.");

    const state = service.getCharacter("OCF");
    expect(state.sum.elements.some((e) => e.id === ID_FEATURE_PRIMAL_KNOWLEDGE)).toBe(true);

    service.setCharacterControl("OCF", { key: `item:${ID_OCF_PRIMAL_KNOWLEDGE}`, enabled: false });

    const afterDisable = service.getOptionalRules("OCF");
    expect(afterDisable.some((r) => r.elementId === ID_OCF_PRIMAL_KNOWLEDGE)).toBe(false);
    const finalState = service.getCharacter("OCF");
    expect(finalState.sum.elements.some((e) => e.id === ID_OCF_PRIMAL_KNOWLEDGE)).toBe(false);
    expect(finalState.sum.elements.some((e) => e.id === ID_FEATURE_PRIMAL_KNOWLEDGE)).toBe(false);
  });
});

/**
 * Gap 3: an OCF carried as an equipment record — the shape imported documents use, and
 * the shape `addItem` produces — conveys its benefits (the statistics
 * calculator applies an active item's grants, and the sheet renders the
 * feature it grants), but the optional-rules DTO read `enabled` only from the
 * sum. So the control reported OFF for a feature that was demonstrably ON, and
 * switching it off left the equipment record behind, still applying.
 */
describe("optional class features carried as equipment records (gap 3)", () => {
  const ID_OCF_INSTINCTIVE_POUNCE = "ID_WOTC_TCOE_ITEM_OCF_BARBARIAN_INSTINCTIVE_POUNCE";

  /** A barbarian 7 carrying the optional class feature as an inventory record. */
  function carrying(): CharacterService {
    const service = build(6); // Barbarian level 7
    service.addItem("OCF", { itemId: ID_OCF_INSTINCTIVE_POUNCE, amount: 1, baseElementId: null });
    return service;
  }

  it("reports the OCF as enabled", () => {
    const rule = carrying().getOptionalRules("OCF").find((r) => r.elementId === ID_OCF_INSTINCTIVE_POUNCE);
    expect(rule?.enabled).toBe(true);
  });

  it("removes the equipment record when the control is switched off", () => {
    const service = carrying();
    service.setCharacterControl("OCF", { key: `item:${ID_OCF_INSTINCTIVE_POUNCE}`, enabled: false });

    const state = service.getCharacter("OCF");
    expect(state.items.some((item) => item.itemId === ID_OCF_INSTINCTIVE_POUNCE)).toBe(false);
    const rule = service.getOptionalRules("OCF").find((r) => r.elementId === ID_OCF_INSTINCTIVE_POUNCE);
    expect(rule?.enabled ?? false).toBe(false);
  });
});
