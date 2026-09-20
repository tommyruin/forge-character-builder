import type { SpellResourceDto } from "@forge-cb/api";
import type { CharacterSheetModel, SheetPage, SheetRow, SheetSection } from "./model.js";
import type { LayoutRun } from "./card-layout.js";
import { measuredTextWidth, winAnsiText } from "./text.js";
import { decodeBase64 } from "../platform.js";
import {
  DEFAULT_SHEET_COLOURS,
  SHEET_FIXED_COLOURS,
  SHEET_PALETTE,
  SHEET_TEMPLATE_CONTRACT,
  type SheetColours,
  type SheetTemplateLabels,
} from "./template-contract.js";
import {
  PDFCheckBox,
  PDFDocument,
  type PDFEmbeddedPage,
  type PDFForm,
  PDFName,
  type PDFRef,
  TextAlignment,
  PDFTextField,
  StandardFonts,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
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
  /** The set's titles, captions and ribbons, keyed by template file. */
  labels: SheetTemplateLabels;
  /** The typefaces to draw them and the values in. */
  faces: SheetFaces;
}

export interface CharacterSheetWriteOptions {
  /** Show ability modifiers in the larger character ability boxes. */
  emphasizeAbilityModifiers?: boolean;
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
  return {
    regular: await embedFace(document, faces.body.regular, "FCB-Body"),
    bold: await embedFace(document, faces.body.bold, "FCB-Body-Bold"),
    italic: await embedFace(document, faces.body.italic, "FCB-Body-Italic"),
    boldItalic: await embedFace(document, faces.body.boldItalic, "FCB-Body-BoldItalic"),
    titles: await embedFace(document, faces.titles, "FCB-Titles"),
    captions: await embedFace(document, faces.captions, "FCB-Captions"),
    numbers: await embedFace(document, faces.numbers, "FCB-Numbers"),
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
    const width = font.widthOfTextAtSize(value, label.size);
    const box = label.width ?? 0;
    const x = label.align === "center" ? label.x + (box - width) / 2 : label.align === "right" ? label.x + box - width : label.x;
    const color = colours[label.color];
    page.drawText(value, { x: x + dx, y: label.y + dy, size: label.size, font, color: rgb(color[0], color[1], color[2]) });
  }
  for (const ribbon of text.ribbons) {
    const value = winAnsiText(ribbon.text);
    const width = fonts.titles.widthOfTextAtSize(value, ribbon.size) + ribbon.pad * 2;
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
    /^(details|companion)_(armor_class|hp_current|hp_max|hp_temp|initiative|proficiency_bonus|passive_perception_total|inspiration|hd|speed_walking|xp)$/.test(name);
}

function bundleIsComplete(bundle: CharacterSheetTemplateBundle | null): bundle is CharacterSheetTemplateBundle {
  return bundle !== null &&
    bundle.spellcastingSectionTops.length === 10 &&
    typeof bundle.labels === "object" && bundle.labels !== null &&
    typeof bundle.faces === "object" && bundle.faces !== null &&
    Object.entries(bundle).every(([key, value]) =>
      key === "labels" || key === "faces" ||
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
  return font.widthOfTextAtSize(value, size) <= rect.width - 4 ? size : 0;
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
 * Largest size (from `base` down to a 4.5pt floor in 0.25 steps) at which the
 * value's wrapped lines fit the widget rectangle. Long multiline content
 * (backstories, notes) shrinks to fit instead of clipping at the widget edge
 * with no visual indication.
 */
/**
 * A single-line value shrinks, down to a floor, so the whole value stays
 * inside its widget instead of being clipped at the right edge.
 */
export function fitSingleLineFontSize(value: string, width: number, base: number, font: PDFFont): number {
  const available = Math.max(1, width - 4);
  const needed = font.widthOfTextAtSize(value, base);
  if (needed <= available) return base;
  return Math.max(SINGLE_LINE_MIN_FONT_SIZE, Math.floor((base * available) / needed * 10) / 10);
}
const SINGLE_LINE_MIN_FONT_SIZE = 4.5;

export function fitMultilineFontSize(
  value: string,
  width: number,
  height: number,
  base: number,
  floor = 4.5,
  measure: (text: string, fontSize: number) => number = measuredTextWidth,
): number {
  if (value === "" || width <= 0 || height <= 0) return base;
  const usable = width - 4;
  const paragraphs = value.split(/\r?\n/).map((line) => line.split(/[ \t]+/).filter((word) => word !== ""));
  // Glyph advance widths scale linearly with size, so each word is measured
  // once at size 1 and reused across candidate sizes.
  const unitWidths = new Map<string, number>();
  const unitWidth = (word: string): number => {
    let cached = unitWidths.get(word);
    if (cached === undefined) {
      cached = measure(word, 1);
      unitWidths.set(word, cached);
    }
    return cached;
  };
  const spaceUnit = measure(" ", 1);
  const fits = (size: number): boolean => {
    let lines = 0;
    for (const words of paragraphs) {
      lines += 1;
      let lineWidth = 0;
      for (const word of words) {
        const wordWidth = unitWidth(word) * size;
        if (lineWidth !== 0 && lineWidth + spaceUnit * size + wordWidth > usable) {
          lines += 1;
          lineWidth = wordWidth;
        } else {
          lineWidth += (lineWidth === 0 ? 0 : spaceUnit * size) + wordWidth;
        }
      }
    }
    return lines * size * 1.2 <= height - 4;
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

interface FilledTemplatePage {
  page: PDFPage;
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
): Promise<FilledTemplatePage> {
  const art = await artworkFor(template);
  const embedded = await embedArtwork(output, template, art, artwork);
  const page = output.addPage([art.width, art.height]);
  page.drawPage(embedded, { x: 0, y: 0, width: art.width, height: art.height });
  const textColour = SHEET_PALETTE[colours.text].rgb;
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
    const font = isNumbersField(name) ? outputFonts.numbers : outputFonts.regular;
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
    }
    drawBoxedValue(page, field.rect, value, font, field.base, textColour);
  }
  return { page, fieldRects: art.rects };
}

/**
 * Draws a value that will not sit on one line in its box: wrapped, shrunk to
 * fit, and clipped to the widget rectangle the way the form's own appearance
 * clipped it. Only a prose box reaches this — every other value is one line.
 */
function drawBoxedValue(
  page: PDFPage,
  rect: FieldRect,
  value: string,
  font: PDFFont,
  base: number,
  colour: PdfColor,
): void {
  const size = fitMultilineFontSize(value, rect.width, rect.height, base, undefined, (text, fontSize) =>
    font.widthOfTextAtSize(winAnsiText(text), fontSize));
  const usable = rect.width - 4;
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/[ \t]+/).filter((part) => part !== "")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && font.widthOfTextAtSize(candidate, size) > usable) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
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
  let y = rect.y + rect.height - 2 - size;
  for (const line of lines) {
    if (line !== "") {
      page.drawText(line, { x: rect.x + 2, y, size, font, color: rgb(colour[0], colour[1], colour[2]) });
    }
    y -= size * 1.2;
  }
  page.pushOperators(popGraphicsState());
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
  const width = font.widthOfTextAtSize(item.value, item.size);
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

function runFont(fonts: SheetFonts, style: LayoutRun["style"]): PDFFont {
  if (style === "bold") return fonts.bold;
  if (style === "italic") return fonts.italic;
  if (style === "bold-italic") return fonts.boldItalic;
  return fonts.regular;
}

/** Measures text the way it will be drawn: in the chosen body face, per style. */
export type TextMeasure = (text: string, fontSize: number, style?: LayoutRun["style"]) => number;

function fontMeasure(fonts: SheetFonts): TextMeasure {
  return (text, fontSize, style) => runFont(fonts, style).widthOfTextAtSize(winAnsiText(text), fontSize);
}

function drawPositionedRuns(page: PDFPage, runs: readonly LayoutRun[], fonts: SheetFonts): void {
  const measure = fontMeasure(fonts);
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
 * feature, or the end of a whole feature. */
type FeatureFlowGap = "paragraph" | "feature" | null;

interface FeatureFlowLine {
  words: readonly StyledWord[];
  indent: number;
  gapAfter: FeatureFlowGap;
}

interface FeatureContinuation {
  lines: readonly FeatureFlowLine[];
  x: number;
  top: number;
  width: number;
  bottom: number;
  fontSize: number;
  lineHeight: number;
}

const DEFAULT_FEATURE_FONT_SIZE = 8;
// Preserve readable print: modest fitting is allowed, then prose continues
// on another page at the normal size instead of falling below 6pt.
const MIN_FEATURE_FONT_SIZE = 6;
const FEATURE_PARAGRAPH_GAP = 1.2;
// One feature is set off from the next by rather more than the breath between
// its own paragraphs, so the eye finds the boundaries. It is a fraction of the
// type size so it shrinks along with the adaptive fit rather than eating the
// space that fit just bought.
const FEATURE_GAP_RATIO = 0.45;

function featureGapFor(gap: FeatureFlowGap, fontSize: number): number {
  if (gap === "feature") return fontSize * FEATURE_GAP_RATIO;
  if (gap === "paragraph") return FEATURE_PARAGRAPH_GAP;
  return 0;
}

function featureFlowLines(
  section: SheetSection,
  width: number,
  fontSize: number,
  measure: TextMeasure,
  featureGap = true,
): FeatureFlowLine[] {
  const output: FeatureFlowLine[] = [];
  const rows = (section.renderRows ?? section.rows)
    .flatMap((row) => row.kind === "tokens" ? [row.tokens.join(" ")] : [...row.lines]);
  for (const row of rows) {
    const paragraphs = featureWords(row);
    for (const [paragraphIndex, words] of paragraphs.entries()) {
      const indent = paragraphIndex > 0 ? 8 : 0;
      // One row is one feature (model.ts collectFeatures), so its last
      // paragraph is where a feature ends.
      const endsFeature = featureGap && paragraphIndex === paragraphs.length - 1;
      const availableWidth = width - indent;
      const spaceWidth = measure(" ", fontSize);
      let line: StyledWord[] = [];
      let lineWidth = 0;
      const wrapped: FeatureFlowLine[] = [];
      for (const word of words) {
        const wordWidth = measure(word.text, fontSize, word.style ?? "regular");
        const candidateWidth = line.length === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
        if (line.length > 0 && candidateWidth > availableWidth) {
          wrapped.push({ words: line, indent, gapAfter: null });
          line = [];
          lineWidth = 0;
        }
        line.push(word);
        lineWidth = line.length === 1 ? wordWidth : lineWidth + spaceWidth + wordWidth;
      }
      if (line.length > 0) wrapped.push({ words: line, indent, gapAfter: null });
      if (wrapped.length > 0) wrapped[wrapped.length - 1]!.gapAfter = endsFeature ? "feature" : "paragraph";
      output.push(...wrapped);
    }
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

function drawFeatureFlow(
  page: PDFPage,
  lines: readonly FeatureFlowLine[],
  fonts: SheetFonts,
  x: number,
  top: number,
  width: number,
  bottom: number,
  fontSize: number,
  lineHeight: number,
): FeatureContinuation | undefined {
  let y = top;
  let lineIndex = 0;
  // The space between words is the body face's at this size whatever face the
  // word itself is in, so it is measured once rather than per word.
  const spaceWidth = fonts.regular.widthOfTextAtSize(" ", fontSize);
  const ink = rgb(0.05, 0.05, 0.05);
  for (; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (y < bottom) break;
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
      cursor += font.widthOfTextAtSize(value, fontSize) + spaceWidth;
    }
    flush();
    y -= lineHeight + featureGapFor(line.gapAfter, fontSize);
  }
  if (lineIndex >= lines.length) return undefined;
  return { lines: lines.slice(lineIndex), x, top, width, bottom, fontSize, lineHeight };
}

function drawRichFeatureSection(
  page: PDFPage,
  section: SheetSection | undefined,
  fonts: SheetFonts,
  x: number,
  top: number,
  width: number,
  bottom: number,
  fontSize = DEFAULT_FEATURE_FONT_SIZE,
  lineHeight = fontSize,
  options: { featureGap?: boolean } = {},
): FeatureContinuation | undefined {
  if (section === undefined) return undefined;
  // A list box — proficiencies and languages — is one run of like items, not a
  // sequence of features, so it keeps the plain paragraph rhythm.
  const featureGap = options.featureGap ?? true;
  const lineHeightAt = (size: number): number => lineHeight * size / fontSize;
  const measure = fontMeasure(fonts);
  const normalLines = featureFlowLines(section, width, fontSize, measure, featureGap);
  let chosenFontSize = fontSize;
  let chosenLines = normalLines;
  let chosenLineHeight = lineHeightAt(chosenFontSize);
  if (!featureFlowFits(normalLines, top, bottom, chosenLineHeight, chosenFontSize)) {
    const floorLines = featureFlowLines(section, width, MIN_FEATURE_FONT_SIZE, measure, featureGap);
    const floorLineHeight = lineHeightAt(MIN_FEATURE_FONT_SIZE);
    if (featureFlowFits(floorLines, top, bottom, floorLineHeight, MIN_FEATURE_FONT_SIZE)) {
      // Take the largest size that still fits, so the text shrinks only as far
      // as the page demands.
      let low = MIN_FEATURE_FONT_SIZE;
      let high = fontSize;
      for (let pass = 0; pass < 10; pass += 1) {
        const candidate = (low + high) / 2;
        const candidateLines = featureFlowLines(section, width, candidate, measure, featureGap);
        if (featureFlowFits(candidateLines, top, bottom, lineHeightAt(candidate), candidate)) low = candidate;
        else high = candidate;
      }
      chosenFontSize = low;
      chosenLines = featureFlowLines(section, width, chosenFontSize, measure, featureGap);
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
  return drawFeatureFlow(page, chosenLines, fonts, x, top, width, bottom, chosenFontSize, chosenLineHeight);
}

interface RichTextBox {
  x: number;
  top: number;
  width: number;
  bottom: number;
}

/**
 * The drawable box for a hand-drawn rich-text section: the template field's
 * widget rectangle inset 3pt horizontally, with the first baseline one line
 * below the top edge and the last baseline held 1pt above the bottom edge.
 * Falls back to the given box when the template lacks the field.
 */
function richTextBox(
  fieldRects: ReadonlyMap<string, FieldRect>,
  fieldName: string,
  lineHeight: number,
  fallback: RichTextBox,
): RichTextBox {
  const rect = fieldRects.get(fieldName);
  if (rect === undefined) return fallback;
  return {
    x: rect.x + 3,
    top: rect.y + rect.height - lineHeight,
    width: rect.width - 6,
    bottom: rect.y + 1,
  };
}

function drawDetailsRichText(
  page: PDFPage,
  modelPage: SheetPage,
  fonts: SheetFonts,
  fieldRects: ReadonlyMap<string, FieldRect>,
): FeatureContinuation[] {
  const find = (title: string): SheetSection | undefined =>
    modelPage.sections.find((section) => section.title === title);
  const continuations: FeatureContinuation[] = [];
  const racialBox = richTextBox(fieldRects, "details_additional_notes", DEFAULT_FEATURE_FONT_SIZE,
    { x: 222, top: 372, width: 169, bottom: 125 });
  const racialContinuation = drawRichFeatureSection(
    page, find("racial-traits"), fonts, racialBox.x, racialBox.top, racialBox.width, racialBox.bottom);
  if (racialContinuation !== undefined) continuations.push(racialContinuation);
  const featureBox = richTextBox(fieldRects, "details_features", DEFAULT_FEATURE_FONT_SIZE,
    { x: 409, top: 653, width: 169, bottom: 132 });
  const featureContinuation = drawRichFeatureSection(
    page, find("features"), fonts, featureBox.x, featureBox.top, featureBox.width, featureBox.bottom);
  if (featureContinuation !== undefined) continuations.push(featureContinuation);

  const proficiencyRows = [
    ...(find("proficiencies")?.rows ?? []),
    ...(find("languages")?.rows ?? []),
  ];
  const proficiencyBox = richTextBox(fieldRects, "details_proficiencies_languages", 9.2,
    { x: 409, top: 119, width: 169, bottom: 33 });
  const proficiencyContinuation = drawRichFeatureSection(
    page,
    { title: "proficiencies-languages", rows: proficiencyRows },
    fonts,
    proficiencyBox.x,
    proficiencyBox.top,
    proficiencyBox.width,
    proficiencyBox.bottom,
    7.4,
    9.2,
    { featureGap: false },
  );
  if (proficiencyContinuation !== undefined) continuations.push(proficiencyContinuation);
  return continuations;
}

/**
 * The companion page's flowed text. The template sizes its own
 * `companion_features` box, so the geometry comes from that field's widget
 * rectangle rather than pinned coordinates.
 */
function drawCompanionRichText(
  page: PDFPage,
  modelPage: SheetPage,
  fonts: SheetFonts,
  fieldRects: ReadonlyMap<string, FieldRect>,
): void {
  const section = modelPage.sections.find((candidate) => candidate.title === "companion-features");
  if (section === undefined || section.rows.length === 0) return;
  const box = richTextBox(fieldRects, "companion_features", DEFAULT_FEATURE_FONT_SIZE, {
    x: 36,
    top: 360,
    width: 250,
    bottom: 40,
  });
  drawRichFeatureSection(page, section, fonts, box.x, box.top, box.width, box.bottom);
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

async function addCardPage(
  output: PDFDocument,
  template: Uint8Array,
  text: SheetTemplateLabels[string] | undefined,
  fragments: FragmentCache,
  count: number,
  fonts: SheetFonts,
  colours: SheetLabelColours,
): Promise<PDFPage> {
  const card = await embedFragment(output, template, fragments);
  const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const grid = SHEET_TEMPLATE_CONTRACT.cards;
  for (let index = 0; index < count; index += 1) {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const top = grid.rowTops[row];
    if (top === undefined) break;
    const x = grid.originX + column * (grid.width + grid.gutter);
    const y = top - grid.height;
    page.drawPage(card, { x, y, width: grid.width, height: grid.height });
    drawTemplateText(page, text, fonts, colours, x, y);
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
    x: center - font.widthOfTextAtSize(value, size) / 2,
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
  if (spellTextWidth(text, font, size) <= width) return text;
  let used = spellTextWidth("...", font, size);
  if (used > width) return "";
  let prefix = "";
  for (const character of text) {
    used += font.widthOfTextAtSize(character, size);
    if (used > width) break;
    prefix += character;
  }
  return `${prefix}...`;
}

/** Clarify recognized free casts while retaining unrecognized authored allowances. */
function compactUsage(usage: string): string {
  return usage.replace(/^(\d+)\s*\/\s*(Long Rest|Short Rest|LR|SR)$/i, (_, count: string, rest: string) =>
    `${count} free ${count === "1" ? "cast" : "casts"}/${/^(Long Rest|LR)$/i.test(rest) ? "LR" : "SR"}`);
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
    for (const spellSection of caster.sections.filter((section) => section.spells.length > 0)) {
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
      // cast free or from another caster's slots), so it prints no label.
      if (spellSection.level > 0 && caster.resource.mode === "slots" && spellSection.slots > 0) {
        page.drawText(`${spellSection.slots} SPELL SLOTS`, {
          x: slotTextX,
          y: topY + textBaseline,
          size: 5.5,
          font: fonts.regular,
          color: rgb(1, 1, 1),
        });
        const labelWidth = fonts.regular.widthOfTextAtSize(`${spellSection.slots} SPELL SLOTS`, 5.5);
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
        const name = winAnsiText(spell.name);
        const rawMarker = spell.usage === undefined || spell.usage === "" ? "" : winAnsiText(compactUsage(spell.usage));
        const marker = ellipsizeSpellText(rawMarker, fonts.regular, 5.5, (SPELL_CELL_RIGHTS[column]! - x) / 2);
        // A free cast's marker follows the name in the small slot-label size; a
        // name too long to leave it room inside the cell gives up size rather
        // than run the marker into the next cell's prepared dot.
        const markerGap = 2.5;
        const markerWidth = marker === "" ? 0 : markerGap + spellTextWidth(marker, fonts.regular, 5.5);
        const room = SPELL_CELL_RIGHTS[column]! - x - markerWidth;
        const fullWidth = spellTextWidth(name, fonts.regular, 7);
        const size = fullWidth <= room ? 7 : Math.max(5, 7 * room / fullWidth);
        const fittedName = ellipsizeSpellText(name, fonts.regular, size, room);
        page.drawText(fittedName, { x, y, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
        if (marker !== "") {
          const markerX = x + spellTextWidth(fittedName, fonts.regular, size) + markerGap;
          page.drawText(marker, { x: markerX, y, size: 5.5, font: fonts.regular, color: rgb(0.18, 0.18, 0.18) });
        }
        if (spell.prepared || spell.alwaysPrepared) {
          page.drawText("•", { x: x - 13, y: y - 0.2, size: 5, font: fonts.regular, color: rgb(0.18, 0.18, 0.18) });
        }
      });
      sectionTop -= topHeight + rows * rowHeight + endHeight;
    }
    headerY = sectionTop - 10 - SPELL_HEADER.height;
  }
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
  const fill = (phase: string, template: Uint8Array, pageValues: Readonly<Record<string, string>>) =>
    timed(`fill:${phase}`, () => addFilledTemplatePage(output, template, pageValues, colours, fonts, artwork));

  const output = await PDFDocument.create();
  const fonts = await timed("embedFonts", () => embedSheetFonts(output, bundle.faces));
  const values = { ...model.formValues };
  let detailsLabels = bundle.labels[files.details];
  if (options.emphasizeAbilityModifiers === true) {
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      const score = `details_${ability}_score`;
      const modifier = `details_${ability}_modifier`;
      [values[score], values[modifier]] = [values[modifier] ?? "", values[score] ?? ""];
    }
    if (detailsLabels !== undefined) detailsLabels = {
      ...detailsLabels,
      labels: detailsLabels.labels.map((label) => ({ ...label, text: label.text === "SCORE" ? "MODIFIER" : label.text === "MODIFIER" ? "SCORE" : label.text })),
    };
  }
  const attackNoteRows: SheetRow[] = [];
  const attackNotes: SheetSection = { title: "Attack notes", rows: attackNoteRows };
  const detailsArt = await artworkFor(bundle.details);
  for (const [name, field] of detailsArt.fields) {
    if (!/^details_attack(?:[1-4])?_description$/.test(name) || !values[name]) continue;
    const value = values[name]!.split(/\r?\n/).map(winAnsiText).join("\n");
    const measure = (text: string, size: number): number => fonts.regular.widthOfTextAtSize(text, size);
    const size = fitMultilineFontSize(value, field.rect.width, field.rect.height, field.base, 0.25, measure);
    if (size >= 4.5 && value.split(/\s+/).every((word) => measure(word, size) <= field.rect.width - 4)) continue;
    const row = name.match(/attack([1-4])_/)?.[1];
    const title = row ? `Attack ${row}: ${values[`details_attack${row}_weapon`] || "Notes"}` : "General attack notes";
    attackNoteRows.push({ kind: "tokens", tokens: [title + ".", ...value.split(/\s+/)] });
    values[name] = "See attack notes";
  }
  const images = model.images ?? {};
  const fragments: FragmentCache = new Map();
  await yieldToEventLoop(true);
  for (const modelPage of model.pages) {
    await yieldToEventLoop();
    if (modelPage.templateKind === "details") {
      const { page, fieldRects } = await fill("details", bundle.details, {
        ...values,
        details_features: "",
        details_proficiencies_languages: "",
      });
      drawTemplateText(page, detailsLabels, fonts, labelInk);
      await timed("brandImage", () => drawBrandImage(output, page, fieldRects, brandImage, colours));
      drawSheetFooter(page, fonts, footerText);
      const continuations = timed("richText:details", () => drawDetailsRichText(page, modelPage, fonts, fieldRects));
      for (let index = 0; index < continuations.length; index += 1) {
        const continuation = continuations[index]!;
        const { page: continuationPage, fieldRects: continuationRects } = await fill("details-continuation", bundle.details, {
          ...values,
          details_features: "",
          details_proficiencies_languages: "",
        });
        drawTemplateText(continuationPage, detailsLabels, fonts, labelInk);
        await timed("brandImage", () => drawBrandImage(output, continuationPage, continuationRects, brandImage, colours));
        drawSheetFooter(continuationPage, fonts, footerText);
        const next = timed("richText:details", () => drawFeatureFlow(
          continuationPage,
          continuation.lines,
          fonts,
          continuation.x,
          continuation.top,
          continuation.width,
          continuation.bottom,
          continuation.fontSize,
          continuation.lineHeight,
        ));
        if (next !== undefined) continuations.push(next);
      }
      if (attackNotes.rows.length > 0) {
        let remaining: readonly FeatureFlowLine[] = featureFlowLines(attackNotes, 520, 8, fontMeasure(fonts), true);
        do {
          const notesPage = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          notesPage.drawText("ATTACK NOTES", { x: 40, y: PAGE_HEIGHT - 40, size: 12, font: fonts.titles });
          const next = drawFeatureFlow(notesPage, remaining, fonts, 40, PAGE_HEIGHT - 65, 520, 50, 8, 10);
          drawSheetFooter(notesPage, fonts, footerText);
          remaining = next?.lines ?? [];
        } while (remaining.length > 0);
      }
      continue;
    }
    if (modelPage.templateKind === "background") {
      const { page, fieldRects } = await fill("background", bundle.background, values);
      drawTemplateText(page, bundle.labels[files.background], fonts, labelInk);
      await timed("brandImage", () => drawBrandImage(output, page, fieldRects, brandImage, colours));
      await timed("portrait", () => drawFieldImage(output, page, fieldRects, "background_portrait_image", images["background_portrait_image"] ?? ""));
      drawSheetFooter(page, fonts, footerText);
      continue;
    }
    if (modelPage.templateKind === "companion") {
      const { page, fieldRects } = await fill("companion", bundle.companion, {
        ...values,
        companion_features: "",
      });
      drawTemplateText(page, bundle.labels[files.companion], fonts, labelInk);
      await timed("brandImage", () => drawBrandImage(output, page, fieldRects, brandImage, colours));
      await timed("portrait", () => drawFieldImage(output, page, fieldRects, "companion_portrait_image", images["companion_portrait_image"] ?? ""));
      timed("richText:companion", () => drawCompanionRichText(page, modelPage, fonts, fieldRects));
      drawSheetFooter(page, fonts, footerText);
      continue;
    }
    if (modelPage.templateKind === "equipment") {
      const sidebarRuns = equipmentSidebarRuns(modelPage);
      const lastPage = sidebarRuns.reduce((highest, run) => Math.max(highest, run.page ?? 0), 0);
      for (let equipmentPage = 0; equipmentPage <= lastPage; equipmentPage += 1) {
        await yieldToEventLoop();
        // A continuation carries only the overflowing notes column: repeating
        // the gear, treasure and quest tables would print the same inventory
        // twice.
        const { page } = await fill("equipment", bundle.equipment, {
          ...(equipmentPage === 0
            ? values
            : Object.fromEntries(Object.entries(values).map(([key, value]) =>
              [key, key.startsWith("equipment_page_") ? "" : value]))),
          equipment_page_magic_items: "",
        });
        drawTemplateText(page, bundle.labels[files.equipment], fonts, labelInk);
        timed("richText:equipment", () => drawEquipmentRichText(page, modelPage, fonts, equipmentPage));
        drawSheetFooter(page, fonts, footerText);
      }
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
        const page = await timed("cards:page", () => addCardPage(
          output,
          modelPage.templateKind === "spell-cards" ? bundle.spellCard : bundle.genericCard,
          bundle.labels[modelPage.templateKind === "spell-cards" ? files.spellCard : files.genericCard],
          fragments,
          cardPage === 0
            ? modelPage.sections.length
            : Math.max(1, ...positionedRuns
              .filter((run) => (run.page ?? 0) === cardPage)
              .map((run) => (run.card ?? 0) + 1)),
          fonts,
          labelInk,
        ));
        timed("cards:runs", () => drawPositionedRuns(
          page,
          positionedRuns.filter((run) => (run.page ?? 0) === cardPage),
          fonts,
        ));
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
