/**
 * Custom content on a character, end to end: a draft made through the service
 * is stored in the character file, compiled, installed in the library, granted,
 * and then behaves like any book feature in statistics, selections, magic, the
 * Build projection and the sheet.
 */

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { isCharacterPackElement } from "../content/character-packs.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { buildCharacterDetail } from "../selection/detail.js";
import { isContentAllowedForCharacter } from "../content/access.js";
import {
  ID,
  buildCharacter,
  buildFighter3,
  buildWizard4,
  ruleOfName,
  sharedLibrary,
  type BuiltCharacter,
} from "../testing/character-factory.js";
import { readCustomPack } from "./pack.js";
import { createCustomDraft, newCustomBlockId, type CustomBlock, type CustomDraft } from "./schema.js";

// Invented content for the boon to grant and offer; never book text.
const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Ember Spark" type="Spell" source="Test Pack" id="ID_TEST_SPELL_EMBER_SPARK">
    <supports>Wizard</supports>
    <description><p>A mote of fire.</p></description>
    <setters><set name="level">0</set><set name="school">Evocation</set><set name="time">Action</set><set name="range">60 feet</set><set name="duration">Instantaneous</set></setters>
  </element>
  <element name="Tidecant" type="Language" source="Test Pack" id="ID_TEST_LANGUAGE_TIDECANT">
    <supports>Standard</supports>
    <description><p>The speech of the tides.</p></description>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/custom-content-test.xml", PACK]]));
}, 120_000);

