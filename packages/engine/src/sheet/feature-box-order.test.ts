/**
 * The order of the features box on the character page.
 *
 * The content registers a subclass choice ahead of the class's own features,
 * so the sheet's plain feature order puts the subclass first. The layouts
 * with one combined features box (the standard 2014 and 2024 pages) print the
 * class features, then the subclass features, then the feats, as the grouped
 * layouts do, each group in its usual order. The Resources paragraph, when
 * asked for, still closes the box.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import { freshService, ID, select, sharedLibrary, STANDARD_ARRAY } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { buildCharacterSheetModel, type BuildSheetOptions, type SheetRow } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { DEFAULT_SHEET_FONTS, type SheetTemplateSet } from "./template-contract.js";

const SORCERER_2024 = "ID_WOTC_PHB24_CLASS_SORCERER";
const ABERRANT_SORCERY = "ID_WOTC_PHB24_ARCHETYPE_SORCERER_ABERRANT_SORCERY";
const SPECIES_2024 = "ID_WOTC_PHB24_RACE_AASIMAR";
const BACKGROUND_2024 = "ID_WOTC_PHB24_BACKGROUND_ACOLYTE";
const FEAT_2024 = "ID_WOTC_PHB24_FEAT_SPELLSNIPER";
const BATTLE_MASTER = "ID_WOTC_PHB_ARCHETYPE_FIGHTER_BATTLE_MASTER";
const FEAT_2014 = "ID_PHB_FEAT_ALERT";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
});

/** A 2024 Aberrant Sorcerer 8, the subclass picked at 3 or at 8. */
function sorcerer(id: string, subclassAt: 3 | 8): CharacterState {
  const service = freshService(library);
  service.createCharacter(id);
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, { strength: 8, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 15 });
  select(service, id, "Race", SPECIES_2024);
  select(service, id, "Class", SORCERER_2024);
  select(service, id, "Background", BACKGROUND_2024);
  for (let level = 2; level <= 8; level++) {
    service.levelUp(id);
    if (level === subclassAt) select(service, id, "Archetype", ABERRANT_SORCERY);
  }
  service.addGrantedFeat(id, { featId: FEAT_2024 });
  return service.getCharacter(id);
}

/** A 2014 Battle Master Fighter 7, saved and loaded again. */
function fighter(id: string): CharacterState {
  const service = freshService(library);
  service.createCharacter(id);
  service.setAbilities(id, STANDARD_ARRAY);
  select(service, id, "Race", ID.RACE_DWARF);
  select(service, id, "Sub Race", ID.SUB_RACE_HILL_DWARF);
  select(service, id, "Class", ID.CLASS_FIGHTER);
  for (let level = 2; level <= 7; level++) {
    service.levelUp(id);
    if (level === 3) select(service, id, "Archetype", BATTLE_MASTER);
  }
  service.addGrantedFeat(id, { featId: FEAT_2014 });
  const copy = `${id}-reloaded`;
  service.importCharacterXml(copy, service.exportCharacterXml(id));
  return service.getCharacter(copy);
}

const text = (row: SheetRow): string => row.kind === "tokens" ? row.tokens.join(" ") : row.lines.join(" ");
/** A row's feature title: the text before its first full stop or bracket. */
const title = (row: SheetRow): string => text(row).split(/[.(]/)[0]!.trim();

function box(state: CharacterState, options: Partial<BuildSheetOptions> = {}) {
  const model = buildCharacterSheetModel(state, library, { mode: "full", ...options });
  const page = model.pages.find((entry) => entry.templateKind === "details")!;
  const section = page.sections.find((entry) => entry.title === "features")!;
  const groups = page.featureGroups!;
  return {
    model,
    combined: section.renderRows ?? section.rows,
    rows: section.rows,
    classRows: groups["class-features"]!,
    subclassRows: groups["subclass-features"]!,
    featRows: groups.feats!,
  };
}

const CHARACTERS: ReadonlyArray<readonly [string, () => CharacterState]> = [
  ["a 2024 sorcerer with the subclass picked at 3", () => sorcerer("Sorcerer3", 3)],
  ["a 2024 sorcerer with the subclass picked at 8", () => sorcerer("Sorcerer8", 8)],
  ["a reloaded 2014 fighter", () => fighter("Fighter7")],
];

describe("the combined features box", () => {
  it.each(CHARACTERS)("prints class features, then subclass features, then feats, for %s", (_, build) => {
    const { combined, rows, classRows, subclassRows, featRows } = box(build());
    // Each character has every group, so the order means something.
    expect(classRows.length).toBeGreaterThan(1);
    expect(subclassRows.length).toBeGreaterThan(1);
    expect(featRows.length).toBeGreaterThan(0);
    expect(combined).toEqual([...classRows, ...subclassRows, ...featRows]);
    // The canonical rows and the printed rows agree.
    expect(rows).toEqual(combined);
  });

  it.each(CHARACTERS)("keeps the Resources paragraph last, for %s", (_, build) => {
    const { combined, classRows, subclassRows, featRows } = box(build(), { resourceTrackersList: true, resourceTrackersInline: false });
    const resources = classRows.at(-1)!;
    expect(title(resources)).toBe("Resources");
    expect(combined).toEqual([...classRows.slice(0, -1), ...subclassRows, ...featRows, resources]);
  });

  it("orders the form-fillable Features and Traits field the same way", () => {
    const { model, classRows, subclassRows, featRows } = box(sorcerer("SorcererForm", 3));
    const field = model.formValues?.["Features and Traits"] ?? "";
    const at = (row: SheetRow): number => field.indexOf(text(row));
    const positions = [...classRows, ...subclassRows, ...featRows].map(at);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  // The combined pages draw the box from these rows: the class's first
  // feature prints before the subclass's first, and the feat after both.
  it.each([
    ["2024", () => sorcerer("SorcererPdf", 3)],
    ["2014", () => fighter("FighterPdf")],
  ] as const)("prints the class first on the %s page", async (set: SheetTemplateSet, build) => {
    const { model, classRows, subclassRows, featRows } = box(build());
    const bytes = new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set, DEFAULT_SHEET_FONTS, { split: false })));
    const doc = await getDocument({ data: bytes }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const page = content.items.map((item) => "str" in item ? item.str : "").join(" ");
    const first = (rows: readonly SheetRow[]): number => page.indexOf(title(rows[0]!));
    expect(first(classRows)).toBeGreaterThanOrEqual(0);
    expect(first(classRows)).toBeLessThan(first(subclassRows));
    expect(first(subclassRows)).toBeLessThan(first(featRows));
  });
});

describe("the grouped features boxes", () => {
  it.each(CHARACTERS)("keep each origin's rows and their order, for %s", (_, build) => {
    const { classRows, subclassRows, featRows } = box(build());
    const titles = (rows: readonly SheetRow[]): string[] => rows.map(title);
    // The subclass group holds the subclass's features, not the class's.
    for (const shared of titles(classRows)) expect(titles(subclassRows)).not.toContain(shared);
    for (const shared of titles(featRows)) expect([...titles(classRows), ...titles(subclassRows)]).not.toContain(shared);
  });

  it("splits by origin on the Hybrid page as before", async () => {
    const { model, classRows, subclassRows } = box(sorcerer("SorcererHybrid", 3));
    const bytes = new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle("2024-hybrid")));
    const doc = await getDocument({ data: bytes }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const page = content.items.map((item) => "str" in item ? item.str : "").join(" ");
    expect(page.indexOf(title(classRows[0]!))).toBeLessThan(page.indexOf(title(subclassRows[0]!)));
    expect(page).toContain(title(subclassRows[0]!));
  });
});
