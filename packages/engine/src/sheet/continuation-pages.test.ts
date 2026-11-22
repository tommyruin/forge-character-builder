/**
 * Text a page's boxes cannot hold continues on plain continuation pages,
 * named by the box's own printed title and wrapped at the continuation page's
 * width, never on a further copy of the page and never clipped away.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument, PDFTextField } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { inventoryRuns } from "./card-layout.js";
import type { CharacterSheetModel, SheetPage } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";

const tokens = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
const line = (text: string) => ({ kind: "lines" as const, lines: [text] });

interface Item { str: string; x: number; y: number; width: number; size: number }

async function render(page: SheetPage, formValues: Record<string, string> = {}, bundle = localTemplateBundle("2014")) {
  const model: CharacterSheetModel = { characterId: "Continued", mode: "full", pageCount: 1, pages: [page], formValues };
  const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, bundle)) }).promise;
  const pages: Item[][] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    pages.push((await (await doc.getPage(index)).getTextContent()).items.flatMap((item) => "str" in item && item.str.trim() !== ""
      ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, size: Math.hypot(item.transform[2] as number, item.transform[3] as number) }]
      : []));
  }
  const text = pages.map((items) => items.map((item) => item.str).join(" "));
  /** Every `prefix` token across the document, each one once. */
  const words = (prefix: string) => text.join(" ").match(new RegExp(`\\b${prefix}\\d+\\b`, "g")) ?? [];
  return { pages, text, words };
}

