import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import {
  descriptionCardRuns,
  inventoryRuns,
  layoutHtmlRuns,
  resolveSpellCardOrigin,
  sortedLayoutTokens,
  type DescriptionCard,
  type LayoutRun,
} from "./card-layout.js";
import { winAnsiText } from "./text.js";
import { SHEET_TEMPLATE_CONTRACT } from "./template-contract.js";

const spell = (title: string, body: string): DescriptionCard => ({
  kind: "spell",
  title,
  subtitle: "Evocation Cantrip",
  metadata: [
    ["CASTING TIME", "1 action"],
    ["RANGE", "60 feet"],
    ["DURATION", "Instantaneous"],
    ["COMPONENTS", "V, S"],
  ],
  body,
  footer: "Spellcasting (Wizard)",
  footerRight: "Player’s Handbook",
});

describe("positioned card layout", () => {
  it("lays mixed styled chunks on shared baselines and in x order", () => {
    const runs = layoutHtmlRuns("<p>plain <strong>bold words</strong> <em>italic</em></p>", { x: 10, top: 100, width: 160, fontSize: 8 });
    expect(sortedLayoutTokens(runs)).toEqual(["plain", "bold", "words", "italic"]);
    expect(new Set(runs.map((run) => run.y))).toEqual(new Set([runs[0]!.y]));
    expect(runs.map((run) => run.x)).toEqual([...runs.map((run) => run.x)].sort((a, b) => a - b));
    expect(runs.map((run) => [run.text, run.style])).toEqual([
      ["plain", "regular"],
      ["bold", "bold"],
      ["words", "bold"],
      ["italic", "italic"],
    ]);
  });

  it("preserves nested bold-italic markup in card descriptions", () => {
    const runs = descriptionCardRuns([
      spell("Styled", "<p>Regular <strong>bold <em>both</em></strong> <i>italic</i></p>"),
    ]).filter((run) => run.role === "body");

    expect(runs.map((run) => [run.text, run.style])).toEqual([
      ["Regular", "regular"],
      ["bold", "bold"],
      ["both", "bold-italic"],
      ["italic", "italic"],
    ]);
  });

  it("applies subsequent-paragraph indentation and spacing", () => {
    const runs = layoutHtmlRuns("<p>first paragraph</p><p>second paragraph</p>", { x: 10, top: 100, width: 80, fontSize: 8 });
    const first = runs.find((run) => run.text === "first")!;
    const second = runs.find((run) => run.text === "second")!;
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeLessThanOrEqual(first.y - 8);
  });

  it("uses a bullet with hanging indentation for list content", () => {
    const runs = layoutHtmlRuns("<ul><li>long listed content wraps onto another line of prose</li></ul>", { x: 10, top: 100, width: 85, fontSize: 8 });
    const bullet = runs.find((run) => run.text === "\u0007")!;
    const listed = runs.filter((run) => run.text !== "\u0007");
    expect(bullet.x).toBeLessThan(listed[0]!.x);
    expect(Math.min(...listed.map((run) => run.x))).toBeGreaterThan(bullet.x);
  });

  it("clips top-row spell metadata labels while retaining body and lower-row metadata", () => {
    const cards = [spell("One", "top body remains visible"), spell("Two", "second body"), spell("Three", "third body"), spell("Four", "lower body")];
    const runs = descriptionCardRuns(cards);
    const top = runs.filter((run) => run.card === 0).map((run) => run.text);
    const lower = runs.filter((run) => run.card === 3).map((run) => run.text);
    expect(top.join(" ")).toContain("top body remains visible");
    expect(top.some((text) => text.startsWith("CASTING TIME"))).toBe(false);
    expect(lower).toContain("CASTING TIME");
    expect(lower).toContain("1 action");
  });

  it("places spell-description text at the measured field origins", () => {
    const runs = descriptionCardRuns([
      spell("One", "first body"),
      spell("Two", "second body"),
      spell("Three", "third body"),
    ]).filter((run) => run.role === "body");

    expect([0, 1, 2].map((card) => Math.min(...runs.filter((run) => run.card === card).map((run) => run.x)))).toEqual([31, 220, 409]);
    expect(new Set(runs.map((run) => run.y))).toEqual(new Set([683]));
    expect(new Set(runs.map((run) => run.fontSize))).toEqual(new Set([5]));
  });

  it("places spell headings and metadata inside their reference card bands", () => {
    const runs = descriptionCardRuns([spell("Alarm", "body")]);
    const title = runs.find((run) => run.role === "title")!;
    const subtitle = runs.find((run) => run.role === "subtitle")!;
    const values = runs.filter((run) => run.role === "metadata-value");

    expect(title).toMatchObject({ y: 752.5, style: "regular", align: "center" });
    expect(subtitle).toMatchObject({ y: 740, style: "italic", align: "center" });
    expect(values.map((run) => [run.text, run.x, run.y])).toEqual([
      ["1 action", 79.5, 727],
      ["60 feet", 79.5, 716],
      ["Instantaneous", 79.5, 705],
      ["V, S", 79.5, 694],
    ]);
    expect(runs.filter((run) => run.role === "footer").map((run) => [run.text, run.y, run.align])).toEqual([
      ["Spellcasting (Wizard)", 532.5, "left"],
      ["Player’s Handbook", 532.5, "right"],
    ]);
  });

  it("keeps a line-ending hyphen prefix on its measured baseline", () => {
    const runs = layoutHtmlRuns(
      "<p>A wave of thunderous force sweeps from you. Each creature in a 15-foot cube</p>",
      { x: 409, top: 683, width: 163.4, fontSize: 5, firstLineIndent: 5.56 },
    );
    const prefix = runs.find((run) => run.text === "15-")!;
    const suffix = runs.find((run) => run.text === "foot")!;

    expect(prefix.y).toBe(683);
    expect(suffix.y).toBe(678);
  });

  it("uses the measured four-space inset when prose flows beyond the short field band", () => {
    const body = Array.from({ length: 90 }, (_, index) => `word${index}`).join(" ");
    const first = descriptionCardRuns([spell("Long", body)]).find((run) => run.role === "body")!;

    expect(first.x).toBeCloseTo(36.56, 2);
    expect(first.y).toBe(683);
  });

  it("keeps long generic bodies based on geometry, without a card-count gate", () => {
    const body = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const runs = descriptionCardRuns([
      { kind: "generic", title: "One", subtitle: "Gear", metadata: [], body, footer: "Source" },
      { kind: "generic", title: "Two", subtitle: "Gear", metadata: [], body, footer: "Source" },
    ]);
    expect(runs.some((run) => run.card === 0 && run.text.includes("word79"))).toBe(true);
    expect(runs.some((run) => run.card === 1 && run.text.includes("word79"))).toBe(true);
  });

  it("continues long card bodies without placing text below the card body band", () => {
    const body = Array.from({ length: 600 }, (_, index) => `card-token-${index}`).join(" ");
    const runs = descriptionCardRuns([
      { kind: "generic", title: "Long", subtitle: "Gear", metadata: [], body, footer: "Source" },
    ]);
    const bodyRuns = runs.filter((run) => run.role === "body");

    expect(new Set(bodyRuns.map((run) => run.page ?? 0)).size).toBeGreaterThan(1);
    expect(bodyRuns.every((run) => run.y >= 532)).toBe(true);
    expect(bodyRuns.some((run) => run.text === "card-token-599")).toBe(true);
  });

  it("renders short top-row item descriptions at the reference 6pt size", () => {
    const runs = descriptionCardRuns([
      { kind: "generic", title: "Warning", subtitle: "Weapon", metadata: [], body: "<p>Visible item text.</p>", footer: "3 lb.", footerRight: "Source" },
    ]).filter((run) => run.role === "body");

    expect(runs.map((run) => run.text)).toEqual(["Visible", "item", "text."]);
    expect(new Set(runs.map((run) => run.y))).toEqual(new Set([728]));
    expect(new Set(runs.map((run) => run.fontSize))).toEqual(new Set([6]));
  });

  it("gives identical bodies identical visibility regardless of item type", () => {
    const body = Array.from({ length: 55 }, (_, index) => `token${index}`).join(" ");
    const cards: DescriptionCard[] = ["Weapon", "Armor", "Gear"].map((subtitle) => ({ kind: "generic", title: subtitle, subtitle, metadata: [], body, footer: "Source" }));
    const counts = cards.map((_, card) => descriptionCardRuns(cards).filter((run) => run.card === card && run.role === "body").flatMap((run) => run.text.split(/\s+/)).length);
    expect(new Set(counts).size).toBe(1);
  });

  it("sorts unequal prose by physical y then x rather than source row index", () => {
    const runs = descriptionCardRuns([spell("Long", "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"), spell("Short", "alpha beta")]);
    const tokens = sortedLayoutTokens(runs);
    expect(tokens.indexOf("alpha")).toBeLessThan(tokens.indexOf("sixteen"));
  });

  it("interleaves sidebar and table by y and preserves list bullets", () => {
    const tokens = sortedLayoutTokens(inventoryRuns(
      [[["Sword", "1", "3"]], [["Potion", "1", "—"]]],
      [{ title: "Tattoo", html: "<p>First paragraph.</p><ul><li>Critical benefit.</li></ul>" }],
    ));
    expect(tokens.slice(0, 5)).toEqual(["Tattoo.", "First", "paragraph.", "Sword", "1"]);
    expect(tokens).toContain("\u0007");
  });

  it("preserves the equipment sidebar heading style and reference leading", () => {
    const sidebar = inventoryRuns(
      [[], []],
      [{ title: "Hand Crossbow of Warning", html: "<p>This magic weapon warns you of danger.</p>" }],
    ).filter((run) => run.role === "sidebar");

    expect(sidebar[0]).toMatchObject({
      text: "Hand",
      x: SHEET_TEMPLATE_CONTRACT.equipmentNotes.x + 3,
      y: SHEET_TEMPLATE_CONTRACT.equipmentNotes.y + SHEET_TEMPLATE_CONTRACT.equipmentNotes.height - 10,
      fontSize: 7,
      style: "bold-italic",
    });
    expect(sidebar.find((run) => run.text === "This")).toMatchObject({
      y: SHEET_TEMPLATE_CONTRACT.equipmentNotes.y + SHEET_TEMPLATE_CONTRACT.equipmentNotes.height - 10,
      style: "regular",
    });
  });

  it("uses measured list leading and places the first inventory summary in its template band", () => {
    const runs = inventoryRuns(
      [[], []],
      [{ title: "Rules", html: "<ul><li>one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen</li></ul>" }],
      [["1", "/", "3"]],
    );
    const sidebar = runs.filter((run) => run.role === "sidebar");
    const summary = runs.find((run) => run.role === "table")!;
    const bullet = sidebar.find((run) => run.text === "\u0007")!;
    const firstListedWord = sidebar.find((run) => run.text === "one")!;
    const lowerLine = sidebar.find((run) => run.y < bullet.y)!;

    expect(sidebar[0]!.y - bullet.y).toBe(10);
    expect(firstListedWord.y).toBe(bullet.y);
    expect(bullet.y - lowerLine.y).toBe(10);
    expect(summary.y).toBe(510);
  });

  it("resolves pact, prepared, and ordinary spellcasting origins", () => {
    expect(resolveSpellCardOrigin({ caster: "Warlock", requiresPreparation: false, prepared: false, alwaysPrepared: false, pactMagic: true })).toBe("Pact Magic (Warlock)");
    expect(resolveSpellCardOrigin({ caster: "Druid", requiresPreparation: true, prepared: true, alwaysPrepared: false })).toBe("Prepared (Druid)");
    expect(resolveSpellCardOrigin({ caster: "Cleric", requiresPreparation: true, prepared: false, alwaysPrepared: false })).toBe("Spellcasting (Cleric)");
  });
});

