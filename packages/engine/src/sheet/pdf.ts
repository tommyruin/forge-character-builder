import type { SpellResourceDto } from "@forge-cb/api";
import type { CharacterSheetModel, SheetPage, SheetRow, SheetSection, SheetSpellListSection } from "./model.js";
import { CONTINUATION_PAGE_TEXT, type LayoutRun } from "./card-layout.js";
import { BOX_TEXT_TOP_INSET, LAYOUT_CAP_HEIGHT, READABLE_MIN_FONT_SIZE, measuredTextWidth, winAnsiText } from "./text.js";
import { SHEET_BASE_ATTACK_ROWS, attackDescriptionNote } from "./attack-notes.js";
import { decodeBase64 } from "../platform.js";
import {
  DEFAULT_SHEET_COLOURS,
  SHEET_FIXED_COLOURS,
  SHEET_PALETTE,
  SHEET_TEMPLATE_CONTRACT,
  type SheetColours,
  type SheetLayout,
  type SheetTemplateLabels,
} from "./template-contract.js";
import {
  PDFCheckBox,
  PDFDocument,
  StandardFontEmbedder,
  type PDFEmbeddedPage,
  type PDFForm,
  PDFName,
  type PDFRef,
  TextAlignment,
  PDFTextField,
  StandardFonts,
  clip,
  clipEvenOdd,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 32;
const CONTENT_TOP = 692;
const CONTENT_BOTTOM = 48;
const COLUMN_GAP = 14;
const COLUMN_WIDTH = (PAGE_WIDTH - PAGE_MARGIN * 2 - COLUMN_GAP) / 2;
const SECTION_TITLE_HEIGHT = 17;
const SECTION_PADDING = 6;
const LINE_HEIGHT = 10;
const SECTION_GAP = 9;

/**
 * Yields to the host event loop so queued worker messages can run during a long
 * sheet generation. scheduler.yield is a macrotask boundary when available;
 * setTimeout is the portable fallback.
 *
 * The fallback is why this is time-based rather than once per page. Timers
 * scheduled from a timer callback are clamped to 4ms once nested, so a sheet
 * that yielded on every page spent tens of milliseconds asleep on the browsers
 * without scheduler.yield. Yielding only when the last one has aged out keeps
 * the worker just as answerable on a slow page and free on a fast one.
 */
const YIELD_INTERVAL_MS = 16;
let lastYield = 0;

async function yieldToEventLoop(force = false): Promise<void> {
  const now = performance.now();
  if (!force && now - lastYield < YIELD_INTERVAL_MS) return;
  lastYield = now;
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

type PdfColor = readonly [number, number, number];

const PAPER: PdfColor = [0.97, 0.96, 0.93];
const PANEL: PdfColor = [1, 0.995, 0.98];
const INK: PdfColor = [0.12, 0.15, 0.18];
const MUTED: PdfColor = [0.36, 0.38, 0.4];
const ACCENT: PdfColor = [0.55, 0.19, 0.11];
const HEADER: PdfColor = [0.12, 0.16, 0.2];
const WHITE: PdfColor = [1, 1, 1];

/** The line the writer signs every page with; a host may replace it. */
export const DEFAULT_SHEET_FOOTER_TEXT = "Generated with Forge Character Builder.";
const SHEET_FOOTER_BASELINE = 11.7;

// The spellcasting header's banner and stat boxes, as the template contract
// lays them out. Drawing to these keeps the values inside their art.
const { spellHeader: SPELL_HEADER, spellList: SPELL_LIST } = SHEET_TEMPLATE_CONTRACT;

/** Escape a string for a PDF literal string while keeping this writer ASCII-only. */
function pdfText(value: string): string {
  let ascii = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    ascii += code >= 32 && code <= 126 ? character : "?";
  }
  return ascii.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function number(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function color(colorValue: PdfColor, operator: "rg" | "RG"): string {
  return `${number(colorValue[0])} ${number(colorValue[1])} ${number(colorValue[2])} ${operator}`;
}

function text(
  commands: string[],
  x: number,
  y: number,
  value: string,
  font: "F1" | "F2" | "F3",
  size: number,
  textColor: PdfColor,
): void {
  commands.push(
    color(textColor, "rg"),
    "BT",
    `/${font} ${number(size)} Tf`,
    `${number(x)} ${number(y)} Td`,
    `(${pdfText(value)}) Tj`,
    "ET",
  );
}

function filledRect(commands: string[], x: number, y: number, width: number, height: number, fill: PdfColor): void {
  commands.push(color(fill, "rg"), `${number(x)} ${number(y)} ${number(width)} ${number(height)} re`, "f");
}

function outlinedRect(
  commands: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  stroke: PdfColor,
  lineWidth: number,
): void {
  commands.push(
    color(stroke, "RG"),
    `${number(lineWidth)} w`,
    `${number(x)} ${number(y)} ${number(width)} ${number(height)} re`,
    "S",
  );
}

function titleCase(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function wrapText(value: string, maxCharacters: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters));
      }
      continue;
    }
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > maxCharacters && current !== "") {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function rowLines(row: SheetRow): string[] {
  if (row.kind === "tokens") return [row.tokens.join(" ")];
  return [...row.lines];
}

function sectionLines(section: SheetSection): string[] {
  const lines: string[] = [];
  for (const row of section.rows) lines.push(...rowLines(row));
  return lines;
}

function pageHeading(page: SheetPage, pageIndex: number): string {
  if (pageIndex === 0) return "CHARACTER OVERVIEW";
  if (pageIndex === 1) return "FEATURES & NOTES";
  if (pageIndex === 2) return "INVENTORY & MAGIC";
  const firstSection = page.sections[0]?.title;
  return firstSection === undefined ? `PAGE ${page.page}` : titleCase(firstSection);
}

function drawSection(
  commands: string[],
  section: SheetSection,
  lines: readonly string[],
  x: number,
  top: number,
  width: number,
): number {
  const height = SECTION_TITLE_HEIGHT + SECTION_PADDING * 2 + lines.length * LINE_HEIGHT;
  const bottom = top - height;
  filledRect(commands, x, bottom, width, height, PANEL);
  outlinedRect(commands, x, bottom, width, height, [0.78, 0.75, 0.7], 0.6);
  filledRect(commands, x, top - SECTION_TITLE_HEIGHT, width, SECTION_TITLE_HEIGHT, ACCENT);
  text(commands, x + SECTION_PADDING, top - 12, titleCase(section.title), "F2", 8, WHITE);
  let lineY = top - SECTION_TITLE_HEIGHT - SECTION_PADDING - 1;
  for (const line of lines) {
    text(commands, x + SECTION_PADDING, lineY, line, "F1", 7.5, INK);
    lineY -= LINE_HEIGHT;
  }
  return height;
}

function pageContent(model: CharacterSheetModel, page: SheetPage, pageIndex: number, pageCount: number): string {
  const commands: string[] = ["q"];
  filledRect(commands, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, PAPER);
  outlinedRect(commands, 23, 23, PAGE_WIDTH - 46, PAGE_HEIGHT - 46, ACCENT, 1.1);

  filledRect(commands, PAGE_MARGIN, 716, PAGE_WIDTH - PAGE_MARGIN * 2, 52, HEADER);
  text(commands, PAGE_MARGIN + 14, 748, "CHARACTER SHEET", "F2", 16, WHITE);
  text(commands, PAGE_MARGIN + 14, 732, `${model.characterId}  /  ${pageHeading(page, pageIndex)}`, "F1", 8.5, [0.85, 0.88, 0.9]);
  text(commands, PAGE_WIDTH - PAGE_MARGIN - 72, 748, model.mode.toUpperCase(), "F2", 7.5, WHITE);
  text(commands, PAGE_WIDTH - PAGE_MARGIN - 72, 732, `${pageIndex + 1} / ${pageCount}`, "F1", 8, [0.85, 0.88, 0.9]);

  commands.push(color(ACCENT, "RG"), "0.8 w", `${PAGE_MARGIN} 704 m`, `${PAGE_WIDTH - PAGE_MARGIN} 704 l`, "S");

  let column = 0;
  let top = CONTENT_TOP;
  const nextColumn = (): boolean => {
    if (column === 0) {
      column = 1;
      top = CONTENT_TOP;
      return true;
    }
    return false;
  };

  const sections = page.sections.length > 0
    ? page.sections
    : [{ title: "Character Sheet", rows: [] } satisfies SheetSection];
  for (const section of sections) {
    const lines = sectionLines(section).flatMap((line) => wrapText(line, 57));
    let offset = 0;
    while (offset < Math.max(lines.length, 1)) {
      const x = PAGE_MARGIN + column * (COLUMN_WIDTH + COLUMN_GAP);
      const available = Math.max(1, Math.floor((top - CONTENT_BOTTOM - SECTION_TITLE_HEIGHT - SECTION_PADDING * 2) / LINE_HEIGHT));
      const take = Math.max(1, Math.min(lines.length - offset, available));
      const chunk = lines.slice(offset, offset + take);
      const height = drawSection(commands, section, chunk, x, top, COLUMN_WIDTH);
      top -= height + SECTION_GAP;
      offset += take;
      if (offset < lines.length && top - SECTION_TITLE_HEIGHT < CONTENT_BOTTOM) {
        if (!nextColumn()) {
          // The model normally gives each page enough room. If a custom model
          // does not, continue the final column so no semantic row disappears.
          top = CONTENT_BOTTOM - SECTION_GAP;
        }
      }
    }
    if (top - SECTION_TITLE_HEIGHT < CONTENT_BOTTOM) {
      if (nextColumn()) continue;
      top = CONTENT_BOTTOM - SECTION_GAP;
    }
  }

  commands.push(color(MUTED, "rg"), "0.5 w", `${PAGE_MARGIN} 38 m`, `${PAGE_WIDTH - PAGE_MARGIN} 38 l`, "S");
  text(commands, PAGE_MARGIN, 29, "5E-COMPATIBLE CHARACTER SHEET", "F3", 6.5, MUTED);
  text(commands, PAGE_WIDTH - PAGE_MARGIN - 74, 29, `PAGE ${pageIndex + 1} OF ${pageCount}`, "F2", 6.5, MUTED);
  commands.push("Q");
  return `${commands.join("\n")}\n`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Serialize a model into a deterministic, browser-safe styled PDF. */
export function writeCharacterSheetPdf(model: CharacterSheetModel): ArrayBuffer {
  const pages = model.pages.length > 0 ? model.pages : [{ page: 1, templateKind: "generic" as const, sections: [] }];
  const firstPageId = 6;
  const pageIds = pages.map((_, index) => firstPageId + index * 2);
  const objects: string[] = new Array(firstPageId + pages.length * 2).fill("");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R /PageMode /UseThumbs >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>";

  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const content = pageContent(model, page, index, pages.length);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /ProcSet [/PDF /Text] /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}endstream`;
  });

  let output = "%PDF-1.4\n% FCB Styled Character Sheet\n";
  const offsets = new Array<number>(objects.length).fill(0);
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = byteLength(output);
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(output).buffer;
}

/**
 * Fills the independently supplied 5e AcroForm template while preserving its
 * original artwork, field geometry, and checkbox appearance. The custom
 * writer above remains the deterministic fallback for non-browser callers or
 * installations where the public template asset is unavailable.
 */
/** Where a typeface comes from: a PDF standard font, or a font file's bytes. */
export type SheetFaceSource = { standard: StandardFonts } | { bytes: Uint8Array };

/** The faces a render uses, resolved from the reader's font choice. */
export interface SheetFaces {
  titles: SheetFaceSource;
  captions: SheetFaceSource;
  numbers: SheetFaceSource;
  body: { regular: SheetFaceSource; bold: SheetFaceSource; italic: SheetFaceSource; boldItalic: SheetFaceSource };
  /** The body face's SHEET_FONT_FACES key, which picks its advance widths (see measuredTextWidth). */
  bodyFace?: string;
}

export const DEFAULT_SHEET_FACES: SheetFaces = {
  titles: { standard: StandardFonts.TimesRomanBold },
  captions: { standard: StandardFonts.HelveticaBold },
  numbers: { standard: StandardFonts.Helvetica },
  body: {
    regular: { standard: StandardFonts.Helvetica },
    bold: { standard: StandardFonts.HelveticaBold },
    italic: { standard: StandardFonts.HelveticaOblique },
    boldItalic: { standard: StandardFonts.HelveticaBoldOblique },
  },
};

export interface CharacterSheetTemplateBundle {
  details: Uint8Array;
  background: Uint8Array;
  companion: Uint8Array;
  equipment: Uint8Array;
  spellcastingHeader: Uint8Array;
  spellcastingSectionTops: readonly Uint8Array[];
  spellcastingSectionCenter: Uint8Array;
  spellcastingSectionBottom: Uint8Array;
  spellCard: Uint8Array;
  genericCard: Uint8Array;
  /**
   * The file `details` was loaded from, when it is a layout variant of the
   * set's character page; its labels are kept under that name. Absent for the
   * set's own page.
   */
  detailsFile?: string;
  /**
   * The layout `details` prints. Absent, the writer reads the layout from the
   * page's own boxes: separate subclass and feat boxes are split, one features
   * box is not.
   */
  layout?: SheetLayout;
  /** The set's titles, captions and ribbons, keyed by template file. */
  labels: SheetTemplateLabels;
  /** The typefaces to draw them and the values in. */
  faces: SheetFaces;
}

export interface CharacterSheetWriteOptions {
  /** Show ability modifiers in the larger character ability boxes. */
  emphasizeAbilityModifiers?: boolean;
  /** Include overflow attack-note pages (default true). */
  includeAttackNotes?: boolean;
  /** The line signed at the foot of every template page. */
  footerText?: string;
  /** The scheme the templates were recoloured to; labels and values follow it. */
  colours?: SheetColours;
  /** A host's logo, base64 PNG or JPEG, painted over the masthead's die badge. */
  brandImage?: string;
  /**
   * Phase timings, for the render benchmark. Production callers omit it, so
   * the writer resolves the hook once and pays a single branch per phase.
   */
  trace?: SheetRenderTrace;
}

/** Reports how long one named phase of a render took. */
export type SheetRenderTrace = (phase: string, ms: number, detail?: Record<string, unknown>) => void;

interface SheetFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  titles: PDFFont;
  captions: PDFFont;
  numbers: PDFFont;
  /** Positioned body runs measured as drawn, the way the model laid them out. */
  bodyMeasure: TextMeasure;
}

/** The label colours of a scheme, as pdf-lib colours. */
interface SheetLabelColours {
  accent: PdfColor;
  lines: PdfColor;
  text: PdfColor;
  cream: PdfColor;
}

const CREAM: PdfColor = [...SHEET_FIXED_COLOURS.cream];

function labelColours(colours: SheetColours): SheetLabelColours {
  const pick = (name: keyof typeof SHEET_PALETTE): PdfColor => [...SHEET_PALETTE[name].rgb] as PdfColor;
  return { accent: pick(colours.accent), lines: pick(colours.lines), text: pick(colours.text), cream: CREAM };
}

// fontkit is large and only the render lane needs it; loading it on demand
// keeps it out of the engine worker's chunk.
let fontkitPromise: Promise<Parameters<PDFDocument["registerFontkit"]>[0]> | undefined;
function loadFontkit(): Promise<Parameters<PDFDocument["registerFontkit"]>[0]> {
  fontkitPromise ??= import("@pdf-lib/fontkit").then((module) => module.default);
  return fontkitPromise;
}

/** Fixed names keep the output byte-stable; pdf-lib would otherwise salt embedded font names. */
async function embedFace(document: PDFDocument, source: SheetFaceSource, name: string): Promise<PDFFont> {
  if ("standard" in source) return document.embedFont(source.standard);
  return document.embedFont(source.bytes, { subset: true, customName: name });
}

async function embedSheetFonts(document: PDFDocument, faces: SheetFaces): Promise<SheetFonts> {
  document.registerFontkit(await loadFontkit());
  const body = {
    regular: await embedFace(document, faces.body.regular, "FCB-Body"),
    bold: await embedFace(document, faces.body.bold, "FCB-Body-Bold"),
    italic: await embedFace(document, faces.body.italic, "FCB-Body-Italic"),
    boldItalic: await embedFace(document, faces.body.boldItalic, "FCB-Body-BoldItalic"),
  };
  // A named or standard body face measures on its advance widths, as the
  // model's layout did; custom bytes with no name fall back to the font.
  const bodyMeasure: TextMeasure = faces.bodyFace !== undefined || "standard" in faces.body.regular
    ? (text, fontSize, style) => measuredTextWidth(text, fontSize, style ?? "regular", faces.bodyFace)
    : (text, fontSize, style) => runFont(body, style).widthOfTextAtSize(winAnsiText(text), fontSize);
  return {
    ...body,
    titles: await embedFace(document, faces.titles, "FCB-Titles"),
    captions: await embedFace(document, faces.captions, "FCB-Captions"),
    numbers: await embedFace(document, faces.numbers, "FCB-Numbers"),
    bodyMeasure,
  };
}

const RIBBON_TEXT_DROP = 0.36;

/**
 * Draws a template file's labels and ribbons onto `page`, offset by where the
 * writer placed the file (whole pages sit at the origin; fragments and cards
 * wherever they were drawn). Ribbons size themselves to the chosen title face.
 */
function drawTemplateText(
  page: PDFPage,
  text: SheetTemplateLabels[string] | undefined,
  fonts: SheetFonts,
  colours: SheetLabelColours,
  dx = 0,
  dy = 0,
): void {
  if (text === undefined) return;
  for (const label of text.labels) {
    const font = label.font === "titles" ? fonts.titles : label.font === "captions" ? fonts.captions : fonts.regular;
    const value = winAnsiText(label.text);
    const width = drawnWidth(font, value, label.size);
    const box = label.width ?? 0;
    const x = label.align === "center" ? label.x + (box - width) / 2 : label.align === "right" ? label.x + box - width : label.x;
    const color = colours[label.color];
    page.drawText(value, { x: x + dx, y: label.y + dy, size: label.size, font, color: rgb(color[0], color[1], color[2]) });
  }
  for (const ribbon of text.ribbons) {
    const value = winAnsiText(ribbon.text);
    const width = drawnWidth(fonts.titles, value, ribbon.size) + ribbon.pad * 2;
    const h = ribbon.height;
    const left = ribbon.cx - width / 2 + dx;
    const top = ribbon.cy + h / 2 + dy;
    const accent = colours.accent;
    page.drawSvgPath(`M 4 0 H ${width - 4} L ${width} ${h / 2} L ${width - 4} ${h} H 4 L 0 ${h / 2} Z`, {
      x: left,
      y: top,
      color: rgb(accent[0], accent[1], accent[2]),
      borderWidth: 0,
    });
    const cream = colours.cream;
    page.drawText(value, {
      x: ribbon.cx + dx - (width - ribbon.pad * 2) / 2,
      y: ribbon.cy + dy - ribbon.size * RIBBON_TEXT_DROP,
      size: ribbon.size,
      font: fonts.titles,
      color: rgb(cream[0], cream[1], cream[2]),
    });
  }
}

/** Fields that hold a large number and take the numbers face. */
function isNumbersField(name: string): boolean {
  return /^(details|companion)_(str|dex|con|int|wis|cha)_(score|modifier)$/.test(name) ||
    /^(details|companion)_(armor_class|hp_current|hp_max|hp_temp|initiative|proficiency_bonus|passive_perception_total|inspiration|hd|speed_walking|xp|level)$/.test(name);
}

/**
 * An ability score printed smaller than its modifier, as the 2024 pages'
 * score box beside the modifier roundel. It takes the body face's regular
 * weight, so the bold modifier reads first.
 */
function isSecondaryScore(name: string, fields: ReadonlyMap<string, TemplateField>): boolean {
  const ability = name.match(/^details_(str|dex|con|int|wis|cha)_score$/)?.[1];
  if (ability === undefined) return false;
  return (fields.get(name)?.base ?? 0) < (fields.get(`details_${ability}_modifier`)?.base ?? 0);
}

function bundleIsComplete(bundle: CharacterSheetTemplateBundle | null): bundle is CharacterSheetTemplateBundle {
  return bundle !== null &&
    bundle.spellcastingSectionTops.length === 10 &&
    typeof bundle.labels === "object" && bundle.labels !== null &&
    typeof bundle.faces === "object" && bundle.faces !== null &&
    Object.entries(bundle).every(([key, value]) =>
      key === "labels" || key === "faces" || key === "detailsFile" || key === "layout" ||
      (Array.isArray(value)
        ? value.every((bytes) => bytes.byteLength > 0)
        : (value as Uint8Array).byteLength > 0)
    );
}

// A field's default appearance ends in `/<font> <size> Tf`; the size is the one
// the template asked for when it drew the box, which knows the box's geometry.
const DEFAULT_APPEARANCE_SIZE = /\/[^\0\t\n\f\r ]+[\0\t\n\f\r ]*(\d*\.\d+|\d+)[\0\t\n\f\r ]+Tf/g;

/** The size a template asked for, or undefined when it left the size to the viewer. */
export function templateFontSize(appearance: string | undefined): number | undefined {
  if (appearance === undefined) return undefined;
  DEFAULT_APPEARANCE_SIZE.lastIndex = 0;
  let size: number | undefined;
  for (const match of appearance.matchAll(DEFAULT_APPEARANCE_SIZE)) {
    const candidate = Number(match[1]);
    // A zero size means "fit the widget", which is the viewer's job, not ours.
    if (Number.isFinite(candidate) && candidate > 0) size = candidate;
  }
  return size;
}

/**
 * The face's cap height as a fraction of the em, for optically centring a line
 * of digits in a box.
 *
 * pdf-lib centres a line by centring the font's *ascender* box, which only
 * looks right when the ascender equals the cap height (as it happens to for
 * Helvetica). Its `heightOfFontAtSize` is also unusable here: for a face whose
 * em is not 1000 units it subtracts an unscaled descender. So the ratio is read
 * from the embedded face directly, and rejected when it is implausible —
 * several of the display faces report a cap height that is nothing of the sort.
 */
const CAP_HEIGHT_FALLBACK = 0.7;
const capHeightRatios = new WeakMap<PDFFont, number>();

function capHeightRatio(font: PDFFont): number {
  const cached = capHeightRatios.get(font);
  if (cached !== undefined) return cached;
  const embedder = (font as unknown as { embedder?: Record<string, unknown> }).embedder;
  const face = embedder?.font as { CapHeight?: number; capHeight?: number; unitsPerEm?: number } | undefined;
  const units = typeof face?.unitsPerEm === "number" && face.unitsPerEm > 0 ? face.unitsPerEm : 1000;
  const capHeight = typeof face?.CapHeight === "number" ? face.CapHeight : face?.capHeight;
  const ratio = typeof capHeight === "number" ? capHeight / units : Number.NaN;
  const usable = Number.isFinite(ratio) && ratio >= 0.45 && ratio <= 0.85 ? ratio : CAP_HEIGHT_FALLBACK;
  capHeightRatios.set(font, usable);
  return usable;
}

/**
 * The size the template asked for, capped so the value's cap height fits the
 * box and its width fits too. Zero when even the floor overflows, which sends
 * the value back to the form field, whose appearance clips instead of spilling.
 */
function drawnNumberSize(value: string, rect: FieldRect, base: number, font: PDFFont): number {
  if (value === "") return base;
  const byHeight = (rect.height - 2) / capHeightRatio(font);
  const size = fitSingleLineFontSize(value, rect.width, Math.min(base, byHeight), font);
  return drawnWidth(font, value, size) <= rect.width - 4 ? size : 0;
}

/** Used only when a template field carries no size of its own. */
function fieldFontSize(name: string): number {
  if (/details_attack\d_(weapon|range|attack|damage)$/.test(name)) return 7.16;
  if (/details_attack\d_description$/.test(name) || name === "details_attack_description") return 6;
  if (/details_(str|dex|con|int|wis|cha)_score$/.test(name)) return 15;
  if (/details_(str|dex|con|int|wis|cha)_modifier$/.test(name)) return 9;
  if (name === "details_armor_class") return 18;
  if (name === "details_character_name") return 12;
  if (name === "details_build" || name === "details_xp") return 7;
  if (/^details_(proficiency_bonus|passive_perception_total|initiative)$/.test(name)) return 10;
  if (name.startsWith("equipment_page_gear_") || name.startsWith("equipment_page_magic_gear_")) return 7;
  if (name === "equipment_page_magic_items") return 6.5;
  if (name === "background_story" || name === "background_feature") return 6.5;
  return 8;
}

/**
 * A single-line value shrinks, down to the readable floor (or its own size
 * when that is smaller), so the whole value stays inside its widget instead
 * of being clipped at the right edge.
 */
export function fitSingleLineFontSize(value: string, width: number, base: number, font: PDFFont): number {
  const available = Math.max(1, width - 4);
  const needed = drawnWidth(font, value, base);
  if (needed <= available) return base;
  return Math.max(Math.min(READABLE_MIN_FONT_SIZE, base), Math.floor((base * available) / needed * 10) / 10);
}

/**
 * Largest size (from `base` down to the readable floor in 0.25 steps) at which
 * the value's wrapped lines fit the widget rectangle. Long multiline content
 * (backstories, notes) shrinks to fit instead of clipping at the widget edge
 * with no visual indication.
 */
/**
 * How many lines of a form box's wrapped value fit its height at `size`: the
 * first line's cap height the shared inset under the top edge, as in every
 * flowed box, lines 1.2 sizes apart, the last baseline a point above the floor.
 */
function boxedLineRoom(height: number, size: number, capHeight: number): number {
  const below = height - BOX_TEXT_TOP_INSET - capHeight * size - 1;
  return below < 0 ? 0 : Math.floor(below / (size * 1.2) + 1e-9) + 1;
}

/** One breakable piece of a form box's value. */
interface BoxedToken {
  text: string;
  /** Follows the piece before it with no space: the part after a "/" in a word. */
  glued: boolean;
}

/**
 * A form value's paragraphs as breakable pieces: its words, with a word
 * joined by slashes ("2d10/2d8/3d6", "and/or") breakable after each slash, so
 * a compound value wraps there instead of running out of its box.
 */
function boxedTokens(value: string): BoxedToken[][] {
  return value.split(/\r?\n/).map((paragraph) => paragraph.split(/[ \t]+/).filter((word) => word !== "")
    .flatMap((word) => word.split(/(?<=\/)(?=.)/).map((text, index) => ({ text, glued: index > 0 }))));
}

interface BoxedLine {
  text: string;
  paragraph: number;
  /** The paragraph's tokens on this line, `start` to before `end`. */
  start: number;
  end: number;
  /** A single token wider than the whole line, which only shrinking can fit. */
  overwide: boolean;
}

function boxedText(tokens: readonly BoxedToken[]): string {
  return tokens.map((token, index) => (index > 0 && !token.glued ? ` ${token.text}` : token.text)).join("");
}

/**
 * Breaks a form value into lines no wider than `usable`, given each piece's
 * width and a space's at the size being tried. Words are never broken; a
 * piece wider than a line stands alone on it, marked, so a fit can refuse it.
 */
function wrapBoxed(
  paragraphs: readonly (readonly BoxedToken[])[],
  usable: number,
  width: (text: string) => number,
  space: number,
): BoxedLine[] {
  const lines: BoxedLine[] = [];
  paragraphs.forEach((tokens, paragraph) => {
    let start = 0;
    let lineWidth = 0;
    const push = (end: number): void => {
      const text = boxedText(tokens.slice(start, end));
      lines.push({ text, paragraph, start, end, overwide: end - start === 1 && width(tokens[start]!.text) > usable });
    };
    tokens.forEach((token, index) => {
      const tokenWidth = width(token.text);
      const gap = index === start || token.glued ? 0 : space;
      if (index > start && lineWidth + gap + tokenWidth > usable) {
        push(index);
        start = index;
        lineWidth = tokenWidth;
      } else {
        lineWidth += gap + tokenWidth;
      }
    });
    push(tokens.length);
  });
  return lines;
}

export function fitMultilineFontSize(
  value: string,
  width: number,
  height: number,
  base: number,
  floor = READABLE_MIN_FONT_SIZE,
  measure: (text: string, fontSize: number) => number = measuredTextWidth,
  capHeight = LAYOUT_CAP_HEIGHT,
): number {
  if (value === "" || width <= 0 || height <= 0) return base;
  const usable = width - 4;
  const paragraphs = boxedTokens(value);
  // Glyph advance widths scale linearly with size, so each piece is measured
  // once at size 1 and reused across candidate sizes.
  const unitWidths = new Map<string, number>();
  const unitWidth = (text: string): number => {
    let cached = unitWidths.get(text);
    if (cached === undefined) {
      cached = measure(text, 1);
      unitWidths.set(text, cached);
    }
    return cached;
  };
  const spaceUnit = measure(" ", 1);
  const fits = (size: number): boolean => {
    const lines = wrapBoxed(paragraphs, usable, (text) => unitWidth(text) * size, spaceUnit * size);
    return lines.length <= boxedLineRoom(height, size, capHeight) && lines.every((line) => !line.overwide);
  };
  for (let size = base; size >= floor; size -= 0.25) {
    if (fits(size)) return size;
  }
  return floor;
}

interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Text a template box could not hold even at its smallest size. */
interface BoxOverflow {
  field: string;
  /** The words not drawn, from the first one on, paragraphs kept apart by newlines. */
  text: string;
  /**
   * The box printed the value cut short, ending in an ellipsis, as this; `text`
   * is then the whole value.
   */
  shown?: string;
}

interface FilledTemplatePage {
  page: PDFPage;
  /** What each box that would have clipped could not hold, for a continuation page. */
  overflow: BoxOverflow[];
  /** Widget rectangles by field name, captured before the form was flattened
   *  so hand-drawn rich text can bound itself to the template's own boxes.
   *  Shared with every page drawn from the same template, so it is read-only. */
  fieldRects: ReadonlyMap<string, FieldRect>;
}

/** Drops a field and its widgets from every page so flattening cannot draw it. */
function removeFieldFromPages(source: PDFDocument, form: PDFForm, field: unknown): void {
  const target = field as {
    ref: PDFRef;
    acroField: { getWidgets(): Array<{ dict: unknown }> };
  };
  for (const page of source.getPages()) {
    page.node.removeAnnot(target.ref);
    for (const widget of target.acroField.getWidgets()) {
      const widgetRef = source.context.getObjectRef(widget.dict as never);
      if (widgetRef !== undefined) page.node.removeAnnot(widgetRef);
    }
  }
  (form as unknown as { acroForm: { removeField(field: unknown): void } }).acroForm.removeField(
    target.acroField,
  );
}

/**
 * A template's artwork, parsed and baked once.
 *
 * Every page drawn from a template produced byte-identical artwork: the same
 * parse of the same bytes, the same fields dropped, the same flatten. Only the
 * values differ, and the writer draws those itself. So the bake happens once
 * and each page stamps the result, instead of re-parsing a 191 KB details or
 * 313 KB equipment template per page.
 */
interface TemplateArtwork {
  /**
   * The donor document, baked once and never mutated afterwards. It is kept
   * parsed rather than re-serialized: embedding from bytes would make every
   * render parse the baked page again, which measured 30ms slower on a sheet
   * for no saving in output size.
   */
  source: PDFDocument;
  width: number;
  height: number;
  /** Widget geometry and typography, captured before the fields were dropped. */
  fields: ReadonlyMap<string, TemplateField>;
  /** The same widget rectangles, for callers that place art against them. */
  rects: ReadonlyMap<string, FieldRect>;
}

interface TemplateField {
  rect: FieldRect;
  kind: "text" | "check" | "other";
  multiline: boolean;
  align: TextAlignment;
  /** The size the template asked for; its own default appearance is the authority. */
  base: number;
}

// Keyed on the recoloured template bytes, which the render worker caches per
// template set, colour scheme and typeface — so the entry lives exactly as long
// as the bundle it belongs to. The promise is cached, not the result, so two
// renders in flight cannot both parse the same template.
const templateArtwork = new WeakMap<Uint8Array, Promise<TemplateArtwork>>();

function artworkFor(template: Uint8Array): Promise<TemplateArtwork> {
  let cached = templateArtwork.get(template);
  if (cached === undefined) {
    cached = buildTemplateArtwork(template);
    templateArtwork.set(template, cached);
  }
  return cached;
}

async function buildTemplateArtwork(template: Uint8Array): Promise<TemplateArtwork> {
  const source = await PDFDocument.load(template, { updateMetadata: false });
  const form = source.getForm();
  const fields = new Map<string, TemplateField>();
  const rects = new Map<string, FieldRect>();
  const dropped: unknown[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    const rect = field.acroField.getWidgets()[0]?.getRectangle();
    const text = field instanceof PDFTextField;
    const multiline = text && field.isMultiline();
    if (rect !== undefined) {
      rects.set(name, rect);
      fields.set(name, {
        rect,
        kind: text ? "text" : field instanceof PDFCheckBox ? "check" : "other",
        multiline,
        align: text ? field.getAlignment() : TextAlignment.Left,
        base: (text ? templateFontSize(field.acroField.getDefaultAppearance()) : undefined) ?? fieldFontSize(name),
      });
    }
    // A multiline box keeps its own appearance, which is the box the template
    // drew; flattening bakes it into the artwork. Every other widget would have
    // pdf-lib synthesize a border the template never drew, so it goes, and the
    // writer draws its value and its check mark instead.
    if (!multiline) {
      if (field instanceof PDFCheckBox) field.uncheck();
      dropped.push(field);
    }
  }
  for (const field of dropped) removeFieldFromPages(source, form, field);
  form.flatten({ updateFieldAppearances: false });
  const { width, height } = source.getPage(0).getSize();
  return { source, width, height, fields, rects };
}

/** Each template's artwork is embedded at most once per output document. */
async function embedArtwork(
  output: PDFDocument,
  template: Uint8Array,
  artwork: TemplateArtwork,
  cache: ArtworkCache,
): Promise<PDFEmbeddedPage> {
  const cached = cache.get(template);
  if (cached !== undefined) return cached;
  // embedPage copies the donor's objects into this document before normalising
  // them, so the cached artwork is never mutated and serves every later render.
  const embedded = await output.embedPage(artwork.source.getPage(0));
  cache.set(template, embedded);
  return embedded;
}

type ArtworkCache = Map<Uint8Array, PDFEmbeddedPage>;

async function addFilledTemplatePage(
  output: PDFDocument,
  template: Uint8Array,
  values: Readonly<Record<string, string>>,
  colours: SheetColours,
  /** The output document's own faces, embedded once for the whole sheet. */
  outputFonts: SheetFonts,
  artwork: ArtworkCache,
  /** Draws the template's artwork onto the page; absent, it prints as drawn. */
  drawArtwork?: (page: PDFPage, embedded: PDFEmbeddedPage, width: number, height: number) => void,
): Promise<FilledTemplatePage> {
  const art = await artworkFor(template);
  const embedded = await embedArtwork(output, template, art, artwork);
  const page = output.addPage([art.width, art.height]);
  if (drawArtwork === undefined) page.drawPage(embedded, { x: 0, y: 0, width: art.width, height: art.height });
  else drawArtwork(page, embedded, art.width, art.height);
  const textColour = SHEET_PALETTE[colours.text].rgb;
  const overflow: BoxOverflow[] = [];
  for (const [name, field] of art.fields) {
    // Values render through WinAnsi, so an unencodable glyph in third-party
    // content degrades rather than aborting the whole build. A multiline
    // widget is sanitised one line at a time: WinAnsi collapses every control
    // character to a space, and the form appearance this drawing replaces
    // broke a multiline value at its newlines, so the breaks have to survive
    // the sanitising for the drawn text to say the same thing.
    const raw = values[name] ?? "";
    const value = field.multiline
      ? raw.split(/\r?\n/).map((line) => winAnsiText(line)).join("\n")
      : winAnsiText(raw);
    if (field.kind === "check") {
      // Both template sets' markers (squares and circles) carry the same mark.
      if (value === "true") {
        page.drawCircle({
          x: field.rect.x + field.rect.width / 2,
          y: field.rect.y + field.rect.height / 2,
          size: Math.min(field.rect.width, field.rect.height) * 0.28,
          color: rgb(textColour[0], textColour[1], textColour[2]),
        });
      }
      continue;
    }
    if (field.kind !== "text" || value === "") continue;
    const font = isNumbersField(name) && !isSecondaryScore(name, art.fields) ? outputFonts.numbers : outputFonts.regular;
    if (!field.multiline) {
      // A single line sits optically centred in its box whatever face the
      // reader chose, because it is drawn rather than filled through the form.
      const size = drawnNumberSize(value, field.rect, field.base, font);
      if (size > 0) {
        drawFieldValue(
          page,
          { rect: field.rect, value, size, align: field.align, numbers: isNumbersField(name) },
          font,
          textColour,
        );
        continue;
      }
      // Too long for one line even at the readable floor. A box with room for
      // two lines at the floor wraps it (below); a one-line box shows what fits,
      // marked with an ellipsis, and the whole value prints on a continuation
      // page, so nothing is cut away unseen.
      const floor = Math.min(READABLE_MIN_FONT_SIZE, field.base, (field.rect.height - 2) / capHeightRatio(font));
      if (boxedLineRoom(field.rect.height, floor, capHeightRatio(font)) < 2) {
        const shown = ellipsized(value, font, floor, field.rect.width - 4);
        drawFieldValue(page, { rect: field.rect, value: shown, size: floor, align: field.align, numbers: isNumbersField(name) }, font, textColour);
        overflow.push({ field: name, text: value, shown });
        continue;
      }
    }
    const rest = drawBoxedValue(page, field.rect, value, font, field.base, textColour, !field.multiline, field.align);
    if (rest !== undefined) overflow.push({ field: name, ...rest });
  }
  return { page, overflow, fieldRects: art.rects };
}

/**
 * Draws a value that will not sit on one line in its box: wrapped, shrunk to
 * fit, and clipped to the widget rectangle the way the form's own appearance
 * clipped it.
 *
 * A value that will not fit even at the readable floor is never cut unseen:
 * the box's last line ends in an ellipsis. A one-line field's value (`whole`)
 * keeps the floor size and is returned entire, to print in full; a prose
 * box keeps its own size and returns the words after the ellipsis, to
 * continue.
 */
function drawBoxedValue(
  page: PDFPage,
  rect: FieldRect,
  value: string,
  font: PDFFont,
  base: number,
  colour: PdfColor,
  whole = false,
  align: TextAlignment = TextAlignment.Left,
): Omit<BoxOverflow, "field"> | undefined {
  const capHeight = capHeightRatio(font);
  const measure = (text: string, fontSize: number): number => drawnWidth(font, winAnsiText(text), fontSize);
  const fitted = fitMultilineFontSize(value, rect.width, rect.height, base, undefined, measure, capHeight);
  const usable = rect.width - 4;
  const paragraphs = boxedTokens(value);
  const layout = (size: number): BoxedLine[] =>
    wrapBoxed(paragraphs, usable, (text) => measure(text, size), measure(" ", size));
  const room = (size: number): number => boxedLineRoom(rect.height, size, capHeight);
  let size = fitted;
  let lines = layout(size);
  let shown = lines.map((line) => line.text);
  let rest: Omit<BoxOverflow, "field"> | undefined;
  if (lines.length > room(size) || lines.some((line) => line.overwide)) {
    size = whole ? Math.min(READABLE_MIN_FONT_SIZE, base) : base;
    lines = layout(size);
    const overwide = lines.findIndex((line) => line.overwide);
    const cut = Math.min(lines.length, room(size), overwide < 0 ? lines.length : overwide);
    // The last line shown makes room for the ellipsis: a prose box gives up its
    // last words to the continuation; a one-line field is cut where it must,
    // since it prints whole there anyway.
    let resume = lines[cut];
    shown = lines.slice(0, cut).map((line) => line.text);
    const last = lines[cut - 1];
    if (last !== undefined) {
      const tokens = paragraphs[last.paragraph]!;
      let end = last.end;
      // A prose box's cut falls between whole words: never inside a word
      // broken at a slash, whose halves would land in two places.
      while (!whole && end > last.start + 1 &&
        (tokens[end]?.glued === true || measure(`${boxedText(tokens.slice(last.start, end))}\u2026`, size) > usable)) end -= 1;
      const kept = boxedText(tokens.slice(last.start, end));
      const marked = measure(`${kept}\u2026`, size) <= usable;
      shown[cut - 1] = marked ? `${kept}\u2026` : ellipsized(kept, font, size, usable);
      // A word cut short continues whole, from its start; words given up
      // continue from the first.
      let wordStart = end;
      while (wordStart > 0 && tokens[wordStart]?.glued === true) wordStart -= 1;
      if (!marked) resume = last;
      else if (wordStart < last.end) resume = { ...last, start: wordStart };
    } else if (room(size) > 0) {
      shown = ["\u2026"];
    }
    if (whole) {
      // Named on the continuation page by the box's first line, which is
      // where a reader starts looking for it.
      const first = shown[0] ?? "";
      rest = { text: value, shown: shown.length > 1 && !first.endsWith("\u2026") ? `${first}\u2026` : first };
    } else if (resume !== undefined) {
      rest = {
        text: [
          boxedText(paragraphs[resume.paragraph]!.slice(resume.start)),
          ...paragraphs.slice(resume.paragraph + 1).map(boxedText),
        ].join("\n"),
      };
    }
  }
  page.pushOperators(
    pushGraphicsState(),
    moveTo(rect.x, rect.y),
    lineTo(rect.x + rect.width, rect.y),
    lineTo(rect.x + rect.width, rect.y + rect.height),
    lineTo(rect.x, rect.y + rect.height),
    closePath(),
    clip(),
    endPath(),
  );
  let y = rect.y + rect.height - BOX_TEXT_TOP_INSET - capHeight * size;
  // Wrapped lines keep the field's own alignment, so a centred value stays
  // centred when it takes a second line.
  for (const text of shown) {
    if (text !== "") {
      const width = measure(text, size);
      const x = align === TextAlignment.Center
        ? rect.x + (rect.width - width) / 2
        : align === TextAlignment.Right ? rect.x + rect.width - 2 - width : rect.x + 2;
      page.drawText(text, { x, y, size, font, color: rgb(colour[0], colour[1], colour[2]) });
    }
    y -= size * 1.2;
  }
  page.pushOperators(popGraphicsState());
  return rest;
}

/** As much of `text` as fits `width` at `size`, ending in an ellipsis. */
function ellipsized(text: string, font: PDFFont, size: number, width: number): string {
  const room = width - drawnWidth(font, "\u2026", size);
  let kept = "";
  for (const character of text) {
    if (drawnWidth(font, kept + character, size) > room) break;
    kept += character;
  }
  return `${kept.trimEnd()}\u2026`;
}

interface DrawnValue {
  rect: FieldRect;
  value: string;
  size: number;
  align: TextAlignment;
  /** Numeric values take the numbers face; everything else the body face. */
  numbers: boolean;
}

/** Draws a value centred on its box's middle by cap height, not by ascender. */
function drawFieldValue(page: PDFPage, item: DrawnValue, font: PDFFont, colour: PdfColor): void {
  const width = drawnWidth(font, item.value, item.size);
  const x = item.align === TextAlignment.Center
    ? item.rect.x + (item.rect.width - width) / 2
    : item.align === TextAlignment.Right
      ? item.rect.x + item.rect.width - 1 - width
      : item.rect.x + 1;
  page.drawText(item.value, {
    x,
    y: item.rect.y + item.rect.height / 2 - (capHeightRatio(font) * item.size) / 2,
    size: item.size,
    font,
    color: rgb(colour[0], colour[1], colour[2]),
  });
}

function runFont(fonts: Pick<SheetFonts, "regular" | "bold" | "italic" | "boldItalic">, style: LayoutRun["style"]): PDFFont {
  if (style === "bold") return fonts.bold;
  if (style === "italic") return fonts.italic;
  if (style === "bold-italic") return fonts.boldItalic;
  return fonts.regular;
}

/** Measures text the way it will be drawn: in the chosen body face, per style. */
export type TextMeasure = (text: string, fontSize: number, style?: LayoutRun["style"]) => number;

// Advances of a standard face's strings at 1pt, per font, so wrapping and
// shrink-to-fit searches measure each word once.
const standardAdvances = new WeakMap<PDFFont, Map<string, number>>();

/**
 * How wide `text` is once drawn. pdf-lib's widthOfTextAtSize subtracts a
 * standard face's kerning pairs, but drawText shows the string with a plain
 * show-text operator, which a viewer lays out on advance widths alone, so the
 * kerned width runs short by up to a tenth on capitals and a line measured
 * with it prints past its box. An embedded face is measured on the glyphs
 * fontkit lays out, which are the ones drawText encodes, so it already agrees.
 * Everything the writer measures to place or fit drawn text goes through here.
 */
function drawnWidth(font: PDFFont, text: string, size: number): number {
  if (!((font as unknown as { embedder?: unknown }).embedder instanceof StandardFontEmbedder)) {
    return font.widthOfTextAtSize(text, size);
  }
  let advances = standardAdvances.get(font);
  if (advances === undefined) {
    advances = new Map();
    standardAdvances.set(font, advances);
  }
  let units = advances.get(text);
  if (units === undefined) {
    units = 0;
    for (const character of text) units += font.widthOfTextAtSize(character, 1);
    advances.set(text, units);
  }
  return units * size;
}

function fontMeasure(fonts: SheetFonts): TextMeasure {
  return (text, fontSize, style) => drawnWidth(runFont(fonts, style), winAnsiText(text), fontSize);
}

function drawPositionedRuns(page: PDFPage, runs: readonly LayoutRun[], fonts: SheetFonts): void {
  const measure = fonts.bodyMeasure;
  const ink = rgb(0.08, 0.08, 0.08);
  let previousFlow:
    | { card: number | undefined; role: LayoutRun["role"]; y: number; endX: number; space: number }
    | undefined;
  // Card prose arrives one word per run. Consecutive words on the same line in
  // the body face are drawn as one string: the space that joins them is the
  // body face's, which is the width the layout advances by, so the merged run
  // lands exactly where the words would have. A bold or italic word, a new
  // line, or a gap breaks the run.
  let pending: { x: number; y: number; size: number; text: string; endX: number } | undefined;
  const flush = (): void => {
    if (pending === undefined) return;
    page.drawText(pending.text, { x: pending.x, y: pending.y, size: pending.size, font: fonts.regular, color: ink });
    pending = undefined;
  };
  for (const run of runs) {
    if (run.role === "metadata") continue;
    const value = winAnsiText(run.text);
    if (value === "") continue;
    const font = runFont(fonts, run.style);
    const size = run.fontSize ?? run.height;
    const textWidth = measure(value, size, run.style ?? "regular");
    let x = run.align === "center"
      ? run.x + (run.width - textWidth) / 2
      : run.align === "right"
        ? run.x + run.width - textWidth
        : run.x;
    const isFlow = run.role === "body" || run.role === "sidebar";
    if (
      isFlow &&
      previousFlow !== undefined &&
      previousFlow.card === run.card &&
      previousFlow.role === run.role &&
      previousFlow.y === run.y
    ) {
      x = Math.max(x, previousFlow.endX + previousFlow.space);
    }
    const space = measure(" ", size);
    const mergeable = isFlow && font === fonts.regular;
    if (
      mergeable &&
      pending !== undefined &&
      pending.y === run.y &&
      pending.size === size &&
      Math.abs(pending.endX - x) < 0.001
    ) {
      pending.text += `${value} `;
      pending.endX = x + textWidth + space;
    } else {
      flush();
      if (mergeable) {
        pending = { x, y: run.y, size, text: `${value} `, endX: x + textWidth + space };
      } else {
        page.drawText(isFlow ? `${value} ` : value, { x, y: run.y, size, font, color: ink });
      }
    }
    previousFlow = isFlow
      ? { card: run.card, role: run.role, y: run.y, endX: x + textWidth, space }
      : undefined;
  }
  flush();
}

interface StyledWord {
  text: string;
  style: LayoutRun["style"];
}

function featureWords(line: string): StyledWord[][] {
  const paragraphParts = line.split(/(?:\t{2,}|[\r\n]+)/).map((part) => part.trim()).filter(Boolean);
  return paragraphParts.map((paragraph, paragraphIndex) => {
    if (paragraphIndex > 0) {
      return paragraph.split(/\s+/).map((word) => ({ text: word, style: "regular" }));
    }
    const heading = /^(.*?(?:\)\.|\.))(?:\s+|$)(.*)$/.exec(paragraph);
    if (heading === null) {
      return paragraph.split(/\s+/).map((word) => ({ text: word, style: "regular" }));
    }
    return [
      ...heading[1]!.split(/\s+/).map((word) => ({ text: word, style: "bold-italic" as const })),
      ...heading[2]!.split(/\s+/).filter(Boolean).map((word) => ({ text: word, style: "regular" as const })),
    ];
  });
}

/** The break that follows a flowed line: none, a paragraph break inside one
 * feature, the end of a whole feature, the rule under a group heading, or the
 * end of a group before the next group's heading. */
type FeatureFlowGap = "paragraph" | "feature" | "heading" | "group" | null;

/**
 * One unwrapped paragraph of a feature box. A `heading` names a group of
 * features (a split layout's class features, subclass features and feats in
 * one box); a `part` names the box a continuation page carries on. Both are
 * ruled underneath alike, and neither is left as the last line of a box.
 */
interface FeatureParagraph {
  words: readonly StyledWord[];
  indent: number;
  gapAfter: FeatureFlowGap;
  kind?: "heading" | "part";
}

interface FeatureFlowLine {
  words: readonly StyledWord[];
  indent: number;
  gapAfter: FeatureFlowGap;
  kind?: FeatureParagraph["kind"];
  /** The paragraph the line was wrapped from, and its first word there. */
  paragraph: number;
  start: number;
}

/**
 * The part of a box that did not fit: its paragraphs from the first word not
 * drawn, unwrapped, so a continuation page can wrap them at its own width.
 */
interface FeatureContinuation {
  paragraphs: readonly FeatureParagraph[];
  /** The box this continues, as its printed name. */
  heading: string;
  /** The part prints in full a value its box cut short; `heading` is what the box shows. */
  whole?: boolean;
}

const DEFAULT_FEATURE_FONT_SIZE = 8;
// Preserve readable print: modest fitting is allowed, then prose continues
// on another page at the normal size instead of falling below 6pt.
const MIN_FEATURE_FONT_SIZE = 6;
// Species Traits steps down no further than this before it borrows room from
// the features beside it, then continues.
const SPECIES_MIN_FONT_SIZE = 6.5;
const FEATURE_PARAGRAPH_GAP = 1.2;
// One feature is set off from the next by rather more than the breath between
// its own paragraphs, so the eye finds the boundaries. It is a fraction of the
// type size so it shrinks along with the adaptive fit rather than eating the
// space that fit just bought.
const FEATURE_GAP_RATIO = 0.45;

// A group heading's rule sits this far below its baseline, clear of
// descenders, and the first feature under it starts a feature gap below that.
const FEATURE_RULE_DROP_RATIO = 0.3;
// Above a heading, the last group ends with a full line's breath, so the
// heading reads as the start of something new rather than another feature.
const FEATURE_GROUP_GAP_RATIO = 0.9;
// Between the parts of a continuation page.
const CONTINUATION_PART_GAP = 6;

function featureGapFor(gap: FeatureFlowGap, fontSize: number): number {
  if (gap === "feature" || gap === "heading") return fontSize * FEATURE_GAP_RATIO;
  if (gap === "group") return fontSize * FEATURE_GROUP_GAP_RATIO;
  if (gap === "paragraph") return FEATURE_PARAGRAPH_GAP;
  return 0;
}

function featureParagraphs(rows: readonly SheetRow[], featureGap = true): FeatureParagraph[] {
  const output: FeatureParagraph[] = [];
  const lines = rows.flatMap((row) => row.kind === "tokens" ? [row.tokens.join(" ")] : [...row.lines]);
  for (const row of lines) {
    const paragraphs = featureWords(row);
    for (const [paragraphIndex, words] of paragraphs.entries()) {
      // One row is one feature (model.ts collectFeatures), so its last
      // paragraph is where a feature ends.
      const endsFeature = featureGap && paragraphIndex === paragraphs.length - 1;
      output.push({ words, indent: paragraphIndex > 0 ? 8 : 0, gapAfter: endsFeature ? "feature" : "paragraph" });
    }
  }
  return output;
}

function sectionParagraphs(section: SheetSection, featureGap = true): FeatureParagraph[] {
  return featureParagraphs(section.renderRows ?? section.rows, featureGap);
}

/** A heading or part line, in the body's bold face and ruled beneath. */
function headingParagraph(text: string, kind: "heading" | "part"): FeatureParagraph {
  return {
    words: text.split(" ").map((word) => ({ text: word, style: "bold" as const })),
    indent: 0,
    gapAfter: "heading",
    kind,
  };
}

/**
 * The split layout's single features box: each non-empty group under its own
 * ruled heading, the groups set apart by a wider gap.
 */
function groupedFeatureParagraphs(groups: ReadonlyArray<readonly [string, readonly SheetRow[]]>): FeatureParagraph[] {
  const output: FeatureParagraph[] = [];
  for (const [heading, rows] of groups) {
    if (rows.length === 0) continue;
    if (output.length > 0) output[output.length - 1] = { ...output[output.length - 1]!, gapAfter: "group" };
    output.push(headingParagraph(heading, "heading"), ...featureParagraphs(rows));
  }
  return output;
}

function featureFlowLines(
  paragraphs: readonly FeatureParagraph[],
  width: number,
  fontSize: number,
  measure: TextMeasure,
): FeatureFlowLine[] {
  const output: FeatureFlowLine[] = [];
  const spaceWidth = measure(" ", fontSize);
  for (const [paragraphIndex, { words, indent, gapAfter, kind }] of paragraphs.entries()) {
    const availableWidth = width - indent;
    let line: StyledWord[] = [];
    let start = 0;
    let lineWidth = 0;
    const wrapped: FeatureFlowLine[] = [];
    const push = (): void => {
      wrapped.push({ words: line, indent, gapAfter: null, paragraph: paragraphIndex, start, ...(kind === undefined ? {} : { kind }) });
    };
    for (const [wordIndex, word] of words.entries()) {
      const wordWidth = measure(word.text, fontSize, word.style ?? "regular");
      const candidateWidth = line.length === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
      if (line.length > 0 && candidateWidth > availableWidth) {
        push();
        line = [];
        start = wordIndex;
        lineWidth = 0;
      }
      line.push(word);
      lineWidth = line.length === 1 ? wordWidth : lineWidth + spaceWidth + wordWidth;
    }
    if (line.length > 0) push();
    if (wrapped.length > 0) wrapped[wrapped.length - 1]!.gapAfter = gapAfter;
    output.push(...wrapped);
  }
  return output;
}

function featureFlowFits(
  lines: readonly FeatureFlowLine[],
  top: number,
  bottom: number,
  lineHeight: number,
  fontSize: number,
): boolean {
  let y = top;
  for (const line of lines) {
    if (y < bottom) return false;
    y -= lineHeight + featureGapFor(line.gapAfter, fontSize);
  }
  return true;
}

interface FeatureFlowResult {
  /** The paragraphs left over from the first line not drawn, if any. */
  rest?: FeatureParagraph[];
  /** The baseline the next line would have taken. */
  y: number;
}

const FEATURE_RULE_COLOUR: PdfColor = [0.45, 0.45, 0.45];

function drawFeatureFlow(
  page: PDFPage,
  paragraphs: readonly FeatureParagraph[],
  lines: readonly FeatureFlowLine[],
  fonts: SheetFonts,
  x: number,
  top: number,
  width: number,
  bottom: number,
  fontSize: number,
  lineHeight: number,
  ruleColour: PdfColor = FEATURE_RULE_COLOUR,
): FeatureFlowResult {
  let y = top;
  let lineIndex = 0;
  // The space between words is the body face's at this size whatever face the
  // word itself is in, so it is measured once rather than per word.
  const spaceWidth = drawnWidth(fonts.regular, " ", fontSize);
  const ink = rgb(0.05, 0.05, 0.05);
  for (; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (y < bottom) break;
    // A heading goes with the line under it, to the next page if need be.
    const next = y - lineHeight - featureGapFor(line.gapAfter, fontSize);
    if (line.kind !== undefined && lineIndex + 1 < lines.length && next < bottom) break;
    let cursor = x + line.indent;
    // Consecutive words in the body face are drawn as one string. pdf-lib sums
    // glyph advances without kerning, and the space that joins them is the body
    // face's — the same width the cursor advances by — so a merged run lands
    // exactly where the words would have landed one at a time. A bold or italic
    // word breaks the run, because its own space is a different width.
    let pending: { font: PDFFont; text: string; x: number } | undefined;
    const flush = (): void => {
      if (pending === undefined) return;
      page.drawText(pending.text, { x: pending.x, y, size: fontSize, font: pending.font, color: ink });
      pending = undefined;
    };
    for (const word of line.words) {
      const font = runFont(fonts, word.style);
      const value = winAnsiText(word.text);
      if (pending !== undefined && font === fonts.regular) pending.text += ` ${value}`;
      else {
        flush();
        pending = font === fonts.regular ? { font, text: value, x: cursor } : undefined;
        if (pending === undefined) {
          page.drawText(value, { x: cursor, y, size: fontSize, font, color: ink });
        }
      }
      cursor += drawnWidth(font, value, fontSize) + spaceWidth;
    }
    flush();
    // Group headings and continuation lines alike are ruled beneath.
    if (line.kind !== undefined) {
      const ruleY = y - fontSize * FEATURE_RULE_DROP_RATIO;
      page.drawLine({ start: { x, y: ruleY }, end: { x: x + width, y: ruleY }, thickness: 0.5, color: rgb(...ruleColour) });
    }
    y -= lineHeight + featureGapFor(line.gapAfter, fontSize);
  }
  if (lineIndex >= lines.length) return { y };
  const first = lines[lineIndex]!;
  const cut = paragraphs[first.paragraph]!;
  return {
    rest: [{ ...cut, words: cut.words.slice(first.start) }, ...paragraphs.slice(first.paragraph + 1)],
    y,
  };
}

/**
 * Whether `paragraphs` fit the box at `size`, the line height scaling with the
 * size as drawRichFeatureSection scales it.
 */
function featureBoxFits(
  paragraphs: readonly FeatureParagraph[],
  fonts: SheetFonts,
  box: RichTextBox,
  size: number,
  lineHeightRatio = 1,
): boolean {
  const top = box.top - BOX_TEXT_TOP_INSET - capHeightRatio(fonts.regular) * size;
  return featureFlowFits(featureFlowLines(paragraphs, box.width, size, fontMeasure(fonts)), top, box.bottom, size * lineHeightRatio, size);
}

function drawRichFeatureSection(
  page: PDFPage,
  paragraphs: readonly FeatureParagraph[],
  fonts: SheetFonts,
  x: number,
  /** The box's top edge; the first baseline follows from the size drawn. */
  boxTop: number,
  width: number,
  bottom: number,
  fontSize = DEFAULT_FEATURE_FONT_SIZE,
  lineHeight = fontSize,
  ruleColour?: PdfColor,
  minFontSize = MIN_FEATURE_FONT_SIZE,
): FeatureParagraph[] | undefined {
  const lineHeightAt = (size: number): number => lineHeight * size / fontSize;
  const capHeight = capHeightRatio(fonts.regular);
  const topAt = (size: number): number => boxTop - BOX_TEXT_TOP_INSET - capHeight * size;
  const measure = fontMeasure(fonts);
  const normalLines = featureFlowLines(paragraphs, width, fontSize, measure);
  let chosenFontSize = fontSize;
  let chosenLines = normalLines;
  let chosenLineHeight = lineHeightAt(chosenFontSize);
  if (!featureFlowFits(normalLines, topAt(chosenFontSize), bottom, chosenLineHeight, chosenFontSize)) {
    const floorLines = featureFlowLines(paragraphs, width, minFontSize, measure);
    const floorLineHeight = lineHeightAt(minFontSize);
    if (featureFlowFits(floorLines, topAt(minFontSize), bottom, floorLineHeight, minFontSize)) {
      // Take the largest size that still fits, so the text shrinks only as far
      // as the page demands.
      let low = minFontSize;
      let high = fontSize;
      for (let pass = 0; pass < 10; pass += 1) {
        const candidate = (low + high) / 2;
        const candidateLines = featureFlowLines(paragraphs, width, candidate, measure);
        if (featureFlowFits(candidateLines, topAt(candidate), bottom, lineHeightAt(candidate), candidate)) low = candidate;
        else high = candidate;
      }
      chosenFontSize = low;
      chosenLines = featureFlowLines(paragraphs, width, chosenFontSize, measure);
      chosenLineHeight = lineHeightAt(chosenFontSize);
    } else {
      // Prose that cannot fit even at the smallest legible size is continued
      // at the normal size. Shrinking the visible prefix further would make a
      // short feature look arbitrarily smaller merely because a later feature
      // is long; the continuation page provides the bounded layout instead.
      chosenLines = normalLines;
      chosenLineHeight = lineHeightAt(chosenFontSize);
    }
  }
  return drawFeatureFlow(page, paragraphs, chosenLines, fonts, x, topAt(chosenFontSize), width, bottom, chosenFontSize, chosenLineHeight, ruleColour).rest;
}

interface RichTextBox {
  x: number;
  /** The box's top edge, not a baseline. */
  top: number;
  width: number;
  bottom: number;
}



/**
 * The drawable box for a hand-drawn rich-text section: the template field's
 * widget rectangle inset 3pt horizontally, its top edge (where the first
 * line's cap height is held BOX_TEXT_TOP_INSET below, at whatever size the
 * text is drawn) and the last baseline held 1pt above the bottom edge.
 * Falls back to the given box when the template lacks the field.
 */
function richTextBox(
  fieldRects: ReadonlyMap<string, FieldRect>,
  fieldName: string,
  fallback: RichTextBox,
): RichTextBox {
  const rect = fieldRects.get(fieldName);
  if (rect === undefined) return fallback;
  return {
    x: rect.x + 3,
    top: rect.y + rect.height,
    width: rect.width - 6,
    bottom: rect.y + 1,
  };
}

const CONTINUATION_TEXT_X = CONTINUATION_PAGE_TEXT.x;
const CONTINUATION_TEXT_WIDTH = CONTINUATION_PAGE_TEXT.width;
const CONTINUATION_TEXT_TOP = CONTINUATION_PAGE_TEXT.top;
const CONTINUATION_TEXT_BOTTOM = CONTINUATION_PAGE_TEXT.bottom;

/** A plain page in the attack-note style: a titled band and the footer. */
function addContinuationPage(
  output: PDFDocument, title: string, fonts: SheetFonts, colours: SheetLabelColours, footerText: string,
): PDFPage {
  const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 32, y: 738, width: 548, height: 30, color: rgb(...colours.accent), borderColor: rgb(...colours.lines), borderWidth: 1 });
  page.drawText(title, { x: 44, y: 748, size: 12, font: fonts.titles, color: rgb(...colours.cream) });
  drawSheetFooter(page, fonts, footerText);
  return page;
}

/**
 * Whatever a page's boxes could not hold continues on plain pages in the
 * attack-note style, each box's part under a bold "<box> (continued)" line,
 * rewrapped at the page's full width rather than repeating the page to fill
 * the same small boxes again. Every part is set at the features' normal size,
 * so the page reads as one run of text whichever boxes it came from.
 */
function addFeatureContinuationPages(
  output: PDFDocument, parts: readonly FeatureContinuation[], fonts: SheetFonts,
  colours: SheetLabelColours, footerText: string, title: string,
): void {
  const measure = fontMeasure(fonts);
  const fontSize = DEFAULT_FEATURE_FONT_SIZE;
  let page: PDFPage | undefined;
  let y = 0;
  for (const part of parts) {
    // A part that opens on a group heading is named for that group already, so
    // its part line stands in for the heading.
    const [first, ...others] = part.paragraphs;
    let rest: FeatureParagraph[] | undefined = [
      headingParagraph(`${part.heading} (${part.whole === true ? "in full" : "continued"})`, "part"),
      ...(first?.kind === "heading" ? others : part.paragraphs),
    ];
    if (page !== undefined) y -= CONTINUATION_PART_GAP;
    while (rest !== undefined) {
      if (page === undefined || y < CONTINUATION_TEXT_BOTTOM) {
        page = addContinuationPage(output, title, fonts, colours, footerText);
        y = CONTINUATION_TEXT_TOP;
      }
      const lines = featureFlowLines(rest, CONTINUATION_TEXT_WIDTH, fontSize, measure);
      const drawn: FeatureFlowResult = drawFeatureFlow(page, rest, lines, fonts, CONTINUATION_TEXT_X, y, CONTINUATION_TEXT_WIDTH,
        CONTINUATION_TEXT_BOTTOM, fontSize, fontSize, colours.lines);
      y = drawn.y;
      rest = drawn.rest;
      if (rest !== undefined) page = undefined;
    }
  }
}

// A box's title sits just above or just below it (2024 heads its boxes, 2014
// captions them underneath), centred over a span that covers the box.
const BOX_TITLE_REACH = 30;
const BOX_TITLE_SLACK = 6;
const BOX_TITLE_MAX_SPAN = 2.2;

function printedName(text: string): string {
  return text.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

/**
 * The name a continuation gives a box: the title the page itself prints for
 * it, found by geometry in the page's labels so a renamed or moved box keeps
 * its name, else `fallback`.
 */
function boxTitle(labels: SheetTemplateLabels[string] | undefined, rect: FieldRect | undefined, fallback: string): string {
  if (rect === undefined) return fallback;
  let best: { text: string; distance: number } | undefined;
  for (const label of labels?.labels ?? []) {
    const width = label.width ?? 0;
    if (label.align !== "center" || !/\p{Lu}{2}/u.test(label.text) || label.text !== label.text.toUpperCase()) continue;
    if (label.x > rect.x + BOX_TITLE_SLACK || label.x + width < rect.x + rect.width - BOX_TITLE_SLACK) continue;
    if (width > rect.width * BOX_TITLE_MAX_SPAN) continue;
    const top = rect.y + rect.height;
    const distance = label.y >= top ? label.y - top : label.y <= rect.y ? rect.y - label.y : 0;
    if (distance <= BOX_TITLE_REACH && (best === undefined || distance < best.distance)) best = { text: label.text, distance };
  }
  return best === undefined ? fallback : printedName(best.text);
}

/** A form box's name when its page prints no title for it: the field's own. */
function fieldFallbackName(field: string): string {
  return printedName(field.replace(/^(details|background|companion|equipment_page)_/, "").replace(/_/g, " "));
}

/** Text a form box could not hold, as plain paragraphs for a continuation. */
function fieldContinuations(
  overflow: readonly BoxOverflow[], fieldRects: ReadonlyMap<string, FieldRect>, labels: SheetTemplateLabels[string] | undefined,
): FeatureContinuation[] {
  // A value cut short is named by what its box shows, which is how a reader
  // finds it here; a box's remaining text, by the box's printed title.
  return overflow.map(({ field, text, shown }) => ({
    heading: shown ?? boxTitle(labels, fieldRects.get(field), fieldFallbackName(field)),
    ...(shown === undefined ? {} : { whole: true }),
    paragraphs: text.split("\n").flatMap((paragraph): FeatureParagraph[] => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      return words.length === 0 ? [] : [{ words: words.map((word) => ({ text: word, style: "regular" as const })), indent: 0, gapAfter: "paragraph" }];
    }),
  }));
}

/**
 * How the details page lays out its feature rows: `split` puts class
 * features, subclass features and feats apart, in their own boxes when the
 * template has them and under ruled headings in one box when it does not.
 */
interface DetailsFeatureLayout {
  split: boolean;
  /** The page's printed titles, which name the boxes a continuation carries on. */
  labels?: SheetTemplateLabels[string];
  ruleColour?: PdfColor;
}

/** One flowed box of the character page: its field, its text and how it is set. */
interface DetailsTextBox {
  field: string;
  paragraphs: readonly FeatureParagraph[];
  /** The box's name for a continuation when the page prints no title for it. */
  heading: string;
  fallback: RichTextBox;
  fontSize?: number;
  lineHeight?: number;
  minFontSize?: number;
}

const SPECIES_FIELD = "details_additional_notes";
const FEATURES_FIELD = "details_features";

/** What the character page flows into its rich-text boxes, in drawing order. */
function detailsTextBoxes(
  modelPage: SheetPage,
  fieldRects: ReadonlyMap<string, FieldRect>,
  layout: DetailsFeatureLayout,
): DetailsTextBox[] {
  const find = (title: string): SheetSection | undefined =>
    modelPage.sections.find((section) => section.title === title);
  const boxes: DetailsTextBox[] = [];
  const racial = find("racial-traits");
  if (racial !== undefined) {
    boxes.push({
      field: SPECIES_FIELD, paragraphs: sectionParagraphs(racial), heading: "Traits",
      fallback: { x: 222, top: 380, width: 169, bottom: 125 }, minFontSize: SPECIES_MIN_FONT_SIZE,
    });
  }
  // A layout with its own subclass and feat boxes (2024 Hybrid, and the split
  // layout of the others) splits the feature rows by origin; a split layout
  // with one features box heads each origin's rows inside it; the others keep
  // one combined box. A model without the groups prints the combined rows in
  // the class box rather than leaving the three boxes empty.
  const groups = modelPage.featureGroups;
  const featureBox = { x: 409, top: 661, width: 169, bottom: 132 };
  const features = find("features");
  const grouped: ReadonlyArray<readonly [string, string, readonly SheetRow[]]> = groups === undefined ? [] : [
    [FEATURES_FIELD, "Class Features", groups["class-features"] ?? []],
    ["details_subclass_features", "Subclass Features", groups["subclass-features"] ?? []],
    ["details_feats", "Feats", groups.feats ?? []],
  ];
  if (fieldRects.has("details_subclass_features") && groups !== undefined) {
    for (const [field, heading, rows] of grouped) boxes.push({ field, paragraphs: featureParagraphs(rows), heading, fallback: featureBox });
  } else if (layout.split && groups !== undefined) {
    boxes.push({
      field: FEATURES_FIELD, heading: "Features", fallback: featureBox,
      paragraphs: groupedFeatureParagraphs(grouped.map(([, heading, rows]) => [heading, rows] as const)),
    });
  } else if (features !== undefined) {
    boxes.push({ field: FEATURES_FIELD, paragraphs: sectionParagraphs(features), heading: "Features", fallback: featureBox });
  }

  const proficiencyRows = [
    ...(find("proficiencies")?.rows ?? []),
    ...(find("languages")?.rows ?? []),
  ];
  // A list box — proficiencies and languages — is one run of like items, not a
  // sequence of features, so it keeps the plain paragraph rhythm.
  boxes.push({
    field: "details_proficiencies_languages", paragraphs: featureParagraphs(proficiencyRows, false), heading: "Proficiencies & Languages",
    fallback: { x: 409, top: 128, width: 169, bottom: 33 }, fontSize: 7.4, lineHeight: 9.2,
  });
  return boxes;
}

function drawDetailsRichText(
  page: PDFPage,
  boxes: readonly DetailsTextBox[],
  fonts: SheetFonts,
  fieldRects: ReadonlyMap<string, FieldRect>,
  layout: DetailsFeatureLayout,
): FeatureContinuation[] {
  const continuations: FeatureContinuation[] = [];
  for (const { field, paragraphs, heading, fallback, fontSize = DEFAULT_FEATURE_FONT_SIZE, lineHeight = fontSize, minFontSize } of boxes) {
    const box = richTextBox(fieldRects, field, fallback);
    const rest = drawRichFeatureSection(page, paragraphs, fonts, box.x, box.top, box.width, box.bottom, fontSize, lineHeight, layout.ruleColour, minFontSize);
    if (rest === undefined) continue;
    // Cut inside a headed group, the part continues that group, by its name.
    const group = paragraphs.slice(0, paragraphs.length - rest.length + 1).reverse().find((paragraph) => paragraph.kind === "heading");
    continuations.push({
      paragraphs: rest,
      heading: group === undefined ? boxTitle(layout.labels, fieldRects.get(field), heading) : group.words.map((word) => word.text).join(" "),
    });
  }
  return continuations;
}

// ---------------------------------------------------------------------------
// The 2024 and Hybrid traits column: Species Traits over the features box,
// one region the two share.
// ---------------------------------------------------------------------------

/**
 * The column as the template drew it, found from its own boxes: the species
 * and features fields one above the other in the same column, their plate
 * frames `traitsColumn.gap` apart. A page without that arrangement (the 2014
 * page keeps its species traits in another column) has none.
 */
interface TraitsColumn {
  species: FieldRect;
  features: FieldRect;
  /** The band's horizontal extent: both frames and their strokes. */
  left: number;
  right: number;
  /** The species frame's top edge, which never moves. */
  speciesTop: number;
  /** The template's species frame bottom and features frame top. */
  speciesBottom: number;
  featuresTop: number;
  /** The features frame's bottom edge, which never moves. */
  featuresBottom: number;
  /**
   * Lines across each frame's straight sides, clear of its title and its
   * corners. Between them the writer rearranges the artwork; outside them it
   * prints as drawn.
   */
  upperCut: number;
  lowerCut: number;
}

// A frame's 0.9pt stroke reaches this far past its path.
const FRAME_STROKE_REACH = 0.6;
// The species frame holds at least its title and two lines; the features
// frame at least its title and a few lines of text.
const TRAITS_SPECIES_MIN_HEIGHT = 40;
const TRAITS_FEATURES_MIN_HEIGHT = 80;
// When the column cannot hold both, Species Traits takes no more than this
// share of it unless the features still fit beside it.
const TRAITS_SPECIES_CAP_SHARE = 0.4;
// Neighbouring pieces of the rearranged artwork overlap by this much, so no
// viewer shows a seam where they meet.
const TRAITS_SEAM_OVERLAP = 0.5;

function findTraitsColumn(rects: ReadonlyMap<string, FieldRect>): TraitsColumn | undefined {
  const species = rects.get(SPECIES_FIELD);
  const features = rects.get(FEATURES_FIELD);
  if (species === undefined || features === undefined) return undefined;
  const pad = SHEET_TEMPLATE_CONTRACT.platePad;
  if (Math.abs(species.x - features.x) > 0.5 || Math.abs(species.width - features.width) > 0.5) return undefined;
  const speciesBottom = species.y - pad.bottom;
  const featuresTop = features.y + features.height + pad.top;
  const gap = speciesBottom - featuresTop;
  if (gap < 0 || gap > SHEET_TEMPLATE_CONTRACT.traitsColumn.gap + 0.5) return undefined;
  return {
    species,
    features,
    left: species.x - pad.side - FRAME_STROKE_REACH,
    right: species.x + species.width + pad.side + FRAME_STROKE_REACH,
    speciesTop: species.y + species.height + pad.top,
    speciesBottom,
    featuresTop,
    featuresBottom: features.y - pad.bottom,
    upperCut: species.y + species.height - pad.bottom,
    lowerCut: features.y + pad.bottom,
  };
}

/**
 * The column's field rectangles with the boundary moved down by `shift`
 * points (up, when negative): the species box ends lower and the features
 * box starts lower, both by the same amount.
 */
function shiftedTraitsRects(
  rects: ReadonlyMap<string, FieldRect>, column: TraitsColumn, shift: number,
): ReadonlyMap<string, FieldRect> {
  if (shift === 0) return rects;
  const out = new Map(rects);
  out.set(SPECIES_FIELD, { ...column.species, y: column.species.y - shift, height: column.species.height + shift });
  out.set(FEATURES_FIELD, { ...column.features, height: column.features.height - shift });
  return out;
}

/**
 * How far to move the boundary. Species Traits first takes the height it
 * needs at the normal size, giving any spare to the features. Text the
 * printed box cannot hold shrinks, down to SPECIES_MIN_FONT_SIZE, before it
 * borrows. When it must borrow, it takes what the features can spare at
 * their own normal size, so it prints as large as the column allows, and at
 * least what it needs at the floor while the features still fit at theirs.
 * Only when the column cannot hold both does either continue: Species Traits
 * keeps its printed height or takes up to TRAITS_SPECIES_CAP_SHARE of the
 * column, more if the features still fit.
 */
function planTraitsColumn(
  column: TraitsColumn,
  species: DetailsTextBox | undefined,
  features: DetailsTextBox | undefined,
  fonts: SheetFonts,
): number {
  const printed = column.speciesTop - column.speciesBottom;
  const least = TRAITS_SPECIES_MIN_HEIGHT - printed;
  const most = column.featuresTop - column.featuresBottom - TRAITS_FEATURES_MIN_HEIGHT;
  if (most < least) return 0;
  if (species === undefined || species.paragraphs.length === 0) return least;
  const rects = new Map([[SPECIES_FIELD, column.species], [FEATURES_FIELD, column.features]]);
  const box = (field: string, shift: number): RichTextBox =>
    richTextBox(shiftedTraitsRects(rects, column, shift), field, species.fallback);
  const speciesFits = (shift: number, size: number): boolean => featureBoxFits(species.paragraphs, fonts, box(SPECIES_FIELD, shift), size);
  const featuresFit = (shift: number, size = MIN_FEATURE_FONT_SIZE): boolean => features === undefined
    || featureBoxFits(features.paragraphs, fonts, box(FEATURES_FIELD, shift), size);
  /** The smallest whole-point shift in range that passes a test growing easier with the shift. */
  const smallest = (test: (shift: number) => boolean): number | undefined => {
    if (!test(most)) return undefined;
    let low = least - 1;
    let high = most;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (test(middle)) high = middle;
      else low = middle;
    }
    return high;
  };
  const atNormal = smallest((shift) => speciesFits(shift, DEFAULT_FEATURE_FONT_SIZE));
  if (atNormal !== undefined && atNormal <= 0) return atNormal;
  if (speciesFits(0, SPECIES_MIN_FONT_SIZE)) return 0;
  const atFloor = smallest((shift) => speciesFits(shift, SPECIES_MIN_FONT_SIZE));
  // The largest shift that leaves the features room at `size`, found the same way.
  const featuresRoom = (size?: number): number => {
    if (!featuresFit(least, size)) return least - 1;
    const first = smallest((shift) => !featuresFit(shift, size));
    return first === undefined ? most : first - 1;
  };
  const room = featuresRoom();
  if (atFloor !== undefined && atFloor <= room) {
    return Math.max(atFloor, Math.min(featuresRoom(DEFAULT_FEATURE_FONT_SIZE), atNormal ?? most));
  }
  const cap = Math.round(TRAITS_SPECIES_CAP_SHARE * (column.speciesTop - column.featuresBottom)) - printed;
  return Math.min(most, Math.max(0, Math.min(atFloor ?? most, Math.max(room, cap))));
}

/** Clips to the union of `rects` (or, even-odd, the first less the rest), draws, and restores. */
function withClip(page: PDFPage, rects: ReadonlyArray<readonly [number, number, number, number]>, evenOdd: boolean, draw: () => void): void {
  page.pushOperators(
    pushGraphicsState(),
    ...rects.map(([x, y, width, height]) => rectangle(x, y, width, height)),
    evenOdd ? clipEvenOdd() : clip(),
    endPath(),
  );
  draw();
  page.pushOperators(popGraphicsState());
}

/**
 * The character page's artwork with the traits column's boundary moved down
 * by `shift`. Everything outside the band between the column's cuts prints
 * as drawn. Inside it, the species frame's foot and the features frame's head
 * move together; the gap they open (or the overlap they leave) is filled by
 * stretching a one-point slice of the frame's straight sides, which repeats
 * exactly, so the frames read as drawn at their new heights.
 */
function drawTraitsColumnArtwork(
  page: PDFPage, embedded: PDFEmbeddedPage, width: number, height: number, column: TraitsColumn, shift: number,
): void {
  const full = { x: 0, y: 0, width, height };
  if (shift === 0) {
    page.drawPage(embedded, full);
    return;
  }
  const { left, right, upperCut, lowerCut } = column;
  const span = right - left;
  withClip(page, [[0, 0, width, height], [left, lowerCut, span, upperCut - lowerCut]], true, () => page.drawPage(embedded, full));
  // The moved part: the species foot, the gap and the features head.
  const movedBottom = lowerCut + Math.max(0, -shift);
  const movedTop = upperCut - Math.max(0, shift);
  withClip(page, [[left, movedBottom, span, movedTop - movedBottom]], false, () => page.drawPage(embedded, { ...full, y: -shift }));
  // A taller species box repeats the slice under its cut; a shorter one, the
  // features box's slice over its own.
  const [slice, from, to] = shift > 0
    ? [upperCut - 1, movedTop - TRAITS_SEAM_OVERLAP, upperCut + TRAITS_SEAM_OVERLAP]
    : [lowerCut, lowerCut - TRAITS_SEAM_OVERLAP, movedBottom + TRAITS_SEAM_OVERLAP];
  const scale = to - from;
  withClip(page, [[left, from, span, to - from]], false, () =>
    page.drawPage(embedded, { x: 0, y: from - slice * scale, width, height: height * scale }));
}

/** The page's labels with those inside the traits column's band moved with its boundary. */
function shiftedTraitsLabels(
  labels: SheetTemplateLabels[string] | undefined, column: TraitsColumn, shift: number,
): SheetTemplateLabels[string] | undefined {
  if (labels === undefined || shift === 0) return labels;
  const inBand = (x: number, y: number): boolean => x >= column.left && x <= column.right && y > column.lowerCut && y < column.upperCut;
  return {
    labels: labels.labels.map((label) => inBand(label.x + (label.width ?? 0) / 2, label.y) ? { ...label, y: label.y - shift } : label),
    ribbons: labels.ribbons.map((ribbon) => inBand(ribbon.cx, ribbon.cy) ? { ...ribbon, cy: ribbon.cy - shift } : ribbon),
  };
}

/**
 * The companion page's flowed text. The template sizes its own
 * `companion_features` box, so the geometry comes from that field's widget
 * rectangle rather than pinned coordinates. Returns what the box could not
 * hold, named by the page's title for it.
 */
function drawCompanionRichText(
  page: PDFPage,
  modelPage: SheetPage,
  fonts: SheetFonts,
  fieldRects: ReadonlyMap<string, FieldRect>,
  labels: SheetTemplateLabels[string] | undefined,
): FeatureContinuation[] {
  const section = modelPage.sections.find((candidate) => candidate.title === "companion-features");
  if (section === undefined || section.rows.length === 0) return [];
  const box = richTextBox(fieldRects, "companion_features", {
    x: 36,
    top: 368,
    width: 250,
    bottom: 40,
  });
  const rest = drawRichFeatureSection(page, sectionParagraphs(section), fonts, box.x, box.top, box.width, box.bottom);
  return rest === undefined ? [] : [{ paragraphs: rest, heading: boxTitle(labels, fieldRects.get("companion_features"), "Features") }];
}

function equipmentSidebarRuns(modelPage: SheetPage): LayoutRun[] {
  return modelPage.sections
    .flatMap((section) => section.positionedRuns ?? [])
    .filter((run) => run.role === "sidebar");
}

function drawEquipmentRichText(
  page: PDFPage,
  modelPage: SheetPage,
  fonts: SheetFonts,
  pageIndex: number,
): void {
  drawPositionedRuns(
    page,
    equipmentSidebarRuns(modelPage).filter((run) => (run.page ?? 0) === pageIndex),
    fonts,
  );
}

interface AttackNoteCard { title: string; text: string }

/** Wrap literal user text using the selected face, including unbroken words. */
function attackNoteLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (drawnWidth(font, candidate, size) <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const char of word) {
      if (line && drawnWidth(font, line + char, size) > width) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function addAttackNotePages(
  output: PDFDocument, cards: readonly AttackNoteCard[], fonts: SheetFonts,
  colours: SheetLabelColours, footerText: string,
): void {
  const x = 32, width = 548, padding = 12, bottom = 48, lineHeight = 11;
  let page: PDFPage | undefined;
  let top = 0;
  const newPage = (): PDFPage => {
    top = 724;
    return addContinuationPage(output, "ATTACK NOTES", fonts, colours, footerText);
  };
  for (const card of cards) {
    const lines = attackNoteLines(card.text, fonts.regular, 8, width - padding * 2);
    let offset = 0;
    while (offset < lines.length) {
      const title = card.title + (offset > 0 ? " (continued)" : "");
      const wrappedTitle = attackNoteLines(title, fonts.titles, 10, width - padding * 2);
      const titleLines = wrappedTitle.length <= 3 ? wrappedTitle : [...wrappedTitle.slice(0, 2), ellipsizeSpellText(wrappedTitle.slice(2).join(" "), fonts.titles, 10, width - padding * 2)];
      const headerHeight = titleLines.length * 12 + 12;
      if (!page || top - bottom < headerHeight + padding * 2 + lineHeight * 2) page = newPage();
      const count = Math.min(lines.length - offset, Math.floor((top - bottom - headerHeight - padding * 2) / lineHeight));
      const height = headerHeight + padding * 2 + count * lineHeight;
      page.drawRectangle({ x, y: top - height, width, height, color: rgb(1, 1, 1), borderColor: rgb(...colours.lines), borderWidth: 1 });
      page.drawRectangle({ x, y: top - headerHeight, width, height: headerHeight, color: rgb(...colours.accent), borderColor: rgb(...colours.lines), borderWidth: 1 });
      titleLines.forEach((line, index) => page!.drawText(line, { x: x + padding, y: top - 16 - index * 12, size: 10, font: fonts.titles, color: rgb(...colours.cream) }));
      lines.slice(offset, offset + count).forEach((line, index) => page!.drawText(line, { x: x + padding, y: top - headerHeight - padding - 8 - index * lineHeight, size: 8, font: fonts.regular, color: rgb(...colours.text) }));
      offset += count;
      top -= height + 14;
    }
  }
}

/** A card frame: the template artwork and the labels drawn on it. */
interface CardFrame { template: Uint8Array; labels: SheetTemplateLabels[string] | undefined }

/**
 * A card page with one frame per filled slot, in reading order. A slot that
 * continues a card begun earlier takes `continued` (the plain card: no spell
 * metadata labels waiting for values); every other slot takes `primary`.
 */
async function addCardPage(
  output: PDFDocument,
  primary: CardFrame,
  continued: CardFrame,
  fragments: FragmentCache,
  slots: readonly boolean[],
  fonts: SheetFonts,
  colours: SheetLabelColours,
): Promise<PDFPage> {
  const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const grid = SHEET_TEMPLATE_CONTRACT.cards;
  for (const [index, isContinued] of slots.entries()) {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const top = grid.rowTops[row];
    if (top === undefined) break;
    const x = grid.originX + column * (grid.width + grid.gutter);
    const y = top - grid.height;
    const frame = isContinued ? continued : primary;
    page.drawPage(await embedFragment(output, frame.template, fragments), { x, y, width: grid.width, height: grid.height });
    drawTemplateText(page, frame.labels, fonts, colours, x, y);
  }
  return page;
}

/**
 * Times a named phase when the caller supplied a trace hook. Without one the
 * writer runs the phase directly, so an untraced render pays a single branch.
 */
function phaseTimer(trace: SheetRenderTrace | undefined) {
  if (trace === undefined) return <T>(_phase: string, run: () => T): T => run();
  return <T>(phase: string, run: () => T, detail?: Record<string, unknown>): T => {
    const started = performance.now();
    const result = run();
    // A phase is usually async; the cast keeps one signature for both kinds.
    if (result instanceof Promise) {
      return result.then((value: unknown) => {
        trace(phase, performance.now() - started, detail);
        return value;
      }) as T;
    }
    trace(phase, performance.now() - started, detail);
    return result;
  };
}

type FragmentCache = Map<Uint8Array, Awaited<ReturnType<PDFDocument["embedPdf"]>>[number]>;

// Each template fragment is embedded at most once per output document; repeated
// spell-list or card pages reuse the embedded page instead of re-parsing bytes.
async function embedFragment(output: PDFDocument, bytes: Uint8Array, fragments: FragmentCache) {
  const cached = fragments.get(bytes);
  if (cached !== undefined) return cached;
  const [embedded] = await output.embedPdf(bytes, [0]);
  fragments.set(bytes, embedded!);
  return embedded!;
}

function drawCentered(
  page: PDFPage,
  textValue: string,
  center: number,
  y: number,
  font: PDFFont,
  size: number,
  textColor: PdfColor = [0.05, 0.05, 0.05],
): void {
  const value = winAnsiText(textValue);
  page.drawText(value, {
    x: center - drawnWidth(font, value, size) / 2,
    y,
    size,
    font,
    color: rgb(textColor[0], textColor[1], textColor[2]),
  });
}

/**
 * Centres text on a box's middle rather than on a baseline: cap height sits
 * either side of `middle`, which is how the template's engraved boxes read.
 */
function drawCenteredInBox(
  page: PDFPage,
  textValue: string,
  center: number,
  middle: number,
  font: PDFFont,
  size: number,
): void {
  drawCentered(page, textValue, center, middle - (capHeightRatio(font) * size) / 2, font, size);
}

/**
 * Draws a portrait into the template's image-field frame. The template's own
 * image buttons are dropped when the form is flattened, so the picture is
 * painted onto the page using the rectangle captured beforehand — scaled to
 * fit and centred, the way the frames were designed to hold it.
 *
 * A portrait is decoration: an unreadable or unsupported image is skipped so a
 * character with a bad one still exports a complete sheet.
 */
/**
 * Paints a host's logo over the masthead badge. The template's own die mark is
 * covered first, so a logo with transparent edges does not show it through.
 *
 * The template draws the masthead rule across the badge's box, so the knockout
 * takes the rule's left end with it; that slice is repainted before the logo
 * goes down, leaving the header rule unbroken behind a transparent mark.
 */
async function drawBrandImage(
  output: PDFDocument,
  page: PDFPage,
  fieldRects: ReadonlyMap<string, FieldRect>,
  base64: string,
  colours: SheetColours,
): Promise<void> {
  const rect = fieldRects.get(SHEET_TEMPLATE_CONTRACT.masthead.field);
  if (rect === undefined || base64 === "") return;
  // The template keeps the die mark inside the badge's box, so the box plus a
  // hair for antialiasing clears it without reaching the name plate below.
  const bleed = 0.5;
  const left = rect.x - bleed;
  const bottom = rect.y - bleed;
  const width = rect.width + bleed * 2;
  const height = rect.height + bleed * 2;
  page.drawRectangle({ x: left, y: bottom, width, height, color: rgb(1, 1, 1) });
  drawMastheadRule(page, left, left + width, bottom, bottom + height, colours);
  await drawFieldImage(output, page, fieldRects, SHEET_TEMPLATE_CONTRACT.masthead.field, base64);
}

/** Redraws the part of the masthead rule that falls inside the badge knockout. */
function drawMastheadRule(
  page: PDFPage,
  left: number,
  right: number,
  bottom: number,
  top: number,
  colours: SheetColours,
): void {
  const { rule } = SHEET_TEMPLATE_CONTRACT.masthead;
  const { thickness, capRadius } = SHEET_TEMPLATE_CONTRACT.ornament;
  if (rule.y + capRadius < bottom || rule.y - capRadius > top) return;
  const [red, green, blue] = SHEET_PALETTE[colours.accent].rgb;
  const colour = rgb(red, green, blue);
  const from = Math.max(left, rule.x1 + capRadius * 2);
  const to = Math.min(right, rule.x2 - capRadius * 2);
  if (to > from) {
    page.drawLine({ start: { x: from, y: rule.y }, end: { x: to, y: rule.y }, thickness, color: colour });
  }
  for (const capX of [rule.x1 + capRadius, rule.x2 - capRadius]) {
    if (capX < left - capRadius || capX > right + capRadius) continue;
    page.drawSvgPath(`M 0 ${-capRadius} L ${capRadius} 0 L 0 ${capRadius} L ${-capRadius} 0 Z`, {
      x: capX,
      y: rule.y,
      color: colour,
      borderWidth: 0,
    });
  }
}

async function drawFieldImage(
  output: PDFDocument,
  page: PDFPage,
  fieldRects: ReadonlyMap<string, FieldRect>,
  fieldName: string,
  base64: string,
): Promise<void> {
  const rect = fieldRects.get(fieldName);
  if (rect === undefined || base64 === "") return;
  try {
    const bytes = decodeBase64(base64);
    const isPng =
      bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
    // Uploads normalize to PNG, but an imported character may carry a JPEG.
    if (!isPng && !isJpeg) return;
    const image = isPng ? await output.embedPng(bytes) : await output.embedJpg(bytes);
    const scaled = image.scaleToFit(rect.width, rect.height);
    page.drawImage(image, {
      x: rect.x + (rect.width - scaled.width) / 2,
      y: rect.y + (rect.height - scaled.height) / 2,
      width: scaled.width,
      height: scaled.height,
    });
  } catch {
    // Unreadable portrait: the rest of the sheet still renders.
  }
}

/** Signs the foot of a template page. */
function drawSheetFooter(page: PDFPage, fonts: SheetFonts, footerText: string): void {
  if (footerText === "") return;
  drawCentered(page, footerText, PAGE_WIDTH / 2, SHEET_FOOTER_BASELINE, fonts.regular, 5.5, [0.219, 0.219, 0.218]);
}

/**
 * The spell point reference under a caster header: a title line with the pool
 * maximum, a two-row level/cost table (levels 6-9 starred), and the
 * once-per-long-rest footnote.
 */
function drawSpellPointReference(
  page: PDFPage,
  resource: Extract<SpellResourceDto, { mode: "spellPoints" }>,
  headerY: number,
  fonts: SheetFonts,
): void {
  const tableLeft = 46;
  const tableWidth = PAGE_WIDTH - tableLeft * 2;
  const labelWidth = 82;
  const valueWidth = (tableWidth - labelWidth) / resource.costs.length;
  const rowHeight = 10;
  const tableTop = headerY - 13;
  const tableBottom = tableTop - rowHeight * 2;
  const grey = (value: number): ReturnType<typeof rgb> => rgb(value / 255, value / 255, value / 255);

  page.drawRectangle({ x: tableLeft, y: tableBottom, width: tableWidth, height: rowHeight * 2, color: grey(248) });
  page.drawRectangle({ x: tableLeft, y: tableBottom, width: labelWidth, height: rowHeight * 2, color: grey(224) });
  page.drawRectangle({
    x: tableLeft, y: tableBottom, width: tableWidth, height: rowHeight * 2,
    borderColor: grey(96), borderWidth: 0.45,
  });
  page.drawLine({
    start: { x: tableLeft, y: tableTop - rowHeight },
    end: { x: tableLeft + tableWidth, y: tableTop - rowHeight },
    thickness: 0.45, color: grey(96),
  });
  for (let index = 0; index <= resource.costs.length; index++) {
    const x = tableLeft + labelWidth + index * valueWidth;
    page.drawLine({ start: { x, y: tableBottom }, end: { x, y: tableTop }, thickness: 0.45, color: grey(96) });
  }

  const title = `SPELL POINTS · ${resource.maximumPoints} MAX · RECOVER ON LONG REST${resource.shared ? " · SHARED POOL" : ""}`;
  drawCentered(page, title, tableLeft + tableWidth / 2, tableTop + 3.5, fonts.bold, 7.5);
  const labelCenter = tableLeft + labelWidth / 2;
  drawCentered(page, "SPELL LEVEL", labelCenter, tableTop - rowHeight + 2.5, fonts.bold, 6.5);
  drawCentered(page, "SPELL COST", labelCenter, tableBottom + 2.5, fonts.bold, 6.5);
  for (const [index, cost] of resource.costs.entries()) {
    const center = tableLeft + labelWidth + (index + 0.5) * valueWidth;
    drawCentered(page, cost.oncePerLongRest ? `${cost.spellLevel}*` : `${cost.spellLevel}`, center, tableTop - rowHeight + 2.5, fonts.regular, 7);
    drawCentered(page, `${cost.points}`, center, tableBottom + 2.5, fonts.regular, 7);
  }
  const starred = resource.costs.filter((cost) => cost.oncePerLongRest).map((cost) => cost.spellLevel);
  if (starred.length > 0) {
    const range = `${starred[0]}-${starred[starred.length - 1]}`;
    drawCentered(
      page, `* LEVELS ${range}: ONE SLOT OF EACH LEVEL PER LONG REST`,
      tableLeft + tableWidth / 2, tableBottom - 8, fonts.regular, 6.5,
    );
  }
}

/**
 * Where each spell column's cell ends: the next cell's prepared dot begins
 * there (scripts/build-sheet-templates.mjs draws the same edges).
 */
const SPELL_CELL_RIGHTS: readonly number[] = SPELL_LIST.cellRights;

// drawText emits advances without kerning; measuring a complete string with
// pdf-lib subtracts kerning and can place the marker on top of the name.
function spellTextWidth(text: string, font: PDFFont, size: number): number {
  return [...text].reduce((width, character) => width + font.widthOfTextAtSize(character, size), 0);
}

/** Keep even custom names/allowances inside their cell at the minimum size. */
function ellipsizeSpellText(text: string, font: PDFFont, size: number, width: number): string {
  // The tolerance absorbs rounding when `size` was scaled to fit `width` exactly.
  if (spellTextWidth(text, font, size) <= width + 0.01) return text;
  let used = spellTextWidth("\u2026", font, size);
  if (used > width) return "";
  let prefix = "";
  for (const character of text) {
    used += font.widthOfTextAtSize(character, size);
    if (used > width) break;
    prefix += character;
  }
  return `${prefix}\u2026`;
}

/**
 * A spell cell's name and free-cast marker. The name prints at 7pt with the
 * marker after it at 5.5pt when both fit the cell. Otherwise the name gives
 * up size, down to the readable floor, to make room; only when neither fits
 * there is the marker cut (keeping at least half the cell) and then the name,
 * each with an ellipsis. The spell's card carries the full name.
 */
function fitSpellCell(
  name: string,
  rawMarker: string,
  font: PDFFont,
  cellWidth: number,
): { name: string; size: number; marker: string; markerSize: number; markerGap: number } {
  const markerGap = 2.5;
  const markerSize = 5.5;
  // Clear of the cell's right border.
  const width = cellWidth - 1;
  const nameFull = spellTextWidth(name, font, 7);
  let marker = rawMarker;
  if (marker !== "") {
    const nameMin = nameFull * READABLE_MIN_FONT_SIZE / 7;
    if (width - markerGap - spellTextWidth(marker, font, markerSize) < nameMin) {
      marker = ellipsizeSpellText(marker, font, markerSize, Math.max(width - markerGap - nameMin, width / 2 - markerGap));
    }
  }
  const room = width - (marker === "" ? 0 : markerGap + spellTextWidth(marker, font, markerSize));
  const size = nameFull <= room ? 7 : Math.max(READABLE_MIN_FONT_SIZE, 7 * room / nameFull);
  return { name: ellipsizeSpellText(name, font, size, room), size, marker, markerSize, markerGap };
}

/** Clarify recognized free casts while retaining unrecognized authored allowances. */
function compactUsage(usage: string): string {
  // Also compacts the allowance closing a feat's origin label:
  // "[Fey Touched - 1/Long Rest]" reads "[Fey Touched - 1 free cast/LR]".
  return usage.replace(/(^|- )(\d+)\s*\/\s*(Long Rest|Short Rest|LR|SR)(\]?)$/i, (_, lead: string, count: string, rest: string, close: string) =>
    `${lead}${count} free ${count === "1" ? "cast" : "casts"}/${/^(Long Rest|LR)$/i.test(rest) ? "LR" : "SR"}${close}`);
}

async function addSpellListPage(
  output: PDFDocument,
  modelPage: SheetPage,
  bundle: CharacterSheetTemplateBundle,
  fonts: SheetFonts,
  fragments: FragmentCache,
  colours: SheetLabelColours,
): Promise<void> {
  const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const files = SHEET_TEMPLATE_CONTRACT.files;
  const header = await embedFragment(output, bundle.spellcastingHeader, fragments);
  const tops = await Promise.all(bundle.spellcastingSectionTops.map((bytes) => embedFragment(output, bytes, fragments)));
  const center = await embedFragment(output, bundle.spellcastingSectionCenter, fragments);
  const bottom = await embedFragment(output, bundle.spellcastingSectionBottom, fragments);
  let headerY = PAGE_HEIGHT - 10 - SPELL_HEADER.height;
  for (const caster of modelPage.spellcasting ?? []) {
    page.drawPage(header, { x: 0, y: headerY, width: PAGE_WIDTH, height: SPELL_HEADER.height });
    drawTemplateText(page, bundle.labels[files.spellcastingHeader], fonts, colours, 0, headerY);
    const stats = [caster.ability, caster.attackBonus, caster.saveDc, caster.prepareCount];
    drawCenteredInBox(
      page, caster.name, SPELL_HEADER.bannerCenter, headerY + SPELL_HEADER.bannerMiddle, fonts.regular, 10);
    stats.forEach((value, index) => {
      drawCenteredInBox(
        page, value, SPELL_HEADER.statCenters[index]!, headerY + SPELL_HEADER.statMiddle, fonts.regular, 10);
    });
    if (caster.resource.mode === "spellPoints") {
      drawSpellPointReference(page, caster.resource, headerY, fonts);
    }

    // The spell point reference block occupies the band between the header
    // and the first level section, so sections start 38pt lower with it.
    let sectionTop = headerY - (caster.resource.mode === "spellPoints" ? 48 : 10);
    const { topHeight, rowHeight, endHeight, columns, slotTextX, textBaseline } = SPELL_LIST;
    // A slot level prints even with no spells chosen: its circles still track
    // the slots, which a character can spend on a higher-level casting.
    const hasSlots = (section: SheetSpellListSection): boolean =>
      section.level > 0 && caster.resource.mode === "slots" && section.slots > 0;
    for (const spellSection of caster.sections.filter((section) => section.spells.length > 0 || hasSlots(section))) {
      // The level band holds the first two spells; every further three fill a row.
      const rows = Math.ceil(Math.max(0, spellSection.spells.length - 2) / 3);
      const topY = sectionTop - topHeight;
      for (let row = 1; row <= rows; row += 1) {
        page.drawPage(center, { x: 0, y: topY - row * rowHeight, width: PAGE_WIDTH, height: rowHeight });
        drawTemplateText(page, bundle.labels[files.spellcastingSectionCenter], fonts, colours, 0, topY - row * rowHeight);
      }
      page.drawPage(bottom, { x: 0, y: topY - rows * rowHeight - endHeight, width: PAGE_WIDTH, height: endHeight });
      drawTemplateText(page, bundle.labels[files.spellcastingSectionBottom], fonts, colours, 0, topY - rows * rowHeight - endHeight);
      page.drawPage(tops[spellSection.level] ?? tops[0]!, { x: 0, y: topY, width: PAGE_WIDTH, height: topHeight });
      drawTemplateText(page, bundle.labels[SHEET_TEMPLATE_CONTRACT.spellcastingSectionTops[spellSection.level] ?? SHEET_TEMPLATE_CONTRACT.spellcastingSectionTops[0]!], fonts, colours, 0, topY);
      // A feature caster's level block has no slots to count (its spells are
      // cast free or from another caster's slots), so it prints no label. A
      // combined multiclass class whose shared slots print on another class's
      // bands says where, once.
      if (spellSection.sharedSlotsWith !== undefined && !hasSlots(spellSection)) {
        const note = ellipsizeSpellText(
          winAnsiText(`SHARED SLOTS: SEE ${spellSection.sharedSlotsWith.toUpperCase()}`),
          fonts.regular, 5.5, SPELL_LIST.labelCellRight - 4 - slotTextX,
        );
        page.drawText(note, { x: slotTextX, y: topY + textBaseline, size: 5.5, font: fonts.regular, color: rgb(1, 1, 1) });
      }
      if (hasSlots(spellSection)) {
        const slotLabel = `${spellSection.slots} SPELL ${spellSection.slots === 1 ? "SLOT" : "SLOTS"}`;
        page.drawText(slotLabel, {
          x: slotTextX,
          y: topY + textBaseline,
          size: 5.5,
          font: fonts.regular,
          color: rgb(1, 1, 1),
        });
        const labelWidth = fonts.regular.widthOfTextAtSize(slotLabel, 5.5);
        for (let slot = 0; slot < spellSection.slots; slot++) {
          page.drawCircle({ x: slotTextX + labelWidth + 9 + slot * 9, y: topY + textBaseline + 2,
            size: 2.7, borderColor: rgb(1, 1, 1), borderWidth: 0.7 });
        }
      }
      spellSection.spells.forEach((spell, index) => {
        const firstRow = index < 2;
        const column = firstRow ? index + 1 : (index - 2) % 3;
        const row = firstRow ? 0 : 1 + Math.floor((index - 2) / 3);
        const x = columns[column]!;
        const y = topY + textBaseline - row * rowHeight;
        const rawMarker = spell.usage === undefined || spell.usage === "" ? "" : winAnsiText(compactUsage(spell.usage));
        // A free cast's marker follows the name in the small slot-label size,
        // inside the cell so it never runs into the next cell's bubble.
        const cell = fitSpellCell(winAnsiText(spell.name), rawMarker, fonts.regular, SPELL_CELL_RIGHTS[column]! - x);
        page.drawText(cell.name, { x, y, size: cell.size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
        if (cell.marker !== "") {
          const markerX = x + spellTextWidth(cell.name, fonts.regular, cell.size) + cell.markerGap;
          page.drawText(cell.marker, { x: markerX, y, size: cell.markerSize, font: fonts.regular, color: rgb(0.18, 0.18, 0.18) });
        }
        if (spell.prepared || spell.alwaysPrepared) {
          // Fills the cell's template bubble (the same contract offsets draw it).
          page.drawCircle({
            x: x + SPELL_LIST.preparedMark.dx,
            y: y + SPELL_LIST.preparedMark.dy,
            size: SPELL_LIST.preparedMark.radius,
            color: rgb(0.18, 0.18, 0.18),
          });
        }
      });
      sectionTop -= topHeight + rows * rowHeight + endHeight;
    }
    headerY = sectionTop - 10 - SPELL_HEADER.height;
  }
}

/**
 * A template with more attack rows than the form values fill (the 2014 pages
 * have five) takes the next attacks from the details page's own list,
 * and its free-text note lists only the attacks that still have no row ahead
 * of the user's notes. A model without the list, or a template with the usual
 * rows, keeps the form values as they are.
 */
function fillExtraAttackRows(
  values: Record<string, string>,
  model: CharacterSheetModel,
  fields: ReadonlyMap<string, TemplateField>,
): void {
  let rows = 0;
  for (const name of fields.keys()) {
    const row = Number(name.match(/^details_attack(\d+)_weapon$/)?.[1] ?? 0);
    if (row > rows) rows = row;
  }
  const details = model.pages.find((page) => page.templateKind === "details");
  const attacks = details?.attacks;
  if (rows <= SHEET_BASE_ATTACK_ROWS || attacks === undefined) return;
  attacks.slice(SHEET_BASE_ATTACK_ROWS, rows).forEach((attack, index) => {
    const row = SHEET_BASE_ATTACK_ROWS + index + 1;
    values[`details_attack${row}_weapon`] = attack.name;
    values[`details_attack${row}_range`] = attack.range;
    values[`details_attack${row}_attack`] = attack.bonus;
    values[`details_attack${row}_damage`] = attack.damage;
    values[`details_attack${row}_description`] = attack.note;
  });
  values["details_attack_description"] = attackDescriptionNote(attacks.slice(rows), details?.attackNotes ?? "");
}

/**
 * Assemble every semantic page against its matching template. The result is
 * deliberately flattened/static so browser PDF viewers see the same text and
 * typography as downloaded files.
 */
export async function writeCharacterSheetPdfWithTemplateBundle(
  model: CharacterSheetModel,
  bundle: CharacterSheetTemplateBundle | null,
  options: CharacterSheetWriteOptions = {},
): Promise<ArrayBuffer> {
  if (!bundleIsComplete(bundle)) return writeCharacterSheetPdf(model);
  const footerText = options.footerText ?? DEFAULT_SHEET_FOOTER_TEXT;
  const colours = options.colours ?? DEFAULT_SHEET_COLOURS;
  const brandImage = options.brandImage ?? "";
  const labelInk = labelColours(colours);
  const files = SHEET_TEMPLATE_CONTRACT.files;
  const timed = phaseTimer(options.trace);
  const artwork: ArtworkCache = new Map();
  const fill = (
    phase: string, template: Uint8Array, pageValues: Readonly<Record<string, string>>,
    drawArtwork?: (page: PDFPage, embedded: PDFEmbeddedPage, width: number, height: number) => void,
  ) => timed(`fill:${phase}`, () => addFilledTemplatePage(output, template, pageValues, colours, fonts, artwork, drawArtwork));

  const output = await PDFDocument.create();
  const fonts = await timed("embedFonts", () => embedSheetFonts(output, bundle.faces));
  const values = { ...model.formValues };
  let detailsLabels = bundle.labels[bundle.detailsFile ?? files.details];
  const detailsArt = await artworkFor(bundle.details);
  if (options.emphasizeAbilityModifiers === true) {
    // Emphasis puts the modifier in the large slot. A template whose modifier
    // already has it (by its fields' own sizes) needs no swap.
    let swapped = false;
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      const score = `details_${ability}_score`;
      const modifier = `details_${ability}_modifier`;
      if ((detailsArt.fields.get(score)?.base ?? 0) <= (detailsArt.fields.get(modifier)?.base ?? 0)) continue;
      [values[score], values[modifier]] = [values[modifier] ?? "", values[score] ?? ""];
      swapped = true;
    }
    if (swapped && detailsLabels !== undefined) detailsLabels = {
      ...detailsLabels,
      labels: detailsLabels.labels.map((label) => ({ ...label, text: label.text === "SCORE" ? "MODIFIER" : label.text === "MODIFIER" ? "SCORE" : label.text })),
    };
  }
  fillExtraAttackRows(values, model, detailsArt.fields);
  const attackNotes: AttackNoteCard[] = [];
  for (const [name, field] of detailsArt.fields) {
    if (!/^details_attack(?:\d+)?_description$/.test(name) || !values[name]) continue;
    const value = values[name]!.split(/\r?\n/).map(winAnsiText).join("\n");
    const measure = (text: string, size: number): number => drawnWidth(fonts.regular, text, size);
    // Match the writer's single-line path before considering multiline overflow.
    if (!field.multiline && drawnNumberSize(value, field.rect, field.base, fonts.regular) > 0) continue;
    const size = fitMultilineFontSize(value, field.rect.width, field.rect.height, field.base, 0.25, measure, capHeightRatio(fonts.regular));
    if (size >= READABLE_MIN_FONT_SIZE && value.split(/\s+/).every((word) => measure(word, size) <= field.rect.width - 4)) continue;
    const row = name.match(/attack(\d+)_/)?.[1];
    const title = row ? `Attack ${row}: ${values[`details_attack${row}_weapon`] || "Notes"}` : "General attack notes";
    if (options.includeAttackNotes !== false) {
      attackNotes.push({ title, text: value });
    }
    values[name] = options.includeAttackNotes === false ? "Long note omitted" : "See attack notes";
  }
  const images = model.images ?? {};
  const fragments: FragmentCache = new Map();
  await yieldToEventLoop(true);
  for (const modelPage of model.pages) {
    await yieldToEventLoop();
    if (modelPage.templateKind === "details") {
      const split = bundle.layout?.split ?? detailsArt.rects.has("details_subclass_features");
      const boxes = detailsTextBoxes(modelPage, detailsArt.rects, { split });
      // On the 2024 pages Species Traits and the features share one column;
      // the boundary between them moves to suit the text.
      const column = findTraitsColumn(detailsArt.rects);
      const shift = column === undefined ? 0 : timed("traitsColumn", () => planTraitsColumn(
        column, boxes.find((box) => box.field === SPECIES_FIELD), boxes.find((box) => box.field === FEATURES_FIELD), fonts));
      const { page, fieldRects: templateRects, overflow: boxOverflow } = await fill("details", bundle.details, {
        ...values,
        details_features: "",
        details_subclass_features: "",
        details_feats: "",
        details_proficiencies_languages: "",
      }, column === undefined || shift === 0 ? undefined : (target, embedded, width, height) =>
        drawTraitsColumnArtwork(target, embedded, width, height, column, shift));
      const fieldRects = column === undefined ? templateRects : shiftedTraitsRects(templateRects, column, shift);
      const pageLabels = column === undefined ? detailsLabels : shiftedTraitsLabels(detailsLabels, column, shift);
      drawTemplateText(page, pageLabels, fonts, labelInk);
      await timed("brandImage", () => drawBrandImage(output, page, fieldRects, brandImage, colours));
      drawSheetFooter(page, fonts, footerText);
      const overflow = timed("richText:details", () => drawDetailsRichText(page, boxes, fonts, fieldRects, {
        split,
        labels: pageLabels,
        ruleColour: labelInk.lines,
      }));
      // A page that carries feature text is titled for it; one carrying only
      // other boxes' values is the character page continued.
      addFeatureContinuationPages(output, [...overflow, ...fieldContinuations(boxOverflow, fieldRects, pageLabels)],
        fonts, labelInk, footerText, overflow.length > 0 ? "FEATURES & TRAITS (CONTINUED)" : "CHARACTER (CONTINUED)");
      addAttackNotePages(output, attackNotes, fonts, labelInk, footerText);
      continue;
    }
    if (modelPage.templateKind === "background") {
      const { page, fieldRects, overflow } = await fill("background", bundle.background, values);
      drawTemplateText(page, bundle.labels[files.background], fonts, labelInk);
      await timed("brandImage", () => drawBrandImage(output, page, fieldRects, brandImage, colours));
      await timed("portrait", () => drawFieldImage(output, page, fieldRects, "background_portrait_image", images["background_portrait_image"] ?? ""));
      drawSheetFooter(page, fonts, footerText);
      addFeatureContinuationPages(output, fieldContinuations(overflow, fieldRects, bundle.labels[files.background]),
        fonts, labelInk, footerText, "BACKGROUND (CONTINUED)");
      continue;
    }
    if (modelPage.templateKind === "companion") {
      const { page, fieldRects, overflow } = await fill("companion", bundle.companion, {
        ...values,
        companion_features: "",
      });
      const companionLabels = bundle.labels[files.companion];
      drawTemplateText(page, companionLabels, fonts, labelInk);
      await timed("brandImage", () => drawBrandImage(output, page, fieldRects, brandImage, colours));
      await timed("portrait", () => drawFieldImage(output, page, fieldRects, "companion_portrait_image", images["companion_portrait_image"] ?? ""));
      const rest = timed("richText:companion", () => drawCompanionRichText(page, modelPage, fonts, fieldRects, companionLabels));
      drawSheetFooter(page, fonts, footerText);
      addFeatureContinuationPages(output, [...rest, ...fieldContinuations(overflow, fieldRects, companionLabels)],
        fonts, labelInk, footerText, "COMPANION (CONTINUED)");
      continue;
    }
    if (modelPage.templateKind === "equipment") {
      const sidebarRuns = equipmentSidebarRuns(modelPage);
      const lastPage = sidebarRuns.reduce((highest, run) => Math.max(highest, run.page ?? 0), 0);
      await yieldToEventLoop();
      const { page, fieldRects, overflow } = await fill("equipment", bundle.equipment, {
        ...values,
        equipment_page_magic_items: "",
      });
      const equipmentLabels = bundle.labels[files.equipment];
      drawTemplateText(page, equipmentLabels, fonts, labelInk);
      timed("richText:equipment", () => drawEquipmentRichText(page, modelPage, fonts, 0));
      drawSheetFooter(page, fonts, footerText);
      // The notes column's overflow is laid out at the continuation page's own
      // width (card-layout.ts), on plain pages rather than further copies of
      // the inventory page.
      for (let equipmentPage = 1; equipmentPage <= lastPage; equipmentPage += 1) {
        await yieldToEventLoop();
        const continuation = addContinuationPage(output, "EQUIPMENT (CONTINUED)", fonts, labelInk, footerText);
        if (equipmentPage === 1) {
          const notes = boxTitle(equipmentLabels, fieldRects.get("equipment_page_magic_items"), "Notes");
          const part = [headingParagraph(`${notes} (continued)`, "part")];
          drawFeatureFlow(continuation, part, featureFlowLines(part, CONTINUATION_TEXT_WIDTH, DEFAULT_FEATURE_FONT_SIZE, fontMeasure(fonts)),
            fonts, CONTINUATION_TEXT_X, CONTINUATION_TEXT_TOP, CONTINUATION_TEXT_WIDTH, CONTINUATION_TEXT_BOTTOM,
            DEFAULT_FEATURE_FONT_SIZE, DEFAULT_FEATURE_FONT_SIZE, labelInk.lines);
        }
        timed("richText:equipment", () => drawEquipmentRichText(continuation, modelPage, fonts, equipmentPage));
      }
      addFeatureContinuationPages(output, fieldContinuations(overflow, fieldRects, equipmentLabels),
        fonts, labelInk, footerText, "EQUIPMENT (CONTINUED)");
      continue;
    }
    if (modelPage.templateKind === "spell-list") {
      await timed("spell-list", () => addSpellListPage(output, modelPage, bundle, fonts, fragments, labelInk));
      continue;
    }
    if (modelPage.templateKind === "spell-cards" || modelPage.templateKind === "item-cards") {
      const positionedRuns = modelPage.sections.flatMap((section) => section.positionedRuns ?? []);
      const lastPage = positionedRuns.reduce((highest, run) => Math.max(highest, run.page ?? 0), 0);
      for (let cardPage = 0; cardPage <= lastPage; cardPage += 1) {
        await yieldToEventLoop();
        // The slots the layout filled on this page (a continuation takes a
        // slot of its own, so the count is not the page's section count), and
        // which of them continue a card.
        const pageRuns = positionedRuns.filter((run) => (run.page ?? 0) === cardPage);
        const slots: boolean[] = Array.from({ length: Math.max(1, ...pageRuns.map((run) => (run.card ?? 0) + 1)) }, () => false);
        for (const run of pageRuns) if (run.continued === true) slots[run.card ?? 0] = true;
        const genericFrame = { template: bundle.genericCard, labels: bundle.labels[files.genericCard] };
        const page = await timed("cards:page", () => addCardPage(
          output,
          modelPage.templateKind === "spell-cards"
            ? { template: bundle.spellCard, labels: bundle.labels[files.spellCard] }
            : genericFrame,
          genericFrame,
          fragments,
          slots,
          fonts,
          labelInk,
        ));
        timed("cards:runs", () => drawPositionedRuns(page, pageRuns, fonts));
      }
      continue;
    }
    const fallback = await PDFDocument.load(writeCharacterSheetPdf({
      ...model,
      pageCount: 1,
      pages: [modelPage],
    }));
    const [page] = await output.copyPages(fallback, [0]);
    output.addPage(page!);
  }
  for (const page of output.getPages()) page.node.delete(PDFName.of("Annots"));
  const bytes = await timed(
    "save",
    () => output.save({ useObjectStreams: true, addDefaultPage: false }),
    { pages: output.getPageCount() },
  );
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
