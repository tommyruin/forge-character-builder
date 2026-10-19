import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFCheckBox, PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { templateFontSize } from "./pdf.js";
import { sheetFaces } from "./templates.js";
import {
  DEFAULT_SHEET_FONTS,
  SHEET_FONT_FACES,
  SHEET_FONT_FACE_NAMES,
  SHEET_LAYOUT_DEFAULTS,
  SHEET_TEMPLATE_CONTRACT,
  SHEET_TEMPLATE_SETS,
  resolveSheetLayout,
  sheetDetailsFile,
  sheetLayoutVariants,
  type SheetLabel,
  type SheetTemplateLabels,
  type SheetTemplateSet,
} from "./template-contract.js";

const SHEETS = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..", "apps", "client", "public", SHEET_TEMPLATE_CONTRACT.directory);

/** A set's character pages: its own, then every layout variant. */
function detailsFilesOf(set: SheetTemplateSet): string[] {
  return [SHEET_TEMPLATE_CONTRACT.files.details, ...sheetLayoutVariants(set).map((variant) => variant.file)];
}

/** Every set's character pages, as [set, file] pairs. */
const DETAILS_PAGES = SHEET_TEMPLATE_SETS.flatMap((set) => detailsFilesOf(set).map((file) => [set, file] as const));

/** The layout switches a set's character page `file` prints. */
function layoutOf(set: SheetTemplateSet, file: string) {
  return file === SHEET_TEMPLATE_CONTRACT.files.details
    ? SHEET_LAYOUT_DEFAULTS[set]
    : sheetLayoutVariants(set).find((variant) => variant.file === file)!.layout;
}

/** Each page with split away from its set's default, beside the page that differs from it only in split. */
function sheetLayoutVariantPairs(): Array<readonly [SheetTemplateSet, string, string]> {
  return SHEET_TEMPLATE_SETS.flatMap((set) => sheetLayoutVariants(set)
    .filter((variant) => variant.layout.split !== SHEET_LAYOUT_DEFAULTS[set].split)
    .map((variant) => [set, variant.file, sheetDetailsFile(set, { ...variant.layout, split: SHEET_LAYOUT_DEFAULTS[set].split })] as const));
}

/** Every full-page template of a set, layout variants included, with its labels and widget rectangles. */
async function pagesOf(set: SheetTemplateSet) {
  const labels = JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;
  const files = [
    ...detailsFilesOf(set),
    SHEET_TEMPLATE_CONTRACT.files.background,
    SHEET_TEMPLATE_CONTRACT.files.companion,
    SHEET_TEMPLATE_CONTRACT.files.equipment,
  ];
  return Promise.all(files.map(async (file) => {
    const document = await PDFDocument.load(readFileSync(join(SHEETS, set, file)));
    const widgets = document.getForm().getFields().flatMap((field) => {
      const rect = field.acroField.getWidgets()[0]?.getRectangle();
      return rect === undefined ? [] : [{ name: field.getName(), rect }];
    });
    return { file, widgets, text: labels[file] };
  }));
}

