/**
 * The options a character is built from, made in a pack: a class, a subclass, a
 * species, a subspecies, a background and a companion. Each compiles to the
 * shapes the bundled rules use, and a character built from them levels up,
 * picks and casts through the engine's ordinary paths.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { checkContentFile } from "../content/pack-check.js";
import { parseAppendsFile, parseElementsFile, type ParsedElement } from "../content/parser.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { computeStatistics } from "../statistics/calculator.js";
import { ID, STANDARD_ARRAY, buildCharacter, sharedLibrary } from "../testing/character-factory.js";
import { compileCustomElement, compileCustomPack } from "./compile.js";
import { compiledElementIds } from "./compile-build.js";
import { packElementFor, packElementType } from "./promote.js";
import {
  createCustomBackgroundDraft,
  createCustomClassDraft,
  createCustomCompanionDraft,
  createCustomDraft,
  createCustomSpeciesDraft,
  createCustomSubclassDraft,
  createCustomSubspeciesDraft,
  createProgressionFeature,
  newCustomBlockId,
  type ChoiceBlock,
  type CustomBlock,
  type CustomClassDraft,
  type CustomPackDraft,
  type CustomSpellcasting,
  type GrantBlock,
} from "./schema.js";
import { slotTotals } from "./spellcasting.js";
import { customPackDraftIssues, readCustomPackDraft } from "./validate.js";

// ---- small builders for invented content --------------------------------------------

const grant = (type: string, id: string): GrantBlock => ({ kind: "grant", id: newCustomBlockId(), target: { by: "id", type, id } });

const idChoice = (type: string, name: string, count: number, ids: string[]): ChoiceBlock => ({
  kind: "choice",
  id: newCustomBlockId(),
  type,
  name,
  count,
  supports: { kind: "group", op: "any", items: ids.map((value) => ({ kind: "id", value })) },
});

function feature(owner: "class" | "subclass" | "species" | "background", level: number, name: string, text: string, extra: Partial<ReturnType<typeof createCustomDraft>> = {}) {
  const entry = createProgressionFeature(owner, level, name);
  return { ...entry, draft: { ...entry.draft, description: text, ...extra } };
}

const compiled = (draft: CustomPackDraft, source = "Test Pack"): ParsedElement[] =>
  parseElementsFile(`<elements>${compileCustomElement(draft, { source })}</elements>`, "test.xml");

const casterOf = (overrides: Partial<CustomSpellcasting> = {}): CustomSpellcasting => ({
  ability: "wisdom",
  style: "prepared",
  slots: { progression: "full" },
  prepare: { ability: true, level: "full" },
  cantrips: [{ level: 1, known: 2 }, { level: 4, known: 3 }],
  ...overrides,
});

const MOON_DIE = { id: "moondie", name: "Moon die", kind: "dice" as const, steps: [{ level: 1, value: "d6" }, { level: 3, value: "d8" }, { level: 5, value: "d10" }] };

/** A homebrew class: hit die, features by level, a value column, subclass at 3, ASI at 4, "choose 2 skills". */
function moonwalker(extra: Partial<CustomClassDraft> = {}): CustomClassDraft {
  return {
    ...createCustomClassDraft("Moonwalker"),
    hitDie: 10,
    short: "A wanderer who borrows the moon's light.",
    description: "Moonwalkers cross the night as others cross a field.",
    scales: [MOON_DIE],
    features: [
      feature("class", 1, "Lunar Step", "You step through moonlight.", { sheet: { text: "Your moon die is {{scale:moon die}}." } }),
      feature("class", 2, "Silver Tongue", "Your words carry.", {
        blocks: [{ kind: "modifier", id: newCustomBlockId(), target: "persuasion:misc", mode: "add", value: { kind: "number", value: 2 } }],
      }),
      feature("class", 5, "Moon Surge", "A flood of silver light."),
    ],
    subclass: { level: 3, label: "Moon Path" },
    asiLevels: [4],
    starting: [
      grant("Proficiency", "ID_PROFICIENCY_SAVINGTHROW_WISDOM"),
      idChoice("Proficiency", "Skill Proficiency (Moonwalker)", 2, [
        "ID_PROFICIENCY_SKILL_ARCANA",
        "ID_PROFICIENCY_SKILL_NATURE",
        "ID_PROFICIENCY_SKILL_STEALTH",
      ]),
    ],
    ...extra,
  };
}

let baseFiles: ReadonlyMap<string, string>;
beforeAll(async () => {
  baseFiles = (await sharedLibrary()).fileContents ?? new Map<string, string>();
}, 120_000);

function libraryWith(drafts: CustomPackDraft[], extraFiles: Array<[string, string]> = []): ElementLibrary {
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, new Map([...baseFiles, ["imports/build-options.xml", compileCustomPack(drafts, { source: "Test Pack" })], ...extraFiles]));
  return library;
}

const packFindings = (library: ElementLibrary) => (library.diagnostics ?? []).filter((entry) => entry.file === "imports/build-options.xml");

// ---- compile shapes -------------------------------------------------------------------------

