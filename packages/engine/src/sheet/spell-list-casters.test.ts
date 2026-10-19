/**
 * Which levels, slot circles and prepared marks each caster's spell list
 * prints.
 *
 * A combined multiclass character has one shared slot pool, but each class
 * learns and prepares spells only up to its own class's spell level: a Druid 5
 * / Sorcerer 3 has 4th-level slots, yet prepares at most 3rd-level druid
 * spells and knows at most 2nd-level sorcerer spells. The shared circles print
 * once, on the class whose spells reach highest, and a feat caster prints none.
 * Pact Magic's lower levels print the spells known there, and a caster that
 * does not prepare marks every levelled spell it knows.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PDFPage } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { freshService, ID, select, sharedLibrary, STANDARD_ARRAY } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { buildCharacterSheetModel, type SheetSpellcasterLayout } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { SHEET_TEMPLATE_CONTRACT } from "./template-contract.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

const ABILITIES = { ...STANDARD_ARRAY, intelligence: 14, wisdom: 16, charisma: 14 };

function pickNamed(service: CharacterService, id: string, name: string, elementId: string, level?: number): void {
  const rule = pendingSelectionRules(service.getCharacter(id))
    .find((candidate) => candidate.name === name && (level === undefined || candidate.requiredLevel === level));
  if (rule === undefined) throw new Error(`no pending rule named '${name}'`);
  service.setSelection(id, rule.identifier, elementId);
}

interface Edition {
  ruleset: "2014" | "2024";
  druid: string;
  multiclassSorcerer: string;
  spell: (name: string) => string;
  /** Builds Druid 6 with Magic Initiate (Wizard) taken on the Intelligence route. */
  base: (service: CharacterService, id: string) => void;
}

const EDITIONS: readonly Edition[] = [
  {
    ruleset: "2014",
    druid: ID.CLASS_DRUID,
    multiclassSorcerer: "ID_WOTC_PHB_MULTICLASS_SORCERER",
    spell: (name) => `ID_PHB_SPELL_${name}`,
    base: (service, id) => {
      service.setCharacterOption(id, { optionId: ID.OPTION_FEATS, enabled: true });
      select(service, id, "Race", ID.RACE_DWARF);
      select(service, id, "Sub Race", ID.SUB_RACE_HILL_DWARF);
      select(service, id, "Class", ID.CLASS_DRUID);
      for (let level = 2; level <= 6; level++) service.levelUp(id);
      pickNamed(service, id, "Improvement Option (Druid 4)", "ID_INTERNAL_CLASS_FEATURE_FEAT_4_DRUID");
      select(service, id, "Feat", "ID_PHB_FEAT_MAGICINITIATE");
      select(service, id, "Feat Feature", "ID_PHB_FEAT_MAGIC_INITIATE_WIZARD");
      pickNamed(service, id, "Cantrip (Magic Initiate)", "ID_PHB_SPELL_FIRE_BOLT");
      pickNamed(service, id, "Cantrip (Magic Initiate)", "ID_PHB_SPELL_MAGE_HAND");
      pickNamed(service, id, "1st-level Spell (Magic Initiate)", "ID_PHB_SPELL_MAGIC_MISSILE");
    },
  },
  {
    ruleset: "2024",
    druid: "ID_WOTC_PHB24_CLASS_DRUID",
    multiclassSorcerer: "ID_WOTC_PHB24_MULTICLASS_SORCERER",
    spell: (name) => `ID_WOTC_PHB24_SPELL_${name}`,
    base: (service, id) => {
      service.setRulesetMode(id, "2024");
      select(service, id, "Race", "ID_WOTC_PHB24_RACE_HUMAN");
      select(service, id, "Class", "ID_WOTC_PHB24_CLASS_DRUID");
      // The Sage background grants Magic Initiate (Wizard).
      select(service, id, "Background", "ID_WOTC_PHB24_BACKGROUND_SAGE");
      for (let level = 2; level <= 6; level++) service.levelUp(id);
      pickNamed(service, id, "Spellcasting Ability (Magic Initiate)", "ID_WOTC_PHB24_FEAT_FEATURE_MAGIC_INITIATE_WIZARD_INTELLIGENCE");
      pickNamed(service, id, "Cantrip (Magic Initiate)", "ID_WOTC_PHB24_SPELL_FIRE_BOLT");
      pickNamed(service, id, "Cantrip (Magic Initiate)", "ID_WOTC_PHB24_SPELL_MAGE_HAND");
      pickNamed(service, id, "Level 1 Spell (Magic Initiate)", "ID_WOTC_PHB24_SPELL_MAGIC_MISSILE");
    },
  },
];