describe("sheet template geometry", () => {
  it.each(DETAILS_PAGES)("provides six printable exhaustion markers on %s/%s", async (set, file) => {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm();
    expect(form.getFields().filter((field) => /^details_exhaustion_[1-6]$/.test(field.getName()))).toHaveLength(6);
  });

  // A panel title printed inside a panel's top edge lands on body content that
  // was laid out for a title at the foot. Both sets label at the foot; this
  // keeps them there.
  it.each([...SHEET_TEMPLATE_SETS])("keeps every panel title off the fields on the %s pages", async (set) => {
    const collisions: string[] = [];
    for (const { file, widgets, text } of await pagesOf(set)) {
      for (const label of text?.labels ?? []) {
        if (label.font !== "titles") continue;
        // The masthead's die mark is drawn over its own badge by design.
        const width = label.text.length * label.size * 0.75;
        const left = label.align === "center" ? label.x + ((label.width ?? 0) - width) / 2 : label.x;
        for (const widget of widgets) {
          if (widget.name === SHEET_TEMPLATE_CONTRACT.masthead.field) continue;
          const overlaps = left < widget.rect.x + widget.rect.width && left + width > widget.rect.x &&
            label.y < widget.rect.y + widget.rect.height && label.y + label.size > widget.rect.y;
          if (overlaps) collisions.push(`${file}: "${label.text}" over ${widget.name}`);
        }
      }
    }
    expect(collisions).toEqual([]);
    // Every page of the set, layout variants included: slow under the coverage pass.
  }, 30_000);

  // The edition label is how a printed page says which rules it was laid out
  // for; a page without one reads as the other edition's sheet. The 2024
  // Hybrid set lays 2024 rules out on the classic ability column, so its pages
  // say 2024.
  const RULES_EDITION: Record<string, string> = { "2014": "2014", "2024": "2024", "2024-hybrid": "2024" };
  it.each([...SHEET_TEMPLATE_SETS])("labels every %s page with its edition", async (set) => {
    expect(RULES_EDITION[set], set).toBeDefined();
    const missing: string[] = [];
    for (const { file, text } of await pagesOf(set)) {
      if (!(text?.labels ?? []).some((label) => label.text === `${RULES_EDITION[set]} RULES`)) missing.push(file);
    }
    expect(missing).toEqual([]);
    // Every page of the set, layout variants included: slow under the coverage pass.
  }, 30_000);

  // The hybrid character page is the 2024 page with a different ability
  // arrangement: the writer fills it from the same values, so it carries
  // every 2024 field. Split, its features stay in one box, which the writer
  // heads by origin, so it has no other feature boxes.
  const fieldNames = async (set: SheetTemplateSet, file: string = SHEET_TEMPLATE_CONTRACT.files.details) =>
    new Set((await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm().getFields().map((field) => field.getName()));
  it("gives the 2024 Hybrid character page every 2024 field and one feature box", async () => {
    const modern = await fieldNames("2024");
    const hybrid = await fieldNames("2024-hybrid");
    expect([...modern].filter((name) => !hybrid.has(name))).toEqual([]);
    expect([...hybrid].filter((name) => !modern.has(name))).toEqual([]);
    for (const name of ["details_subclass_features", "details_feats"]) expect(hybrid.has(name), name).toBe(false);
  });

  // The same layout switches on both pages give the same fields, so a value
  // the writer fills on one is never lost on the other: the split 2024 page
  // matches Hybrid's own, and the unsplit Hybrid page matches 2024's own.
  it("keeps the 2024 and Hybrid pages' fields in step for each layout choice", async () => {
    for (const readable of [false, true]) {
      for (const top of [false, true]) {
        for (const split of [true, false]) {
          const modern = sheetDetailsFile("2024", resolveSheetLayout("2024", { top, split, readable }));
          const hybrid = sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { top, split, readable }));
          expect([...await fieldNames("2024", modern)].sort(), `top ${top} split ${split} readable ${readable}`).toEqual([...await fieldNames("2024-hybrid", hybrid)].sort());
        }
      }
    }
    // Sixteen pages loaded: slow under the coverage pass.
  }, 30_000);

  // The split switch changes the feature boxes and nothing else: each page
  // with it away from the set's default matches the page with the same other
  // switches and the default split.
  it.each(sheetLayoutVariantPairs())(
    "changes only the feature boxes on %s/%s against %s",
    async (set, file, reference) => {
      const featureBoxes = new Set(["details_features", "details_subclass_features", "details_feats"]);
      const rects = async (name: string) => new Map((await PDFDocument.load(readFileSync(join(SHEETS, set, name)))).getForm().getFields()
        .filter((field) => !featureBoxes.has(field.getName()))
        .map((field) => [field.getName(), field.acroField.getWidgets()[0]?.getRectangle()]));
      expect(await rects(file)).toEqual(await rects(reference));
    },
  );

  const TOP_2024 = DETAILS_PAGES.filter(([set, file]) => set !== "2014" && layoutOf(set, file).top);
  it("has a compact top row page for every set and split choice", () => {
    // The 2024 pages' own top row is the compact one.
    expect(TOP_2024.map(([set, file]) => `${set}/${file}`)).toEqual([
      "2024/details.pdf", "2024/details~split.pdf", "2024/details~readable.pdf", "2024/details~split.readable.pdf",
      "2024-hybrid/details.pdf", "2024-hybrid/details~unsplit.pdf", "2024-hybrid/details~readable.pdf", "2024-hybrid/details~unsplit.readable.pdf",
    ]);
    expect(DETAILS_PAGES.filter(([set, file]) => set === "2014" && file.includes("~top")).map(([, file]) => file))
      .toEqual(["details~top.pdf", "details~top.split.pdf", "details~top.readable.pdf", "details~top.split.readable.pdf"]);
  });

  // The compact top row reads the defences first: armor class in one box
  // with the armor, its marks and the resistances, then hit points lost and
  // hit dice spent. The death saves join the vitals beneath.
  it.each(TOP_2024)("lays armor class, hit points and hit dice out in one row on %s/%s", async (set, file) => {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm();
    const classic = (await PDFDocument.load(readFileSync(join(SHEETS, set, sheetDetailsFile(set, { ...layoutOf(set, file), top: false }))))).getForm();
    const names = new Set(form.getFields().map((field) => field.getName()));
    const rectIn = (source: typeof form, name: string) => source.getFields().find((field) => field.getName() === name)!.acroField.getWidgets()[0]!.getRectangle();
    const rect = (name: string) => rectIn(form, name);
    const row = ["details_armor_class", "details_equipped_armor", "details_hp_current", "details_hd"].map(rect);
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index]!.x, `column ${index}`).toBeGreaterThan(row[index - 1]!.x + row[index - 1]!.width);
    }
    // One row: the numbers share a horizontal band.
    const numbers = [row[0]!, row[2]!, row[3]!];
    const bottom = Math.max(...numbers.map((box) => box.y));
    const top = Math.min(...numbers.map((box) => box.y + box.height));
    expect(top).toBeGreaterThan(bottom);

    // The armor box: armor, other AC sources and resistances beside the
    // armor class, the shield and stealth ticks along its foot.
    const ac = rect("details_armor_class");
    for (const name of ["details_equipped_armor", "details_armor_resistances", "details_shield_equipped", "details_armor_stealth_disadvantage"]) {
      const box = rect(name);
      expect(box.x, name).toBeGreaterThanOrEqual(ac.x + ac.width);
      expect(box.x + box.width, name).toBeLessThan(rect("details_hp_current").x);
      expect(box.y, name).toBeGreaterThan(ac.y - 20);
    }
    expect(form.getField("details_shield_equipped")).toBeInstanceOf(PDFCheckBox);
    expect(names.has("details_equipped_shield")).toBe(false);

    // Hit dice: the maximum over a write-in for the dice spent.
    expect(names.has("details_hd_spent")).toBe(true);

    // The identity reads as separate labelled fields; XP is one of them.
    expect(names.has("details_build")).toBe(false);
    for (const name of ["details_species", "details_class", "details_level", "details_background", "details_xp"]) expect(names.has(name), name).toBe(true);
    expect(rect("details_xp").height).toBeLessThanOrEqual(12);

    // Proficiency bonus, initiative and passive perception take smaller boxes
    // than the classic header's, and the death saves sit among them.
    for (const name of ["details_proficiency_bonus", "details_initiative", "details_passive_perception_total"]) {
      expect(rect(name).width, name).toBeLessThan(rectIn(classic, name).width);
      expect(rect(name).height, name).toBeLessThan(rectIn(classic, name).height);
    }
    const vitals = rect("details_proficiency_bonus");
    const save = rect("details_death_save_success_1");
    expect(save.y + save.height).toBeLessThan(ac.y);
    expect(save.y).toBeGreaterThan(vitals.y - 10);

    // Speed: the walking speed large on the left, the other modes on lines of their own to its right.
    const walking = rect("details_speed_walking");
    const modes = ["details_speed_fly", "details_speed_climb", "details_speed_swim"].map(rect);
    for (const mode of modes) expect(mode.x).toBeGreaterThanOrEqual(walking.x + walking.width);
    expect(new Set(modes.map((mode) => mode.x)).size).toBe(1);
    expect(modes[0]!.y).toBeGreaterThan(modes[1]!.y);
    expect(modes[1]!.y).toBeGreaterThan(modes[2]!.y);
  });

  it.each(TOP_2024)("labels the compact identity plainly on %s/%s", async (set, file) => {
    const labels = JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;
    const texts = labels[file]!.labels.map((label) => label.text);
    for (const caption of ["SPECIES", "CLASS", "LEVEL", "BACKGROUND", "XP", "SHIELD", "MAX", "SPENT"]) expect(texts, caption).toContain(caption);
    expect(texts).not.toContain("SPECIES & BACKGROUND");
    expect(texts).not.toContain("CLASS & LEVEL");
  });

  it.each(DETAILS_PAGES.filter(([set, file]) => set === "2014" && file.includes("~top")))(
    "puts initiative beside the proficiency bonus and splits the hit dice on %s/%s",
    async (set, file) => {
      const form = (await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm();
      const rect = (name: string) => form.getFields().find((field) => field.getName() === name)!.acroField.getWidgets()[0]!.getRectangle();
      const bonus = rect("details_proficiency_bonus");
      const initiative = rect("details_initiative");
      // Side by side on one line.
      expect(Math.abs((initiative.y + initiative.height / 2) - (bonus.y + bonus.height / 2))).toBeLessThan(2);
      expect(Math.abs(initiative.x - (bonus.x + bonus.width))).toBeLessThan(40);
      expect(form.getField("details_initiative_advantage")).toBeInstanceOf(PDFCheckBox);
      const advantage = rect("details_initiative_advantage");
      expect(Math.abs(advantage.y - initiative.y)).toBeLessThan(20);
      const max = rect("details_hd");
      const spent = rect("details_hd_spent");
      expect(Math.abs(max.y - spent.y)).toBeLessThan(2);
      expect(spent.x).toBeGreaterThanOrEqual(max.x + max.width);
      // The rest of the 2014 page keeps its place, the shield caption included.
      expect(form.getFields().some((field) => field.getName() === "details_equipped_shield")).toBe(true);
      expect(form.getFields().some((field) => field.getName() === "details_build")).toBe(true);
    },
  );

  // The companion page shares the hit point box, and keeps its single hit dice field.
  it.each([...SHEET_TEMPLATE_SETS])("leaves the %s companion's hit dice whole", async (set) => {
    const names = (await PDFDocument.load(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.files.companion)))).getForm().getFields().map((field) => field.getName());
    expect(names).toContain("companion_hd");
    expect(names.filter((name) => name.startsWith("companion_hd"))).toEqual(["companion_hd"]);
  });

  it("sizes every field from its own default appearance", async () => {
    for (const set of SHEET_TEMPLATE_SETS) {
      for (const { file, widgets } of await pagesOf(set)) {
        const document = await PDFDocument.load(readFileSync(join(SHEETS, set, file)));
        for (const field of document.getForm().getFields()) {
          if (widgets.find((widget) => widget.name === field.getName()) === undefined) continue;
          const size = templateFontSize(field.acroField.getDefaultAppearance());
          if (size === undefined) continue;
          expect(size, `${set}/${file} ${field.getName()}`).toBeGreaterThan(0);
        }
      }
    }
    // Every page of every set, variants included: well past 5 seconds under
    // the coverage pass, which is not what this test measures.
  }, 30_000);

  // A 2024 weapon's notes cell carries the whole property list, and since the
  // "Mastery: <Name>" suffix was added it never fits one line. That cell — and
  // only that cell — wraps into the band under its row, so it has to stay
  // taller than the rest of the row, sit where its first line reads as level
  // with the row, and clear both the row above and the panel's own free-text
  // note. A single-line cell here clips the second line in half.
  //
  // 86pt wide or more is what prints the longest 2024 property list ("Reach,
  // Special, Special Lance, Heavy, Mastery: Topple") at the full 6pt in every
  // body face — a 66pt column drove it down to 4.75pt. 21pt tall is the row
  // pitch, and the shortest cell that holds three wrapped lines at the
  // writer's 4.5pt floor, so a hand-written note wraps rather than clipping.
  //
  // The cell's top is 0.9pt proud of the row's, because the writer places the
  // two kinds of line differently: a single-line value is centred on its box by
  // cap height, a wrapped cell's first baseline is a fixed `top - 2 - size`
  // inset. Sharing the top left the note visibly low; pdf.test.ts measures
  // what the 0.9pt buys.
  it.each(DETAILS_PAGES.filter(([set]) => set !== "2014"))("gives the 2024 attack notes a wrapping cell that clears its neighbours on %s/%s", async (set, file) => {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm();
    const rectOf = (name: string) => form.getTextField(name).acroField.getWidgets()[0]!.getRectangle();
    const freeText = rectOf("details_attack_description");
    expect(form.getTextField("details_attack_description").isMultiline()).toBe(true);
    // Five rows, under column captions on a 193 baseline.
    expect(form.getFields().filter((field) => /^details_attack\d+_weapon$/.test(field.getName()))).toHaveLength(5);
    for (let row = 1; row <= 5; row += 1) {
      const name = `details_attack${row}_description`;
      const notes = rectOf(name);
      const weapon = rectOf(`details_attack${row}_weapon`);
      expect(form.getTextField(name).isMultiline(), name).toBe(true);
      expect(notes.width, name).toBeGreaterThanOrEqual(86);
      expect(notes.height, name).toBe(21);
      expect(notes.y + notes.height, name).toBeCloseTo(weapon.y + weapon.height + 0.9, 5);
      if (row > 1) expect(notes.y + notes.height, name).toBeLessThanOrEqual(rectOf(`details_attack${row - 1}_description`).y);
      expect(freeText.y + freeText.height, name).toBeLessThanOrEqual(notes.y);
      expect(notes.y + notes.height, name).toBeLessThan(193);
      expect(notes.x + notes.width, name).toBeLessThanOrEqual(582);
    }
    // The free-text note is the user's own prose and the attacks without a
    // row: two lines' worth of box, inside the panel, under the last row.
    expect(freeText.height).toBeGreaterThanOrEqual(20);
    expect(freeText.y).toBeGreaterThanOrEqual(62);
    expect(freeText.x + freeText.width).toBeLessThanOrEqual(582);
  });

  // The 2014 page prints the same text on a wide line of its own, which fits;
  // it must not pick up the 2024 page's wrapping cell.
  // The readable page has six rows, each with its own notes line.
  it.each([
    [SHEET_TEMPLATE_CONTRACT.files.details, 4],
    ...DETAILS_PAGES.filter(([set, file]) => set === "2014" && file.includes("readable")).map(([, file]) => [file, 6] as const),
  ] as const)("leaves the 2014 attack notes on their own single line on %s, %i rows", async (file, rows) => {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, "2014", file)))).getForm();
    const rectOf = (name: string) => form.getTextField(name).acroField.getWidgets()[0]!.getRectangle();
    const names = form.getFields().map((field) => field.getName());
    expect(names.filter((name) => /^details_attack\d+_weapon$/.test(name))).toHaveLength(rows);
    for (let row = 1; row <= rows; row += 1) {
      const field = form.getTextField(`details_attack${row}_description`);
      expect(field.isMultiline(), `row ${row}`).toBe(false);
      expect(rectOf(`details_attack${row}_description`).width, `row ${row}`).toBeGreaterThan(300);
      // Each notes line sits under its own row and clears the next row's values.
      const notes = rectOf(`details_attack${row}_description`);
      expect(notes.y + notes.height, `row ${row}`).toBeLessThanOrEqual(rectOf(`details_attack${row}_weapon`).y);
      if (row < rows) expect(notes.y, `row ${row}`).toBeGreaterThanOrEqual(rectOf(`details_attack${row + 1}_weapon`).y + rectOf(`details_attack${row + 1}_weapon`).height - 0.5);
    }
    // The free-text notes keep a box of their own under the last row.
    const free = rectOf("details_attack_description");
    expect(free.y + free.height).toBeLessThanOrEqual(rectOf(`details_attack${rows}_description`).y);
    expect(free.height).toBeGreaterThanOrEqual(20);
  });

  it.each(DETAILS_PAGES.filter(([set]) => set !== "2014"))("gives the big numbers a size that suits their box on %s/%s", async (set, file) => {
    const document = await PDFDocument.load(readFileSync(join(SHEETS, set, file)));
    const sizeOf = (name: string) => templateFontSize(document.getForm().getTextField(name).acroField.getDefaultAppearance());
    for (const name of ["details_proficiency_bonus", "details_initiative", "details_passive_perception_total", "details_hd"]) {
      expect(sizeOf(name), name).toBeGreaterThanOrEqual(14);
    }
  });
});