/**
 * pdf.ts paints these runs one word at a time, advancing each word of a flowed
 * line past the one before it (drawPositionedRuns). Widths here are summed from
 * pdf-lib one glyph at a time -- never from the engine’s own measurer, and never
 * from widthOfTextAtSize, which subtracts kerning that a viewer does not apply --
 * so this reproduces independently what the page actually shows. A layout that
 * mis-measures wraps a word too late and prints past the edge of its box, which
 * is exactly what this guards against.
 */
function drawnWidth(font: PDFFont, text: string, size: number): number {
  return [...text].reduce((total, character) => total + font.widthOfTextAtSize(character, size), 0);
}

async function drawnBounds(runs: readonly LayoutRun[]) {
  const document = await PDFDocument.create();
  const fonts: Record<string, PDFFont> = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
    "bold-italic": await document.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const drawn: Array<{ text: string; overflow: number; y: number; page: number }> = [];
  let previous: { key: string; endX: number; space: number } | undefined;
  for (const run of runs) {
    const value = winAnsiText(run.text);
    if (value === "") continue;
    const font = fonts[run.style ?? "regular"]!;
    const size = run.fontSize ?? run.height;
    const width = drawnWidth(font, value, size);
    const key = `${run.page ?? 0}:${run.card ?? -1}:${run.role}:${run.y}`;
    let x = run.x;
    if (previous !== undefined && previous.key === key) x = Math.max(x, previous.endX + previous.space);
    drawn.push({ text: run.text, overflow: x + width - (run.x + run.width), y: run.y, page: run.page ?? 0 });
    previous = { key, endX: x + width, space: drawnWidth(font, " ", size) };
  }
  return drawn;
}

