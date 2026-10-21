/**
 * Species Traits on the character page.
 *
 * On the 2024 and Hybrid pages, Species Traits sits over the features box in
 * one column, and the two share it: a short species gives its spare height to
 * the features, a long one borrows from them, and only text the whole column
 * cannot hold continues on a "Features & Traits (continued)" page, under
 * "Species Traits (continued)". Species text shrinks to a 6.5pt floor before
 * it borrows. On every page, the longest species texts print in full.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { freshService, ID, select, sharedLibrary, STANDARD_ARRAY } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { buildCharacterSheetModel, type CharacterSheetModel, type SheetRow } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { SHEET_TEMPLATE_CONTRACT, type SheetTemplateSet } from "./template-contract.js";

const SETS: readonly SheetTemplateSet[] = ["2014", "2024", "2024-hybrid"];
const SHARED_COLUMN_SETS: readonly SheetTemplateSet[] = ["2024", "2024-hybrid"];

interface TextItem { str: string; x: number; y: number; size: number }

async function renderPages(model: CharacterSheetModel, set: SheetTemplateSet): Promise<TextItem[][]> {
  const bytes = new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set)));
  const doc = await getDocument({ data: bytes }).promise;
  const pages: TextItem[][] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    const content = await (await doc.getPage(index)).getTextContent();
    pages.push(content.items.flatMap((item) => "str" in item && item.str.trim() !== ""
      ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, size: Math.abs(item.transform[3] as number) }]
      : []));
  }
  return pages;
}

// A soft hyphen marks where a word may break; the sheet prints the word whole.
const words = (text: string): string[] => text.replace(/­/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
const pageText = (page: readonly TextItem[]): string => page.map((item) => item.str).join(" ");

/** Whether every word of `needle` appears in `haystack`, in order. */
function inOrder(haystack: readonly string[], needle: readonly string[]): { ok: boolean; missing?: string } {
  let at = 0;
  for (const [index, word] of needle.entries()) {
    while (at < haystack.length && haystack[at] !== word) at += 1;
    if (at === haystack.length) return { ok: false, missing: needle.slice(Math.max(0, index - 4), index + 4).join(" ") };
    at += 1;
  }
  return { ok: true };
}

const rowText = (rows: readonly SheetRow[]): string =>
  rows.map((row) => row.kind === "tokens" ? row.tokens.join(" ") : row.lines.join(" ")).join(" ");

// ---------------------------------------------------------------------------
// Synthetic models: the shared column's behaviour without any content.
// ---------------------------------------------------------------------------

