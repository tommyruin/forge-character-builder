import { describe, expect, it } from "vitest";
import {
  getSelectionRulePresentation,
  hasIncompleteRequiredSelection,
  shouldShowSelectionOptionsLoading,
} from "../selectionRulePresentation";

const rule = (overrides = {}) => ({
  name: "Choice",
  type: "Choice Type",
  requiredLevel: 1,
  isOptional: false,
  selectionCount: 1,
  ...overrides,
});

describe("selection rule presentation", () => {
  it("only treats unfilled required rules as incomplete reminders", () => {
    expect(
      hasIncompleteRequiredSelection([
        rule({ isOptional: true, hasSelection: false }),
      ]),
    ).toBe(false);
    expect(
      hasIncompleteRequiredSelection([
        rule({ isOptional: false, hasSelection: false }),
      ]),
    ).toBe(true);
    expect(
      hasIncompleteRequiredSelection([
        rule({ isOptional: false, hasSelection: false, hasAvailableOptions: false }),
      ]),
    ).toBe(false);
    expect(
      hasIncompleteRequiredSelection([
        rule({ isOptional: false, hasSelection: true }),
      ]),
    ).toBe(false);
  });

  it("does not treat required rules grouped under Other as reminder-worthy", () => {
    const personalityTrait = rule({
      name: "Personality Trait",
      type: "Personality Trait",
      isOptional: false,
      hasSelection: false,
    });

    expect(
      hasIncompleteRequiredSelection([personalityTrait], {
        sectionKey: "other",
      }),
    ).toBe(false);
    expect(
      hasIncompleteRequiredSelection([personalityTrait], {
        sectionKey: "background",
      }),
    ).toBe(true);
  });

  it("clears the Background dot once only optional picks are left", async () => {
    const { BUILD_SECTIONS } = await import("../../api.js");
    const { buildSectionRules } = await import("../buildSectionRules.js");
    const section = (key) => BUILD_SECTIONS.find((s) => s.key === key);
    const dotOn = (key, rules) =>
      hasIncompleteRequiredSelection(buildSectionRules(section(key), rules), {
        sectionKey: key,
      });
    // The shape the engine reports for a 2014 background with personality
    // lists: List picks come through optional, so they hold no reminder.
    const rules = [
      rule({ name: "Background", type: "Background", hasSelection: true }),
      rule({ name: "Variant Feature", type: "Background Feature", isOptional: true, hasSelection: false, hasAvailableOptions: false }),
      rule({ name: "Personality Trait", type: "List", isList: true, isOptional: true, selectionCount: 2, hasSelection: false }),
      rule({ name: "Ideal", type: "List", isList: true, isOptional: true, hasSelection: false }),
      rule({ name: "Language (Background)", type: "Language", isOptional: false, selectionCount: 2, hasSelection: false }),
    ];

    expect(dotOn("background", rules)).toBe(false);
    // The background's language pick still flags its own section.
    expect(dotOn("languages", rules)).toBe(true);
    // A List pick the content marks required keeps the dot.
    expect(
      dotOn("background", [
        ...rules,
        rule({ name: "Calling", type: "List", isList: true, isOptional: false, hasSelection: false }),
      ]),
    ).toBe(true);
  });

  it("keeps an authored language title while removing its grouped type", () => {
    expect(
      getSelectionRulePresentation(
        rule({
          name: "Language (Acolyte)",
          type: "Language",
          selectionCount: 2,
        }),
        { sectionLabel: "Languages", showRuleType: false },
      ),
    ).toMatchObject({
      displayTitle: "Language (Acolyte)",
      metaParts: ["Pick 2"],
    });
  });

  it("does not show a parent-level loading state before a numbered picker opens", () => {
    expect(
      shouldShowSelectionOptionsLoading({ isMulti: true, options: null, error: null }),
    ).toBe(false);
    expect(
      shouldShowSelectionOptionsLoading({ isMulti: false, options: null, error: null }),
    ).toBe(true);
    expect(
      shouldShowSelectionOptionsLoading({ isMulti: true, options: null, error: new Error("failed") }),
    ).toBe(false);
  });

  it("keeps a specific proficiency title without repeating its category", () => {
    expect(
      getSelectionRulePresentation(
        rule({
          name: "Skill Proficiency (Bard)",
          type: "Proficiency",
          selectionCount: 3,
        }),
        { sectionLabel: "Proficiencies", showRuleType: false },
      ).metaParts,
    ).toEqual(["Pick 3"]);
  });

  it("preserves level, optional, and pick metadata in their existing order", () => {
    expect(
      getSelectionRulePresentation(
        rule({
          name: "Feat (Level 4)",
          type: "Feat",
          requiredLevel: 4,
          isOptional: true,
          selectionCount: 2,
        }),
        { sectionLabel: "Feats", showRuleType: false },
      ).metaParts,
    ).toEqual(["Level 4", "Optional", "Pick 2"]);
  });

  it("keeps the technical type when the caller needs it for Other", () => {
    expect(
      getSelectionRulePresentation(
        rule({ name: "Uncategorised choice", type: "Custom Feature" }),
        { sectionLabel: "Other" },
      ).metaParts,
    ).toEqual(["Custom Feature"]);
  });

  it("retains the existing Choose one treatment for exact duplicates", () => {
    expect(
      getSelectionRulePresentation(rule({ name: "Race", type: "Race" }), {
        sectionLabel: "Species",
        showRuleType: false,
      }),
    ).toMatchObject({ displayTitle: "Choose one", metaParts: [] });
  });

  it("marks Choose one as a placeholder and a real rule name as not", () => {
    // "Choose one" stands in for a name the rail already shows. It is an
    // instruction, not a label, so the card can drop it once the choice is
    // made — which callers can only know if the presentation says so.
    expect(
      getSelectionRulePresentation(rule({ name: "Race", type: "Race" }), {
        sectionLabel: "Species",
        showRuleType: false,
      }).isPlaceholderTitle,
    ).toBe(true);
    expect(
      getSelectionRulePresentation(rule({ name: "Fighting Style", type: "Feature" }), {
        sectionLabel: "Class",
      }).isPlaceholderTitle,
    ).toBe(false);
  });

  it("leaves the default Manage and Companion presentation unchanged", () => {
    expect(
      getSelectionRulePresentation(
        rule({ name: "Sacred Oath", type: "Companion Feature" }),
      ).metaParts,
    ).toEqual(["Companion Feature"]);
  });
});