const boonBlocks = (): CustomBlock[] => [
  { kind: "modifier", id: newCustomBlockId(), target: "strength", mode: "add", value: { kind: "number", value: 1 } },
  { kind: "modifier", id: newCustomBlockId(), target: "strength:max", mode: "raiseMax", value: { kind: "number", value: 2 } },
  {
    kind: "grant",
    id: newCustomBlockId(),
    target: { by: "id", type: "Spell", id: "ID_TEST_SPELL_EMBER_SPARK" },
    spell: { castAbility: "wisdom", usage: "1/Long Rest" },
  },
  { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Proficiency", id: "ID_PROFICIENCY_SKILL_STEALTH" } },
  { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Language", id: "ID_TEST_LANGUAGE_TIDECANT" } },
  {
    kind: "choice",
    id: newCustomBlockId(),
    type: "Language",
    name: "Borrowed tongue",
    count: 1,
    supports: { kind: "tag", value: "Standard" },
  },
];

function boon(extra: Partial<CustomDraft> = {}): CustomDraft {
  return {
    ...createCustomDraft("boon", "Ember Boon"),
    description: "A warmth that never fades.",
    sheet: { action: "bonusAction", usage: "1/Long Rest" },
    blocks: boonBlocks(),
    ...extra,
  };
}

const sheetLines = (service: CharacterService, id: string): string[] => {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const lines: string[] = [];
  for (const page of model.pages) {
    for (const section of page.sections) {
      for (const row of section.rows) lines.push(...(row.kind === "lines" ? row.lines : row.tokens));
    }
  }
  return lines;
};

let counter = 0;
const fighter = (): BuiltCharacter => buildFighter3(library, `CustomFighter${counter++}`);

afterEach(() => {
  // Characters in these tests are never deleted explicitly; packs are keyed by id and ids are unique per test.
});

describe("a boon made on a character", () => {
  it("is granted, shows under Other as custom, and does everything its blocks say", () => {
    const { service, id } = fighter();
    const before = computeStatistics(service.getCharacter(id), library);
    const saved = service.saveCustomDraft(id, { draft: boon() });

    expect(saved.entry).toMatchObject({ type: "Custom Feature", section: "other", granted: true, installed: true });
    expect(saved.diagnostics).toEqual([]);

    // Build: a top-level grant, marked custom, placed in Other.
    expect(service.getDmGrants(id)).toContainEqual({
      kind: "feature",
      id: saved.entry.elementId,
      name: "Ember Boon",
      source: "Custom",
      type: "Custom Feature",
      isCustom: true,
      origin: "character",
      section: "other",
    });
    const detail = buildCharacterDetail(service.getCharacter(id), library);
    expect(detail.registeredElements.find((entry) => entry.id === saved.entry.elementId)).toMatchObject({
      isCustom: true,
      origin: "character",
    });
    expect(detail.registeredElements.find((entry) => entry.id === "ID_PROFICIENCY_SKILL_STEALTH")?.isCustom).toBe(false);

    // Modifiers: the ability bonus and the raised maximum.
    const after = computeStatistics(service.getCharacter(id), library);
    expect(after["strength:score"]).toBe(before["strength:score"]! + 1);
    expect(after["strength:max"]).toBe(22);

    // Grants: the proficiency counts, the language registers, and the spell
    // shows on the spell pages as a feature caster with its ability and usage.
    expect(after["stealth:proficiency"]).toBe(before["stealth:proficiency"]! + before.proficiency!);
    const registered = service.getCharacter(id).sum.elements.map((entry) => entry.id);
    expect(registered).toContain("ID_TEST_LANGUAGE_TIDECANT");
    const casters = service.getSpellcasting(id);
    const feature = casters.find((caster) => caster.name === "Ember Boon");
    expect(feature).toMatchObject({ kind: "feature", ability: "Wisdom" });
    expect(feature!.knownSpells.map((spell) => spell.id)).toEqual(["ID_TEST_SPELL_EMBER_SPARK"]);

    // The choice is pending and filtered to its list.
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Borrowed tongue");
    expect(rule).toBeDefined();
    const options = selectionOptions(service.getCharacter(id), library, rule!).map((option) => option.id);
    expect(options).toContain("ID_LANGUAGE_ELVISH");
    expect(options).not.toContain("ID_LANGUAGE_ABYSSAL");
    service.setSelection(id, rule!.identifier, "ID_LANGUAGE_ELVISH");
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).toContain("ID_LANGUAGE_ELVISH");

    // The sheet prints it with its action and usage.
    expect(sheetLines(service, id)).toContain("Ember Boon (Bonus Action—1/Long Rest). A warmth that never fades.");
  });

  it("names the granting custom feature as the source of the spells it grants", () => {
    const { service, id } = fighter();
    const saved = service.saveCustomDraft(id, { draft: boon() });
    const feature = service.getSpellcasting(id).find((caster) => caster.name === "Ember Boon");
    expect(feature!.knownSpells[0]).toMatchObject({
      id: "ID_TEST_SPELL_EMBER_SPARK",
      grantedBy: { elementId: saved.entry.elementId, name: "Ember Boon", isCustom: true },
    });
  });

  it("is the same element after a save, a reload and an export", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft });
    const exported = service.exportCharacterXml(id);

    const other = new CharacterService(undefined, library);
    other.importCharacterXml("Reloaded", exported);
    expect(other.getDmGrants("Reloaded").some((grant) => grant.id === draft.id && grant.isCustom)).toBe(true);
    expect(computeStatistics(other.getCharacter("Reloaded"), library)["strength:max"]).toBe(22);
    expect(other.getCustomContent("Reloaded").entries.map((entry) => entry.draft)).toEqual([draft]);
    expect(other.exportCharacterXml("Reloaded")).toBe(exported);
  });

  it("travels in the character package to a device whose library never saw it", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft });
    // A .dnd5e-pkg carries the character's XML; the pack is inside it.
    const packageXml = service.exportCharacterXml(id);

    const base = { ...library, fileContents: new Map(library.fileContents) } as ElementLibrary;
    const freshLibrary = { ...base } as ElementLibrary;
    replaceLibraryFiles(freshLibrary, new Map(library.fileContents));
    expect(isCharacterPackElement(freshLibrary, draft.id)).toBe(false);
    const device = new CharacterService(undefined, freshLibrary);
    device.importCharacterXml("Elsewhere", packageXml);
    expect(isCharacterPackElement(freshLibrary, draft.id)).toBe(true);
    expect(device.getDmGrants("Elsewhere").some((grant) => grant.id === draft.id)).toBe(true);
    expect(computeStatistics(device.getCharacter("Elsewhere"), freshLibrary)["strength:max"]).toBe(22);
  });

  it("leaves a file that never used custom content byte-identical, and a deleted draft too", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    const saved = service.saveCustomDraft(id, { draft: boon(), grant: false });
    expect(service.exportCharacterXml(id)).toContain("<forge-builder");
    service.deleteCustomDraft(id, { draftId: saved.entry.elementId });
    expect(service.exportCharacterXml(id)).toBe(original);
  });

  it("is offered to its own character alone", () => {
    const first = fighter();
    const second = fighter();
    const draft = boon();
    first.service.saveCustomDraft(first.id, { draft });
    expect(isCharacterPackElement(library, draft.id)).toBe(true);
    expect(() => second.service.addGrantedElement(second.id, { elementId: draft.id })).toThrow(/not found/);
  });
});