const prose = (label: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${label}${index}`).join(" ");

function syntheticModel(racial: readonly string[], features: readonly string[]): CharacterSheetModel {
  const lines = (texts: readonly string[]): SheetRow[] => texts.map((text) => ({ kind: "lines", lines: [text] }));
  return {
    characterId: "Synthetic species", mode: "lite", pageCount: 1,
    pages: [{
      page: 1, templateKind: "details",
      sections: [
        { title: "racial-traits", rows: lines(racial) },
        { title: "features", rows: lines(features) },
      ],
      featureGroups: { "class-features": lines(features), "subclass-features": [], feats: [] },
    }],
  } as CharacterSheetModel;
}

const CONTINUED = "Species Traits (continued)";

describe.each(SHARED_COLUMN_SETS)("the %s page's shared species and features column", (set) => {
  it("holds long species text without a continuation page while the features leave room", async () => {
    const racial = ["Longtrait. " + prose("sp", 220), "Second. " + prose("sq", 60)];
    const pages = await renderPages(syntheticModel(racial, ["Short. One feature."]), set);
    expect(pages).toHaveLength(1);
    const found = inOrder(words(pageText(pages[0]!)), words(racial.join(" ")));
    expect(found.ok, found.missing).toBe(true);
  });

  it("shrinks species text no further than 6.5pt", async () => {
    const pages = await renderPages(syntheticModel(["Longtrait. " + prose("sp", 260)], ["Short. One feature."]), set);
    const species = pages[0]!.filter((item) => /^sp\d/.test(item.str) || item.str.startsWith("Longtrait"));
    expect(species.length).toBeGreaterThan(0);
    for (const item of species) expect(item.size).toBeGreaterThanOrEqual(6.5 - 0.01);
  });

  it("gives a short species' spare height to the features", async () => {
    const pages = await renderPages(syntheticModel(["Brief. One line of trait."], ["Opening. " + prose("ft", 20)]), set);
    // The features box's title moves with the boundary: a one-line species
    // lifts it above where the printed Species Traits frame ends.
    const title = pages[0]!.find((item) => /^(CLASS )?FEATURES$/.test(item.str));
    const column = SHEET_TEMPLATE_CONTRACT.traitsColumn;
    const speciesBottom = column.top - column.speciesHeight[set as keyof typeof column.speciesHeight];
    expect(title?.y).toBeGreaterThan(speciesBottom);
    const opening = pages[0]!.find((item) => item.str.startsWith("Opening"));
    expect(opening?.y).toBeLessThan(title!.y);
  });

  it("continues only what the whole column cannot hold, species under its own heading", async () => {
    const racial = ["Longtrait. " + prose("sp", 700)];
    const features = ["Bigfeature. " + prose("ft", 900)];
    const pages = await renderPages(syntheticModel(racial, features), set);
    expect(pages.length).toBeGreaterThan(1);
    const continued = pages.slice(1).map(pageText).join(" ");
    expect(continued).toContain(CONTINUED);
    const all = words(pages.map(pageText).join(" "));
    for (const text of [racial[0]!, features[0]!]) {
      const found = inOrder(all, words(text));
      expect(found.ok, found.missing).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Real species: the longest trait texts in both rulesets, on every page.
// ---------------------------------------------------------------------------

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

interface Species { ruleset: "2014" | "2024"; label: string; race: string; subRace?: string }

const SPECIES: readonly Species[] = [
  { ruleset: "2014", label: "Aasimar", race: "ID_WOTC_VGTM_RACE_AASIMAR", subRace: "ID_WOTC_VGTM_SUB_RACE_Scourge_AASIMAR" },
  { ruleset: "2014", label: "Hexblood", race: "ID_WOTC_VRGTR_RACE_HEXBLOOD" },
  { ruleset: "2014", label: "Goliath", race: "ID_WOTC_VGTM_RACE_GOLIATH" },
  { ruleset: "2014", label: "Dragonborn", race: "ID_RACE_DRAGONBORN" },
  { ruleset: "2024", label: "Aasimar", race: "ID_WOTC_PHB24_RACE_AASIMAR" },
  { ruleset: "2024", label: "Goliath", race: "ID_WOTC_PHB24_RACE_GOLIATH" },
  { ruleset: "2024", label: "Dragonborn", race: "ID_WOTC_PHB24_RACE_DRAGONBORN" },
];

/** Resolves every open species choice with its wordiest option, the worst case for the box. */
function resolveSpeciesChoices(service: CharacterService, id: string): void {
  for (let pass = 0; pass < 6; pass++) {
    const state = service.getCharacter(id);
    const rule = pendingSelectionRules(state).find((candidate) => ["Racial Trait", "Sub Race"].includes(candidate.type));
    if (rule === undefined) return;
    const options = selectionOptions(state, library, rule);
    const wordiest = [...options].sort((left, right) =>
      (library.byId.get(right.id)?.descriptionXml?.length ?? 0) - (library.byId.get(left.id)?.descriptionXml?.length ?? 0))[0];
    if (wordiest === undefined) return;
    service.setSelection(id, rule.identifier, wordiest.id);
  }
}

function speciesFighter(species: Species): CharacterSheetModel {
  const service = freshService(library);
  const id = `${species.label}${species.ruleset}`;
  service.createCharacter(id);
  service.setAbilities(id, STANDARD_ARRAY);
  if (species.ruleset === "2024") service.setRulesetMode(id, "2024");
  select(service, id, "Race", species.race);
  if (species.subRace !== undefined) select(service, id, "Sub Race", species.subRace);
  select(service, id, "Class", species.ruleset === "2024" ? "ID_WOTC_PHB24_CLASS_FIGHTER" : ID.CLASS_FIGHTER);
  for (let level = 2; level <= 5; level++) service.levelUp(id);
  resolveSpeciesChoices(service, id);
  return buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", include: { background: false, notes: false, spellCards: false, itemCards: false } });
}

describe.each(SPECIES)("$ruleset $label's species traits", (species) => {
  it.each(SETS)("print in full on the %s page, continued only where the column has no room", async (set) => {
    const model = speciesFighter(species);
    const details = model.pages.find((page) => page.templateKind === "details")!;
    const racial = rowText(details.sections.find((section) => section.title === "racial-traits")!.rows);
    expect(words(racial).length).toBeGreaterThan(20);
    const pages = await renderPages(model, set);
    const found = inOrder(words(pages.map(pageText).join(" ")), words(racial));
    expect(found.ok, found.missing).toBe(true);
    if (SHARED_COLUMN_SETS.includes(set)) {
      expect(pages.map(pageText).join(" ")).not.toContain(CONTINUED);
    }
  }, 60_000);
});
