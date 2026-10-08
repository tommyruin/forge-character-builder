/**
 * Optional character-page layouts. Each layout switch is a variant of the
 * set's character page template (`details~<flags>.pdf`); every other file in
 * a set is shared. The defaults print exactly the page each set has always
 * printed, a missing variant falls back to that page, and the writer fills the
 * variant's boxes from the same sheet model.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFArray, PDFCheckBox, PDFDocument, PDFStream, decodePDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel, type CharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { fetchCharacterSheetTemplateBundle } from "./templates.js";
import { seededRng, sharedLibrary } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import {
  DEFAULT_SHEET_FONTS,
  SHEET_LAYOUT_DEFAULTS,
  SHEET_TEMPLATE_CONTRACT,
  SHEET_TEMPLATE_SETS,
  resolveSheetLayout,
  sheetDetailsFile,
  sheetLayoutKey,
  sheetLayoutVariants,
  type SheetTemplateLabels,
  type SheetTemplateSet,
} from "./template-contract.js";

const SHEETS = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..", "apps", "client", "public", SHEET_TEMPLATE_CONTRACT.directory);
const BASE = SHEET_TEMPLATE_CONTRACT.files.details;

describe("sheet layout flags", () => {
  it("resolves each switch to the set's own default unless set on or off", () => {
    expect(SHEET_LAYOUT_DEFAULTS["2014"]).toEqual({ top: false, split: false, readable: false });
    expect(SHEET_LAYOUT_DEFAULTS["2024"]).toEqual({ top: false, split: false, readable: false });
    // The Hybrid page has always split its features by origin.
    expect(SHEET_LAYOUT_DEFAULTS["2024-hybrid"]).toEqual({ top: false, split: true, readable: false });
    for (const set of SHEET_TEMPLATE_SETS) {
      for (const request of [undefined, null, {}, { split: null }, { split: "yes" }, { split: 1 }, "split"]) {
        expect(resolveSheetLayout(set, request), `${set} ${JSON.stringify(request)}`).toEqual(SHEET_LAYOUT_DEFAULTS[set]);
      }
      expect(resolveSheetLayout(set, { split: true }).split).toBe(true);
      expect(resolveSheetLayout(set, { split: false }).split).toBe(false);
      expect(resolveSheetLayout(set, { top: true, readable: true })).toMatchObject({ top: true, readable: true });
    }
  });

  it("names a variant by the switches that differ from the set's page, in a fixed order", () => {
    expect(sheetDetailsFile("2014", resolveSheetLayout("2014", {}))).toBe(BASE);
    expect(sheetDetailsFile("2014", resolveSheetLayout("2014", { split: true }))).toBe("details~split.pdf");
    expect(sheetDetailsFile("2024", resolveSheetLayout("2024", { split: true }))).toBe("details~split.pdf");
    // Hybrid's own page is the split one, so turning split off is its variant.
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { split: true }))).toBe(BASE);
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { split: false }))).toBe("details~unsplit.pdf");
    // Flags join in the order top, split, readable whatever order they were set in.
    const every = ["top", "split", "readable"] as const;
    expect(sheetDetailsFile("2014", { readable: true, split: true, top: true }, every)).toBe("details~top.split.readable.pdf");
    expect(sheetDetailsFile("2024-hybrid", { readable: true, split: false, top: true }, every)).toBe("details~top.unsplit.readable.pdf");
    expect(sheetDetailsFile("2014", { top: false, split: true, readable: true }, every)).toBe("details~split.readable.pdf");
  });

  it("names the readable body variants with every combination of the other switches", () => {
    for (const set of ["2014", "2024"] as const) {
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { readable: true })), set).toBe("details~readable.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { readable: true, split: true })), set).toBe("details~split.readable.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { top: true, readable: true })), set).toBe("details~top.readable.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { top: true, split: true, readable: true })), set).toBe("details~top.split.readable.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { readable: false, split: true })), set).toBe("details~split.pdf");
    }
    // Hybrid splits by default, so its readable page with split left alone is plain "readable".
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { readable: true }))).toBe("details~readable.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { readable: true, split: false }))).toBe("details~unsplit.readable.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { readable: true, top: true }))).toBe("details~top.readable.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { readable: true, top: true, split: false }))).toBe("details~top.unsplit.readable.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { readable: false }))).toBe(BASE);
  });

  it("names the compact top row variants, alone and with the split switch", () => {
    for (const set of ["2014", "2024"] as const) {
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { top: true })), set).toBe("details~top.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { top: true, split: true })), set).toBe("details~top.split.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { top: true, split: false })), set).toBe("details~top.pdf");
      expect(sheetDetailsFile(set, resolveSheetLayout(set, { top: false, split: true })), set).toBe("details~split.pdf");
    }
    // Hybrid splits by default, so its compact page with split left alone is plain "top".
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { top: true }))).toBe("details~top.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { top: true, split: null }))).toBe("details~top.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { top: true, split: false }))).toBe("details~top.unsplit.pdf");
    expect(sheetDetailsFile("2024-hybrid", resolveSheetLayout("2024-hybrid", { top: false }))).toBe(BASE);
  });

  it("keys a layout by its effective switches", () => {
    expect(sheetLayoutKey(resolveSheetLayout("2014", {}))).not.toBe(sheetLayoutKey(resolveSheetLayout("2014", { split: true })));
    expect(sheetLayoutKey(resolveSheetLayout("2014", { split: true }))).toBe(sheetLayoutKey(resolveSheetLayout("2024-hybrid", {})));
    expect(sheetLayoutKey(resolveSheetLayout("2024-hybrid", { split: null }))).toBe(sheetLayoutKey(resolveSheetLayout("2024-hybrid", { split: true })));
    expect(sheetLayoutKey(resolveSheetLayout("2024", { top: true }))).not.toBe(sheetLayoutKey(resolveSheetLayout("2024", {})));
    expect(sheetLayoutKey(resolveSheetLayout("2024", { top: true, split: true }))).not.toBe(sheetLayoutKey(resolveSheetLayout("2024", { top: true })));
    expect(sheetLayoutKey(resolveSheetLayout("2024", { readable: true }))).not.toBe(sheetLayoutKey(resolveSheetLayout("2024", {})));
    expect(sheetLayoutKey(resolveSheetLayout("2024", { readable: true, top: true }))).not.toBe(sheetLayoutKey(resolveSheetLayout("2024", { top: true })));
  });

  it("ships every implemented variant beside its set, with its labels", () => {
    // In the order the switches shipped, so each labels.json only grows at its end.
    const expected: Record<SheetTemplateSet, string[]> = {
      "2014": [
        "details~split.pdf", "details~top.pdf", "details~top.split.pdf",
        "details~readable.pdf", "details~split.readable.pdf", "details~top.readable.pdf", "details~top.split.readable.pdf",
      ],
      "2024": [
        "details~split.pdf", "details~top.pdf", "details~top.split.pdf",
        "details~readable.pdf", "details~split.readable.pdf", "details~top.readable.pdf", "details~top.split.readable.pdf",
      ],
      "2024-hybrid": [
        "details~unsplit.pdf", "details~top.pdf", "details~top.unsplit.pdf",
        "details~readable.pdf", "details~unsplit.readable.pdf", "details~top.readable.pdf", "details~top.unsplit.readable.pdf",
      ],
    };
    for (const set of SHEET_TEMPLATE_SETS) {
      const variants = sheetLayoutVariants(set);
      expect(variants.map((variant) => variant.file), set).toEqual(expected[set]);
      const labels = JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;
      // The set's own files keep their place; variants follow them.
      const names = Object.keys(labels);
      expect(names.slice(-variants.length), set).toEqual(variants.map((variant) => variant.file));
      for (const variant of variants) {
        expect(sheetDetailsFile(set, variant.layout), `${set}/${variant.file}`).toBe(variant.file);
        expect(readFileSync(join(SHEETS, set, variant.file)).byteLength, `${set}/${variant.file}`).toBeGreaterThan(1000);
        expect(labels[variant.file], `${set}/${variant.file}`).toBeDefined();
      }
    }
  });
});

describe("loading a layout variant", () => {
  const origin = "https://example.test";
  const base = `${origin}/tools/character-builder/`;
  const requests: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    requests.length = 0;
  });

  /** Serves the public tree, minus `missing`, and rewrites labels.json through `labels`. */
  function serve({ missing = [] as string[], labels = (value: SheetTemplateLabels) => value } = {}) {
    vi.stubGlobal("location", { origin, pathname: "/tools/character-builder/" });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      const name = decodeURIComponent(url.slice(base.length));
      if (missing.some((file) => name.endsWith(`/${file}`))) return new Response("not found", { status: 404 });
      const bytes = readFileSync(join(SHEETS, "..", name));
      if (name.endsWith(SHEET_TEMPLATE_CONTRACT.labelsFile)) {
        return new Response(JSON.stringify(labels(JSON.parse(bytes.toString("utf8")) as SheetTemplateLabels)), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    }));
  }
  const file = (set: string, name: string) => new Uint8Array(readFileSync(join(SHEETS, set, name)));

  it("fetches the variant the layout asks for", async () => {
    serve();
    const bundle = (await fetchCharacterSheetTemplateBundle(base, "2014", DEFAULT_SHEET_FONTS, { split: true }))!;
    expect(bundle.detailsFile).toBe("details~split.pdf");
    expect(bundle.details).toEqual(file("2014", "details~split.pdf"));
    const hybrid = (await fetchCharacterSheetTemplateBundle(base, "2024-hybrid", DEFAULT_SHEET_FONTS, { split: false }))!;
    expect(hybrid.detailsFile).toBe("details~unsplit.pdf");
    expect(hybrid.details).toEqual(file("2024-hybrid", "details~unsplit.pdf"));
    const top = (await fetchCharacterSheetTemplateBundle(base, "2024", DEFAULT_SHEET_FONTS, { top: true, split: true }))!;
    expect(top.detailsFile).toBe("details~top.split.pdf");
    expect(top.details).toEqual(file("2024", "details~top.split.pdf"));
    const hybridTop = (await fetchCharacterSheetTemplateBundle(base, "2024-hybrid", DEFAULT_SHEET_FONTS, { top: true }))!;
    expect(hybridTop.detailsFile).toBe("details~top.pdf");
    expect(hybridTop.details).toEqual(file("2024-hybrid", "details~top.pdf"));
    const readable = (await fetchCharacterSheetTemplateBundle(base, "2024", DEFAULT_SHEET_FONTS, { top: true, split: true, readable: true }))!;
    expect(readable.detailsFile).toBe("details~top.split.readable.pdf");
    expect(readable.details).toEqual(file("2024", "details~top.split.readable.pdf"));
    const hybridReadable = (await fetchCharacterSheetTemplateBundle(base, "2024-hybrid", DEFAULT_SHEET_FONTS, { readable: true, split: false }))!;
    expect(hybridReadable.detailsFile).toBe("details~unsplit.readable.pdf");
    expect(hybridReadable.details).toEqual(file("2024-hybrid", "details~unsplit.readable.pdf"));
    // Every set and variant is loaded and parsed: slow under the coverage pass.
  }, 30_000);

  it("fetches only the set's own page for the default layout", async () => {
    serve();
    for (const layout of [undefined, {}, { top: false, split: null, readable: false }]) {
      const bundle = (await fetchCharacterSheetTemplateBundle(base, "2024-hybrid", DEFAULT_SHEET_FONTS, layout))!;
      expect(bundle.details).toEqual(file("2024-hybrid", BASE));
      expect(bundle.detailsFile ?? BASE).toBe(BASE);
    }
    expect(requests.filter((url) => url.includes("~"))).toEqual([]);
  });

  it("falls back to the set's own page when the variant cannot be fetched", async () => {
    serve({ missing: ["details~split.pdf"] });
    const bundle = (await fetchCharacterSheetTemplateBundle(base, "2024", DEFAULT_SHEET_FONTS, { split: true }))!;
    expect(bundle.details).toEqual(file("2024", BASE));
    expect(bundle.detailsFile ?? BASE).toBe(BASE);
    expect(requests.some((url) => url.endsWith("/details~split.pdf"))).toBe(true);
  });

  it("falls back to the set's own page when the labels do not know the variant", async () => {
    serve({ labels: (labels) => Object.fromEntries(Object.entries(labels).filter(([name]) => name !== "details~split.pdf")) });
    const bundle = (await fetchCharacterSheetTemplateBundle(base, "2014", DEFAULT_SHEET_FONTS, { split: true }))!;
    expect(bundle.details).toEqual(file("2014", BASE));
    expect(bundle.detailsFile ?? BASE).toBe(BASE);
  });

  it("loads the same variant locally for tests and the benchmark", () => {
    const local = localTemplateBundle("2014", DEFAULT_SHEET_FONTS, { split: true });
    expect(local.detailsFile).toBe("details~split.pdf");
    expect(local.details).toEqual(file("2014", "details~split.pdf"));
    expect(localTemplateBundle("2014").details).toEqual(file("2014", BASE));
  });
});