describe("a class compiles to the shape the bundled classes use", () => {
  const draft = moonwalker({
    spellcasting: casterOf(),
    multiclass: {
      requirements: { kind: "ability", ability: "wisdom", min: 13 },
      summary: "Light armor and one skill of your choice",
      blocks: [grant("Proficiency", "ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR")],
    },
  });
  const [primary, ...rest] = compiled(draft);

  it("is a Class with a hit die, a short line and a grant per feature at its level", () => {
    expect(primary!.identity).toMatchObject({ id: draft.id, name: "Moonwalker", type: "Class", source: "Test Pack" });
    expect(primary!.setters.find((entry) => entry.name === "hd")?.value).toBe("d10");
    expect(primary!.setters.find((entry) => entry.name === "short")?.value).toBe("A wanderer who borrows the moon's light.");
    const grants = primary!.rules.filter((rule) => rule.kind === "grant" && rule.type === "Class Feature");
    expect(grants.map((rule) => [rule.kind === "grant" ? rule.id : "", rule.kind === "grant" ? rule.level : 0])).toEqual([
      [draft.features[0]!.draft.id, 1],
      [`${draft.id}_SPELLCASTING`, 1],
      [draft.features[1]!.draft.id, 2],
      [`${draft.id}_SUBCLASS`, 3],
      [`${draft.id}_ASI`, 4],
      [draft.features[2]!.draft.id, 5],
    ]);
    expect(compiledElementIds(compileCustomElement(draft, { source: "Test Pack" }))[0]).toBe(draft.id);
    expect(rest.map((entry) => entry.identity.type)).toContain("Class Feature");
  });

  it("keeps the first class' proficiencies and skill choice off a multiclass entry", () => {
    const multiId = `${draft.id}_MULTICLASS`;
    expect(primary!.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_PROFICIENCY_SAVINGTHROW_WISDOM", requirements: `!${multiId}` }));
    expect(primary!.rules).toContainEqual(
      expect.objectContaining({ kind: "select", name: "Skill Proficiency (Moonwalker)", number: 2, requirements: `!${multiId}` }),
    );
    expect(primary!.multiclass).toMatchObject({ id: multiId, prerequisite: "Wisdom 13 or higher" });
    expect(primary!.multiclass!.requirements).toBe("([wis:13])||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER");
    expect(primary!.multiclass!.setters.find((entry) => entry.name === "multiclass proficiencies")?.value).toBe("Light armor and one skill of your choice");
    expect(primary!.multiclass!.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_INTERNAL_GRANT_MULTICLASS" }));
    expect(primary!.multiclass!.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR" }));
  });

  it("offers ability score improvements through the engine's improvement option, and the subclass as an Archetype pick", () => {
    const asi = rest.find((entry) => entry.identity.id === `${draft.id}_ASI`)!;
    expect(asi.rules).toEqual([
      expect.objectContaining({ kind: "select", type: "Class Feature", name: "Improvement Option (Moonwalker 4)", supports: "Improvement Option,Moonwalker,4", level: 4 }),
    ]);
    const pick = rest.find((entry) => entry.identity.id === `${draft.id}_SUBCLASS`)!;
    expect(pick.rules).toEqual([expect.objectContaining({ kind: "select", type: "Archetype", name: "Moon Path", supports: "Moon Path" })]);
  });

  it("writes the value column as level-gated inline statistics, before anything reads it", () => {
    const stats = primary!.rules.filter((rule) => rule.kind === "stat");
    expect(stats.slice(0, 3).map((rule) => (rule.kind === "stat" ? [rule.name, rule.value, rule.level, rule.inline] : []))).toEqual([
      ["scale:moon die", "d6", 1, true],
      ["scale:moon die", "d8", 3, true],
      ["scale:moon die", "d10", 5, true],
    ]);
  });
});

describe("a caster's rules follow the bundled progressions", () => {
  const levelRules = (rules: ParsedElement["rules"], name: string): Map<number, number> => {
    const out = new Map<number, number>();
    for (const rule of rules) {
      if (rule.kind === "stat" && rule.name === name) out.set(rule.level ?? 1, (out.get(rule.level ?? 1) ?? 0) + Number(rule.value));
    }
    return out;
  };

  /** The slot total of one slot level at one class level, from a feature's level-gated statistics. */
  const total = (rules: ParsedElement["rules"], caster: string, slotLevel: number, classLevel: number): number => {
    let sum = 0;
    for (const [level, delta] of levelRules(rules, `${caster}:spellcasting:slots:${slotLevel}`)) if (level <= classLevel) sum += delta;
    return sum;
  };

  let corpus: ElementLibrary;
  beforeAll(async () => {
    corpus = await sharedLibrary();
  }, 120_000);

  it.each([
    ["full", "ID_WOTC_PHB_CLASS_FEATURE_WIZARD_SPELLCASTING_WIZARD", "wizard"],
    ["half", "ID_WOTC_PHB_CLASS_FEATURE_PALADIN_SPELLCASTING", "paladin"],
    ["third", "ID_WOTC_PHB_ARCHETYPE_FEATURE_ELDRITCH_KNIGHT_SPELLCASTING", "eldritch knight"],
  ] as const)("gives a %s caster the slots the book %s table gives, at every level", (progression, bookId, caster) => {
    const book = corpus.byId.get(bookId)!;
    const draft = moonwalker({ name: "Slotter", spellcasting: casterOf({ casterName: caster, slots: { progression } }) });
    const feature = compiled(draft).find((entry) => entry.identity.id === `${draft.id}_SPELLCASTING`)!;
    for (let level = 1; level <= 20; level++) {
      for (let slotLevel = 1; slotLevel <= 9; slotLevel++) {
        expect(total(feature.rules, caster, slotLevel, level), `${progression} slot ${slotLevel} at ${level}`).toBe(total(book.rules, caster, slotLevel, level));
      }
    }
  });

  it("gives a pact caster the warlock's count and slot level", () => {
    const book = corpus.byId.get("ID_WOTC_PHB_CLASS_FEATURE_WARLOCK_SPELLCASTING_WARLOCK_PACT_MAGIC")!;
    const draft = moonwalker({ name: "Pacter", spellcasting: casterOf({ casterName: "warlock", style: "known", prepare: undefined, slots: { progression: "pact" } }) });
    const feature = compiled(draft).find((entry) => entry.identity.id === `${draft.id}_SPELLCASTING`)!;
    for (let level = 1; level <= 20; level++) {
      for (let slotLevel = 1; slotLevel <= 5; slotLevel++) {
        // The book's slot rules refer to the count statistic; a reference resolves at the count's final value, as the engine does.
        const resolve = (rules: ParsedElement["rules"]): number => {
          const countAt = (at: number): number => [...levelRules(rules, "warlock:spellcasting:slots:count")].filter(([l]) => l <= at).reduce((sum, [, v]) => sum + v, 0);
          let sum = 0;
          for (const rule of rules) {
            if (rule.kind !== "stat" || rule.name !== `warlock:spellcasting:slots:${slotLevel}` || (rule.level ?? 1) > level) continue;
            const value = rule.value ?? "0";
            sum += value === "warlock:spellcasting:slots:count" ? countAt(20) : value === "-warlock:spellcasting:slots:count" ? -countAt(20) : Number(value);
          }
          return sum;
        };
        expect(resolve(feature.rules), `pact slot ${slotLevel} at ${level}`).toBe(resolve(book.rules));
      }
    }
  });

  it("takes a custom table as written, with the totals of each level", () => {
    const table = Array.from({ length: 20 }, (_, level) => [Math.min(4, level + 1), level >= 4 ? 1 : 0, 0, 0, 0, 0, 0, 0, 0]);
    const totals = slotTotals({ slots: { progression: "custom", table } })!;
    expect(totals[5]).toEqual(table[5]);
    const draft = moonwalker({ spellcasting: casterOf({ slots: { progression: "custom", table } }) });
    const feature = compiled(draft).find((entry) => entry.identity.id === `${draft.id}_SPELLCASTING`)!;
    expect(total(feature.rules, "moonwalker", 1, 8)).toBe(4);
    expect(total(feature.rules, "moonwalker", 2, 4)).toBe(0);
    expect(total(feature.rules, "moonwalker", 2, 5)).toBe(1);
  });

  it("writes the spellcasting block, the multiclass marker and the cantrip and spell picks", () => {
    const draft = moonwalker({
      spellcasting: casterOf({
        style: "spellbook",
        ritual: true,
        listFilter: { kind: "group", op: "any", items: [{ kind: "school", value: "Evocation" }, { kind: "school", value: "Abjuration" }] },
        spells: [{ level: 1, known: 2 }, { level: 2, known: 4 }],
      }),
    });
    const feature = compiled(draft).find((entry) => entry.identity.id === `${draft.id}_SPELLCASTING`)!;
    expect(feature.spellcasting).toMatchObject({ name: "Moonwalker", ability: "Wisdom", prepare: true, list: "Moonwalker,(Evocation||Abjuration)" });
    expect(feature.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL", requirements: "ID_INTERNAL_GRANT_MULTICLASS" }));
    expect(feature.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_INTERNAL_RITUAL_CASTING" }));
    const picks = feature.rules.filter((rule) => rule.kind === "select").map((rule) => (rule.kind === "select" ? [rule.name, rule.level, rule.number ?? 1] : []));
    expect(picks).toEqual([
      ["Cantrip (Moonwalker)", 1, 2],
      ["Cantrip (Moonwalker)", 4, 1],
      ["Spellbook (Moonwalker)", 1, 2],
      ["Spellbook (Moonwalker)", 2, 2],
    ]);
    expect(feature.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "moonwalker:spellcasting:prepare", value: "wisdom:modifier" }));
    expect(feature.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "moonwalker:spellcasting:prepare", value: "level:moonwalker" }));
  });

  it("marks a half caster for multiclass slots and a known caster as one that does not prepare", () => {
    const draft = moonwalker({ spellcasting: casterOf({ style: "known", allowReplace: true, prepare: undefined, slots: { progression: "half" }, spells: [{ level: 2, known: 2 }] }) });
    const feature = compiled(draft).find((entry) => entry.identity.id === `${draft.id}_SPELLCASTING`)!;
    expect(feature.spellcasting).toMatchObject({ prepare: false, allowReplace: true });
    expect(feature.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF" }));
    expect(feature.rules.some((rule) => rule.kind === "stat" && rule.name.endsWith(":prepare"))).toBe(false);
    const first = feature.rules.find((rule) => rule.kind === "stat" && rule.name.startsWith("moonwalker:spellcasting:slots"));
    expect(first).toMatchObject({ level: 2 });
  });
});

describe("a subclass", () => {
  it("is an Archetype under the class' tag that grants Archetype Features at class levels", () => {
    const draft = {
      ...createCustomSubclassDraft({ id: "ID_BOOK_CLASS", name: "Druid", tag: "Druid Circle" }, "Circle of the Moonwell"),
      scales: [{ ...MOON_DIE, id: "well", name: "Well die" }],
      features: [feature("subclass", 3, "Moonwell Initiate", "A well in your mind."), feature("subclass", 6, "Moonlit Form", "You take the shape of light.")],
      spells: {
        caster: "Druid",
        alwaysPrepared: [
          { level: 3, spell: { id: "ID_BOOK_SPELL_ONE", label: "One" } },
          { level: 5, spell: { id: "ID_BOOK_SPELL_TWO", label: "Two" } },
        ],
        addToList: [{ id: "ID_BOOK_SPELL_THREE", label: "Three" }],
      },
    };
    const [archetype, ...others] = compiled(draft);
    expect(archetype!.identity.type).toBe("Archetype");
    expect(archetype!.supports).toEqual(["Druid Circle"]);
    expect(archetype!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Archetype Feature", id: draft.features[1]!.draft.id, level: 6 }));
    expect(archetype!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Spell", id: "ID_BOOK_SPELL_ONE", level: 3, spellcasting: "Druid", prepared: true }));
    expect(others.map((entry) => entry.identity.type)).toEqual(["Archetype Feature", "Archetype Feature"]);
    const appends = parseAppendsFile(`<elements>${compileCustomElement(draft, { source: "Test Pack" })}</elements>`, "test.xml");
    expect(appends).toEqual([expect.objectContaining({ id: "ID_BOOK_SPELL_THREE", supports: ["Druid"] })]);
  });

  it("can cast on its own, reading its class' level", () => {
    const draft = {
      ...createCustomSubclassDraft({ id: "ID_BOOK_CLASS", name: "Fighter", tag: "Martial Archetype" }, "Rune Knight"),
      spellcasting: casterOf({ ability: "intelligence", style: "known", prepare: undefined, slots: { progression: "third" }, listTag: "Wizard", spells: [{ level: 3, known: 3 }], cantrips: [{ level: 3, known: 2 }] }),
    };
    const caster = compiled(draft).find((entry) => entry.identity.id === `${draft.id}_SPELLCASTING`)!;
    expect(caster.identity.type).toBe("Archetype Feature");
    expect(caster.spellcasting).toMatchObject({ name: "Rune Knight", list: "Wizard" });
    expect(caster.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD" }));
    expect(compiled(draft)[0]!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Archetype Feature", id: `${draft.id}_SPELLCASTING`, level: 3 }));
  });
});

describe("a species and a subspecies", () => {
  const species = {
    ...createCustomSpeciesDraft("Selkie"),
    size: "Small" as const,
    speed: 25,
    speeds: [{ mode: "swim" as const, feet: 40 }],
    vision: [{ id: "ID_VISION_DARKVISION", label: "Darkvision" }],
    languages: { grants: [{ id: "ID_LANGUAGE_COMMON" }], choices: 1 },
    abilityBonuses: [{ ability: "charisma" as const, amount: 2 }],
    abilityChoice: { picks: 1, from: ["strength" as const, "dexterity" as const] },
    subspecies: { kind: "Sub Race" as const },
    features: [feature("species", 1, "Sealskin", "You can breathe water."), feature("species", 5, "Tide Call", "The sea answers you.")],
    appearance: { names: { male: "Aldo, Bram", family: "Tidewater" }, namesFormat: "{{name}} {{family}}", height: { base: `4'2"`, modifier: "2d4" }, weight: { base: "60 lb.", modifier: "1d4" } },
  };

  it("grants a size, writes the speeds, senses and languages, and gates traits by level", () => {
    const [race, ...traits] = compiled(species);
    expect(race!.identity.type).toBe("Race");
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Size", id: "ID_SIZE_SMALL" }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "innate speed", value: "25", bonus: "base" }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "innate speed:swim", value: "40", bonus: "base" }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Vision", id: "ID_VISION_DARKVISION" }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Language", id: "ID_LANGUAGE_COMMON" }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "select", type: "Language", name: "Language (Selkie)", supports: "Standard" }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Racial Trait", id: species.features[0]!.draft.id }));
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Racial Trait", id: species.features[1]!.draft.id, level: 5 }));
    expect(traits.map((entry) => entry.identity.type)).toEqual(["Racial Trait", "Racial Trait"]);
  });

  it("writes the 2014 ability increases so a background that supplies them switches them off", () => {
    const [race] = compiled(species);
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "charisma", value: "2", requirements: "!ID_INTERNAL_GRANTS_BACKGROUND_ASI" }));
    expect(race!.rules).toContainEqual(
      expect.objectContaining({ kind: "select", type: "Ability Score Improvement", supports: "ID_INTERNAL_ASI_STRENGTH||ID_INTERNAL_ASI_DEXTERITY", requirements: "!ID_INTERNAL_GRANTS_BACKGROUND_ASI" }),
    );
    const [race2024] = compiled({ ...species, ruleset: "2024" });
    expect(race2024!.rules.some((rule) => rule.kind === "stat" && rule.name === "charisma")).toBe(false);
  });

  it("writes the appearance setters the suggestions read", () => {
    const [race] = compiled(species);
    expect(race!.setters).toContainEqual({ name: "names", value: "Aldo, Bram", attrs: { type: "male" } });
    expect(race!.setters).toContainEqual({ name: "height", value: `4'2"`, attrs: { modifier: "2d4" } });
    expect(race!.setters).toContainEqual({ name: "weight", value: "60 lb.", attrs: { modifier: "1d4" } });
    expect(race!.setters).toContainEqual({ name: "names-format", value: "{{name}} {{family}}" });
  });

  it("offers a subspecies through a pick that answers to the species' name, and the subspecies answers to it", () => {
    const [race] = compiled(species);
    expect(race!.rules).toContainEqual(expect.objectContaining({ kind: "select", type: "Sub Race", name: "Selkie Subrace", supports: "Selkie" }));
    const sub = { ...createCustomSubspeciesDraft({ id: species.id, name: "Selkie", tag: "Selkie" }, "Grey Selkie"), speedBonus: 5, abilityBonuses: [{ ability: "wisdom" as const, amount: 1 }] };
    const [element] = compiled(sub);
    expect(element!.identity.type).toBe("Sub Race");
    expect(element!.supports).toEqual(["Selkie"]);
    expect(element!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "innate speed", value: "5" }));
    const [variant] = compiled({ ...sub, kind: "Race Variant" });
    expect(variant!.identity.type).toBe("Race Variant");
  });
});

