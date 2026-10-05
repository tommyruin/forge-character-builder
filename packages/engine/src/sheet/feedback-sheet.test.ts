import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { mergeSheetSpellcasters } from "./spell-groups.js";
import { isSheetTemplateSet, SHEET_FONT_FACES } from "./template-contract.js";
import type { SpellcasterDto } from "../magic/dto.js";

const caster = (name: string, kind: "class" | "feature", ability = "Wisdom", attackModifier = 5, usage?: string): SpellcasterDto => ({
  name, kind, ability, attackModifier, saveDc: 13, identifier: name, prepareCount: 4,
  requiresPreparation: kind === "class", slotsPerLevel: kind === "class" ? [4, 2] : [],
  resource: { mode: "slots" },
  knownSpells: [
    { id: `${name}-cantrip`, name: `${name} Cantrip`, level: 0, isPrepared: false, isAlwaysPrepared: false, source: "PHB" },
    { id: "aid", name: "Aid", level: 2, isPrepared: true, isAlwaysPrepared: false, source: "PHB", usage },
  ],
} as SpellcasterDto);

describe("printed spell lists", () => {
  it("folds a feat caster with matching statistics into its class list, labelled with the feat and free casts", () => {
    const lists = mergeSheetSpellcasters([caster("Druid", "class"), caster("Magic Initiate (Druid)", "feature", "Wisdom", 5, "1/Long Rest")]);
    expect(lists.map((list) => list.name)).toEqual(["Druid"]);
    expect(lists[0]!.knownSpells.find((spell) => spell.id === "Magic Initiate (Druid)-cantrip")?.usage).toBe("[Magic Initiate (Druid)]");
    expect(lists[0]!.knownSpells.filter((spell) => spell.id === "aid")).toHaveLength(1);
    expect(lists[0]!.knownSpells.find((spell) => spell.id === "aid")?.usage).toBe("[Magic Initiate (Druid) - 1/Long Rest]");
  });

  it("keeps a separate list for a different casting ability, attack bonus or slotless level, and never merges two classes", () => {
    const lists = mergeSheetSpellcasters([
      caster("Sorcerer", "class", "Charisma", 6),
      caster("Fighter", "class", "Intelligence", 4),
      caster("Fey Touched", "feature", "Intelligence", 4),
      caster("Wizard", "class", "Intelligence", 4),
      caster("Staff", "feature", "Charisma", 7),
    ]);
    expect(lists.map((list) => list.name)).toEqual(["Sorcerer", "Fighter", "Wizard", "Staff"]);
    const unslotted = mergeSheetSpellcasters([{ ...caster("Ranger", "class"), slotsPerLevel: [2] }, caster("Fey Touched", "feature")]);
    expect(unslotted.map((list) => list.name)).toEqual(["Ranger", "Fey Touched"]);
  });

  it("accepts Hybrid without changing the saved 2014/2024 values and offers readable title fonts", () => {
    expect(isSheetTemplateSet("2024-hybrid")).toBe(true);
    expect(isSheetTemplateSet("2014")).toBe(true);
    expect(isSheetTemplateSet("2024")).toBe(true);
    expect(SHEET_FONT_FACES.helvetica.roles).toContain("titles");
    expect(SHEET_FONT_FACES.alegreyaSans.roles).toContain("titles");
  });
});

describe("2024 Hybrid features", () => {
  const line = (text: string) => ({ kind: "lines" as const, lines: [text] });
  const model = {
    characterId: "Hybrid features", mode: "lite" as const, pageCount: 1,
    pages: [{
      page: 1, templateKind: "details" as const,
      sections: [{ title: "features", rows: [line("Spellcasting. Class prose."), line("Wild Shape. Subclass prose."), line("Alert. Feat prose.")] }],
      featureGroups: {
        "class-features": [line("Spellcasting. Class prose.")],
        "subclass-features": [line("Wild Shape. Subclass prose.")],
        feats: [line("Alert. Feat prose.")],
      },
    }],
  };

  async function placements(set: "2024" | "2024-hybrid") {
    const bundle = localTemplateBundle(set);
    const form = (await PDFDocument.load(bundle.details)).getForm();
    const rect = (name: string) => form.getFields().some((field) => field.getName() === name)
      ? form.getTextField(name).acroField.getWidgets()[0]!.getRectangle() : undefined;
    const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, bundle)) }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((item) => "str" in item);
    const inside = (text: string, field: string): boolean => {
      const box = rect(field);
      const item = items.find((candidate) => "str" in candidate && candidate.str.startsWith(text));
      if (box === undefined || item === undefined || !("transform" in item)) return false;
      const [x, y] = [item.transform[4] as number, item.transform[5] as number];
      return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    };
    return { inside, hasField: (name: string) => rect(name) !== undefined };
  }

  it("prints class features, subclass features and feats in their own boxes", async () => {
    const hybrid = await placements("2024-hybrid");
    expect(hybrid.inside("Spellcasting.", "details_features")).toBe(true);
    expect(hybrid.inside("Wild Shape.", "details_subclass_features")).toBe(true);
    expect(hybrid.inside("Alert.", "details_feats")).toBe(true);
  });

  it("continues overflowing subclass features in full on a labelled page", async () => {
    const long = Array.from({ length: 400 }, (_, index) => `word${index}`).join(" ");
    const overflowing = { ...model, pages: [{ ...model.pages[0]!, featureGroups: { ...model.pages[0]!.featureGroups, "subclass-features": [line(`Starry Form. ${long}`)] } }] };
    const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(overflowing, localTemplateBundle("2024-hybrid"))) }).promise;
    const pages: string[] = [];
    for (let index = 1; index <= doc.numPages; index++) {
      pages.push((await (await doc.getPage(index)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain("FEATURES (CONTINUED)");
    expect(pages[1]).toContain("Subclass Features (continued)");
    const words = pages.join(" ").match(/word\d+/g) ?? [];
    expect(new Set(words).size).toBe(400);
  });

  it("keeps every feature in the single 2024 box", async () => {
    const modern = await placements("2024");
    expect(modern.hasField("details_subclass_features")).toBe(false);
    for (const text of ["Spellcasting.", "Wild Shape.", "Alert."]) expect(modern.inside(text, "details_features")).toBe(true);
  });
});