describe("writing a layout variant", () => {
  const line = (text: string) => ({ kind: "lines" as const, lines: [text] });
  const page = {
    page: 1, templateKind: "details" as const,
    sections: [{ title: "features", rows: [line("Spellcasting. Class prose."), line("Wild Shape. Subclass prose."), line("Alert. Feat prose.")] }],
    featureGroups: {
      "class-features": [line("Spellcasting. Class prose.")],
      "subclass-features": [line("Wild Shape. Subclass prose.")],
      feats: [line("Alert. Feat prose.")],
    },
  };
  const model: CharacterSheetModel = { characterId: "Layouts", mode: "lite", pageCount: 1, pages: [page] };

  async function placements(set: SheetTemplateSet, layout: { split?: boolean | null }, written: CharacterSheetModel = model) {
    const bundle = localTemplateBundle(set, DEFAULT_SHEET_FONTS, layout);
    const form = (await PDFDocument.load(bundle.details)).getForm();
    const rect = (name: string) => form.getFields().some((field) => field.getName() === name)
      ? form.getTextField(name).acroField.getWidgets()[0]!.getRectangle() : undefined;
    const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(written, bundle)) }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((item) => "str" in item);
    const inside = (text: string, field: string): boolean => {
      const box = rect(field);
      const item = items.find((candidate) => "str" in candidate && candidate.str.startsWith(text));
      if (box === undefined || item === undefined || !("transform" in item)) return false;
      const [x, y] = [item.transform[4] as number, item.transform[5] as number];
      return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    };
    const text = items.map((item) => ("str" in item ? item.str : "")).join(" ");
    return { inside, hasField: (name: string) => rect(name) !== undefined, text, pages: doc.numPages };
  }

  it.each(["2014", "2024"] as const)("prints class features, subclass features and feats in their own boxes on %s split", async (set) => {
    const split = await placements(set, { split: true });
    expect(split.inside("Spellcasting.", "details_features")).toBe(true);
    expect(split.inside("Wild Shape.", "details_subclass_features")).toBe(true);
    expect(split.inside("Alert.", "details_feats")).toBe(true);
    for (const title of ["CLASS FEATURES", "SUBCLASS FEATURES", "FEATS"]) expect(split.text).toContain(title);
    expect(split.pages).toBe(1);
  });

  it("prints every feature in one box on the unsplit Hybrid page", async () => {
    const unsplit = await placements("2024-hybrid", { split: false });
    expect(unsplit.hasField("details_subclass_features")).toBe(false);
    expect(unsplit.hasField("details_feats")).toBe(false);
    for (const text of ["Spellcasting.", "Wild Shape.", "Alert."]) expect(unsplit.inside(text, "details_features")).toBe(true);
    expect(unsplit.text).toContain("FEATURES");
    expect(unsplit.text).not.toContain("SUBCLASS FEATURES");
  });

  it("prints the combined features in the class box when the model has no feature groups", async () => {
    const ungrouped = { ...model, pages: [{ page: page.page, templateKind: page.templateKind, sections: page.sections }] };
    for (const [set, layout] of [["2014", { split: true }], ["2024", { split: true }], ["2024-hybrid", {}]] as const) {
      const split = await placements(set, layout, ungrouped);
      for (const text of ["Spellcasting.", "Wild Shape.", "Alert."]) expect(split.inside(text, "details_features"), `${set} ${text}`).toBe(true);
    }
  });

  it.each([...SHEET_TEMPLATE_SETS])("renders the %s default layout exactly as the set's own page", async (set) => {
    // The document info carries the time of writing to the second; pin it so
    // the bytes compare.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T00:00:00Z") });
    try {
      const plain = new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set)));
      for (const layout of [{}, { top: false, split: null, readable: false }, { split: SHEET_LAYOUT_DEFAULTS[set].split }]) {
        const bundle = localTemplateBundle(set, DEFAULT_SHEET_FONTS, layout);
        expect(bundle.details).toEqual(new Uint8Array(readFileSync(join(SHEETS, set, BASE))));
        expect(new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, bundle)), JSON.stringify(layout)).toEqual(plain);
      }
    } finally {
      vi.useRealTimers();
    }
    // Four full renders: about two seconds, two to three times that under the
    // coverage pass. This checks bytes, not a 5-second budget.
  }, 30_000);
});