/** A page's text fields: rectangle, size and multiline flag by name. */
async function fieldsOf(set: SheetTemplateSet, file: string) {
  const form = (await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm();
  const rect = (name: string) => form.getFields().find((field) => field.getName() === name)?.acroField.getWidgets()[0]?.getRectangle();
  const size = (name: string) => templateFontSize(form.getTextField(name).acroField.getDefaultAppearance());
  const has = (name: string) => form.getFields().some((field) => field.getName() === name);
  return { form, rect: (name: string) => rect(name)!, size, has, multiline: (name: string) => form.getTextField(name).isMultiline() };
}
const top = (box: { y: number; height: number }) => box.y + box.height;
const right = (box: { x: number; width: number }) => box.x + box.width;

describe("the 2024 body", () => {
  const PAGES_2024 = DETAILS_PAGES.filter(([set]) => set !== "2014");

  // Armor class and what makes it up are read together, before the hit
  // points: the armor, other AC sources, the stealth mark and the
  // resistances sit right beside the AC, in the compact top row's armor box
  // or the classic header's armor frame.
  it.each(PAGES_2024)("puts the armor and resistances beside the armor class on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const ac = page.rect("details_armor_class");
    // The stealth mark ends a line of ticks, further along.
    for (const [name, most] of [["details_equipped_armor", 20], ["details_armor_resistances", 20], ["details_armor_stealth_disadvantage", 60]] as const) {
      const box = page.rect(name);
      const gap = box.x >= right(ac) ? box.x - right(ac) : ac.x - right(box);
      expect(gap, name).toBeGreaterThanOrEqual(0);
      expect(gap, name).toBeLessThan(most);
      expect(box.y, name).toBeGreaterThan(ac.y - 40);
      expect(top(box), name).toBeLessThan(top(ac) + 50);
    }
    expect(page.has("details_encounter_box")).toBe(false);
    // One box holds the other AC sources and the resistances.
    for (const name of ["details_armor_conditional", "details_resistances"]) expect(page.has(name), name).toBe(false);
  });

  // Species traits over the features, five weapon rows along the foot, and
  // the features taking all the height between: split, they stay one box.
  it.each(PAGES_2024)("gives the features the room between the species traits and the weapons on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const traits = page.rect("details_additional_notes");
    const features = page.rect("details_features");
    const firstRow = page.rect("details_attack1_description");
    expect(page.has("details_subclass_features")).toBe(false);
    expect(page.has("details_feats")).toBe(false);
    expect(traits.y).toBeGreaterThan(top(features));
    expect(features.y).toBeGreaterThan(top(firstRow));
    expect(Math.abs(traits.x - features.x)).toBeLessThan(1);
    expect(traits.width).toBeGreaterThanOrEqual(300);
    expect(traits.height).toBeLessThan(70);
    expect(features.height).toBeGreaterThanOrEqual(290);
    expect(page.has("details_attack5_weapon")).toBe(true);
    expect(page.has("details_attack6_weapon")).toBe(false);
  });

  // A single-line value that cannot fit at the writer's 4.5pt floor wraps
  // inside its one-line box and loses its second line, so the narrow cells
  // hold the longest values they take at 5pt or more: a flying speed, and a
  // ranged weapon's range with its ammunition.
  it.each(PAGES_2024)("fits the longest speed and range values at 5pt or more on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const samples: Array<readonly [string, string]> = [
      ["details_speed_fly", "120ft."], ["details_speed_climb", "120ft."], ["details_speed_swim", "120ft."],
      ...[1, 2, 3, 4, 5].map((row) => [`details_attack${row}_range`, "30/120; Bullet"] as const),
    ];
    for (const [name, value] of samples) {
      const fitted = Math.min(page.size(name)!, (page.rect(name).width - 4) / helvetica.widthOfTextAtSize(value, 1));
      expect(fitted, name).toBeGreaterThanOrEqual(5);
    }
  });

  // D&D Beyond's 2024 block: the modifier is the large number, the score a
  // small box beside it (2024) or in the shield's roundel (Hybrid).
  it.each(PAGES_2024)("makes the modifier the focal number on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
      const modifier = page.rect(`details_${key}_modifier`);
      const score = page.rect(`details_${key}_score`);
      expect(page.size(`details_${key}_modifier`)!, key).toBeGreaterThan(page.size(`details_${key}_score`)!);
      expect(modifier.width * modifier.height, key).toBeGreaterThan(score.width * score.height);
      if (set === "2024") expect(score.x, key).toBeGreaterThanOrEqual(right(modifier) - 1);
      else expect(top(score), key).toBeLessThanOrEqual(modifier.y);
    }
  });
});