describe("editing and deleting", () => {
  it("re-registers an edited boon and keeps the picks whose choice did not change", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft });
    const strengthBefore = computeStatistics(service.getCharacter(id), library)["strength:score"]!;
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Borrowed tongue")!;
    service.setSelection(id, rule.identifier, "ID_LANGUAGE_ELVISH");

    const edited: CustomDraft = {
      ...draft,
      name: "Ember Boon, Rekindled",
      blocks: draft.blocks.map((block) =>
        block.kind === "modifier" && block.target === "strength" ? { ...block, value: { kind: "number", value: 2 } as const } : block,
      ),
    };
    service.saveCustomDraft(id, { draft: edited });

    // The new definition is the one in force: +2 where it was +1.
    expect(computeStatistics(service.getCharacter(id), library)["strength:score"]).toBe(strengthBefore + 1);
    expect(service.getDmGrants(id).find((grant) => grant.id === draft.id)?.name).toBe("Ember Boon, Rekindled");
    expect(pendingSelectionRules(service.getCharacter(id)).some((candidate) => candidate.name === "Borrowed tongue")).toBe(false);
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).toContain("ID_LANGUAGE_ELVISH");
    expect(service.getCustomContent(id).entries).toHaveLength(1);
  });

  it("deleting removes the grant, the stored copy and the installed element", () => {
    const { service, id } = fighter();
    const draft = boon();
    const before = computeStatistics(service.getCharacter(id), library);
    service.saveCustomDraft(id, { draft });
    service.deleteCustomDraft(id, { draftId: draft.id });
    expect(service.getDmGrants(id).some((grant) => grant.id === draft.id)).toBe(false);
    expect(service.getCustomContent(id).entries).toEqual([]);
    expect(isCharacterPackElement(library, draft.id)).toBe(false);
    expect(library.byId.has(draft.id)).toBe(false);
    expect(computeStatistics(service.getCharacter(id), library)["strength:score"]).toBe(before["strength:score"]);
  });

  it("deleting the character removes its pack from the library", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft });
    service.deleteCharacter(id);
    expect(library.byId.has(draft.id)).toBe(false);
  });

  it("refuses an invalid draft naming the field, and changes nothing", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    expect(() => service.saveCustomDraft(id, { draft: { ...boon(), name: "" } })).toThrow(
      expect.objectContaining({ code: "invalid-argument", message: expect.stringContaining("name") }),
    );
    expect(service.exportCharacterXml(id)).toBe(original);
  });
});

describe("level-gated parts", () => {
  it("register a gated grant once the character reaches the level", () => {
    const { service, id } = fighter();
    const draft = createCustomDraft("boon", "Late Bloom");
    draft.blocks = [
      { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Language", id: "ID_TEST_LANGUAGE_TIDECANT" }, level: 5 },
    ];
    service.saveCustomDraft(id, { draft });
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).not.toContain("ID_TEST_LANGUAGE_TIDECANT");
    service.levelUp(id);
    service.levelUp(id);
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).toContain("ID_TEST_LANGUAGE_TIDECANT");
  });
});