describe("the compact top row's values", () => {
  const FIXTURES = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));
  async function fixtureValues(name: string) {
    const library = await sharedLibrary();
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const state = service.importCharacterXml(name, await readFile(join(FIXTURES, `${name}.dnd5e`), "utf8"));
    return buildCharacterSheetModel(state, library, { mode: "lite" }).formValues ?? {};
  }

  it("gives species, class, level and background a value each, beside the combined line", async () => {
    const paladin = await fixtureValues("paladin-7");
    expect(paladin["details_species"]).toBe("Human");
    expect(paladin["details_class"]).toBe("Paladin, Oath of Redemption");
    expect(paladin["details_level"]).toBe("7");
    expect(paladin["details_background"]).toBe("Pirate");
    // The base pages still print the combined line.
    expect(paladin["details_build"]).toBe("Level 7 Human Paladin, Oath of Redemption");
    const multiclass = await fixtureValues("druid-warlock-cleric-6");
    expect(multiclass["details_class"]).toMatch(/^Druid.* \(\d\) \/ .* \(\d\) \/ .* \(\d\)$/);
    expect(multiclass["details_level"]).toBe("6");
    expect(multiclass["details_build"]).toBe(`Level 6 ${multiclass["details_species"]} ${multiclass["details_class"]}`);
  }, 120_000);

  it("ticks the shield only when one is equipped, keeping the shield's name for the base pages", async () => {
    const paladin = await fixtureValues("paladin-7");
    expect(paladin["details_shield_equipped"]).toBe("true");
    expect(paladin["details_equipped_shield"]).toBe("Shield");
    const library = await sharedLibrary();
    const bare = buildCharacterSheetModel(new CharacterService(undefined, library).createCharacter("Bare"), library, { mode: "lite" }).formValues ?? {};
    expect(bare["details_shield_equipped"]).toBe("");
    expect(bare["details_equipped_shield"]).toBe("");
  }, 120_000);
});