const wingedBoots = {
  title: "Winged Boots",
  html: "<p>While you wear these boots, you have a flying speed equal to your walking speed. You can use the boots to fly for up to 4 hours, all at once or in several shorter flights, each one using a minimum of 1 minute from the duration. If you are flying when the duration expires, you descend at a rate of 30 feet per round until you land.</p><p>The boots regain 2 hours of flying capability for every 12 hours they aren’t in use.</p>",
};
const cloakOfProtection = {
  title: "Cloak of Protection",
  html: "<p>You gain a +1 bonus to AC and saving throws while you wear this cloak.</p>",
};
const bagOfHolding = {
  title: "Bag of Holding",
  html: "<p>This bag has an interior space considerably larger than its outside dimensions, roughly 2 feet in diameter at the mouth and 4 feet deep. The bag can hold up to 500 pounds, not exceeding a volume of 64 cubic feet.</p>",
};

// The item-descriptions widget on the equipment template: x 410.243..578.706,
// y 192.603..760.521.
const NOTES_RIGHT_EDGE = 578.706;
const NOTES_FLOOR = 192.603;

describe("drawn text stays inside its box", () => {
  it("keeps inventory item descriptions inside the notes column", async () => {
    const runs = inventoryRuns([[], []], [wingedBoots, cloakOfProtection, bagOfHolding])
      .filter((run) => run.role === "sidebar");
    const drawn = await drawnBounds(runs);

    expect(drawn.length).toBeGreaterThan(50);
    expect(drawn.filter((word) => word.overflow > 0.001)).toEqual([]);
    expect(Math.max(...runs.map((run) => run.x + run.width))).toBeLessThanOrEqual(NOTES_RIGHT_EDGE);
    expect(Math.min(...runs.map((run) => run.y))).toBeGreaterThan(NOTES_FLOOR);
  });

  it("keeps spell and item card bodies inside their card bands", async () => {
    const cards: DescriptionCard[] = [
      spell("Thunderwave", "<p>A wave of thunderous force sweeps out from you. Each creature in a 15-foot cube originating from you must make a Constitution saving throw. On a failed save, a creature takes 2d8 thunder damage and is pushed 10 feet away from you.</p>"),
      { kind: "generic", title: "Bag of Holding", subtitle: "Wondrous Item", metadata: [], body: bagOfHolding.html, footer: "15 lb.", footerRight: "Dungeon Master’s Guide" },
    ];
    const drawn = await drawnBounds(descriptionCardRuns(cards));

    expect(drawn.filter((word) => word.overflow > 0.001)).toEqual([]);
  });

  it("shrinks the notes column rather than running off the page", async () => {
    const crowded = Array.from({ length: 8 }, (_, index) => ({
      title: `${wingedBoots.title} ${index + 1}`,
      html: wingedBoots.html,
    }));
    const runs = inventoryRuns([[], []], crowded).filter((run) => run.role === "sidebar");

    // Everything still lands on the first page, at a size the column can hold.
    expect(new Set(runs.map((run) => run.page ?? 0))).toEqual(new Set([0]));
    expect(Math.max(...runs.map((run) => run.fontSize ?? 0))).toBeLessThan(7);
    expect(Math.min(...runs.map((run) => run.y))).toBeGreaterThan(NOTES_FLOOR);
    expect((await drawnBounds(runs)).filter((word) => word.overflow > 0.001)).toEqual([]);
  });

  it("continues onto a further page when shrinking cannot rescue the column", async () => {
    const overwhelming = Array.from({ length: 40 }, (_, index) => ({
      title: `${wingedBoots.title} ${index + 1}`,
      html: wingedBoots.html,
    }));
    const runs = inventoryRuns([[], []], overwhelming).filter((run) => run.role === "sidebar");
    const pages = new Set(runs.map((run) => run.page ?? 0));

    expect(pages.size).toBeGreaterThan(1);
    // No page spills past the column, and none of the prose is dropped.
    expect(Math.min(...runs.map((run) => run.y))).toBeGreaterThan(NOTES_FLOOR);
    expect(runs.filter((run) => run.text === "Winged")).toHaveLength(overwhelming.length);
    expect((await drawnBounds(runs)).filter((word) => word.overflow > 0.001)).toEqual([]);
  });
});