describe("continuation pages", () => {
  it("sets every part at the features' size, list boxes included", async () => {
    const written = await render({
      page: 1, templateKind: "details",
      sections: [
        { title: "features", rows: [line(`Spellcasting. ${tokens("feature", 1200)}`)] },
        { title: "proficiencies", rows: [line(`Tools. ${tokens("prof", 300)}`)] },
      ],
    });
    const continued = written.pages.slice(1).flat().filter((item) => item.y > 48 && item.y < 730);
    expect(continued.some((item) => item.str.includes("Proficiencies & Languages"))).toBe(true);
    expect([...new Set(continued.map((item) => item.size.toFixed(2)))]).toEqual(["8.00"]);
  }, 60_000);

  it("names a box by the title its page prints, whatever that title is", async () => {
    const base = localTemplateBundle("2014");
    const renamed = Object.fromEntries(Object.entries(base.labels).map(([file, entry]) => [file, {
      ...entry,
      labels: entry.labels.map((label) => label.text === "PROFICIENCIES & LANGUAGES" ? { ...label, text: "PROFICIENCIES, TRAINING, LANGUAGES & SENSES" } : label),
    }]));
    const written = await render({
      page: 1, templateKind: "details",
      sections: [{ title: "proficiencies", rows: [line(`Tools. ${tokens("prof", 300)}`)] }],
    }, {}, { ...base, labels: renamed });
    expect(written.text.slice(1).join(" ")).toContain("Proficiencies, Training, Languages & Senses (continued)");
  }, 60_000);

  it("continues a details box that would have clipped below the features", async () => {
    const written = await render({ page: 1, templateKind: "details", sections: [] }, {
      details_resistances: tokens("resist", 120),
    });
    expect(written.pages.length).toBe(2);
    // With no feature text continued, the page is the character page's.
    expect(written.text[1]).toContain("CHARACTER (CONTINUED)");
    expect(written.words("resist")).toHaveLength(120);
    expect(new Set(written.words("resist")).size).toBe(120);
  }, 60_000);

  it("continues a long backstory on a background continuation page", async () => {
    const written = await render({ page: 2, templateKind: "background", sections: [] }, {
      background_story: `${tokens("story", 900)}\n${tokens("tail", 40)}`,
    });
    expect(written.pages.length).toBe(2);
    expect(written.text[1]).toContain("BACKGROUND (CONTINUED)");
    expect(written.text[1]).toContain("Background Story (continued)");
    // The box keeps its own size and the page after carries the rest.
    expect(Math.min(...written.pages[0]!.filter((item) => /story\d/.test(item.str)).map((item) => item.size))).toBeGreaterThan(4.5);
    for (const [prefix, count] of [["story", 900], ["tail", 40]] as const) {
      expect(written.words(prefix), prefix).toHaveLength(count);
      expect(new Set(written.words(prefix)).size, prefix).toBe(count);
    }
  }, 60_000);

  describe("attack notes after continued features", () => {
    const features = { title: "features", rows: [line(`Spellcasting. ${tokens("feature", 700)}`)] };
    const details = (notes: number, withFeatures = true) => render(
      { page: 1, templateKind: "details", sections: withFeatures ? [features] : [] },
      { details_attack_description: tokens("note", notes) },
    );

    it("carries on below the continued features when they fit, not on a page of their own", async () => {
      const written = await details(120);
      expect(written.pages).toHaveLength(2);
      expect(written.text[1]).toContain("FEATURES & TRAITS (CONTINUED)");
      expect(written.text[1]).toContain("Attack Notes");
      expect(written.text[1]).toContain("General attack notes");
      expect(written.text.join(" ")).not.toContain("ATTACK NOTES");
      expect(written.words("feature")).toHaveLength(700);
      expect(written.words("note")).toHaveLength(120);
      // Under the last feature line, with its heading between.
      const lastFeature = Math.min(...written.pages[1]!.filter((item) => /^feature\d/.test(item.str)).map((item) => item.y));
      const heading = written.pages[1]!.find((item) => item.str.includes("Attack Notes"))!;
      const firstNote = Math.max(...written.pages[1]!.filter((item) => /^note\d/.test(item.str)).map((item) => item.y));
      expect(heading.y).toBeLessThan(lastFeature);
      expect(firstNote).toBeLessThan(heading.y);
    }, 60_000);

    it("still spills onto a further page when there is too much to fit", async () => {
      const written = await details(1500);
      expect(written.pages.length).toBeGreaterThan(2);
      expect(written.text[1]).toContain("Attack Notes");
      expect(written.text[2]).toContain("ATTACK NOTES");
      expect(written.text[2]).toContain("General attack notes (continued)");
      expect(written.words("note")).toHaveLength(1500);
      expect(new Set(written.words("note")).size).toBe(1500);
    }, 60_000);

    it("keeps attack notes on their own page when the features did not continue", async () => {
      const written = await details(120, false);
      expect(written.pages).toHaveLength(2);
      expect(written.text[1]).toContain("ATTACK NOTES");
      expect(written.text[1]).not.toContain("Attack Notes");
      expect(written.words("note")).toHaveLength(120);
    }, 60_000);
  });

  it("continues companion traits the box cannot hold", async () => {
    const written = await render({
      page: 4, templateKind: "companion",
      sections: [{ title: "companion-features", rows: [line(`Pack Tactics. ${tokens("pack", 1500)}`)] }],
    });
    expect(written.pages.length).toBeGreaterThan(1);
    expect(written.text[1]).toContain("COMPANION (CONTINUED)");
    expect(written.text[1]).toContain("Traits & Actions (continued)");
    expect(written.words("pack")).toHaveLength(1500);
    expect(new Set(written.words("pack")).size).toBe(1500);
  }, 60_000);

  it("continues the equipment notes column on plain pages, not on copies of the inventory page", async () => {
    const sidebars = Array.from({ length: 40 }, (_, index) => ({
      title: `Winged Boots ${index + 1}`,
      html: `<p>While you wear these boots, you have a flying speed equal to your walking speed. ${tokens(`boots${index}x`, 30)}</p>`,
    }));
    const written = await render({
      page: 3, templateKind: "equipment",
      sections: [{ title: "inventory", rows: [], positionedRuns: inventoryRuns([[], []], sidebars) }],
    });
    expect(written.pages.length).toBeGreaterThan(1);
    expect(written.text.filter((text) => text.includes("ADVENTURING GEAR"))).toHaveLength(1);
    for (const text of written.text.slice(1)) expect(text).toContain("EQUIPMENT (CONTINUED)");
    expect(written.text[1]).toContain("Inventory — Item Descriptions & Notes (continued)");
    // Rewrapped at the page's width, wider than the column it came from.
    expect(Math.max(...written.pages[1]!.map((item) => item.x + item.width))).toBeGreaterThan(400);
    const all = written.text.join(" ");
    for (let index = 0; index < sidebars.length; index++) expect(all, `boots ${index}`).toContain(`boots${index}x29`);
  }, 60_000);
});