describe("a background", () => {
  const background = {
    ...createCustomBackgroundDraft("Lighthouse Keeper"),
    description: "You tended a lamp above the rocks.",
    starting: [grant("Proficiency", "ID_PROFICIENCY_SKILL_INSIGHT"), idChoice("Language", "Language (Lighthouse Keeper)", 1, ["ID_LANGUAGE_DWARVISH", "ID_LANGUAGE_ELVISH"])],
    equipment: ["A brass lantern", "A signal horn", "A belt pouch holding 10 gp"],
    feature: { ...createCustomDraft("feature", "Keeper's Welcome"), description: "Sailors share a bunk with you." },
    lists: [
      { name: "Personality Trait" as const, count: 2, items: ["I count waves.", "I hum off-key.", "I trust the weather."] },
      { name: "Ideal" as const, count: 1, items: ["Vigilance. Someone has to watch."] },
      { name: "Bond" as const, count: 1, items: ["My lamp must never go dark."] },
      { name: "Flaw" as const, count: 1, items: ["I will not leave my post."] },
    ],
  };

  it("grants its own feature, lists its equipment and offers the lists the sheet reads by name", () => {
    const [main, feat] = compiled(background);
    expect(main!.identity.type).toBe("Background");
    expect(feat!.identity).toMatchObject({ type: "Background Feature", name: "Keeper's Welcome", id: background.feature.id });
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Background Feature", id: background.feature.id }));
    expect(main!.descriptionXml).toContain("Equipment:");
    expect(main!.descriptionXml).toContain("A brass lantern; A signal horn");
    const lists = main!.rules.filter((rule) => rule.kind === "select" && rule.type === "List");
    expect(lists.map((rule) => (rule.kind === "select" ? [rule.name, rule.number ?? 1, rule.items?.length] : []))).toEqual([
      ["Personality Trait", 2, 3],
      ["Ideal", 1, 1],
      ["Bond", 1, 1],
      ["Flaw", 1, 1],
    ]);
  });

  it("writes the 2024 ability choice and origin feat", () => {
    const [main] = compiled({ ...background, abilityChoice: ["wisdom", "constitution", "charisma"], originFeat: { id: "ID_BOOK_FEAT_ONE" } });
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Feat", id: "ID_BOOK_FEAT_ONE" }));
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "grant", type: "Grants", id: "ID_INTERNAL_GRANTS_BACKGROUND_ASI" }));
    expect(main!.rules).toContainEqual(
      expect.objectContaining({ kind: "select", type: "Ability Score Improvement", number: 3, supports: "ID_INTERNAL_ASI_WISDOM||ID_INTERNAL_ASI_CONSTITUTION||ID_INTERNAL_ASI_CHARISMA" }),
    );
  });
});