describe("the pack block", () => {
  it("holds the drafts as JSON in one builder block", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft, grant: false });
    const read = readCustomPack(service.documentOf(id));
    expect(read.drafts).toEqual([draft]);
    expect(read.problems).toEqual([]);
    expect(service.exportCharacterXml(id).match(/<forge-builder\b/g)).toHaveLength(1);
  });

  it("carries an entry this version cannot read through an edit untouched", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: boon(), grant: false });
    const xml = service.exportCharacterXml(id);
    const future = { id: "ID_CUSTOM_FUTURE", schemaVersion: 9, name: "From a newer builder" };
    const patched = xml.replace(/(<custom-pack[^>]*><!\[CDATA\[)\[/, `$1[${JSON.stringify(future)},`);
    expect(patched).not.toBe(xml);
    const other = new CharacterService(undefined, library);
    other.importCharacterXml("Mixed", patched);
    expect(other.getCustomContent("Mixed").problems).toHaveLength(1);
    other.saveCustomDraft("Mixed", { draft: { ...boon(), name: "Another" }, grant: false });
    expect(other.exportCharacterXml("Mixed")).toContain("From a newer builder");
  });

  it("refuses to overwrite a block it cannot read at all", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: boon(), grant: false });
    const broken = service.exportCharacterXml(id).replace(/(<custom-pack[^>]*>)<!\[CDATA\[.*?\]\]>/s, "$1<![CDATA[not json]]>");
    const other = new CharacterService(undefined, library);
    other.importCharacterXml("Broken", broken);
    expect(other.getCustomContent("Broken").problems).toEqual([expect.objectContaining({ index: -1 })]);
    expect(() => other.saveCustomDraft("Broken", { draft: boon(), grant: false })).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(other.exportCharacterXml("Broken")).toBe(broken);
  });

  it("grants an existing draft that was saved ungranted when asked to", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft, grant: false });
    expect(service.getCustomContent(id).entries[0]!.granted).toBe(false);
    service.saveCustomDraft(id, { draft, grant: true });
    expect(service.getCustomContent(id).entries[0]!.granted).toBe(true);
  });

  it("works on any class: a wizard takes the same boon", () => {
    const { service, id } = buildWizard4(library, "CustomWizard");
    const draft = boon();
    service.saveCustomDraft(id, { draft });
    expect(service.getDmGrants(id).some((grant) => grant.id === draft.id)).toBe(true);
  });
});

describe("a custom feat", () => {
  /** A fighter at the level-4 improvement with feats allowed, up to its Feat pick. */
  function atFeatPick() {
    const built = buildCharacter(library, { id: `CustomFeatFighter${counter++}`, classId: ID.CLASS_FIGHTER, levels: 4 });
    built.service.setCharacterOption(built.id, { optionId: ID.OPTION_FEATS, enabled: true });
    const improvement = pendingSelectionRules(built.service.getCharacter(built.id)).find((rule) => /^Improvement Option/.test(rule.name ?? ""))!;
    built.service.setSelection(built.id, improvement.identifier, "ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER");
    return built;
  }
  const featPickOptions = (built: BuiltCharacter): string[] => {
    const rule = ruleOfName(pendingSelectionRules(built.service.getCharacter(built.id)), "Feat (FIGHTER 4)");
    return selectionOptions(built.service.getCharacter(built.id), library, rule).map((option) => option.id);
  };

  it("is offered by the feat picker to its owner only when its requirements pass", () => {
    const owner = atFeatPick();
    const stranger = atFeatPick();
    const open = createCustomDraft("feat", "Open Hand");
    const closed = createCustomDraft("feat", "Iron Grip");
    closed.requirements = { kind: "ability", ability: "strength", min: 30 };
    owner.service.saveCustomDraft(owner.id, { draft: open, grant: false });
    owner.service.saveCustomDraft(owner.id, { draft: closed, grant: false });

    expect(featPickOptions(owner)).toContain(open.id);
    expect(featPickOptions(owner)).not.toContain(closed.id);
    expect(featPickOptions(stranger)).not.toContain(open.id);

    const rule = ruleOfName(pendingSelectionRules(owner.service.getCharacter(owner.id)), "Feat (FIGHTER 4)");
    owner.service.setSelection(owner.id, rule.identifier, open.id);
    const registered = buildCharacterDetail(owner.service.getCharacter(owner.id), library).registeredElements;
    expect(registered.find((entry) => entry.id === open.id)).toMatchObject({ type: "Feat", isCustom: true, origin: "character" });
    // A feat picked through a rule is not a DM grant.
    expect(owner.service.getDmGrants(owner.id).some((grant) => grant.id === open.id)).toBe(false);
  });

  it("is hidden from a character whose ruleset it is not written for", () => {
    const { service, id } = fighter();
    const draft = createCustomDraft("feat", "Modern Knack");
    draft.ruleset = "2024";
    service.saveCustomDraft(id, { draft, grant: false });
    const element = library.byId.get(draft.id)!;
    expect(library.ruleset.get(draft.id)).toBe("2024");
    service.setRulesetMode(id, "2014");
    expect(isContentAllowedForCharacter(service.getCharacter(id), library, element)).toBe(false);
    service.setRulesetMode(id, "2024");
    expect(isContentAllowedForCharacter(service.getCharacter(id), library, element)).toBe(true);
  });
});