describe("writing the compact top row", () => {
  const TOP_PAGES = [
    ["2014", { top: true }], ["2014", { top: true, split: true }],
    ["2024", { top: true }], ["2024", { top: true, split: true }],
    ["2024-hybrid", { top: true }], ["2024-hybrid", { top: true, split: false }],
  ] as const;
  const MULTICLASS = "Druid, Circle of the Moon (2) / Warlock, The Fiend (2) / Cleric, Life Domain (2)";
  const values: Record<string, string> = {
    details_character_name: "Top Row",
    details_xp: "14000",
    details_species: "Mountain Dwarf",
    details_class: MULTICLASS,
    details_level: "6",
    details_background: "Guild Artisan",
    details_build: `Level 6 Mountain Dwarf ${MULTICLASS}`,
    details_hd: "2d8/2d8/2d8",
    details_armor_class: "18",
    details_shield_equipped: "true",
    details_equipped_shield: "Shield",
  };
  const model = (extra: Record<string, string> = {}): CharacterSheetModel => ({
    characterId: "Top", mode: "lite", pageCount: 1,
    pages: [{ page: 1, templateKind: "details", sections: [] }],
    formValues: { ...values, ...extra },
  });

  async function render(set: SheetTemplateSet, layout: object, written: CharacterSheetModel, options = {}) {
    const bundle = localTemplateBundle(set, DEFAULT_SHEET_FONTS, layout);
    const form = (await PDFDocument.load(bundle.details)).getForm();
    const rect = (name: string) => form.getFields().find((field) => field.getName() === name)?.acroField.getWidgets()[0]?.getRectangle();
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(written, bundle, options);
    const doc = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items
      .flatMap((item) => ("str" in item && item.str.trim() !== "" ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width }] : []));
    const loaded = await PDFDocument.load(pdf);
    const contents = loaded.getPages()[0]!.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => loaded.context.lookup(ref, PDFStream))
      : [contents as PDFStream];
    const operators = streams.map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream as never).decode())).join("\n");
    /**
     * The writer's check marks: filled circles, each a move to its left edge
     * at mid height and a curve ending at the bottom of its centre line.
     */
    const marks = [...operators.matchAll(/[\d.]+ ([\d.]+) m\s+[\d.]+ [\d.]+ [\d.]+ [\d.]+ ([\d.]+) [\d.]+ c/g)]
      .map((match) => [Number(match[2]), Number(match[1])] as const);
    const within = (box: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
      x >= box.x - 0.01 && x <= box.x + box.width + 0.01 && y >= box.y - 0.01 && y <= box.y + box.height + 0.01;
    return {
      form, rect, items, text: items.map((item) => item.str).join(" "),
      ticked: (name: string) => { const box = rect(name); return box !== undefined && marks.some(([x, y]) => within(box, x, y)); },
      /** Every drawn item that starts with any word of `value` lies wholly inside `name`'s box. */
      inside: (value: string, name: string) => {
        const box = rect(name);
        const words = new Set(value.split(/\s+/));
        const hits = items.filter((item) => item.str.split(/\s+/).some((word) => words.has(word)) && within(box ?? { x: 0, y: 0, width: -1, height: -1 }, item.x, item.y));
        return box !== undefined && hits.length > 0 && hits.every((item) => item.x + item.width <= box.x + box.width + 0.5) &&
          value.split(/\s+/).every((word) => hits.some((item) => item.str.split(/\s+/).includes(word)));
      },
    };
  }

  it.each(TOP_PAGES.filter(([set]) => set !== "2014"))("ticks the shield box beside AC on %s %j only when a shield is equipped", async (set, layout) => {
    const page = await render(set, layout, model());
    expect(page.form.getField("details_shield_equipped")).toBeInstanceOf(PDFCheckBox);
    expect(page.rect("details_equipped_shield")).toBeUndefined();
    expect(page.ticked("details_shield_equipped")).toBe(true);
    expect(page.text).not.toContain("Shield ");
    const bare = await render(set, layout, model({ details_shield_equipped: "", details_equipped_shield: "" }));
    expect(bare.ticked("details_shield_equipped")).toBe(false);
  });

  it.each([["2014", {}], ["2024", {}]] as const)("ticks the initiative advantage circle on the %s base page only when the value is true", async (set, layout) => {
    const page = await render(set, layout, model({ details_initiative_advantage: "true" }));
    expect(page.form.getField("details_initiative_advantage")).toBeInstanceOf(PDFCheckBox);
    expect(page.ticked("details_initiative_advantage")).toBe(true);
    const bare = await render(set, layout, model({ details_initiative_advantage: "" }));
    expect(bare.ticked("details_initiative_advantage")).toBe(false);
  });

  it.each(TOP_PAGES.filter(([set]) => set !== "2014"))("prints the identity in its own labelled fields on %s %j", async (set, layout) => {
    const page = await render(set, layout, model());
    expect(page.rect("details_build")).toBeUndefined();
    expect(page.inside("14000", "details_xp")).toBe(true);
    expect(page.inside("Mountain Dwarf", "details_species")).toBe(true);
    expect(page.inside(MULTICLASS, "details_class")).toBe(true);
    expect(page.inside("6", "details_level")).toBe(true);
    expect(page.inside("Guild Artisan", "details_background")).toBe(true);
    expect(page.inside("2d8/2d8/2d8", "details_hd")).toBe(true);
    for (const caption of ["SPECIES", "CLASS", "LEVEL", "BACKGROUND", "XP", "SHIELD", "MAX", "SPENT"]) {
      expect(page.items.some((item) => item.str === caption), caption).toBe(true);
    }
    expect(page.text).not.toContain("SPECIES & BACKGROUND");
    expect(page.text).not.toContain("CLASS & LEVEL");
  });

  it.each(TOP_PAGES.filter(([set]) => set !== "2014"))("swaps the ability values when modifiers are emphasized on %s %j", async (set, layout) => {
    const scores = { details_str_score: "18", details_str_modifier: "+4" };
    const page = await render(set, layout, model(scores), { emphasizeAbilityModifiers: true });
    expect(page.inside("+4", "details_str_score")).toBe(true);
    expect(page.inside("18", "details_str_modifier")).toBe(true);
  });

  it.each(TOP_PAGES.filter(([set]) => set === "2014"))("keeps the 2014 identity line and prints the hit dice maximum on %s %j", async (set, layout) => {
    const page = await render(set, layout, model());
    expect(page.inside("2d8/2d8/2d8", "details_hd")).toBe(true);
    expect(page.rect("details_hd_spent")).toBeDefined();
    expect(page.text).toContain("SPENT");
  });
});