describe("a companion", () => {
  const companion = {
    ...createCustomCompanionDraft("Ember Mote"),
    tags: ["Familiar"],
    size: "Tiny" as const,
    creatureType: "Elemental",
    challenge: "0",
    armorClass: 12,
    hitPoints: 3,
    hitPointsText: "3 (1d4+1)",
    speed: 0,
    speeds: [{ mode: "fly" as const, feet: 40 }],
    senses: "darkvision 30 ft.",
    abilities: { strength: 2, dexterity: 14, constitution: 10, intelligence: 6, wisdom: 12, charisma: 7 },
    traits: [{ id: "flicker", name: "Flicker", text: "The mote sheds dim light in a 10-foot radius." }],
    actions: [{ id: "singe", name: "Singe", text: "Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 1 fire damage." }],
  };

  it("is its stat block as setters and statistics, with its entries as child elements", () => {
    const [main, trait, action] = compiled(companion);
    const setter = (name: string) => main!.setters.find((entry) => entry.name === name)?.value;
    expect(main!.identity.type).toBe("Companion");
    expect(main!.supports).toEqual(["Familiar"]);
    expect(setter("dexterity")).toBe("14");
    expect(setter("ac")).toBe("12");
    expect(setter("hp")).toBe("3 (1d4+1)");
    expect(setter("speed")).toBe("0 ft., fly 40 ft.");
    expect(setter("size")).toBe("Tiny");
    expect(setter("traits")).toBe(trait!.identity.id);
    expect(setter("actions")).toBe(action!.identity.id);
    expect(trait!.identity.type).toBe("Companion Trait");
    expect(action!.identity.type).toBe("Companion Action");
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "companion:ac", value: "12" }));
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "companion:hp:max", value: "3", bonus: "base" }));
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "companion:speed:fly", value: "40", bonus: "base" }));
  });

  it("can follow its owner's statistics", () => {
    const [main] = compiled({
      ...companion,
      stats: [
        { id: "a", target: "companion:attack" as const, mode: "add" as const, value: { kind: "reference" as const, ref: "proficiency" } },
        { id: "b", target: "companion:hp:max" as const, mode: "set" as const, value: { kind: "reference" as const, ref: "level" } },
      ],
    });
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "companion:attack", value: "proficiency" }));
    expect(main!.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "companion:hp:max", value: "level", bonus: "base" }));
  });
});