describe("the readable body", () => {
  const READABLE_2024 = DETAILS_PAGES.filter(([set, file]) => set !== "2014" && file.includes("readable"));
  const READABLE_2014 = DETAILS_PAGES.filter(([set, file]) => set === "2014" && file.includes("readable"));
  /** The page `file` would be without the readable switch. */
  const plainOf = (set: SheetTemplateSet, file: string) => {
    const variant = sheetLayoutVariants(set).find((candidate) => candidate.file === file)!;
    return sheetDetailsFile(set, { ...variant.layout, readable: false });
  };

  it("has a readable page for every set and combination of the other switches", () => {
    expect(READABLE_2024.map(([set, file]) => `${set}/${file}`)).toEqual([
      "2024/details~readable.pdf", "2024/details~split.readable.pdf", "2024/details~untop.readable.pdf", "2024/details~untop.split.readable.pdf",
      "2024-hybrid/details~readable.pdf", "2024-hybrid/details~unsplit.readable.pdf", "2024-hybrid/details~untop.readable.pdf", "2024-hybrid/details~untop.unsplit.readable.pdf",
    ]);
    expect(READABLE_2014.map(([, file]) => file)).toEqual([
      "details~readable.pdf", "details~split.readable.pdf", "details~top.readable.pdf", "details~top.split.readable.pdf",
    ]);
  });

  // The free-text attack note under the weapons is the user's own prose and
  // the attacks that did not get a row: two lines at 7pt or more.
  it.each(READABLE_2024)("gives the more attacks note a taller wrapping cell on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const note = page.rect("details_attack_description");
    expect(page.multiline("details_attack_description")).toBe(true);
    expect(page.size("details_attack_description")).toBeGreaterThanOrEqual(7);
    expect(page.size("details_attack_description")).toBeGreaterThan((await fieldsOf(set, plainOf(set, file))).size("details_attack_description")!);
    expect(note.height).toBeGreaterThanOrEqual(20);
    expect(top(note)).toBeLessThanOrEqual(page.rect("details_attack5_description").y);
  });

  it.each(READABLE_2024)("raises the small captions on %s/%s", async (set, file) => {
    const labels = loadLabels(set);
    const sizeOf = (page: string, text: string) => labels[page]!.labels.filter((label) => label.text === text).map((label) => label.size);
    const captions = ["CURRENT", "TEMP", "EXHAUSTION", "SAVING THROW NOTES", ...(set === "2024" ? ["MODIFIER", "SCORE", "SAVING THROW"] : [])];
    for (const caption of captions) {
      const sizes = sizeOf(file, caption);
      const plain = sizeOf(plainOf(set, file), caption);
      expect(sizes.length, caption).toBeGreaterThan(0);
      expect(sizes.length, caption).toBe(plain.length);
      sizes.forEach((size, index) => expect(size, caption).toBeGreaterThan(plain[index]!));
    }
  });

  it.each(READABLE_2014)("raises the small captions on %s/%s", async (set, file) => {
    const labels = JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;
    const sizeOf = (page: string, text: string) => labels[page]!.labels.filter((label) => label.text === text).map((label) => label.size);
    for (const caption of ["STRENGTH", "DEXTERITY", "CONSTITUTION", "INTELLIGENCE", "WISDOM", "CHARISMA", "AC", "SPEED", "FLY", "CLIMB", "SWIM", "SUCCESSES", "FAILURES"]) {
      const sizes = sizeOf(file, caption);
      expect(sizes, caption).toHaveLength(1);
      expect(sizes[0], caption).toBeGreaterThanOrEqual(5.5);
      expect(sizes[0], caption).toBeLessThanOrEqual(7);
      expect(sizes[0], caption).toBeGreaterThan(sizeOf(plainOf(set, file), caption)[0]!);
    }
  });

  it.each(READABLE_2014)("spreads the skills over the room the saving throws gave up on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const plain = await fieldsOf(set, plainOf(set, file));
    const skills = ["acrobatics", "animalhandling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation",
      "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleightofhand", "stealth", "survival"];
    const rows = skills.map((skill) => page.rect(`details_${skill}_total`).y);
    for (let index = 1; index < rows.length; index += 1) expect(rows[index - 1]! - rows[index]!, skills[index]).toBeGreaterThanOrEqual(11.2);
    expect(rows[0]! - rows[1]!).toBeGreaterThan(plain.rect("details_acrobatics_total").y - plain.rect("details_animalhandling_total").y);
    // The saving throws keep their six rows and a notes line, in a shorter box.
    const saves = ["str", "dex", "con", "int", "wis", "cha"].map((key) => page.rect(`details_${key}_save_total`));
    const notes = page.rect("details_saving_throws");
    expect(top(notes)).toBeLessThanOrEqual(saves[5]!.y);
    expect(notes.y).toBeGreaterThan(plain.rect("details_saving_throws").y);
    expect(notes.height).toBeGreaterThanOrEqual(8);
    expect(top(page.rect("details_acrobatics_total"))).toBeLessThan(notes.y - 10);
  });
});

