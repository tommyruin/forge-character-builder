/**
 * Optional character-page layouts. Each layout switch is a variant of the
 * set's character page template (`details~<flags>.pdf`); every other file in
 * a set is shared. The defaults print exactly the page each set has always
 * printed, a missing variant falls back to that page, and the writer fills the
 * variant's boxes from the same sheet model.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { CharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { fetchCharacterSheetTemplateBundle } from "./templates.js";
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

  it("prints a switch that has no variant yet on the set's own page", () => {
    expect(sheetDetailsFile("2014", resolveSheetLayout("2014", { top: true, readable: true }))).toBe(BASE);
    expect(sheetDetailsFile("2014", resolveSheetLayout("2014", { top: true, split: true }))).toBe("details~split.pdf");
  });

  it("keys a layout by its effective switches", () => {
    expect(sheetLayoutKey(resolveSheetLayout("2014", {}))).not.toBe(sheetLayoutKey(resolveSheetLayout("2014", { split: true })));
    expect(sheetLayoutKey(resolveSheetLayout("2014", { split: true }))).toBe(sheetLayoutKey(resolveSheetLayout("2024-hybrid", {})));
    expect(sheetLayoutKey(resolveSheetLayout("2024-hybrid", { split: null }))).toBe(sheetLayoutKey(resolveSheetLayout("2024-hybrid", { split: true })));
  });

  it("ships every implemented variant beside its set, with its labels", () => {
    const expected: Record<SheetTemplateSet, string[]> = {
      "2014": ["details~split.pdf"],
      "2024": ["details~split.pdf"],
      "2024-hybrid": ["details~unsplit.pdf"],
    };
    for (const set of SHEET_TEMPLATE_SETS) {
      const variants = sheetLayoutVariants(set);
      expect(variants.map((variant) => variant.file), set).toEqual(expected[set]);
      const labels = JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;
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
  });

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
  });
});