describe("two characters carrying the same entry", () => {
  it("share one definition, and the entry stays while either one has it", () => {
    const built = fighter();
    const draft = boon();
    built.service.saveCustomDraft(built.id, { draft });
    const service = new CharacterService(undefined, library);
    service.importCharacterXml("First", built.service.exportCharacterXml(built.id));
    service.importCharacterXml("Second", built.service.exportCharacterXml(built.id));
    service.deleteCharacter("First");
    expect(library.byId.has(draft.id)).toBe(true);
    expect(service.getDmGrants("Second").some((grant) => grant.id === draft.id)).toBe(true);
    service.deleteCharacter("Second");
    built.service.deleteCharacter(built.id);
    expect(library.byId.has(draft.id)).toBe(false);
  });
});

describe("sheet presentation", () => {
  it("prints the title, action and usage, and the level text in force", () => {
    const { service, id } = fighter();
    const draft = createCustomDraft("boon", "Ember Boon");
    draft.description = "Base text.";
    draft.sheet = {
      title: "Ember Ward",
      action: "reaction",
      usage: "{{proficiency}}/Long Rest",
      tiers: [{ level: 2, text: "Tier two." }, { level: 5, text: "Tier five." }],
    };
    service.saveCustomDraft(id, { draft });
    expect(sheetLines(service, id)).toContain("Ember Ward (Reaction—2/Long Rest). Tier two.");
    service.levelUp(id);
    service.levelUp(id);
    expect(sheetLines(service, id)).toContain("Ember Ward (Reaction—3/Long Rest). Tier five.");
  });

  it("leaves the feature off the sheet when it is hidden", () => {
    const { service, id } = fighter();
    const draft = createCustomDraft("boon", "Quiet Boon");
    draft.description = "Secret.";
    draft.sheet = { show: false };
    service.saveCustomDraft(id, { draft });
    expect(sheetLines(service, id).join("\n")).not.toContain("Quiet Boon");
  });

  it("prints a feature under each place it can show, and files it in that Build section", () => {
    const { service, id } = fighter();
    const sections: Array<[CustomDraft["showsUnder"], string, string]> = [
      ["race", "Racial Trait", "race"],
      ["class", "Class Feature", "class"],
      ["feats", "Feat", "feats"],
      ["other", "Custom Feature", "other"],
    ];
    for (const [showsUnder, type, section] of sections) {
      const draft = createCustomDraft("feature", `Shown under ${showsUnder}`);
      draft.showsUnder = showsUnder;
      draft.description = `Text for ${showsUnder}.`;
      service.saveCustomDraft(id, { draft });
      expect(service.getDmGrants(id).find((grant) => grant.id === draft.id)).toMatchObject({ type, section, isCustom: true });
      expect(sheetLines(service, id)).toContain(`Shown under ${showsUnder}. Text for ${showsUnder}.`);
    }
  });
});