/** Druid 5 / Sorcerer 3 with Magic Initiate (Wizard): multiclass caster level 8. */
function druidSorcerer(edition: Edition): { service: CharacterService; id: string } {
  const service = freshService(library);
  const id = `DruidSorcerer${edition.ruleset}`;
  service.createCharacter(id);
  service.setAbilities(id, ABILITIES);
  edition.base(service, id);
  service.setCharacterOption(id, { optionId: ID.OPTION_MULTICLASS, enabled: true });
  service.startMulticlass(id, edition.multiclassSorcerer);
  service.levelUpMode(id, { mode: "multiclass", classId: edition.multiclassSorcerer });
  service.levelUpMode(id, { mode: "multiclass", classId: edition.multiclassSorcerer });
  // 1st-level spells for the sorcerer's choices, Shatter for the one its
  // third level grants.
  const firsts = ["SHIELD", "BURNING_HANDS", "SLEEP", "CHROMATIC_ORB", "THUNDERWAVE", "FALSE_LIFE"].map(edition.spell);
  const rules = pendingSelectionRules(service.getCharacter(id))
    .filter((candidate) => candidate.type === "Spell" && /^Spell(casting)? \(Sorcerer\)$/.test(candidate.name))
    .sort((left, right) => left.requiredLevel - right.requiredLevel);
  rules.forEach((rule, index) => {
    service.setSelection(id, rule.identifier, index === rules.length - 1 ? edition.spell("SHATTER") : firsts[index]!);
  });
  return { service, id };
}

function spellLayouts(service: CharacterService, id: string): SheetSpellcasterLayout[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, {
    mode: "full",
    include: { background: false, notes: false, spellCards: false, itemCards: false },
  });
  // A caster continued onto another page repeats its header; join its sections.
  const byName = new Map<string, SheetSpellcasterLayout>();
  for (const layout of model.pages.flatMap((page) => page.spellcasting ?? [])) {
    const seen = byName.get(layout.name);
    byName.set(layout.name, seen === undefined ? layout : { ...seen, sections: [...seen.sections, ...layout.sections] });
  }
  return [...byName.values()];
}

