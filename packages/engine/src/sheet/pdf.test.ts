import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SpellResourceDto } from "@forge-cb/api";
import { PDFArray, PDFDocument, PDFName, PDFStream, decodePDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "../character/service.js";
import { buildFullSheetCharacter, buildRogue5, seededRng } from "../testing/character-factory.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { inventoryRuns } from "./card-layout.js";
import { buildCharacterSheetModel } from "./model.js";
import {
  fitMultilineFontSize,
  writeCharacterSheetPdf,
  writeCharacterSheetPdfWithTemplateBundle,
  type CharacterSheetTemplateBundle,
} from "./pdf.js";
import { DEFAULT_SHEET_FONTS, SHEET_TEMPLATE_CONTRACT, type SheetFontFaceName, type SheetFonts } from "./template-contract.js";
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

/** A 1x1 transparent PNG: the writer only needs an embeddable image. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The operators the writer appended to a rendered page's content stream. */
async function pageOperators(pdf: ArrayBuffer, index = 0): Promise<string> {
  const document = await PDFDocument.load(pdf);
  const page = document.getPages()[index]!;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => document.context.lookup(ref, PDFStream))
    : [contents as PDFStream];
  return streams.map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream as never).decode())).join("\n");
}

describe("character sheet PDF writer", () => {
  it.each(["2014", "2024"] as const)("keeps long spell names and free-cast markers inside every %s cell", async (ruleset) => {
    const model = {
      characterId: "Long spell names", mode: "full" as const, pageCount: 1,
      pages: [{ page: 1, templateKind: "spell-list" as const, sections: [], spellcasting: [{
        name: "Wizard", ability: "Intelligence", attackBonus: "+5", saveDc: "13", prepareCount: "4",
        resource: { mode: "slots" as const, canUseSpellPoints: false },
        sections: [{ level: 1, slots: 0, spells: Array.from({ length: 5 }, (_, i) => ({
          name: `${i} ${"Wondrous Ward ".repeat(12)}`, prepared: true, alwaysPrepared: true, usage: "1/Long Rest",
        })) }],
      }] }],
    };
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(ruleset));
    const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const items = content.items.filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item);
    const markers = items.filter((item) => item.str === "1/LR");
    expect(markers).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const column = i < 2 ? i + 1 : (i - 2) % 3;
      const name = items.find((item) => item.str.startsWith(`${i} `))!;
      expect(name.str).toMatch(/\.\.\.$/);
      const marker = markers.find((item) => Math.abs(item.transform[5] - name.transform[5]) < 2 &&
        item.transform[4] >= name.transform[4] + name.width - 0.01 && item.transform[4] - name.transform[4] - name.width < 4)!;
      expect(marker, JSON.stringify({ name, markers })).toBeDefined();
      expect(marker.transform[4] + marker.width).toBeLessThanOrEqual([228, 417, 582][column]! + 0.01);
    }
  }, 120_000);

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

  // A level-3 Paladin whose Acolyte background took Magic Initiate (Cleric):
  // Divine Smite and Cure Wounds each have one slotless cast per Long Rest,
  // and the feat's block has no slots of its own.
  it("marks free casts beside their spells and prints slot counts only where slots exist", async () => {
    const library = await libraryPromise;
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter("Free casts").id;
    service.setRulesetMode(id, "2024");
    service.setAbilities(id, { strength: 15, dexterity: 10, constitution: 13, intelligence: 8, wisdom: 12, charisma: 14 });
    const pick = (matches: (rule: { type: string; name: string }) => boolean, elementId: string): void => {
      const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => matches(candidate) && !candidate.hasSelection)!;
      service.setSelection(id, rule.identifier, elementId);
    };
    pick((rule) => rule.type === "Race", "ID_WOTC_PHB24_RACE_HUMAN");
    pick((rule) => rule.type === "Class", "ID_WOTC_PHB24_CLASS_PALADIN");
    pick((rule) => rule.type === "Background", "ID_WOTC_PHB24_BACKGROUND_ACOLYTE");
    service.levelUp(id);
    service.levelUp(id);
    pick((rule) => rule.name === "Spellcasting Ability (Magic Initiate)", "ID_WOTC_PHB24_FEAT_FEATURE_MAGIC_INITIATE_CLERIC_WISDOM");
    pick((rule) => rule.name === "Cantrip (Magic Initiate)", "ID_WOTC_PHB24_SPELL_SACRED_FLAME");
    pick((rule) => rule.name === "Cantrip (Magic Initiate)", "ID_WOTC_PHB24_SPELL_GUIDANCE");
    pick((rule) => rule.name === "Level 1 Spell (Magic Initiate)", "ID_WOTC_PHB24_SPELL_CURE_WOUNDS");
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const spellPage = model.pages.findIndex((page) => page.templateKind === "spell-list") + 1;
    // The cell each spell column's text sits in ends where the next cell's
    // prepared dot begins (scripts/build-sheet-templates.mjs).
    const cellRight = (x: number): number => (x < 230 ? 228 : x < 419 ? 417 : 582);

    for (const ruleset of ["2014", "2024"] as const) {
      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(ruleset));
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      const content = await (await browserPdf.getPage(spellPage)).getTextContent();
      const items = content.items.filter(
        (item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item,
      );

      for (const name of ["Divine Smite", "Cure Wounds"]) {
        const spell = items.find((item) => item.str === name);
        expect(spell, `${ruleset} ${name}`).toBeDefined();
        const nameRight = spell!.transform[4] + spell!.width;
        const marker = items.find((item) =>
          item.str === "1/LR" && Math.abs(item.transform[5] - spell!.transform[5]) < 2 &&
          item.transform[4] >= nameRight && item.transform[4] - nameRight < 12);
        expect(marker, `${ruleset} ${name} marker`).toBeDefined();
        expect(marker!.transform[4] + marker!.width, `${ruleset} ${name} marker fits`).toBeLessThanOrEqual(cellRight(spell!.transform[4]));
      }
      // The feat's slotless level block no longer reads "0 SPELL SLOTS"; the
      // Paladin's slotted one still prints its count.
      const labels = items.map((item) => item.str).filter((text) => text.endsWith("SPELL SLOTS"));
      expect(labels, ruleset).toEqual(["3 SPELL SLOTS"]);
    }
  }, 180_000);

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
        sections: [
          {
            title: "features",
            rows: [{ kind: "lines" as const, lines: [`Short Feature. ${shortBody}`, `Long Feature. ${longBody}`] }],
          },
          {
            // Two short features, each one line, so the drop from the first to
            // the second is exactly one line plus the between-feature gap.
            title: "racial-traits",
            rows: [{ kind: "lines" as const, lines: ["Alpha Trait. alphatok", "Bravo Trait. bravotok"] }],
          },
          { title: "proficiencies", rows: [{ kind: "lines" as const, lines: ["Proficiencies. proftok"] }] },
          { title: "languages", rows: [{ kind: "lines" as const, lines: ["Languages. langtok"] }] },
        ],
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

    const baselineOf = (token: string): number => {
      const item = items.find((candidate) => candidate.str.includes(token));
      expect(item, token).toBeDefined();
      return item!.transform[5] as number;
    };
    // One feature is separated from the next by a whole line plus 45% of the
    // type size, not by the 1.2pt breath that separates paragraphs within one.
    const featureDrop = baselineOf("alphatok") - baselineOf("bravotok");
    expect(featureDrop).toBeCloseTo(8 + 8 * 0.45, 2);
    expect(featureDrop).toBeGreaterThan(8 + 1.2);
    // The proficiencies and languages box is a list, not a run of features, so
    // its rows keep the paragraph rhythm (9.2pt line, 1.2pt gap).
    expect(baselineOf("proftok") - baselineOf("langtok")).toBeCloseTo(9.2 + 1.2, 2);
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

  // The Resistances box prints one line per defence group, so its value is
  // multiline on any character with both resistances and immunities. Both
  // template sets size the field for a few short lines; this holds the writer
  // to drawing every word of such a value inside the widget rather than past
  // its edge. The widget rectangle, not the layout script, is the authority
  // for where the box is, so the assertion reads it from the template itself.
  it("keeps a two-line resistances value inside its box on both templates", async () => {
    const value = "Resistances: Acid, Fire\nImmunities: Poison";
    const model = {
      characterId: "Defences",
      mode: "full" as const,
      pageCount: 1,
      pages: [{ page: 1, templateKind: "details" as const, sections: [] }],
      formValues: { details_resistances: value },
    };

    for (const ruleset of ["2014", "2024"] as const) {
      const bundle = localTemplateBundle(ruleset);
      const source = await PDFDocument.load(bundle.details);
      const rect = source.getForm().getTextField("details_resistances").acroField
        .getWidgets()[0]!.getRectangle();

      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, bundle);
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      const content = await (await browserPdf.getPage(1)).getTextContent();
      // pdfjs coalesces adjacent drawn runs into one item, so the value is
      // matched with its line breaks flattened; picking items by rectangle
      // alone would catch the template's own captions.
      const flattened = value.replace(/\s+/g, " ");
      const runs = content.items
        .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
        .filter((item) => item.str.trim() !== "" && flattened.includes(item.str.trim()) &&
          item.transform[4] >= rect.x - 0.5 && item.transform[4] < rect.x + rect.width &&
          (item.transform[5] as number) >= rect.y && (item.transform[5] as number) < rect.y + rect.height);

      // Every word of both groups is drawn, in order, and none of it escapes.
      expect(runs.flatMap((item) => item.str.trim().split(" ")), ruleset).toEqual(value.split(/\s+/));
      for (const run of runs) {
        expect(run.transform[5], `${ruleset} baseline`).toBeGreaterThanOrEqual(rect.y - 0.5);
        expect(run.transform[5], `${ruleset} baseline`).toBeLessThanOrEqual(rect.y + rect.height);
        expect(run.transform[4], `${ruleset} left`).toBeGreaterThanOrEqual(rect.x - 0.5);
        expect(run.transform[4] + run.width, `${ruleset} right`).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
      }
    }
  }, 120_000);

  // A multiline widget's own form appearance broke the value at its newlines,
  // so the drawn replacement has to as well: the Resistances box's groups are
  // separate statements and running them together reads as one sentence.
  it("draws each line of a multiline value on its own baseline", async () => {
    const value = "Resistances: Acid, Fire\nImmunities: Poison";
    const model = {
      characterId: "Defence lines",
      mode: "full" as const,
      pageCount: 1,
      pages: [{ page: 1, templateKind: "details" as const, sections: [] }],
      formValues: { details_resistances: value },
    };

    for (const ruleset of ["2014", "2024"] as const) {
      const bundle = localTemplateBundle(ruleset);
      // The template's own widget rectangle is the authority for the box.
      const source = await PDFDocument.load(bundle.details);
      const rect = source.getForm().getTextField("details_resistances").acroField
        .getWidgets()[0]!.getRectangle();

      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, bundle);
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      const content = await (await browserPdf.getPage(1)).getTextContent();
      const items = content.items
        .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
        .filter((item) => item.str.trim() !== "");

      const lineOf = (label: string): (typeof items)[number] => {
        const matched = items.filter((item) => item.str.trim().startsWith(label));
        expect(matched, `${ruleset} ${label}`).toHaveLength(1);
        return matched[0]!;
      };
      const resistances = lineOf("Resistances:");
      const immunities = lineOf("Immunities:");
      // The second group starts a line of its own, below the first.
      expect(immunities.transform[5], `${ruleset} line order`)
        .toBeLessThan(resistances.transform[5] as number);
      for (const line of [resistances, immunities]) {
        expect(line.transform[5], `${ruleset} baseline`).toBeGreaterThanOrEqual(rect.y - 0.5);
        expect(line.transform[5], `${ruleset} baseline`).toBeLessThanOrEqual(rect.y + rect.height);
        expect(line.transform[4], `${ruleset} left`).toBeGreaterThanOrEqual(rect.x - 0.5);
        expect(line.transform[4] + line.width, `${ruleset} right`).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
      }
    }
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

  // The reported bug: a 2024 weapon whose property list carries a
  // "Mastery: <Name>" suffix wrapped to two lines in the NOTES column, and the
  // single-line cell clipped the second line through its middle. The cell that
  // fixed it was then sized to the panel's whole spare budget — 86pt wide over
  // the row's full 21pt pitch — so the longest list the 2024 weapons produce
  // prints at the full 6pt instead of shrinking to 4.75pt to wrap.
  it("prints a long 2024 weapon note in full inside its notes cell", async () => {
    const long = "Heavy, Reach, Two-Handed, Mastery: Cleave";
    const longest = "Ammunition, Heavy, Loading, Two-Handed, Mastery: Push";
    // The longest property list in the 2024 weapon table, the Lance's.
    const lance = "Reach, Special, Special Lance, Heavy, Mastery: Topple";
    const short = "Versatile, Mastery: Sap";
    const model = {
      characterId: "Cleaver",
      mode: "full" as const,
      pageCount: 1,
      pages: [{ page: 1, templateKind: "details" as const, sections: [] }],
      formValues: {
        details_attack1_weapon: "Glaive",
        details_attack1_damage: "1d10+4 Slashing",
        details_attack1_description: long,
        details_attack2_description: longest,
        details_attack3_damage: "1d8+2 Piercing",
        details_attack3_description: short,
        details_attack4_description: lance,
      },
    };

    // The template's own widget rectangles are the authority for each cell.
    const bundle = localTemplateBundle("2024");
    const source = await PDFDocument.load(bundle.details);
    const rectOf = (name: string): { x: number; y: number; width: number; height: number } =>
      source.getForm().getTextField(name).acroField.getWidgets()[0]!.getRectangle();

    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, bundle);
    const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const content = await (await browserPdf.getPage(1)).getTextContent();
    // pdfjs coalesces each drawn line into one item; a clipped line is still
    // reported, with a baseline outside the widget, which is what this catches.
    const items = content.items
      .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
      .filter((item) => item.str.trim() !== "");

    // The cell is the one the generator lays out: the NOTES column's full width
    // over the row's full pitch.
    for (let row = 1; row <= 4; row += 1) {
      const rect = rectOf(`details_attack${row}_description`);
      expect({ width: rect.width, height: rect.height }, `row ${row} cell`).toEqual({ width: 86, height: 21 });
    }
    // A note's lines are the drawn items inside its own cell; picking them by
    // text alone would catch a weapon name that reads as part of a note.
    const linesOf = (row: number, note: string): typeof items => {
      const rect = rectOf(`details_attack${row}_description`);
      return items.filter((item) => note.includes(item.str.trim()) && item.str.trim().length > 1 &&
        item.transform[4] >= rect.x - 0.5 && item.transform[5] >= rect.y - 0.5 && item.transform[5] <= rect.y + rect.height);
    };
    for (const [row, note] of [[1, long], [2, longest], [3, short], [4, lance]] as const) {
      const rect = rectOf(`details_attack${row}_description`);
      const lines = linesOf(row, note);
      // Every word of the note is drawn, and drawn inside the cell.
      expect(lines.flatMap((item) => item.str.trim().split(" ")), note).toEqual(note.split(" "));
      for (const line of lines) {
        expect(line.transform[5], `${note} baseline`).toBeGreaterThanOrEqual(rect.y - 0.5);
        expect(line.transform[5], `${note} baseline`).toBeLessThanOrEqual(rect.y + rect.height);
        expect(line.transform[4], `${note} left`).toBeGreaterThanOrEqual(rect.x - 0.5);
        expect(line.transform[4] + line.width, `${note} right`).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
        // The cell is wide and tall enough that no 2024 property list has to
        // shrink: every line of every one of them is drawn at the full 6pt.
        expect(Math.hypot(line.transform[2], line.transform[3]), `${note} size`).toBeCloseTo(6, 5);
      }
    }
    // The long notes wrapped rather than shrinking to an unreadable single line.
    expect(linesOf(1, long).length).toBeGreaterThan(1);
    expect(linesOf(2, longest).length).toBeGreaterThan(1);
    expect(linesOf(4, lance).length).toBeGreaterThan(1);
    // Two lines, not three: the wrapped note reads as a pair of full lines.
    expect(linesOf(4, lance).length).toBe(2);
    // A one-line note still sits level with the rest of its row.
    const baselineOf = (value: string): number => items.find((item) => item.str.trim() === value)!.transform[5] as number;
    expect(Math.abs(baselineOf(short) - baselineOf("1d8+2 Piercing"))).toBeLessThanOrEqual(0.6);
  }, 120_000);

  // The reported defect behind the notes cell's 0.9pt lift: the note read as
  // sitting under the rest of its row. The writer places the two kinds of line
  // by different rules — a single-line value is centred on its box by cap
  // height, a wrapped cell's first baseline is a fixed `top - 2 - size` inset —
  // so sharing the row's top left the 6pt note half a point under the 7pt
  // values' baseline and more than a point under their cap top. The cell's top
  // is now 604.9 rather than 604, which is the one number that holds both
  // errors inside half a point for every body face: the value baseline moves
  // with the face's cap height and the note's does not, so the two cannot be
  // made to coincide, only balanced.
  it("sets a 2024 weapon note's first line level with its row in every body face", async () => {
    const model = {
      characterId: "Level",
      mode: "full" as const,
      pageCount: 1,
      pages: [{ page: 1, templateKind: "details" as const, sections: [] }],
      formValues: {
        details_attack1_weapon: "Glaive",
        details_attack1_range: "10 ft",
        details_attack1_attack: "+7",
        details_attack1_damage: "1d10+4 Slashing",
        details_attack1_description: "Heavy, Reach, Two-Handed, Mastery: Cleave",
        details_attack2_weapon: "Dagger",
        details_attack2_range: "20/60",
        details_attack2_attack: "+9",
        details_attack2_damage: "1d4+4 Piercing",
        details_attack2_description: "Versatile, Mastery: Sap",
      },
    };
    // Every face the sheet offers for body text, since the values' baseline
    // depends on the face's cap height and the note's does not.
    for (const body of ["helvetica", "spectral", "alegreyaSans"] as SheetFontFaceName[]) {
      const bundle = localTemplateBundle("2024", { ...DEFAULT_SHEET_FONTS, body });
      const source = await PDFDocument.load(bundle.details);
      const rectOf = (name: string): { x: number; y: number; width: number; height: number } =>
        source.getForm().getTextField(name).acroField.getWidgets()[0]!.getRectangle();
      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, bundle);
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      const content = await (await browserPdf.getPage(1)).getTextContent();
      const items = content.items
        .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
        .filter((item) => item.str.trim() !== "");
      const sizeOf = (item: (typeof items)[number]): number => Math.hypot(item.transform[2], item.transform[3]);

      for (const row of [1, 2]) {
        const values = model.formValues as Record<string, string>;
        const box = rectOf(`details_attack${row}_weapon`);
        const cell = rectOf(`details_attack${row}_description`);
        const drawn = (value: string): (typeof items)[number] => items.find((item) => item.str.trim() === value)!;
        // The face's cap-height ratio, read back from how the writer centred
        // the row's own values on their box rather than from the font file.
        const value = drawn(values[`details_attack${row}_weapon`]!);
        const ratio = (box.y + box.height / 2 - (value.transform[5] as number)) * 2 / sizeOf(value);
        expect(ratio, `${body} row ${row} cap ratio`).toBeGreaterThan(0.45);
        // The note's first line is its topmost line inside its own cell; the
        // NOTES caption sits above the cell, on its own baseline at y 605.
        const first = items
          .filter((item) => item.transform[4] >= cell.x - 0.5 && item.transform[4] < cell.x + cell.width &&
            (item.transform[5] as number) >= cell.y && (item.transform[5] as number) < cell.y + cell.height)
          .sort((a, b) => (b.transform[5] as number) - (a.transform[5] as number))[0]!;
        expect(sizeOf(first), `${body} row ${row} note size`).toBeCloseTo(6, 5);
        const noteBaseline = first.transform[5] as number;
        const noteCapTop = noteBaseline + ratio * sizeOf(first);
        // Every value on the row shares one baseline, and the note agrees with
        // it — and with the cap top the reader's eye actually follows — to
        // inside 0.6pt, which is what reads as level at this size.
        for (const field of ["weapon", "range", "attack", "damage"] as const) {
          const item = drawn(values[`details_attack${row}_${field}`]!);
          const baseline = item.transform[5] as number;
          expect(Math.abs(noteBaseline - baseline), `${body} row ${row} ${field} baseline`).toBeLessThanOrEqual(0.6);
          expect(Math.abs(noteCapTop - (baseline + ratio * sizeOf(item))), `${body} row ${row} ${field} cap top`)
            .toBeLessThanOrEqual(0.6);
        }
      }
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

  // A host logo is painted over the template's die mark by knocking the badge
  // out in white. The masthead rule runs across that box and the name plate
  // sits just below it, so a knockout that grows past the badge erases sheet
  // artwork — which is what broke the header rule under the DM Forge mark.
  it("keeps a host logo's knockout inside the masthead badge and repaints the rule", async () => {
    const model = {
      characterId: "Ada",
      mode: "full" as const,
      pageCount: 1,
      pages: [{ page: 1, templateKind: "details" as const, sections: [] }],
      formValues: { details_character_name: "Ada" },
    };
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, fullTemplateBundle(), { brandImage: PIXEL_PNG });
    const operators = await pageOperators(pdf);

    const badge = SHEET_TEMPLATE_CONTRACT.masthead;
    const box = {
      left: badge.badgeCenterX - badge.badgeSize / 2,
      bottom: badge.badgeCenterY - badge.badgeSize / 2,
      size: badge.badgeSize,
    };
    const origin = /1 1 1 rg[\s\S]*?1 0 0 1 ([\d.]+) ([\d.]+) cm/.exec(operators);
    const extent = /1 1 1 rg[\s\S]*?0 ([\d.]+) l\s+([\d.]+) \1 l/.exec(operators);
    expect(origin).not.toBeNull();
    expect(extent).not.toBeNull();
    const left = Number(origin![1]);
    const bottom = Number(origin![2]);
    const height = Number(extent![1]);
    const width = Number(extent![2]);
    // A hair of bleed covers antialiasing; more than that reaches the name plate.
    expect(left).toBeGreaterThanOrEqual(box.left - 1);
    expect(bottom).toBeGreaterThanOrEqual(box.bottom - 1);
    expect(left + width).toBeLessThanOrEqual(box.left + box.size + 1);
    expect(bottom + height).toBeLessThanOrEqual(box.bottom + box.size + 1);

    // The slice of the masthead rule the knockout took is painted back.
    const repaint = new RegExp(`([\\d.]+) ${badge.rule.y} m\\s+(?:[\\d.]+ ${badge.rule.y} m\\s+)?([\\d.]+) ${badge.rule.y} l`).exec(operators);
    expect(repaint).not.toBeNull();
    expect(Number(repaint![1])).toBeLessThanOrEqual(left + SHEET_TEMPLATE_CONTRACT.ornament.capRadius * 2);
    expect(Number(repaint![2])).toBeGreaterThanOrEqual(left + width);
  }, 60_000);

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