describe("validation names the field", () => {
  it("points into a class' own fields and into the features inside it", () => {
    const bad = moonwalker({ hitDie: 7 as never, asiLevels: [4, 4], features: [{ level: 25, draft: { ...createProgressionFeature("class", 1, "").draft } }] });
    const paths = customPackDraftIssues(bad).map((issue) => issue.path);
    expect(paths).toContain("hitDie");
    expect(paths).toContain("asiLevels");
    expect(paths).toContain("features[0].level");
    expect(paths).toContain("features[0].draft.name");
  });

  it("lets a feature read the table's value column and refuses one that does not exist", () => {
    const reads = feature("class", 2, "Moon Strike", "x", {
      blocks: [{ kind: "modifier", id: newCustomBlockId(), target: "melee:damage", mode: "add", value: { kind: "scale", scale: "moondie" } }],
    });
    const countColumn = { id: "moondie", name: "Strikes", kind: "number" as const, steps: [{ level: 1, value: 1 }] };
    expect(customPackDraftIssues(moonwalker({ scales: [countColumn], features: [reads] }))).toEqual([]);
    expect(customPackDraftIssues(moonwalker({ scales: [], features: [reads] }))).toContainEqual(
      expect.objectContaining({ path: "features[0].draft.blocks[0].value.scale" }),
    );
  });

  it("refuses a spellcaster missing what makes it one, and a subclass that casts both ways", () => {
    const paths = (draft: CustomPackDraft) => customPackDraftIssues(draft).map((issue) => issue.path);
    expect(paths(moonwalker({ spellcasting: casterOf({ ability: "luck" as never }) }))).toContain("spellcasting.ability");
    expect(paths(moonwalker({ spellcasting: casterOf({ slots: { progression: "custom" } }) }))).toContain("spellcasting.slots.table");
    expect(paths(moonwalker({ spellcasting: casterOf({ prepare: undefined }) }))).toContain("spellcasting.prepare");
    const both = { ...createCustomSubclassDraft({ id: "ID_X", name: "X", tag: "T" }, "Both"), spells: { caster: "X", alwaysPrepared: [], addToList: [] }, spellcasting: casterOf() };
    expect(paths(both)).toContain("spellcasting");
  });

  it("refuses a background list the sheet would not read, and a companion with a bad block", () => {
    const background = { ...createCustomBackgroundDraft("B"), lists: [{ name: "Quirk" as never, count: 1, items: ["x"] }] };
    expect(customPackDraftIssues(background)).toContainEqual(expect.objectContaining({ path: "lists[0].name" }));
    const companion = { ...createCustomCompanionDraft("C"), challenge: "lots", armorClass: 99 };
    expect(customPackDraftIssues(companion).map((issue) => issue.path)).toEqual(expect.arrayContaining(["challenge", "armorClass"]));
  });

  it("reads every kind back from a stored pack and tells the pack which element type it makes", () => {
    const drafts = [moonwalker(), createCustomSpeciesDraft("Selkie"), createCustomSubspeciesDraft({ id: "ID_X", name: "X", tag: "X" }, "Y", "Race Variant"), createCustomSubclassDraft({ id: "ID_X", name: "X", tag: "T" }, "Z"), createCustomBackgroundDraft("Keeper"), createCustomCompanionDraft("Mote")];
    for (const draft of drafts) expect(readCustomPackDraft(JSON.parse(JSON.stringify(draft))).template).toBe(draft.template);
    expect(drafts.map(packElementType)).toEqual(["Class", "Race", "Race Variant", "Archetype", "Background", "Companion"]);
    expect(packElementFor(drafts[0]!, "Test Pack", { tolerant: true })).toMatchObject({ type: "Class", id: drafts[0]!.id, customDraft: drafts[0] });
  });
});

// ---- characters built from them ---------------------------------------------------------------

const sheetLines = (service: CharacterService, id: string, library: ElementLibrary): string[] => {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const lines: string[] = [];
  for (const page of model.pages) {
    for (const section of page.sections) for (const row of section.rows) lines.push(...(row.kind === "lines" ? row.lines : row.tokens));
  }
  return lines;
};

const pending = (service: CharacterService, id: string, name: string) => pendingSelectionRules(service.getCharacter(id)).filter((rule) => rule.name === name);

describe("a homebrew class builds a level-5 character", () => {
  const draft = moonwalker({ spellcasting: casterOf() });
  let library: ElementLibrary;
  beforeAll(() => {
    library = libraryWith([draft]);
  });

  it("loads without a finding", () => {
    expect(packFindings(library)).toEqual([]);
    expect(library.byId.get(draft.id)?.identity.type).toBe("Class");
  });

  it("levels 1 to 5 with its hit die, features by level, a value column, a subclass at 3 and an ASI at 4", () => {
    const { service, id } = buildCharacter(library, { id: "Moon5", classId: draft.id, levels: 5 });
    const state = service.getCharacter(id);
    const registered = new Set(state.sum.elements.map((entry) => entry.id));
    for (const entry of draft.features) expect(registered.has(entry.draft.id), entry.draft.name).toBe(true);
    const stats = computeStatistics(state, library);
    // The first level is the hit die's maximum; each later level rolls the die, so at least 1 and at most 10.
    expect(stats["hp:moonwalker"]).toBeGreaterThanOrEqual(10 + 4);
    expect(stats["hp:moonwalker"]).toBeLessThanOrEqual(10 + 4 * 10);
    const first = buildCharacter(library, { id: "Moon1", classId: draft.id, levels: 1 });
    expect(computeStatistics(first.service.getCharacter(first.id), library)["hp:moonwalker"]).toBe(10);
    expect(stats["level:moonwalker"]).toBe(5);
    expect(stats["persuasion:misc"]).toBe(2);
    expect(sheetLines(service, id, library).some((line) => line.includes("Your moon die is d10."))).toBe(true);

    // A level-3 character has not reached the level-5 feature and reads the d8.
    const three = buildCharacter(library, { id: "Moon3", classId: draft.id, levels: 3 });
    expect(new Set(three.service.getCharacter(three.id).sum.elements.map((entry) => entry.id)).has(draft.features[2]!.draft.id)).toBe(false);
    expect(sheetLines(three.service, three.id, library).some((line) => line.includes("Your moon die is d8."))).toBe(true);

    // The subclass pick is due from level 3 and the improvement option from level 4.
    expect(pending(service, id, "Moon Path")).toHaveLength(1);
    expect(pending(service, id, "Improvement Option (Moonwalker 4)")).toHaveLength(1);
    expect(pending(service, id, "Improvement Option (Moonwalker 4)")[0]!.requiredLevel).toBe(4);
    const options = selectionOptions(state, library, pending(service, id, "Improvement Option (Moonwalker 4)")[0]!).map((option) => option.id);
    expect(options).toContain("ID_INTERNAL_CLASS_FEATURE_ASI_4_MOONWALKER");
    expect(options).toContain("ID_INTERNAL_CLASS_FEATURE_FEAT_4_MOONWALKER");
  });

  it("offers only the class' skill list and grants the picks as proficiencies", () => {
    const { service, id } = buildCharacter(library, { id: "MoonSkills", classId: draft.id, levels: 1 });
    const slots = pending(service, id, "Skill Proficiency (Moonwalker)");
    expect(slots).toHaveLength(2);
    const offered = selectionOptions(service.getCharacter(id), library, slots[0]!).map((option) => option.id).sort();
    expect(offered).toEqual(["ID_PROFICIENCY_SKILL_ARCANA", "ID_PROFICIENCY_SKILL_NATURE", "ID_PROFICIENCY_SKILL_STEALTH"]);
    const before = computeStatistics(service.getCharacter(id), library);
    service.setSelection(id, slots[0]!.identifier, "ID_PROFICIENCY_SKILL_ARCANA");
    service.setSelection(id, pending(service, id, "Skill Proficiency (Moonwalker)")[0]!.identifier, "ID_PROFICIENCY_SKILL_STEALTH");
    const after = computeStatistics(service.getCharacter(id), library);
    expect(after["arcana:proficiency"]).toBe(before["arcana:proficiency"]! + before.proficiency!);
    expect(after["stealth:proficiency"]).toBe(before["stealth:proficiency"]! + before.proficiency!);
    expect(after["nature:proficiency"]).toBe(before["nature:proficiency"]);
    // The saving throw proficiency is granted outright.
    expect(service.getCharacter(id).sum.elements.map((entry) => entry.id)).toContain("ID_PROFICIENCY_SAVINGTHROW_WISDOM");
  });

  it("takes a level-5 caster's slots, prepare count and cantrip picks from the table", () => {
    const { service, id } = buildCharacter(library, { id: "MoonCaster", classId: draft.id, levels: 5, abilities: { ...STANDARD_ARRAY, wisdom: 16 } });
    const stats = computeStatistics(service.getCharacter(id), library);
    expect([1, 2, 3, 4].map((slot) => stats[`moonwalker:spellcasting:slots:${slot}`] ?? 0)).toEqual([4, 3, 2, 0]);
    expect(stats["moonwalker:spellcasting:prepare"]).toBe(3 + 5);
    expect(pending(service, id, "Cantrip (Moonwalker)").map((rule) => rule.requiredLevel).sort()).toEqual([1, 1, 4]);
    expect(service.getSpellcasting(id).find((caster) => caster.name === "Moonwalker")).toMatchObject({ ability: "Wisdom" });
  });
});