describe.each(EDITIONS)("Druid 5 / Sorcerer 3 with Magic Initiate (Wizard), $ruleset rules", (edition) => {
  it("caps each class at its own spell level and prints the shared slots once", async () => {
    const { service, id } = druidSorcerer(edition);
    const state = service.getCharacter(id);
    expect(state.magic?.multiclass).toBe(true);
    expect(state.magic?.level).toBe("8");

    const casters = service.getSpellcasting(id);
    const druid = casters.find((caster) => caster.name === "Druid")!;
    const sorcerer = casters.find((caster) => caster.name === "Sorcerer")!;
    // The shared pool reaches 4th level; neither class's spells do.
    expect(druid.slotsPerLevel.slice(0, 4)).toEqual([4, 3, 3, 2]);
    expect(druid.maxSpellLevel).toBe(3);
    expect(sorcerer.maxSpellLevel).toBe(2);
    expect(Math.max(...druid.knownSpells.map((spell) => spell.level))).toBe(3);

    // A Druid 5 cannot prepare a 4th-level druid spell.
    expect(() => service.setPrepared(id, druid.identifier, { spellId: edition.spell("STONESKIN"), prepared: true }))
      .toThrowError(/not known/);
    expect(() => service.setPrepared(id, druid.identifier, { spellId: edition.spell("CALL_LIGHTNING"), prepared: true }))
      .not.toThrow();

    const layouts = spellLayouts(service, id);
    const levelsOf = (name: string): number[] =>
      layouts.find((layout) => layout.name.startsWith(name))!.sections
        .filter((section) => section.level === 0 || section.spells.length > 0 || section.slots > 0)
        .map((section) => section.level);
    const slotsOf = (name: string): number[] =>
      layouts.find((layout) => layout.name.startsWith(name))!.sections.map((section) => section.slots);
    // The druid carries the shared circles, its 4th-level band empty but for them.
    expect(levelsOf("Druid")).toEqual([0, 1, 2, 3, 4]);
    expect(slotsOf("Druid")).toEqual([0, 4, 3, 3, 2]);
    expect(layouts.find((layout) => layout.name.startsWith("Druid"))!.sections.at(-1)!.spells).toEqual([]);
    // The sorcerer prints its own levels without circles, its first band
    // pointing to the druid's.
    expect(levelsOf("Sorcerer")).toEqual([0, 1, 2]);
    expect(slotsOf("Sorcerer").every((slots) => slots === 0)).toBe(true);
    const sharedNotes = (name: string) =>
      layouts.find((layout) => layout.name.startsWith(name))!.sections.map((section) => section.sharedSlotsWith);
    expect(sharedNotes("Sorcerer")).toEqual([undefined, "Druid", undefined]);
    expect(sharedNotes("Druid").every((note) => note === undefined)).toBe(true);
    // Magic Initiate (Wizard) casts with Intelligence in both editions, so it
    // keeps its own list rather than joining the Wisdom druid's, and prints
    // no circles.
    const feat = casters.find((caster) => caster.kind === "feature")!;
    expect([feat.name, feat.ability]).toEqual(["Magic Initiate (Wizard)", "Intelligence"]);
    const initiate = layouts.find((layout) => layout.name === "Magic Initiate (Wizard)")!;
    expect(initiate.ability).toBe("Intelligence");
    expect(initiate.sections.map((section) => section.level)).toEqual([0, 1]);
    expect(initiate.sections.every((section) => section.slots === 0)).toBe(true);

    const circles = vi.spyOn(PDFPage.prototype, "drawCircle");
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    const model = buildCharacterSheetModel(service.getCharacter(id), library, {
      mode: "full",
      include: { background: false, notes: false, spellCards: false, itemCards: false },
    });
    await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(edition.ruleset));
    const trackers = circles.mock.calls.filter(([options]) => options?.size === 2.7);
    expect(trackers).toHaveLength(4 + 3 + 3 + 2);
    expect(texts.mock.calls.filter(([text]) => text === "SHARED SLOTS: SEE DRUID")).toHaveLength(1);
  }, 120_000);

  it("marks the sorcerer's known levelled spells, which it never prepares", () => {
    const { service, id } = druidSorcerer(edition);
    const sorcerer = spellLayouts(service, id).find((layout) => layout.name.startsWith("Sorcerer"))!;
    const levelled = sorcerer.sections.filter((section) => section.level > 0).flatMap((section) => section.spells);
    const cantrips = sorcerer.sections.filter((section) => section.level === 0).flatMap((section) => section.spells);
    expect(levelled.map((spell) => spell.name)).toContain("Shatter");
    expect(levelled.every((spell) => spell.prepared)).toBe(true);
    expect(cantrips.every((spell) => !spell.prepared)).toBe(true);
  }, 120_000);
});

describe("cantrips", () => {
  it("are never marked, even a feat's folded into a class list as always prepared", () => {
    const service = freshService(library);
    const id = "ClericAcolyte";
    service.createCharacter(id);
    service.setRulesetMode(id, "2024");
    service.setAbilities(id, ABILITIES);
    select(service, id, "Race", "ID_WOTC_PHB24_RACE_HUMAN");
    select(service, id, "Class", "ID_WOTC_PHB24_CLASS_CLERIC");
    // Acolyte grants Magic Initiate (Cleric); with Wisdom it matches the cleric.
    select(service, id, "Background", "ID_WOTC_PHB24_BACKGROUND_ACOLYTE");
    pickNamed(service, id, "Spellcasting Ability (Magic Initiate)", "ID_WOTC_PHB24_FEAT_FEATURE_MAGIC_INITIATE_CLERIC_WISDOM");
    pickNamed(service, id, "Cantrip (Magic Initiate)", "ID_WOTC_PHB24_SPELL_SACRED_FLAME");
    pickNamed(service, id, "Cantrip (Magic Initiate)", "ID_WOTC_PHB24_SPELL_GUIDANCE");
    pickNamed(service, id, "Level 1 Spell (Magic Initiate)", "ID_WOTC_PHB24_SPELL_CURE_WOUNDS");

    const layouts = spellLayouts(service, id);
    expect(layouts.map((layout) => layout.name)).toEqual([expect.stringMatching(/^Cleric/)]);
    const spells = layouts[0]!.sections.flatMap((section) => section.spells);
    const guidance = spells.find((spell) => spell.name === "Guidance")!;
    expect([guidance.prepared, guidance.alwaysPrepared]).toEqual([false, false]);
    expect(guidance.usage).toBe("[Magic Initiate (Cleric)]");
  }, 120_000);
});

