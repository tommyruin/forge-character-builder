/**
 * Text a page's boxes cannot hold continues on plain continuation pages,
 * named by the box's own printed title and wrapped at the continuation page's
 * width, never on a further copy of the page and never clipped away.
 */

import { describe, expect, it } from "vitest";
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
    const { PDFDocument } = await import("pdf-lib");
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
    const sizes = new Set<string>();
    for (const field of ["details_features", "details_additional_notes", "details_proficiencies_languages"]) {
      const box = rect(field);
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
});