describe("a homebrew class' spell slots join a multiclass character's shared slots", () => {
  it("counts a full caster's levels toward the combined table", () => {
    const draft = moonwalker({ spellcasting: casterOf(), multiclass: { blocks: [] } });
    const library = libraryWith([draft]);
    const service = new CharacterService(undefined, library, { rng: () => 0.5 });
    service.createCharacter("MC");
    service.setAbilities("MC", { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
    const classRule = pendingSelectionRules(service.getCharacter("MC")).find((rule) => rule.type === "Class")!;
    service.setSelection("MC", classRule.identifier, "ID_WOTC_PHB_CLASS_WIZARD");
    for (let i = 0; i < 3; i++) service.levelUp("MC");
    service.setCharacterOption("MC", { optionId: ID.OPTION_MULTICLASS, enabled: true });
    service.startMulticlass("MC", `${draft.id}_MULTICLASS`);
    service.levelUpMode("MC", { mode: "multiclass", classId: `${draft.id}_MULTICLASS` });
    const values = computeStatistics(service.getCharacter("MC"), library);
    // Wizard 3 and Moonwalker 2 are both full casters: caster level 5.
    expect(values["multiclass:spellcasting:level"]).toBe(5);
    expect([1, 2, 3, 4].map((slot) => values[`multiclass:spellcasting:slot:${slot}`])).toEqual([4, 3, 2, undefined]);
  });
});

describe("a homebrew subclass of a book class", () => {
  const draft = {
    ...createCustomSubclassDraft({ id: ID.CLASS_WIZARD, name: "Wizard", tag: "Arcane Tradition" }, "Tidecaller"),
    description: "You draw on the pull of the sea.",
    scales: [{ id: "tide", name: "Tide die", kind: "dice" as const, steps: [{ level: 2, value: "d4" }, { level: 6, value: "d6" }] }],
    features: [feature("subclass", 2, "Pull of the Tide", "The sea lends you a die: {{scale:tide die}}.", { sheet: { text: "Your tide die is {{scale:tide die}}." } })],
    spells: {
      caster: "Wizard",
      alwaysPrepared: [
        { level: 3, spell: { id: "ID_PHB_SPELL_FOG_CLOUD", label: "Fog Cloud" } },
        { level: 5, spell: { id: "ID_PHB_SPELL_FIREBALL", label: "Fireball" } },
      ],
      addToList: [{ id: "ID_PHB_SPELL_ENTANGLE", label: "Entangle" }],
    },
  };
  let library: ElementLibrary;
  beforeAll(() => {
    library = libraryWith([draft]);
  });

  it("is offered by the Wizard's tradition pick, grants its feature and prepares its spells at their levels", () => {
    expect(packFindings(library)).toEqual([]);
    const { service, id } = buildCharacter(library, {
      id: "Tide4",
      raceId: ID.RACE_ELF,
      subRaceId: ID.SUB_RACE_HIGH_ELF,
      classId: ID.CLASS_WIZARD,
      levels: 4,
      abilities: { strength: 8, dexterity: 14, constitution: 14, intelligence: 16, wisdom: 12, charisma: 10 },
    });
    const rule = pending(service, id, "Arcane Tradition")[0]!;
    expect(selectionOptions(service.getCharacter(id), library, rule).map((option) => option.id)).toContain(draft.id);
    service.setSelection(id, rule.identifier, draft.id);
    const state = service.getCharacter(id);
    expect(state.sum.elements.map((entry) => entry.id)).toContain(draft.features[0]!.draft.id);
    expect(sheetLines(service, id, library).some((line) => line.includes("Your tide die is d4."))).toBe(true);
    const wizard = service.getSpellcasting(id).find((caster) => caster.name === "Wizard")!;
    const always = wizard.knownSpells.filter((spell) => spell.isAlwaysPrepared).map((spell) => spell.id);
    expect(always).toContain("ID_PHB_SPELL_FOG_CLOUD");
    // The level-5 spell is not yet available to a level-4 wizard.
    expect(always).not.toContain("ID_PHB_SPELL_FIREBALL");
  });

  it("adds its spells to the class list for every wizard", () => {
    expect(library.byId.get("ID_PHB_SPELL_ENTANGLE")!.supports).toContain("Wizard");
  });
});

describe("a homebrew species builds a character", () => {
  const species = {
    ...createCustomSpeciesDraft("Selkie"),
    size: "Small" as const,
    speed: 25,
    vision: [{ id: "ID_VISION_DARKVISION" }],
    languages: { grants: [{ id: "ID_LANGUAGE_COMMON" }], choices: 1 },
    abilityBonuses: [{ ability: "charisma" as const, amount: 2 }],
    subspecies: { kind: "Sub Race" as const },
    features: [feature("species", 1, "Sealskin", "You can breathe water."), feature("species", 5, "Tide Call", "The sea answers you.")],
  };
  const grey = { ...createCustomSubspeciesDraft({ id: species.id, name: "Selkie", tag: "Selkie" }, "Grey Selkie"), speedBonus: 5, abilityBonuses: [{ ability: "wisdom" as const, amount: 1 }], features: [feature("species", 1, "Fog Cloak", "Mist clings to you.")] };
  let library: ElementLibrary;
  beforeAll(() => {
    library = libraryWith([species, grey]);
  });

  it("has a size, a speed, a sense, a language pick and a trait at level 5", () => {
    expect(packFindings(library)).toEqual([]);
    const four = buildCharacter(library, { id: "Selkie4", raceId: species.id, subRaceId: grey.id, classId: ID.CLASS_FIGHTER, levels: 4 });
    const state = four.service.getCharacter(four.id);
    const ids = new Set(state.sum.elements.map((entry) => entry.id));
    expect(ids.has("ID_SIZE_SMALL")).toBe(true);
    expect(ids.has("ID_VISION_DARKVISION")).toBe(true);
    expect(ids.has(species.features[0]!.draft.id)).toBe(true);
    expect(ids.has(species.features[1]!.draft.id)).toBe(false);
    const stats = computeStatistics(state, library);
    // 25 feet, and the grey selkie's 5 more.
    expect(stats.speed).toBe(30);
    expect(pending(four.service, four.id, "Language (Selkie)")).toHaveLength(1);
    expect(stats["charisma:score"]).toBe(STANDARD_ARRAY.charisma + 2);
    expect(stats["wisdom:score"]).toBe(STANDARD_ARRAY.wisdom + 1);

    const five = buildCharacter(library, { id: "Selkie5", raceId: species.id, subRaceId: grey.id, classId: ID.CLASS_FIGHTER, levels: 5 });
    expect(new Set(five.service.getCharacter(five.id).sum.elements.map((entry) => entry.id)).has(species.features[1]!.draft.id)).toBe(true);
  });

  it("offers the subspecies only under its species, and the ability increase gives way to a background that supplies it", () => {
    const { service, id } = buildCharacter(library, { id: "SelkieSub", raceId: species.id, subRaceId: "", classId: ID.CLASS_FIGHTER, levels: 1 });
    const rule = pending(service, id, "Selkie Subrace")[0]!;
    expect(selectionOptions(service.getCharacter(id), library, rule).map((option) => option.id)).toEqual([grey.id]);
  });

  it("gives way to a background that supplies the increase", () => {
    const ashore = { ...createCustomBackgroundDraft("Raised Ashore"), abilityChoice: ["wisdom", "constitution", "charisma"] as Array<"wisdom" | "constitution" | "charisma"> };
    const withBackground = libraryWith([species, ashore]);
    const { service, id } = buildCharacter(withBackground, { id: "SelkieAshore", raceId: species.id, subRaceId: "", classId: ID.CLASS_FIGHTER, levels: 1 });
    const before = computeStatistics(service.getCharacter(id), withBackground);
    expect(before["charisma:score"]).toBe(STANDARD_ARRAY.charisma + 2);
    service.setSelection(id, pending(service, id, "Background")[0]!.identifier, ashore.id);
    const after = computeStatistics(service.getCharacter(id), withBackground);
    expect(after["charisma:score"]).toBe(STANDARD_ARRAY.charisma);
    expect(pending(service, id, `Background Ability Score Improvement (Raised Ashore)`)).toHaveLength(3);
  });
});

describe("a homebrew background builds a character", () => {
  const background = {
    ...createCustomBackgroundDraft("Lighthouse Keeper"),
    description: "You tended a lamp above the rocks.",
    starting: [grant("Proficiency", "ID_PROFICIENCY_SKILL_INSIGHT"), idChoice("Language", "Language (Lighthouse Keeper)", 1, ["ID_LANGUAGE_ELVISH", "ID_LANGUAGE_HALFLING"])],
    equipment: ["A brass lantern", "A signal horn"],
    feature: { ...createCustomDraft("feature", "Keeper's Welcome"), description: "Sailors share a bunk with you." },
    lists: [
      { name: "Personality Trait" as const, count: 2, items: ["I count waves.", "I hum off-key.", "I trust the weather."] },
      { name: "Ideal" as const, count: 1, items: ["Vigilance. Someone has to watch."] },
      { name: "Bond" as const, count: 1, items: ["My lamp must never go dark."] },
      { name: "Flaw" as const, count: 1, items: ["I will not leave my post."] },
    ],
  };
  let library: ElementLibrary;
  beforeAll(() => {
    library = libraryWith([background]);
  });

  it("grants its proficiency and feature, offers its language, and fills the sheet's personality fields", () => {
    expect(packFindings(library)).toEqual([]);
    expect(packFindings(libraryWith([background]))).toEqual([]);
    const { service, id } = buildCharacter(library, { id: "Keeper", classId: ID.CLASS_FIGHTER, levels: 1 });
    const rule = pending(service, id, "Background")[0]!;
    expect(selectionOptions(service.getCharacter(id), library, rule).map((option) => option.id)).toContain(background.id);
    service.setSelection(id, rule.identifier, background.id);

    const state = service.getCharacter(id);
    const ids = new Set(state.sum.elements.map((entry) => entry.id));
    expect(ids.has("ID_PROFICIENCY_SKILL_INSIGHT")).toBe(true);
    expect(ids.has(background.feature.id)).toBe(true);
    expect(selectionOptions(state, library, pending(service, id, "Language (Lighthouse Keeper)")[0]!).map((option) => option.id).sort()).toEqual(["ID_LANGUAGE_ELVISH", "ID_LANGUAGE_HALFLING"]);
    expect(library.byId.get(background.id)!.descriptionXml).toContain("A brass lantern; A signal horn");

    const trait = pending(service, id, "Personality Trait");
    expect(trait).toHaveLength(2);
    service.setSelection(id, trait[0]!.identifier, "1");
    service.setSelection(id, pending(service, id, "Personality Trait")[0]!.identifier, "2");
    service.setSelection(id, pending(service, id, "Ideal")[0]!.identifier, "1");
    service.setSelection(id, pending(service, id, "Bond")[0]!.identifier, "1");
    service.setSelection(id, pending(service, id, "Flaw")[0]!.identifier, "1");
    const filled = service.getCharacter(id).backgroundTraits;
    expect(filled.traits).toContain("I count waves.");
    expect(filled.traits).toContain("I hum off-key.");
    expect(filled.ideals).toBe("Vigilance. Someone has to watch.");
    expect(filled.bonds).toBe("My lamp must never go dark.");
    expect(filled.flaws).toBe("I will not leave my post.");
  });

  it("lists the Background Feature as attached, so pack health does not call it unattachable", () => {
    expect((library.diagnostics ?? []).filter((entry) => entry.kind === "unattachable")).toEqual([]);
  });
});

describe("a homebrew companion builds a character", () => {
  const companion = {
    ...createCustomCompanionDraft("Ember Mote"),
    tags: ["Familiar"],
    size: "Tiny" as const,
    creatureType: "Elemental",
    armorClass: 12,
    hitPoints: 3,
    hitPointsText: "3 (1d4+1)",
    speed: 0,
    speeds: [{ mode: "fly" as const, feet: 40 }],
    abilities: { strength: 2, dexterity: 14, constitution: 10, intelligence: 6, wisdom: 12, charisma: 7 },
    traits: [{ id: "flicker", name: "Flicker", text: "The mote sheds dim light in a 10-foot radius." }],
    actions: [{ id: "singe", name: "Singe", text: "Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 1 fire damage." }],
  };

  it("is picked through a feature's companion choice and prints its stat block, trait and action", () => {
    const library = libraryWith([companion]);
    expect(packFindings(library)).toEqual([]);
    const { service, id } = buildCharacter(library, { id: "Familiar", classId: ID.CLASS_FIGHTER, levels: 1 });
    const gift = {
      ...createCustomDraft("boon", "Mote Bond"),
      blocks: [{ kind: "choice", id: newCustomBlockId(), type: "Companion", name: "Bonded mote", count: 1, supports: { kind: "tag", value: "Familiar" } }] as CustomBlock[],
    };
    const saved = service.saveCustomDraft(id, { draft: gift });
    expect(saved.diagnostics).toEqual([]);
    const rule = pending(service, id, "Bonded mote")[0]!;
    expect(selectionOptions(service.getCharacter(id), library, rule).map((option) => option.id)).toContain(companion.id);
    service.setSelection(id, rule.identifier, companion.id);

    const dto = service.getCompanion(id)!;
    expect(dto).toMatchObject({ kind: "Ember Mote", size: "Tiny", creatureType: "Elemental", armorClass: 12, maxHp: 3, speedFly: 40, hitPointsText: "3 (1d4+1)" });
    expect(dto.abilities.find((ability) => ability.name === "Dexterity")).toMatchObject({ score: 14, modifier: 2 });
    expect(dto.traits.map((entry) => entry.name)).toEqual(["Flicker"]);
    expect(dto.actions.map((entry) => entry.name)).toEqual(["Singe"]);
  });
});

describe("changing a choice a character has already used", () => {
  it("names the picks an edit to a class' skill choice would clear, wherever the choice sits", () => {
    const draft = moonwalker();
    const library = libraryWith([draft]);
    const { service, id } = buildCharacter(library, { id: "MoonPicked", classId: draft.id, levels: 1 });
    service.setSelection(id, pending(service, id, "Skill Proficiency (Moonwalker)")[0]!.identifier, "ID_PROFICIENCY_SKILL_ARCANA");

    const renamed = moonwalker({ ...draft, starting: draft.starting.map((block) => (block.kind === "choice" ? { ...block, name: "Trained Skill" } : block)) });
    const report = service.getPackChoiceImpact({ before: draft, after: renamed });
    expect(report.hasPicks).toBe(true);
    expect(report.changes[0]).toMatchObject({ name: "Skill Proficiency (Moonwalker)", change: "removed" });
    expect(report.changes[0]!.picks.map((pick) => pick.elementId)).toEqual(["ID_PROFICIENCY_SKILL_ARCANA"]);

    // A larger count keeps every pick, and a change to a feature's text costs nothing.
    const more = moonwalker({ ...draft, starting: draft.starting.map((block) => (block.kind === "choice" ? { ...block, count: 3 } : block)) });
    expect(service.getPackChoiceImpact({ before: draft, after: more }).hasPicks).toBe(false);
    expect(service.getPackChoiceImpact({ before: draft, after: { ...draft, description: "Changed." } }).changes).toEqual([]);
  });
});

describe("pack health reads the elements a class makes", () => {
  it("finds nothing wrong with a finished class, subclass, species, background and companion together", () => {
    const klass = moonwalker({ spellcasting: casterOf(), multiclass: { blocks: [] } });
    const drafts: CustomPackDraft[] = [
      klass,
      { ...createCustomSubclassDraft({ id: klass.id, name: "Moonwalker", tag: "Moon Path" }, "Wellkeeper"), features: [feature("subclass", 3, "Well Gift", "x")] },
      createCustomSpeciesDraft("Selkie"),
      { ...createCustomBackgroundDraft("Keeper"), feature: { ...createCustomDraft("feature", "Welcome"), description: "x" } },
      createCustomCompanionDraft("Mote"),
    ];
    const library = createEmptyLibrary();
    replaceLibraryFiles(library, new Map(baseFiles));
    const findings = checkContentFile(library, { path: "homebrew/pack.xml", xml: compileCustomPack(drafts, { source: "Test Pack" }) });
    expect(findings).toEqual([]);
  });
});

describe("each template round-trips from form to XML and back", () => {
  const klass = moonwalker({ spellcasting: casterOf(), multiclass: { requirements: { kind: "ability", ability: "wisdom", min: 13 }, blocks: [grant("Proficiency", "ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR")] } });
  const drafts: Array<[string, CustomPackDraft, string]> = [
    ["species", { ...createCustomSpeciesDraft("Selkie"), subspecies: { kind: "Sub Race" }, features: [feature("species", 5, "Tide Call", "x")] }, "Race"],
    ["subspecies", { ...createCustomSubspeciesDraft({ id: "ID_BOOK_RACE", name: "Elf", tag: "Elf" }, "Grey Elf"), speedBonus: 5 }, "Sub Race"],
    ["class", klass, "Class"],
    ["subclass", { ...createCustomSubclassDraft({ id: klass.id, name: "Moonwalker", tag: "Moon Path" }, "Wellkeeper"), features: [feature("subclass", 3, "Well Gift", "x")] }, "Archetype"],
    ["background", { ...createCustomBackgroundDraft("Keeper"), equipment: ["A lantern"], lists: [{ name: "Bond", count: 1, items: ["My lamp."] }] }, "Background"],
    ["companion", { ...createCustomCompanionDraft("Mote"), traits: [{ id: "t", name: "Flicker", text: "x" }] }, "Companion"],
  ];

  it.each(drafts)("a %s reopens as the form it was made with and compiles to the same file", (_, draft, type) => {
    const stored = packElementFor(draft, "Test Pack");
    expect(stored.type).toBe(type);
    const reopened = readCustomPackDraft(JSON.parse(JSON.stringify(stored.customDraft)));
    expect(reopened).toEqual(draft);
    expect(compileCustomElement(reopened, { source: "Test Pack" })).toBe(stored.rawXml);
    const elements = parseElementsFile(`<elements>${stored.rawXml as string}</elements>`, "round.xml");
    expect(elements[0]!.identity).toMatchObject({ id: draft.id, name: draft.name, type, source: "Test Pack" });
    expect(compiledElementIds(stored.rawXml as string)).toEqual(elements.map((entry) => entry.identity.id));
  });

  it("keeps a class' facts through the XML: hit die, levels of its features, its picks and its multiclass entry", () => {
    const [primary] = compiled(klass);
    expect(primary!.setters.find((entry) => entry.name === "hd")?.value).toBe(`d${klass.hitDie}`);
    expect(primary!.rules.filter((rule) => rule.kind === "grant" && rule.type === "Class Feature").length).toBe(klass.features.length + 3);
    expect(primary!.multiclass?.prerequisite).toBe("Wisdom 13 or higher");
  });
});