describe("writing the readable body", () => {
  const READABLE_PAGES = [
    ["2014", { readable: true }], ["2014", { readable: true, top: true }],
    ["2024", { readable: true }], ["2024", { readable: true, top: true, split: true }],
    ["2024-hybrid", { readable: true }], ["2024-hybrid", { readable: true, top: true, split: false }],
  ] as const;
  const page = (extra: Partial<CharacterSheetModel["pages"][number]> = {}) => ({ page: 1, templateKind: "details" as const, sections: [], ...extra });
  const model = (values: Record<string, string>, extra: Partial<CharacterSheetModel["pages"][number]> = {}): CharacterSheetModel => ({
    characterId: "Readable", mode: "lite", pageCount: 1, pages: [page(extra)], formValues: values,
  });

  async function render(set: SheetTemplateSet, layout: object, written: CharacterSheetModel, options = {}) {
    const bundle = localTemplateBundle(set, DEFAULT_SHEET_FONTS, layout);
    const form = (await PDFDocument.load(bundle.details)).getForm();
    const rect = (name: string) => form.getFields().find((field) => field.getName() === name)?.acroField.getWidgets()[0]?.getRectangle();
    const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(written, bundle, options)) }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items
      .flatMap((item) => ("str" in item && item.str.trim() !== "" ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, size: Math.hypot(item.transform[2] as number, item.transform[3] as number) }] : []));
    /** The drawn items whose origin lies in `name`'s box. */
    const within = (name: string) => {
      const box = rect(name);
      return box === undefined ? [] : items.filter((item) => item.x >= box.x - 0.5 && item.x <= box.x + box.width + 0.5 && item.y >= box.y - 0.5 && item.y <= box.y + box.height + 0.5);
    };
    return { form, rect, items, within, text: items.map((item) => item.str).join(" "), pages: doc.numPages };
  }

  it.each(READABLE_PAGES)("prints the %s %j page from the same values", async (set, layout) => {
    const written = await render(set, layout, model({ details_character_name: "Readable Hero", details_str_score: "18", details_str_modifier: "+4" }));
    expect(written.text).toContain("Readable Hero");
    expect(written.within("details_str_score").map((item) => item.str)).toEqual(["18"]);
    expect(written.within("details_str_modifier").map((item) => item.str)).toEqual(["+4"]);
    expect(written.pages).toBe(1);
  });

  // The readable 2024 panels already make the modifier the big number, so
  // emphasizing modifiers leaves the values where they are; the base panels
  // and the shields still swap them.
  it.each([["2024", { readable: true }], ["2024", { readable: true, top: true }]] as const)(
    "keeps the modifier the large number when modifiers are emphasized on %s %j",
    async (set, layout) => {
      const values = { details_str_score: "18", details_str_modifier: "+4" };
      for (const emphasizeAbilityModifiers of [false, true]) {
        const written = await render(set, layout, model(values), { emphasizeAbilityModifiers });
        const [modifier] = written.within("details_str_modifier");
        const [score] = written.within("details_str_score");
        expect(modifier?.str, `emphasis ${emphasizeAbilityModifiers}`).toBe("+4");
        expect(score?.str, `emphasis ${emphasizeAbilityModifiers}`).toBe("18");
        expect(modifier!.size).toBeGreaterThan(score!.size);
      }
    },
  );

  it.each(READABLE_PAGES.filter(([set]) => set !== "2014"))("prints the more attacks note at 7pt or more on %s %j", async (set, layout) => {
    const note = "More attacks: Dagger: 20/60 ft, +5, 1d4+3 piercing; Javelin: 30/120 ft, +5, 1d6+3 piercing.\nAim for the knees.";
    const written = await render(set, layout, model({ details_attack_description: note }));
    const lines = written.within("details_attack_description");
    expect(lines.map((item) => item.str).join(" ").replace(/\s+/g, " ")).toBe(note.replace(/\s+/g, " "));
    for (const line of lines) expect(line.size, line.str).toBeGreaterThanOrEqual(7);
  });
});