describe("text placed in template boxes", () => {
  /** Widget rectangles of `set`'s character page. */
  async function rects(set: "2014" | "2024") {
    const form = (await PDFDocument.load(localTemplateBundle(set).details)).getForm();
    return (name: string) => form.getTextField(name).acroField.getWidgets()[0]!.getRectangle();
  }
  const within = (items: readonly Item[], box: { x: number; y: number; width: number; height: number }) =>
    items.filter((item) => item.x >= box.x - 0.5 && item.x <= box.x + box.width && item.y >= box.y - 0.5 && item.y <= box.y + box.height);

  it.each(["2014", "2024"] as const)("holds every rich-text box's first line the same distance under its top on %s", async (set) => {
    const rect = await rects(set);
    const written = await render({
      page: 1, templateKind: "details",
      sections: [
        // Long enough that the features shrink to fit, so the inset is checked
        // at a size other than the box's own.
        { title: "features", rows: [line(`Spellcasting. ${tokens("feature", 380)}`)] },
        { title: "racial-traits", rows: [line("Darkvision. You can see in dim light.")] },
        { title: "proficiencies", rows: [line("Armor Proficiencies. Light Armor")] },
      ],
    }, {}, localTemplateBundle(set));
    // On 2024 the one-line species gives its room to the features, so their box
    // starts higher than the template drew it, by as far as its title moved
    // (the Species Traits title stays put).
    const titles = localTemplateBundle(set).labels["details.pdf"]!.labels;
    const moved = (title: string): number => {
      const drawn = written.pages[0]!.find((item) => item.str === title);
      const printed = titles.find((label) => label.text === title);
      return drawn === undefined || printed === undefined ? 0 : drawn.y - printed.y;
    };
    const lift = moved("CLASS FEATURES") - moved("SPECIES TRAITS");
    const sizes = new Set<string>();
    for (const field of ["details_features", "details_additional_notes", "details_proficiencies_languages"]) {
      const template = rect(field);
      const box = field === "details_features" ? { ...template, height: template.height + lift } : template;
      const first = within(written.pages[0]!, box).reduce((top, item) => (item.y > top.y ? item : top));
      sizes.add(first.size.toFixed(1));
      // Helvetica's cap height is 718/1000 of the size.
      expect(box.y + box.height - (first.y + 0.718 * first.size), field).toBeCloseTo(4, 1);
    }
    expect(sizes.size).toBeGreaterThan(1);
  }, 60_000);

  it("keeps wrapped lines inside the box's inset at their drawn width", async () => {
    // Capitals with kerning pairs measure narrower kerned than they draw.
    const kerned = Array.from({ length: 60 }, () => "AVATAR WAVY TOWAY").join(" ");
    const written = await render({ page: 1, templateKind: "details", sections: [{ title: "features", rows: [line(`Wards. ${kerned}`)] }] });
    const box = (await rects("2014"))("details_features");
    for (const item of within(written.pages[0]!, box)) {
      expect(item.x + item.width, item.str).toBeLessThanOrEqual(box.x + box.width - 3 + 0.05);
    }
  }, 60_000);

  it("never shrinks a one-line value below the readable floor: it is cut with an ellipsis and printed in full", async () => {
    const build = "Level 20 Mountain Dwarf Druid, Circle of the Stars (5) / Warlock, The Genie (4) / Cleric, Unity Domain (4) / Fighter, Psi Warrior (4) / Rogue, Arcane Trickster (3)";
    const written = await render({ page: 1, templateKind: "details", sections: [] }, { details_build: build });
    const shown = within(written.pages[0]!, (await rects("2014"))("details_build"));
    expect(shown).toHaveLength(1);
    expect(shown[0]!.size).toBeCloseTo(5.5, 2);
    expect(shown[0]!.str).toMatch(/^Level 20 Mountain Dwarf .*…$/);
    expect(written.text[1]).toContain(`${shown[0]!.str} (in full)`);
    expect(written.text[1]).toContain(build);
  }, 60_000);

  // A synthetic range too long for the Range cell, of no shape the short form knows.
  const longRange = "Self (a long synthetic aura that rolls out around the caster)";
  const attackRow = { name: "Shadow Ring", range: longRange, bonus: "DC 13 STR", damage: "2d6 necrotic", note: "" };

  it("prints a cut-off attack cell in full when no card carries the row", async () => {
    const written = await render({ page: 1, templateKind: "details", sections: [], attacks: [attackRow] }, { details_attack1_range: longRange });
    expect(written.text[0]).toMatch(/Self \(a long.*…/);
    expect(written.text[1]).toContain("(in full)");
    expect(written.text[1]).toContain(longRange);
  }, 60_000);

  it("keeps the ellipsis and adds no continuation when the row's spell or weapon prints on a card", async () => {
    const written = await render(
      { page: 1, templateKind: "details", sections: [], attacks: [{ ...attackRow, carded: true }] },
      { details_attack1_range: longRange, details_build: "Level 20 Mountain Dwarf Druid, Circle of the Stars (5) / Warlock, The Genie (4) / Cleric, Unity Domain (4) / Fighter, Psi Warrior (4) / Rogue, Arcane Trickster (3)" },
    );
    expect(written.text[0]).toMatch(/Self \(a long.*…/);
    // Another one-line cell cut short still continues; the attack's range does not.
    expect(written.text[1]).toContain("(in full)");
    expect(written.text.slice(1).join(" ")).not.toContain(longRange);
  }, 60_000);
});

describe("no value hidden in a template box", () => {
  // The boxes the writer fills from the model's sections, not from their values.
  const HAND_DRAWN = /^details_(features|subclass_features|feats|proficiencies_languages|additional_notes)$/;
  // Long attack notes move whole to the attack-note pages, leaving a pointer.
  const ATTACK_NOTE = /^details_attack\d*_description$/;

  it.each([["2014", {}], ["2014", { top: true }], ["2024", {}], ["2024", { top: false }], ["2024-hybrid", {}], ["2024-hybrid", { top: false }]] as const)(
    "shows every %s %j field's value whole, or marks the cut and prints all of it",
    async (set, layout) => {
      const bundle = localTemplateBundle(set, undefined, layout);
      const fields = (await PDFDocument.load(bundle.details)).getForm().getFields()
        .filter((field): field is PDFTextField => field instanceof PDFTextField && !HAND_DRAWN.test(field.getName()))
        .map((field, index) => ({ name: field.getName(), rect: field.acroField.getWidgets()[0]!.getRectangle(), prefix: `q${index}w` }));
      // Each field gets a value of its own, longer than any box holds, its
      // words told apart by field so each can be found again.
      const values = Object.fromEntries(fields.map(({ name, prefix }) => [name, tokens(prefix, 60)]));
      const written = await render({ page: 1, templateKind: "details", sections: [] }, values, bundle);
      const elsewhere = written.text.slice(1).join(" ");
      for (const { name, rect, prefix } of fields) {
        const shown = written.pages[0]!.filter((item) =>
          item.x >= rect.x - 0.5 && item.x <= rect.x + rect.width && item.y >= rect.y - 0.5 && item.y <= rect.y + rect.height);
        // Whatever is drawn in the box is visible: nothing runs past its edge.
        for (const item of shown) {
          expect(item.x + item.width, `${name} "${item.str}" right edge`).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
        }
        const inBox = shown.map((item) => item.str).join(" ");
        const words = Array.from({ length: 60 }, (_, index) => `${prefix}${index}`);
        if (words.every((word) => new RegExp(`\\b${word}\\b`).test(inBox))) continue;
        // Cut: the box says so, and every word is printed elsewhere.
        expect(inBox, `${name} marks its cut`).toMatch(ATTACK_NOTE.test(name) ? /See attack notes|…/ : /…/);
        for (const word of words) {
          expect(new RegExp(`\\b${word}\\b`).test(inBox) || new RegExp(`\\b${word}\\b`).test(elsewhere), `${name}: ${word}`).toBe(true);
        }
      }
    },
    120_000,
  );
});

describe("continued headings and whole words", () => {
  it("rules every continued heading on a continuation page, as inline group headings are", async () => {
    const model: CharacterSheetModel = {
      characterId: "Ruled", mode: "lite", pageCount: 1,
      pages: [{
        page: 1, templateKind: "details",
        sections: [
          { title: "racial-traits", rows: [line(`Ancestry. ${tokens("racial", 400)}`)] },
          { title: "features", rows: [line(`Spellcasting. ${tokens("feature", 900)}`)] },
          { title: "proficiencies", rows: [line(`Tools. ${tokens("prof", 200)}`)] },
        ],
      }],
    };
    const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle("2024"));
    const loaded = await PDFDocument.load(pdf);
    const { PDFArray, PDFStream, decodePDFRawStream } = await import("pdf-lib");
    const contents = loaded.getPages()[1]!.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => loaded.context.lookup(ref, PDFStream)) : [contents as InstanceType<typeof PDFStream>];
    const operators = streams.map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream as never).decode())).join("\n");
    // Rules across the continuation page's text width, one under each part line.
    const rules = [...operators.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) \2 l\s+S/g)].filter((match) => Math.abs(Number(match[3]) - Number(match[1]) - 524) < 0.01);
    const doc = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
    const parts = (await (await doc.getPage(2)).getTextContent()).items.filter((item) => "str" in item && item.str.endsWith("(continued)"));
    expect(parts.length).toBe(3);
    expect(rules).toHaveLength(parts.length);
  }, 60_000);

  it("never prints a soft hyphen: a word marked where it may break prints whole", async () => {
    const written = await render({ page: 1, templateKind: "details", sections: [{ title: "racial-traits", rows: [line("Healing Hands. Touch one tar­get and dam­age heals.")] }] });
    const text = written.text.join(" ");
    expect(text).toContain("target");
    expect(text).toContain("damage");
    expect(text).not.toMatch(/tar-get|dam-age/);
  }, 60_000);
});
