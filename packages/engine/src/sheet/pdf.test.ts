import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SpellResourceDto } from "@forge-cb/api";
import { PDFDocument, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "../character/service.js";
import { buildFullSheetCharacter, buildRogue5 } from "../testing/character-factory.js";
import { inventoryRuns } from "./card-layout.js";
import { buildCharacterSheetModel } from "./model.js";
import {
  fitMultilineFontSize,
  writeCharacterSheetPdf,
  writeCharacterSheetPdfWithTemplateBundle,
  type CharacterSheetTemplateBundle,
} from "./pdf.js";
import { DEFAULT_SHEET_FONTS, SHEET_TEMPLATE_CONTRACT, type SheetFonts } from "./template-contract.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const PUBLIC = join(ROOT, "apps", "client", "public", "sheets", "2014");
const libraryPromise = buildCorpusLibrary();

function template(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(PUBLIC, name)));
}

/** The 2014 set, loaded from the client's public tree. */
export function fullTemplateBundle(fonts: SheetFonts = DEFAULT_SHEET_FONTS): CharacterSheetTemplateBundle {
  return localTemplateBundle("2014", fonts);
}

describe("character sheet PDF writer", () => {
  it("emits a deterministic browser-readable PDF", () => {
    const model = {
      characterId: "Ada",
      mode: "lite" as const,
      pageCount: 1,
      pages: [{ page: 1, templateKind: "generic" as const, sections: [{ title: "summary", rows: [{ kind: "tokens" as const, tokens: ["Ada", "Wizard"] }] }] }],
    };
    const first = new Uint8Array(writeCharacterSheetPdf(model));
    const second = new Uint8Array(writeCharacterSheetPdf(model));
    expect(new TextDecoder().decode(first.slice(0, 8))).toBe("%PDF-1.4");
    expect(first).toEqual(second);
    expect(new TextDecoder().decode(first)).toContain("Ada");
    expect(first.byteLength).toBeGreaterThan(100);
  });

  it("renders a normal model as three styled sheet pages", () => {
    const model = {
      characterId: "Ada",
      mode: "lite" as const,
      pageCount: 3,
      pages: [
        {
          page: 1,
          templateKind: "generic" as const,
          sections: [
            { title: "identity", rows: [{ kind: "tokens" as const, tokens: ["Ada", "Wizard"] }] },
            { title: "abilities", rows: [{ kind: "tokens" as const, tokens: ["18", "+4", "Intelligence"] }] },
          ],
        },
        {
          page: 2,
          templateKind: "generic" as const,
          sections: [
            { title: "features", rows: [{ kind: "lines" as const, lines: ["Arcane Recovery restores a spell slot after a short rest."] }] },
          ],
        },
        {
          page: 3,
          templateKind: "generic" as const,
          sections: [
            { title: "inventory", rows: [{ kind: "tokens" as const, tokens: ["Longsword", "Backpack"] }] },
          ],
        },
      ],
    };

    const pdf = new TextDecoder().decode(new Uint8Array(writeCharacterSheetPdf(model)));

    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(3);
    expect(pdf).toContain("/Count 3");
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
    expect(pdf).toContain("/F2");
    expect(pdf).toMatch(/\bre\n(?:f|S)\b/);
    expect(pdf).toMatch(/\brg\n/);
    expect(pdf).toContain("Ada");
    expect(pdf).toContain("Wizard");
    expect(pdf).toContain("Longsword");
  });

  it("adds a companion page for a character with a companion", async () => {
    const library = await libraryPromise;
    // A companion reaches a character through a granting feature's select
    // rule; the corpus classes gate theirs behind spells, so grant one
    // directly the way the companion DTO tests do.
    const raceId = "ID_TEST_RACE_SHEET_COMPANION";
    const contentXml = `<elements>
  <element name="Sheet Companion Handler" type="Race" source="Homebrew" id="${raceId}">
    <description><p>Grants a companion for the sheet test.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules><select type="Companion" name="Sheet Companion" /></rules>
  </element>
</elements>`;
    await ingestContentFiles(library, [
      { path: "imports/sheet-companion-test.xml", base64: encodeBase64(new TextEncoder().encode(contentXml)) },
    ]);

    const service = new CharacterService(undefined, library);
    const id = "Companion Sheet";
    service.createCharacter(id);
    service.setAbilities(id, {
      strength: 10, dexterity: 12, constitution: 12, intelligence: 15, wisdom: 13, charisma: 8,
    });
    const rule = (type: string) =>
      service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === type);
    service.setSelection(id, rule("Race")!.identifier, raceId);
    service.setSelection(id, rule("Class")!.identifier, "ID_WOTC_PHB_CLASS_WIZARD");
    service.setSelection(id, rule("Companion")!.identifier, "ID_WOTC_PHB_COMPANION_OWL");

    const state = service.getCharacter(id);
    const model = buildCharacterSheetModel(state, library, { mode: "lite" });
    expect(model.pages.map((page) => page.templateKind)).toContain("companion");
    // The companion page sits directly after the background page.
    expect(model.pages[2]!.templateKind).toBe("companion");
    expect(model.formValues?.["companion_name"]).toBeDefined();

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const content = await (await browserPdf.getPage(3)).getTextContent();
    const text = content.items
      .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
      .map((item) => item.str)
      .join(" ");
    expect(text).toContain("Owl");
    expect(text).toContain("COMPANION NAME");
    // A stat block prints its traits and actions as rules text, and names the
    // creature and the feature that granted it rather than repeating the build.
    expect(text).toContain("Flyby");
    expect(text).toContain("provoke opportunity attacks");
    expect(text).toContain("Talons");
    expect(text).toContain("Melee Weapon Attack");
    expect(model.formValues?.["companion_kind"]).toBe("Owl");
    expect(model.formValues?.["companion_owner"]).toBe("Sheet Companion");
    expect(model.formValues?.["companion_build"]).toBe("Tiny beast, unaligned");
    // A familiar keeps its own proficiency bonus, not its owner's.
    expect(model.formValues?.["companion_proficiency"]).toBe("2");
  }, 120_000);

  it("draws the character and companion portraits into their template frames", async () => {
    const library = await libraryPromise;
    const raceId = "ID_TEST_RACE_PORTRAIT_COMPANION";
    const contentXml = `<elements>
  <element name="Portrait Companion Handler" type="Race" source="Homebrew" id="${raceId}">
    <description><p>Grants a companion for the portrait test.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules><select type="Companion" name="Portrait Companion" /></rules>
  </element>
</elements>`;
    await ingestContentFiles(library, [
      { path: "imports/portrait-companion-test.xml", base64: encodeBase64(new TextEncoder().encode(contentXml)) },
    ]);

    const service = new CharacterService(undefined, library);
    const id = "Portrait Sheet";
    service.createCharacter(id);
    service.setAbilities(id, {
      strength: 10, dexterity: 12, constitution: 12, intelligence: 15, wisdom: 13, charisma: 8,
    });
    const rule = (type: string) =>
      service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === type);
    service.setSelection(id, rule("Race")!.identifier, raceId);
    service.setSelection(id, rule("Class")!.identifier, "ID_WOTC_PHB_CLASS_WIZARD");
    service.setSelection(id, rule("Companion")!.identifier, "ID_WOTC_PHB_COMPANION_OWL");

    // An 8x8 PNG stands in for an uploaded portrait.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAABbObilAAAAFVBMVEXvKys7Ozvv8fFRUVGZmZm5ubn///+wLB5aAAAAAXRSTlMAQObYZgAAAB1JREFUCNdjYGBgYGRiZmFlY+fg5OLm4eXjFxAUAgAFDwCJ0Y1CoAAAAABJRU5ErkJggg==";
    service.setPortrait(id, png);
    service.setCompanionPortrait(id, png);

    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "lite" });
    expect(model.images?.["background_portrait_image"]).toBe(png);
    expect(model.images?.["companion_portrait_image"]).toBe(png);

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    const imageCount = (index: number): number => {
      const resources = document.getPage(index).node.Resources();
      const xObject = resources?.lookup(PDFName.of("XObject")) as
        | { keys(): { asString(): string }[]; lookup(key: PDFName): { dict?: Map<unknown, unknown> } }
        | undefined;
      if (xObject === undefined) return 0;
      let count = 0;
      for (const key of xObject.keys()) {
        const entry = xObject.lookup(PDFName.of(key.asString().replace("/", ""))) as
          | { dict?: { get(name: PDFName): { asString?(): string } | undefined } }
          | undefined;
        if (entry?.dict?.get(PDFName.of("Subtype"))?.asString?.() === "/Image") count += 1;
      }
      return count;
    };
    const kinds = model.pages.map((page) => page.templateKind);
    expect(imageCount(kinds.indexOf("background"))).toBe(1);
    expect(imageCount(kinds.indexOf("companion"))).toBe(1);
  }, 120_000);

  it("still renders a complete sheet when the portrait bytes are unusable", async () => {
    const library = await libraryPromise;
    const { service, id } = buildRogue5(library, "Bad Portrait");
    service.setPortrait(id, "not-an-image");
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "lite" });
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(document.getPageCount()).toBe(model.pages.length);
  }, 120_000);

  it("assembles all six page kinds from the tracked template bundle", async () => {
    const library = await libraryPromise;
    const { service, id } = buildFullSheetCharacter(library, "Full Sheet PDF");
    const state = service.getCharacter(id);
    const model = buildCharacterSheetModel(state, library, { mode: "full" });

    expect(model.pages.map((page) => page.templateKind)).toEqual([
      "details",
      "background",
      "equipment",
      "spell-list",
      "spell-cards",
      "item-cards",
    ]);
    expect(model.pages[4]!.sections).toHaveLength(6);
    expect(model.pages[5]!.sections).toHaveLength(3);

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(document.getPageCount()).toBe(6);
    // The bundle is flattened: no interactive form fields or annotations survive.
    expect(document.getForm().getFields()).toHaveLength(0);
    expect(document.getPages().flatMap((page) => page.node.Annots()?.asArray() ?? [])).toHaveLength(0);

    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const textOf = async (page: number): Promise<string> => {
      const content = await (await browserPdf.getPage(page)).getTextContent();
      return content.items
        .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
        .map((item) => item.str)
        .join(" ");
    };

    // Page 3 is the equipment page: the character's items and its headings.
    const pageThree = await textOf(3);
    expect(pageThree).toContain("ITEM DESCRIPTIONS & NOTES");
    expect(pageThree).toContain("Longsword");
    expect(pageThree).toContain("Potion of Healing");

    // Page 5 is the spell-cards page: every granted spell earns a card, with
    // its description rendered alongside the name.
    const pageFive = await textOf(5);
    for (const spell of ["Bless", "Command", "Cure Wounds", "Divine Favor", "Heroism", "Shield of Faith"]) {
      expect(pageFive).toContain(spell);
    }
    expect(pageFive.replace(/\s+/g, "")).toContain("Youblessuptothreecreatures");

    // Page 6 is the item-cards page.
    const pageSix = await textOf(6);
    expect(pageSix).toContain("Longsword");

    const liteModel = buildCharacterSheetModel(state, library, { mode: "lite" });
    expect(liteModel.pages.map((page) => page.templateKind)).toEqual([
      "details",
      "background",
      "equipment",
      "spell-list",
    ]);
    const litePdf = await writeCharacterSheetPdfWithTemplateBundle(liteModel, fullTemplateBundle());
    expect((await PDFDocument.load(litePdf)).getPageCount()).toBe(liteModel.pageCount);
  }, 120_000);

  it("centres the spell header values in their art and signs the sheet", async () => {
    const model = {
      characterId: "Sheet header",
      mode: "full" as const,
      pageCount: 2,
      pages: [
        { page: 1, templateKind: "details" as const, sections: [] },
        {
          page: 2,
          templateKind: "spell-list" as const,
          sections: [],
          spellcasting: [{
            name: "Ranger, Gloom Stalker",
            ability: "Wisdom",
            attackBonus: "+5",
            saveDc: "13",
            prepareCount: "N/A",
            resource: { mode: "slots" as const, canUseSpellPoints: false },
            sections: [],
          }],
        },
      ],
    };

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const itemsOf = async (page: number) => {
      const content = await (await browserPdf.getPage(page)).getTextContent();
      return content.items.filter(
        (item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item,
      );
    };

    // The writer signs every template page with the footer line.
    const detailsItems = await itemsOf(1);
    expect(detailsItems.map((item) => item.str)).toContain("Generated with Forge Character Builder.");

    // Each value sits centred in its engraved box, cap height either side of the box middle.
    const { spellHeader } = SHEET_TEMPLATE_CONTRACT;
    const spellItems = await itemsOf(2);
    const boxes: ReadonlyArray<readonly [string, number]> = [
      ["Wisdom", spellHeader.statCenters[0]],
      ["+5", spellHeader.statCenters[1]],
      ["13", spellHeader.statCenters[2]],
      ["N/A", spellHeader.statCenters[3]],
      ["Ranger, Gloom Stalker", spellHeader.bannerCenter],
    ];
    for (const [value, center] of boxes) {
      const item = spellItems.find((candidate) => candidate.str === value);
      expect(item, value).toBeDefined();
      expect(item!.transform[4] + item!.width / 2).toBeCloseTo(center, 0);
    }
    const middle = (value: string): number => {
      const item = spellItems.find((candidate) => candidate.str === value)!;
      return item.transform[5] + 0.718 * 10 / 2;
    };
    const headerY = 792 - 10 - spellHeader.height;
    expect(middle("Wisdom")).toBeCloseTo(headerY + spellHeader.statMiddle, 1);
    expect(middle("Ranger, Gloom Stalker")).toBeCloseTo(headerY + spellHeader.bannerMiddle, 1);
  }, 120_000);

  it("renders the spell point reference table under the caster header", async () => {
    const casterPage = (resource: SpellResourceDto) => ({
      characterId: "Spell points",
      mode: "full" as const,
      pageCount: 1,
      pages: [{
        page: 1,
        templateKind: "spell-list" as const,
        sections: [],
        spellcasting: [{
          name: "Wizard, School of Evocation",
          ability: "Intelligence",
          attackBonus: "+8",
          saveDc: "16",
          prepareCount: "12",
          resource,
          sections: [{
            level: 1,
            slots: 4,
            spells: [{ name: "Magic Missile", prepared: true, alwaysPrepared: false }],
          }],
        }],
      }],
    });
    const spellPoints = {
      mode: "spellPoints" as const,
      currentPoints: 38,
      maximumPoints: 38,
      shared: false,
      canUseSpellPoints: true as const,
      costs: [
        { spellLevel: 1, points: 2, oncePerLongRest: false },
        { spellLevel: 2, points: 3, oncePerLongRest: false },
        { spellLevel: 3, points: 5, oncePerLongRest: false },
        { spellLevel: 4, points: 6, oncePerLongRest: false },
        { spellLevel: 5, points: 7, oncePerLongRest: false },
        { spellLevel: 6, points: 9, oncePerLongRest: true },
        { spellLevel: 7, points: 10, oncePerLongRest: true },
        { spellLevel: 8, points: 11, oncePerLongRest: true },
        { spellLevel: 9, points: 13, oncePerLongRest: true },
      ],
    };

    const textItems = async (model: Parameters<typeof writeCharacterSheetPdfWithTemplateBundle>[0]) => {
      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      const content = await (await browserPdf.getPage(1)).getTextContent();
      return content.items.filter(
        (item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item,
      );
    };

    const items = await textItems(casterPage(spellPoints));
    const joined = items.map((item) => item.str).join(" ");
    expect(joined).toContain("SPELL POINTS · 38 MAX · RECOVER ON LONG REST");
    expect(joined).toContain("SPELL LEVEL");
    expect(joined).toContain("SPELL COST");
    expect(joined).toContain("* LEVELS 6-9: ONE SLOT OF EACH LEVEL PER LONG REST");
    // Once-per-long-rest levels are starred; their costs render in the row below.
    for (const cell of ["6*", "7*", "8*", "9*", "13"]) {
      expect(items.some((item) => item.str === cell), cell).toBe(true);
    }
    // The old bare annotation under the prepare box is replaced by the block.
    expect(joined).not.toContain("38 SPELL POINTS");
    // A shared multiclass pool is labelled on the title line.
    const sharedItems = await textItems(casterPage({ ...spellPoints, shared: true }));
    expect(sharedItems.map((item) => item.str).join(" ")).toContain(
      "SPELL POINTS · 38 MAX · RECOVER ON LONG REST · SHARED POOL",
    );

    // The spell sections drop below the table instead of overlapping it.
    const slotItems = await textItems(casterPage({ mode: "slots", canUseSpellPoints: true }));
    const yOf = (list: typeof items, value: string) =>
      list.find((item) => item.str === value)!.transform[5] as number;
    expect(yOf(slotItems, "Magic Missile") - yOf(items, "Magic Missile")).toBeCloseTo(38, 0);
  }, 120_000);

  it("fits normal feature prose at the live baseline and continues long prose", async () => {
    const shortBody = "Short feature body token";
    const longBody = Array.from({ length: 800 }, (_, index) => `feature-token-${index}`).join(" ");
    const model = {
      characterId: "Long feature",
      mode: "full" as const,
      pageCount: 1,
      pages: [{
        page: 1,
        templateKind: "details" as const,
        sections: [{
          title: "features",
          rows: [{ kind: "lines" as const, lines: [`Short Feature. ${shortBody}`, `Long Feature. ${longBody}`] }],
        }],
      }],
    };

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(document.getPageCount()).toBeGreaterThan(1);
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const pages = await Promise.all(Array.from({ length: browserPdf.numPages }, async (_, index) => {
      const content = await (await browserPdf.getPage(index + 1)).getTextContent();
      return content.items.filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item);
    }));
    const items = pages.flat();
    expect(items.map((item) => item.str).join(" ")).toContain("feature-token-799");
    const shortItem = items.find((item) => item.str.includes("Short"));
    expect(shortItem).toBeDefined();
    expect(Math.hypot(shortItem!.transform[2], shortItem!.transform[3])).toBeCloseTo(8, 1);
  }, 120_000);

  it("keeps drawn details text inside the template's widget rectangles", async () => {
    const filler = (prefix: string, count: number): string =>
      Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join(" ");
    const model = {
      characterId: "Boxed details",
      mode: "full" as const,
      pageCount: 1,
      pages: [{
        page: 1,
        templateKind: "details" as const,
        sections: [
          { title: "features", rows: [{ kind: "lines" as const, lines: [`Feature. ${filler("featuretok", 800)}`] }] },
          { title: "racial-traits", rows: [{ kind: "lines" as const, lines: [`Trait. ${filler("racialtok", 800)}`] }] },
        ],
      }],
    };

    // The template's own field rectangles are the authority for the drawable area.
    const source = await PDFDocument.load(template(SHEET_TEMPLATE_CONTRACT.files.details));
    const rectOf = (name: string): { x: number; y: number; width: number; height: number } =>
      source.getForm().getTextField(name).acroField.getWidgets()[0]!.getRectangle();
    const featuresRect = rectOf("details_features");
    const racialRect = rectOf("details_additional_notes");

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const pages = await Promise.all(Array.from({ length: browserPdf.numPages }, async (_, index) => {
      const content = await (await browserPdf.getPage(index + 1)).getTextContent();
      return content.items.filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item);
    }));
    const assertInside = (prefix: string, rect: { x: number; y: number; width: number; height: number }): void => {
      const matched = pages.flat().filter((item) => item.str.includes(prefix));
      expect(matched.length).toBeGreaterThan(0);
      for (const item of matched) {
        expect(item.transform[5]).toBeGreaterThanOrEqual(rect.y - 0.5);
        expect(item.transform[5]).toBeLessThanOrEqual(rect.y + rect.height);
        expect(item.transform[4]).toBeGreaterThanOrEqual(rect.x - 0.5);
      }
    };
    assertInside("featuretok", featuresRect);
    assertInside("racialtok", racialRect);
  }, 120_000);

  it("keeps drawn inventory notes inside the equipment page's notes column", async () => {
    // Enough prose to fill the column, so many wrap decisions are exercised.
    const filler = Array.from({ length: 260 }, (_, index) => `notestok${index}`).join(" ");
    const model = {
      characterId: "Boxed notes",
      mode: "full" as const,
      pageCount: 1,
      pages: [{
        page: 1,
        templateKind: "equipment" as const,
        sections: [{
          title: "inventory",
          rows: [],
          positionedRuns: inventoryRuns([[], []], [
            { title: "Winged Boots", html: `<p>While you wear these boots, you have a flying speed equal to your walking speed. ${filler}</p>` },
          ]),
        }],
      }],
    };

    // The template's own widget rectangle is the authority for the column.
    const source = await PDFDocument.load(template(SHEET_TEMPLATE_CONTRACT.files.equipment));
    const rect = source.getForm().getTextField("equipment_page_magic_items").acroField.getWidgets()[0]!.getRectangle();

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const content = await (await browserPdf.getPage(1)).getTextContent();
    // pdfjs coalesces each drawn line into a single item; the template's own
    // column labels are excluded by matching only the prose written here.
    const lines = content.items
      .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
      .filter((item) => item.str.includes("notestok"));

    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      // The reported bug: prose printed past the right edge of this box.
      expect(line.transform[4] + line.width).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
      expect(line.transform[4]).toBeGreaterThanOrEqual(rect.x - 0.5);
      expect(line.transform[5]).toBeGreaterThanOrEqual(rect.y - 0.5);
      expect(line.transform[5]).toBeLessThanOrEqual(rect.y + rect.height);
    }
  }, 120_000);

  it("keeps a registered deity in the header field and out of both trait boxes", async () => {
    const library = await libraryPromise;
    const service = new CharacterService(undefined, library);
    service.createCharacter("Devout");
    const detailRules = service.getCharacterDetail("Devout").selectionRules;
    const deityRule = detailRules.find((rule) => rule.type === "Deity");
    expect(deityRule).toBeDefined();
    service.setSelection("Devout", deityRule!.identifier, "ID_WOTC_PHB_DEITY_AURIL", 1);

    const model = buildCharacterSheetModel(service.getCharacter("Devout"), library, { mode: "full" });
    expect(model.formValues?.["details_deity"]).toBe("Auril");
    const details = model.pages.find((page) => page.templateKind === "details")!;
    const sectionText = (title: string): string =>
      (details.sections.find((section) => section.title === title)?.rows ?? [])
        .flatMap((row) => row.kind === "tokens" ? row.tokens : row.lines)
        .join("\n");
    // The trait boxes are filled from a type whitelist; a Deity
    // element's sheet description never reaches either box.
    expect(sectionText("features")).not.toContain("Auril");
    expect(sectionText("features")).not.toContain("goddess of winter");
    expect(sectionText("racial-traits")).not.toContain("Auril");
  }, 120_000);

  it("routes Treasure items to the valuables table instead of adventuring gear", async () => {
    const library = await libraryPromise;
    const service = new CharacterService(undefined, library);
    const state = service.createCharacter("Valuables");
    state.items.push({
      ...state.items[0] ?? {},
      itemId: "ID_WOTC_DMG_ITEM_GEMSTONE_AZURITE",
      adorners: [],
      amount: 3,
      equipped: false,
      attuned: false,
    } as (typeof state.items)[number]);
    const model = buildCharacterSheetModel(state, library, { mode: "lite" });
    const values = model.formValues ?? {};
    expect(values["equipment_page_valuable_name.0"]).toBe("Azurite");
    expect(values["equipment_page_valuable_count.0"]).toBe("3");
    const gearNames = Object.entries(values)
      .filter(([key]) => key.startsWith("equipment_page_gear_name."))
      .map(([, value]) => value);
    expect(gearNames).not.toContain("Azurite");
  });

  it("fills vehicle cargo rows for items stowed in a storage container", async () => {
    const library = await libraryPromise;
    const service = new CharacterService(undefined, library);
    const state = service.createCharacter("Cargo Hold");
    state.storages = ["Saddlebags", "#2"];
    state.items.push({
      ...state.items[0] ?? {},
      itemId: "ID_WOTC_PHB_WEAPON_LONGSWORD",
      adorners: [],
      amount: 2,
      equipped: false,
      attuned: false,
      storage: "Saddlebags",
    } as (typeof state.items)[number]);
    const model = buildCharacterSheetModel(state, library, { mode: "lite" });
    const values = model.formValues ?? {};
    expect(values["equipment_page_vehicle_1_name"]).toBe("Saddlebags");
    expect(values["equipment_page_vehicle_1_cargo_name.0"]).toBe("Longsword");
    expect(values["equipment_page_vehicle_1_cargo_count.0"]).toBe("2");
    // Longsword is not stackable: its own weight (3 lb), not multiplied by amount.
    expect(values["equipment_page_vehicle_1_cargo_weight.0"]).toBe("3");
    expect(values["equipment_page_vehicle_2_cargo_name.0"]).toBeUndefined();
    // A stowed item's weight leaves carried encumbrance entirely.
    expect(values["equipment_page_weight_carried"]).toBe("");
  });

  it("projects bonus-AC items and attuned descriptions onto the sheet", async () => {
    const library = await libraryPromise;
    const service = new CharacterService(undefined, library);
    const state = service.createCharacter("Staff wielder");
    state.items.push({
      ...state.items[0] ?? {},
      itemId: "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER",
      adorners: [],
      amount: 1,
      equipped: true,
      attuned: true,
      location: "Primary Hand",
    } as (typeof state.items)[number]);
    const model = buildCharacterSheetModel(state, library, { mode: "lite" });
    const values = model.formValues ?? {};
    // Unarmored characters still show their working calculation.
    expect(values["details_equipped_armor"]).toMatch(/^Unarmored \(\d+\)$/);
    // The staff's +2 AC lists beneath the shield box with its contribution.
    expect(values["details_armor_conditional"]).toContain("Staff of Power (2)");
    // Attunement alone puts the item's description in the magic-items panel.
    expect(values["equipment_page_magic_items"]).toContain("Staff of Power.");
    expect(values["equipment_page_magic_items"]).toContain("20 charges");
  });

  it("keeps a long backstory and additional features on the background page", async () => {
    const library = await libraryPromise;
    const service = new CharacterService(undefined, library);
    const state = service.createCharacter("Long backstory");
    state.backstory = "The road behind was longer than the road ahead. ".repeat(120);
    state.additionalFeatures = "Keeps its place on page two.";
    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    // No empty continuation page: the story shrinks to fit its field instead.
    expect(model.pages.some((page) => page.templateKind === "generic")).toBe(false);
    const background = model.pages.find((page) => page.templateKind === "background")!;
    const additional = background.sections.find((section) => section.title === "additional-features")!;
    expect(additional.rows).toHaveLength(1);
  });

  it("shrinks multiline field text to fit the widget instead of clipping", () => {
    const short = fitMultilineFontSize("A short story.", 200, 300, 6.5);
    expect(short).toBe(6.5);
    const long = fitMultilineFontSize(
      "The road behind was longer than the road ahead. ".repeat(120),
      200,
      300,
      6.5,
    );
    expect(long).toBeLessThan(6.5);
    expect(long).toBeGreaterThanOrEqual(4.5);
    const enormous = fitMultilineFontSize(
      "word ".repeat(20_000),
      200,
      300,
      6.5,
    );
    expect(enormous).toBe(4.5);
  });

  it("falls back to a complete six-page PDF when a template bundle is incomplete", async () => {
    const model = {
      characterId: "Complete fallback",
      mode: "full" as const,
      pageCount: 6,
      pages: Array.from({ length: 6 }, (_, index) => ({
        page: index + 1,
        templateKind: "generic" as const,
        sections: [{ title: `page-${index + 1}`, rows: [{ kind: "tokens" as const, tokens: [`Page${index + 1}`] }] }],
      })),
    };

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, null);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(6);
  });

  it("keeps the bundle writer byte-deterministic across renders of the same model", async () => {
    const library = await libraryPromise;
    const built = buildRogue5(library, "determinism");
    // An embedded portrait names its own XObject, so the image path is the one
    // most able to drift between renders — pin it here rather than separately.
    built.service.setPortrait(
      built.id,
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    );
    const state = built.service.getCharacter(built.id);
    const model = buildCharacterSheetModel(state, library, { mode: "lite" });
    expect(model.images?.["background_portrait_image"]).toBeDefined();
    const first = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const second = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    expect(second).toEqual(first);
    // A floor, not a target: single-line values are drawn rather than flattened
    // from form widgets, so a full sheet no longer carries an appearance stream
    // per field. "bakes every provided form value" is what proves the content
    // is all there.
    expect(second.byteLength).toBeGreaterThan(30_000);
  }, 120_000);

  it("bakes every provided form value into the flattened bundle output", async () => {
    const library = await libraryPromise;
    const state = buildRogue5(library, "value-bake").state;
    const model = buildCharacterSheetModel(state, library, { mode: "lite" });
    const formValues = Object.fromEntries(
      Object.entries(model.formValues ?? {}).filter(
        ([key, value]) => value !== "" && /^(details|background|equipment_page)_/.test(key),
      ),
    );
    expect(Object.keys(formValues).length).toBeGreaterThan(20);

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const contents = await Promise.all(Array.from({ length: browserPdf.numPages }, async (_, index) => {
      const content = await (await browserPdf.getPage(index + 1)).getTextContent();
      return content.items
        .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
        .map((item) => item.str)
        .join(" ");
    }));
    const rendered = contents.join("").replace(/\s+/g, "");
    for (const value of Object.values(formValues)) {
      const token = String(value).trim().replace(/\s+/g, "");
      // Checkbox state values render as glyphs, not as "true"/"false" text.
      if (token.length < 3 || token === "true" || token === "false") continue;
      expect(rendered).toContain(token);
    }
  }, 120_000);

  it("keeps continuation and card pagination complete", async () => {
    const library = await libraryPromise;

    // Enough granted spells to fill several card pages: cards paginate nine to
    // a page, and every page the model declares must survive into the PDF.
    const { service, id } = buildFullSheetCharacter(library, "Pagination");
    const spellIds = (library.byType.get("Spell") ?? [])
      .map((element) => element.identity.id)
      .filter((spellId) => spellId.startsWith("ID_PHB_SPELL_"))
      .slice(0, 30);
    for (const spellId of spellIds) {
      try {
        service.addGrantedSpell(id, { spellId });
      } catch {
        // Already granted by the base build.
      }
    }
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const cardPages = model.pages.filter((page) => page.templateKind.endsWith("cards"));
    expect(cardPages.length).toBeGreaterThan(1);
    expect(cardPages.every((page) => page.sections.length <= 9)).toBe(true);
    expect(cardPages.every((page) => page.sections.length > 0)).toBe(true);

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle());
    // Every declared page survives into the PDF; overflowing prose may add
    // continuation pages on top, never remove one.
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(model.pageCount);

    // Nothing falls off the end: every card the model built is rendered.
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const rendered = (await Promise.all(
      Array.from({ length: browserPdf.numPages }, async (_, index) => {
        const content = await (await browserPdf.getPage(index + 1)).getTextContent();
        return content.items
          .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
          .map((item) => item.str)
          .join(" ");
      }),
    )).join(" ").replace(/\s+/g, "");

    const cardTitles = cardPages
      .flatMap((page) => page.sections)
      .flatMap((section) => section.rows)
      .flatMap((row) => (row.kind === "tokens" ? row.tokens : []));
    expect(cardTitles.length).toBeGreaterThan(9);
    for (const title of cardTitles) {
      expect(rendered).toContain(title.replace(/\s+/g, ""));
    }
  }, 120_000);
});