describe("a character with custom content", () => {
  it("keeps the boon and its pick through leveling down and a ruleset switch", () => {
    const { service, id } = fighter();
    const draft = boon();
    service.saveCustomDraft(id, { draft });
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Borrowed tongue")!;
    service.setSelection(id, rule.identifier, "ID_LANGUAGE_ELVISH");

    service.delevel(id, { mode: "last" });
    expect(service.getDmGrants(id).some((grant) => grant.id === draft.id)).toBe(true);
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).toContain("ID_LANGUAGE_ELVISH");

    service.setRulesetMode(id, "2014");
    expect(service.getDmGrants(id).some((grant) => grant.id === draft.id)).toBe(true);
    expect(service.getCustomContent(id).entries).toHaveLength(1);
  });
});

describe("grant and choice variations", () => {
  it("grants by type and name, and holds a grant back until its requirements are met", () => {
    const { service, id } = fighter();
    const stealth = library.byId.get("ID_PROFICIENCY_SKILL_STEALTH")!.identity.name;
    const draft = createCustomDraft("boon", "Quiet Steps");
    draft.blocks = [
      { kind: "grant", id: "byname", target: { by: "name", type: "Proficiency", name: stealth } },
      {
        kind: "grant",
        id: "gated",
        target: { by: "id", type: "Language", id: "ID_TEST_LANGUAGE_TIDECANT" },
        requirements: { kind: "ability", ability: "strength", min: 30 },
      },
    ];
    service.saveCustomDraft(id, { draft });
    const registered = service.getCharacter(id).sum.elements.map((entry) => entry.id);
    expect(registered).toContain("ID_PROFICIENCY_SKILL_STEALTH");
    expect(registered).not.toContain("ID_TEST_LANGUAGE_TIDECANT");
  });

  it("offers an inline list, remembers the pick by its text, and takes it as optional", () => {
    const { service, id } = fighter();
    const draft = createCustomDraft("boon", "Omens");
    draft.blocks = [{ kind: "choice", id: "omen", type: "List", name: "Omen", count: 1, items: ["Crow", "Hare"], optional: true }];
    service.saveCustomDraft(id, { draft });
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Omen")!;
    expect(selectionOptions(service.getCharacter(id), library, rule).map((option) => option.name)).toEqual(["Crow", "Hare"]);
    service.setSelection(id, rule.identifier, "2");
    const detail = buildCharacterDetail(service.getCharacter(id), library);
    expect(detail.selectionRules.find((candidate) => candidate.name === "Omen")).toMatchObject({
      isList: true,
      isOptional: true,
      selectedElementNames: ["Hare"],
    });
  });

  it("offers a spell choice from a filter tree, cast with the ability the feature names", () => {
    const { service, id } = buildWizard4(library, `CustomSpellPick${counter++}`);
    const draft = createCustomDraft("boon", "Ember Study");
    draft.blocks = [
      {
        kind: "choice",
        id: "spell",
        type: "Spell",
        name: "Ember spell",
        count: 1,
        supports: { kind: "group", op: "all", items: [{ kind: "level", value: 0 }, { kind: "school", value: "Evocation" }, { kind: "tag", value: "Wizard" }] },
        castAbility: "charisma",
      },
    ];
    service.saveCustomDraft(id, { draft });
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Ember spell")!;
    const options = selectionOptions(service.getCharacter(id), library, rule);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      const spell = library.byId.get(option.id)!;
      expect(spell.setters.find((setter) => setter.name === "level")?.value).toBe("0");
      expect(spell.setters.find((setter) => setter.name === "school")?.value).toBe("Evocation");
    }
    service.setSelection(id, rule.identifier, options[0]!.id);
    const caster = service.getSpellcasting(id).find((entry) => entry.name === "Ember Study");
    expect(caster).toMatchObject({ kind: "feature", ability: "Charisma" });
    expect(caster!.knownSpells.map((spell) => spell.id)).toEqual([options[0]!.id]);
  });
});