describe("Pact Magic spell list", () => {
  it("prints a Warlock 5's 1st- and 2nd-level spells under its 3rd-level pact slots", () => {
    const service = freshService(library);
    const id = "Warlock5";
    service.createCharacter(id);
    service.setRulesetMode(id, "2024");
    service.setAbilities(id, { ...ABILITIES, charisma: 16 });
    select(service, id, "Race", "ID_WOTC_PHB24_RACE_HUMAN");
    select(service, id, "Class", "ID_WOTC_PHB24_CLASS_WARLOCK");
    pickNamed(service, id, "Spellcasting (Warlock)", "ID_WOTC_PHB24_SPELL_HEX");
    service.levelUp(id);
    service.levelUp(id);
    pickNamed(service, id, "Spellcasting (Warlock)", "ID_WOTC_PHB24_SPELL_MISTY_STEP", 3);
    service.levelUp(id);
    service.levelUp(id);
    pickNamed(service, id, "Spellcasting (Warlock)", "ID_WOTC_PHB24_SPELL_COUNTERSPELL", 5);

    const warlock = spellLayouts(service, id).find((layout) => layout.name.startsWith("Warlock"))!;
    const band = (level: number) => warlock.sections.find((section) => section.level === level);
    expect(band(1)?.spells.map((spell) => spell.name)).toContain("Hex");
    expect(band(2)?.spells.map((spell) => spell.name)).toContain("Misty Step");
    expect(band(3)?.spells.map((spell) => spell.name)).toContain("Counterspell");
    // Only the pact level carries circles.
    expect([band(1)?.slots, band(2)?.slots, band(3)?.slots]).toEqual([0, 0, 2]);
    expect([1, 2, 3].flatMap((level) => band(level)!.spells).every((spell) => spell.prepared)).toBe(true);
  }, 120_000);
});

describe("spell cells", () => {
  const page = (spells: SheetSpellcasterLayout["sections"][number]["spells"]) => ({
    characterId: "Cells", mode: "full" as const, pageCount: 1,
    pages: [{ page: 1, templateKind: "spell-list" as const, sections: [], spellcasting: [{
      name: "Cleric", ability: "Wisdom", attackBonus: "+5", saveDc: "13", prepareCount: "4",
      resource: { mode: "slots" as const, canUseSpellPoints: false },
      sections: [{ level: 1, slots: 0, spells }],
    }] }],
  });

  it.each(["2014", "2024"] as const)("fills the template's bubble for a ready spell on %s", async (set) => {
    const circles = vi.spyOn(PDFPage.prototype, "drawCircle");
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    await writeCharacterSheetPdfWithTemplateBundle(page([
      { name: "Bless", prepared: true, alwaysPrepared: false },
      { name: "Command", prepared: false, alwaysPrepared: false },
      { name: "Sanctuary", prepared: false, alwaysPrepared: true },
    ]), localTemplateBundle(set));
    const { columns, preparedMark } = SHEET_TEMPLATE_CONTRACT.spellList;
    const marks = circles.mock.calls.map(([options]) => options!).filter((options) => options.size === preparedMark.radius);
    // Bless and Command share the level band (columns 1 and 2); Sanctuary opens the next row.
    expect(marks.map((options) => options.x)).toEqual([columns[1]! + preparedMark.dx, columns[0]! + preparedMark.dx]);
    expect(marks.every((options) => options.color !== undefined && options.borderWidth === undefined)).toBe(true);
    expect(texts.mock.calls.some(([text]) => text === "•")).toBe(false);
  });

  it("gives a free-cast marker the width the name leaves before cutting it", async () => {
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(page([
      // Bless in the band's first cell; the long name in the next row's first cell.
      { name: "Bless", prepared: true, alwaysPrepared: false, usage: "[Magic Initiate (Cleric) - 1/Long Rest]" },
      { name: "Command", prepared: true, alwaysPrepared: false },
      { name: "Protection from Evil and Good", prepared: true, alwaysPrepared: false, usage: "[Magic Initiate (Cleric) - 1/Long Rest]" },
    ]), localTemplateBundle("2024"));
    const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const strings = content.items.flatMap((item) => ("str" in item ? [item.str] : []));
    expect(strings.filter((text) => text === "[Magic Initiate (Cleric) - 1 free cast/LR]")).toHaveLength(2);
    expect(strings).toContain("Bless");
    expect(strings).toContain("Protection from Evil and Good");
  });
});