/**
 * Every face a reader may pick for captions, embedded for measuring. The
 * writer draws a caption at the size labels.json gives it in whichever of
 * these is chosen, and never shrinks it to fit.
 */
let captionFacesPromise: Promise<Array<{ name: string; font: PDFFont }>> | undefined;
function captionFaces() {
  captionFacesPromise ??= (async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const read = (file: string) => readFileSync(join(SHEETS, SHEET_TEMPLATE_CONTRACT.fontsDirectory, file));
    const names = SHEET_FONT_FACE_NAMES.filter((name) => (SHEET_FONT_FACES[name].roles as readonly string[]).includes("captions"));
    return Promise.all(names.map(async (name) => {
      const source = sheetFaces({ ...DEFAULT_SHEET_FONTS, captions: name }, read).captions;
      return { name, font: await document.embedFont("standard" in source ? source.standard : source.bytes) };
    }));
  })();
  return captionFacesPromise;
}

type Box = { x: number; y: number; width: number; height: number };
/** The ink of an all-capitals caption in `font`: its measured width, from the baseline to a generous cap height. */
function inkOf(label: SheetLabel, font: PDFFont): Box {
  const width = font.widthOfTextAtSize(label.text, label.size);
  const x = label.align === "center" ? label.x + ((label.width ?? 0) - width) / 2
    : label.align === "right" ? label.x + (label.width ?? 0) - width
      : label.x;
  return { x, y: label.y, width, height: label.size * 0.75 };
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Fails unless `label` is at least 5pt and, in every caption face, lies inside
 * `box` and clear of every field and every other caption on the page.
 */
async function expectReadableCaption(set: SheetTemplateSet, file: string, label: SheetLabel, box: Box) {
  const where = `${set}/${file} "${label.text}"`;
  expect(label.size, where).toBeGreaterThanOrEqual(5);
  const page = await fieldsOf(set, file);
  const widgets = page.form.getFields().flatMap((field) => field.acroField.getWidgets().map((widget) => ({ name: field.getName(), rect: widget.getRectangle() })));
  const others = loadLabels(set)[file]!.labels.filter((other) => other.font === "captions" && !(other.text === label.text && other.x === label.x && other.y === label.y));
  for (const { name, font } of await captionFaces()) {
    const ink = inkOf(label, font);
    const at = `${where} in ${name}`;
    expect(ink.x, at).toBeGreaterThanOrEqual(box.x);
    expect(ink.x + ink.width, at).toBeLessThanOrEqual(box.x + box.width);
    expect(ink.y, at).toBeGreaterThanOrEqual(box.y);
    expect(ink.y + ink.height, at).toBeLessThanOrEqual(box.y + box.height);
    expect(widgets.filter((widget) => overlaps(ink, widget.rect)).map((widget) => widget.name), at).toEqual([]);
    expect(others.filter((other) => overlaps(ink, inkOf(other, font))).map((other) => other.text), at).toEqual([]);
  }
}
const loadLabels = (set: SheetTemplateSet) =>
  JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;

describe("the small captions on the optional pages", () => {
  // The compact 2014 column pairs the proficiency bonus and initiative in two
  // 51 x 24 pills, each ending in a roundel (radius 9) centred on its value's
  // 24pt-wide field. A caption sits between the pill's rounded left end and
  // the roundel.
  const TOP_2014 = DETAILS_PAGES.filter(([set, file]) => set === "2014" && file.includes("~top"));
  it.each(TOP_2014)("prints the proficiency bonus and initiative captions at 5pt or more inside their pills on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const labels = loadLabels(set)[file]!.labels;
    for (const name of ["details_proficiency_bonus", "details_initiative"]) {
      const value = page.rect(name);
      const roundelLeft = value.x + 12 - 9;
      const pill = { x: value.x + 24 - 51, y: value.y - 5, width: 51, height: 24 };
      // The pill's own captions: every caption in it but the advantage mark's.
      const captions = labels.filter((label) => label.font === "captions" && label.text !== "ADV." &&
        label.x >= pill.x && label.x < pill.x + pill.width && label.y >= pill.y && label.y < pill.y + pill.height);
      expect(captions.length, name).toBeGreaterThan(0);
      for (const caption of captions) {
        await expectReadableCaption(set, file, caption, { x: pill.x + 4.5, y: pill.y + 3, width: roundelLeft - 1 - (pill.x + 4.5), height: pill.height - 6 });
      }
    }
    // Slow under the coverage pass: every caption face is measured.
  }, 30_000);

  const SMALL_2024 = DETAILS_PAGES.filter(([set, file]) => set !== "2014" && (layoutOf(set, file).top || layoutOf(set, file).readable));
  it("covers every 2024 and Hybrid page with the compact top row or the readable body", () => {
    expect(SMALL_2024).toHaveLength(12);
  });

  // The stealth mark's caption reads on the mark's line, right beside it,
  // inside the armor's frame.
  it.each(SMALL_2024)("prints the stealth caption at 5pt or more beside its mark on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const captions = loadLabels(set)[file]!.labels.filter((label) => label.text === "STEALTH DISADV.");
    expect(captions).toHaveLength(1);
    const check = page.rect("details_armor_stealth_disadvantage");
    const armor = page.rect("details_equipped_armor");
    const frameLeft = Math.min(armor.x, check.x);
    const frameRight = Math.max(right(armor), right(page.rect("details_armor_resistances")));
    await expectReadableCaption(set, file, captions[0]!, { x: frameLeft, y: check.y - 1, width: frameRight - frameLeft, height: check.height + 2 });
    for (const { name, font } of await captionFaces()) {
      const ink = inkOf(captions[0]!, font);
      const gap = ink.x >= right(check) ? ink.x - right(check) : check.x - (ink.x + ink.width);
      expect(gap, `${set}/${file} in ${name}`).toBeLessThanOrEqual(4);
    }
  }, 30_000);

  // The shield caption: beside its tick box on the compact top row's armor
  // box; centred under the shield's name field, above the vitals row, on the
  // classic header.
  it.each(SMALL_2024)("prints the shield caption at 5pt or more by the armor class on %s/%s", async (set, file) => {
    const page = await fieldsOf(set, file);
    const captions = loadLabels(set)[file]!.labels.filter((label) => label.text === "SHIELD");
    expect(captions).toHaveLength(1);
    const ac = page.rect("details_armor_class");
    if (layoutOf(set, file).top) {
      const check = page.rect("details_shield_equipped");
      const stealth = page.rect("details_armor_stealth_disadvantage");
      // On the tick's line, between it and the stealth mark.
      expect(check.x).toBeGreaterThan(right(ac));
      await expectReadableCaption(set, file, captions[0]!, { x: right(check), y: check.y - 1, width: stealth.x - right(check), height: check.height + 2 });
    } else {
      const name = page.rect("details_equipped_shield");
      // The vitals row's frames stand 4pt above their values' fields.
      const vitalsTop = top(page.rect("details_proficiency_bonus")) + 4;
      await expectReadableCaption(set, file, captions[0]!, { x: name.x, y: vitalsTop, width: name.width, height: name.y - vitalsTop });
    }
  }, 30_000);
});

describe("templateFontSize", () => {
  it("reads the size a template asked for", () => {
    expect(templateFontSize("0.17 0.13 0.11 rg /Helv 12 Tf")).toBe(12);
    expect(templateFontSize("/Helv 7.16 Tf")).toBe(7.16);
    expect(templateFontSize("/Helv 8 Tf /Helv 15 Tf")).toBe(15);
  });

  it("treats an absent or auto size as none of its business", () => {
    expect(templateFontSize(undefined)).toBeUndefined();
    expect(templateFontSize("0 g")).toBeUndefined();
    // A zero size means "fit the widget", which is the viewer's job.
    expect(templateFontSize("/Helv 0 Tf")).toBeUndefined();
  });
});
