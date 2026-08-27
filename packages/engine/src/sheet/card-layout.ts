import { measuredTextWidth, type TextStyle } from "./text.js";
import { SHEET_TEMPLATE_CONTRACT } from "./template-contract.js";

export interface LayoutRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  card?: number;
  /** Zero-based PDF page within the containing card-page model page. */
  page?: number;
  role?: "title" | "subtitle" | "metadata" | "metadata-value" | "body" | "footer" | "table" | "sidebar";
  fontSize?: number;
  style?: "regular" | "bold" | "italic" | "bold-italic";
  align?: "left" | "center" | "right";
}

export interface DescriptionCard {
  kind: "spell" | "generic";
  title: string;
  subtitle: string;
  metadata: ReadonlyArray<readonly [label: string, value: string]>;
  body: string;
  footer: string;
  footerRight?: string;
}

export interface InventorySidebar {
  title: string;
  html: string;
}

export interface HtmlLayoutOptions {
  x: number;
  top: number;
  width: number;
  fontSize: number;
  role?: LayoutRun["role"];
  card?: number;
  firstLineIndent?: number;
  lineHeight?: number;
}

const CARD_CONTRACT = SHEET_TEMPLATE_CONTRACT.cards;
const PAGE_MARGIN = CARD_CONTRACT.originX;
const CARD_WIDTH = CARD_CONTRACT.width;
const CARD_GUTTER = CARD_CONTRACT.gutter;
const SPELL_BODY_WIDTH = 163.4;
/** The card art's footer bar is inset from both card edges by this much. */
const CARD_FOOTER_INSET = CARD_CONTRACT.footerInset;
const SHORT_SPELL_BODY_HEIGHT = 30;
const CARD_TOPS = CARD_CONTRACT.rowTops;
const LABEL_BOXES = [
  { top: 736, bottom: 722 },
  { top: 726, bottom: 712 },
  { top: 716, bottom: 702 },
  { top: 702, bottom: 688 },
] as const;

type InlineStyle = TextStyle;

function measuredWidth(text: string, fontSize: number, style: InlineStyle = "regular"): number {
  return measuredTextWidth(text, fontSize, style);
}


const htmlEntities: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
};

function decodeHtml(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return htmlEntities[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function cardPlainHtml(html: string): string {
  const text = decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return `<p>${text}</p>`;
}

interface InlineWord { text: string; style: InlineStyle }
interface HtmlBlock { words: InlineWord[]; list: boolean }

function htmlBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  let words: InlineWord[] = [];
  let bold = 0;
  let italic = 0;
  let list = false;
  const flush = (): void => {
    if (words.length > 0) blocks.push({ words, list });
    words = [];
  };
  for (const part of html.split(/(<[^>]+>)/g)) {
    if (part === "") continue;
    if (part.startsWith("<")) {
      const closing = /^<\s*\//.test(part);
      const name = /^<\s*\/?\s*([\w]+)/.exec(part)?.[1]?.toLowerCase() ?? "";
      if (name === "strong" || name === "b") bold += closing ? -1 : 1;
      if (name === "em" || name === "i") italic += closing ? -1 : 1;
      if (name === "li" && !closing) { flush(); list = true; }
      if ((name === "li" && closing) || ((name === "p" || name === "div" || name === "br") && closing)) {
        flush();
        if (name === "li") list = false;
      }
      if (name === "br" && !closing) flush();
      continue;
    }
    const style: InlineStyle = bold > 0 ? (italic > 0 ? "bold-italic" : "bold") : italic > 0 ? "italic" : "regular";
    for (const word of decodeHtml(part).split(/\s+/).filter(Boolean)) words.push({ text: word, style });
  }
  flush();
  return blocks;
}

function styledWidth(word: InlineWord, fontSize: number): number {
  return measuredWidth(word.text, fontSize, word.style);
}

/** iText-style composite flow: inline chunks share baselines; later paragraphs
 * receive the four-space indentation inserted by FillCardDescription. */
export function layoutHtmlRuns(html: string, options: HtmlLayoutOptions): LayoutRun[] {
  const runs: LayoutRun[] = [];
  const space = measuredWidth(" ", options.fontSize);
  const indent = measuredWidth("    ", options.fontSize);
  const lineHeight = options.lineHeight ?? options.fontSize;
  let y = options.top;
  htmlBlocks(html).forEach((block, blockIndex) => {
    const contentIndent = block.list ? indent * 2 : blockIndex === 0 ? 0 : indent;
    const bulletX = options.x + (block.list ? indent : 0);
    const firstLineIndent = blockIndex === 0 ? options.firstLineIndent ?? 0 : 0;
    let x = options.x + contentIndent + firstLineIndent;
    if (block.list) runs.push({ text: "\u0007", x: bulletX, y, width: space, height: options.fontSize, role: options.role, card: options.card, fontSize: options.fontSize, style: "regular" });
    for (const word of block.words) {
      const wordWidth = styledWidth(word, options.fontSize);
      if (x > options.x + contentIndent + firstLineIndent && x + wordWidth > options.x + options.width) {
        const hyphen = /^(.+-)([^-]+)$/.exec(word.text);
        if (hyphen !== null) {
          const prefix = hyphen[1]!;
          const suffix = hyphen[2]!;
          const prefixWidth = measuredWidth(prefix, options.fontSize, word.style);
          if (x + prefixWidth <= options.x + options.width) {
            runs.push({ text: prefix, x, y, width: prefixWidth, height: options.fontSize, role: options.role, card: options.card, fontSize: options.fontSize, style: word.style });
            y -= lineHeight;
            const suffixWidth = measuredWidth(suffix, options.fontSize, word.style);
            runs.push({ text: suffix, x: options.x + contentIndent, y, width: suffixWidth, height: options.fontSize, role: options.role, card: options.card, fontSize: options.fontSize, style: word.style });
            x = options.x + contentIndent + suffixWidth + space;
            continue;
          }
        }
        y -= lineHeight;
        x = options.x + contentIndent;
      }
      runs.push({ text: word.text, x, y, width: wordWidth, height: options.fontSize, role: options.role, card: options.card, fontSize: options.fontSize, style: word.style });
      x += wordWidth + space;
    }
    y -= lineHeight;
  });
  return runs;
}

function wrap(text: string, width: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measuredWidth(candidate, fontSize) > width) {
      const hyphen = /^(.+-)([^-]+)$/.exec(word);
      if (hyphen !== null && measuredWidth(`${line} ${hyphen[1]}`, fontSize) <= width) {
        lines.push(`${line} ${hyphen[1]}`);
        line = hyphen[2]!;
        continue;
      }
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function wrapWithContinuation(text: string, firstWidth: number, continuationWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    const width = lines.length === 0 ? firstWidth : continuationWidth;
    if (line !== "" && measuredWidth(candidate, fontSize) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function clippedText(text: string, width: number, fontSize: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const candidate = [...kept, word].join(" ");
    if (kept.length > 0 && measuredWidth(candidate, fontSize) > width) break;
    kept.push(word);
  }
  return kept.join(" ");
}

function overlapsFixedLabel(run: LayoutRun): boolean {
  if (run.role === "metadata-value") return false;
  if ((run.card ?? 3) >= 3) return false;
  return LABEL_BOXES.some((box) => box.bottom <= run.y && run.y <= box.top);
}

const CARD_BODY_MIN_FONT_SIZE = 4.5;

function bodyLineGroups(runs: readonly LayoutRun[]): LayoutRun[][] {
  const groups: LayoutRun[][] = [];
  for (const run of runs) {
    const previous = groups[groups.length - 1];
    if (previous !== undefined && previous[0]!.y === run.y) previous.push(run);
    else groups.push([run]);
  }
  return groups;
}

function cardBodyRuns(
  card: DescriptionCard,
  cardIndex: number,
  fontSize: number,
  bodyWidth: number,
  bodyTop: number,
): LayoutRun[] {
  const plainBody = decodeHtml(card.body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const firstLineIndent = card.kind === "spell"
    ? wrap(plainBody, 160, fontSize).length * fontSize > SHORT_SPELL_BODY_HEIGHT
      ? measuredWidth("    ", fontSize)
      : 0
    : 0;
  const runs = layoutHtmlRuns(card.body, {
    x: PAGE_MARGIN + (cardIndex % 3) * (CARD_WIDTH + CARD_GUTTER) + 5,
    top: bodyTop,
    width: bodyWidth,
    fontSize,
    firstLineIndent,
    role: "body",
    card: cardIndex,
  });
  return runs.filter((run) => card.kind !== "spell" || !overlapsFixedLabel(run));
}

function bodyFits(runs: readonly LayoutRun[], bottom: number): boolean {
  return runs.every((run) => run.y >= bottom);
}

function canonicalDescriptionCardRuns(cards: readonly DescriptionCard[]): LayoutRun[] {
  const runs: LayoutRun[] = [];
  cards.forEach((card, cardIndex) => {
    const column = cardIndex % 3;
    const row = Math.floor(cardIndex / 3);
    const top = CARD_TOPS[row];
    if (top === undefined) return;
    const x = PAGE_MARGIN + column * (CARD_WIDTH + CARD_GUTTER);
    const add = (text: string, y: number, role: LayoutRun["role"], height = 8): void => {
      if (text === "") return;
      const run: LayoutRun = { text, x: x + 3, y, width: CARD_WIDTH - 6, height, card: cardIndex, role };
      if (!overlapsFixedLabel(run)) runs.push(run);
    };
    add(card.title, top, "title", 11);
    add(card.subtitle, top - 14, "subtitle", 9);

    if (card.kind === "spell") {
      let metadataY = top - 30;
      for (const [label, value] of card.metadata) {
        add(label, metadataY, "metadata", 9);
        add(clippedText(value, 115, 6), metadataY, "metadata", 9);
        metadataY -= 10;
      }
      const plainBody = decodeHtml(card.body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      const bodyFontSize = 5;
      const legacyLines = wrap(plainBody, 160, bodyFontSize);
      const firstLineIndent = legacyLines.length * bodyFontSize > SHORT_SPELL_BODY_HEIGHT
        ? measuredWidth("    ", bodyFontSize)
        : 0;
      for (const run of layoutHtmlRuns(cardPlainHtml(card.body), { x: x + 5, top: top - 83, width: SPELL_BODY_WIDTH, fontSize: bodyFontSize, firstLineIndent, role: "body", card: cardIndex })) {
        if (!overlapsFixedLabel(run)) runs.push(run);
      }
    } else {
      for (const run of layoutHtmlRuns(cardPlainHtml(card.body), { x: x + 5, top: top - 38, width: 162, fontSize: 6, role: "body", card: cardIndex })) {
        if (!overlapsFixedLabel(run)) runs.push(run);
      }
    }
    add(card.footer, top - 229, "footer", 7);
    add(card.footerRight ?? "", top - 229, "footer", 7);
  });
  return runs;
}

export function descriptionCardRuns(
  cards: readonly DescriptionCard[],
  options: { richText?: boolean } = {},
): LayoutRun[] {
  if (options.richText === false) return canonicalDescriptionCardRuns(cards);
  const runs: LayoutRun[] = [];
  cards.forEach((card, cardIndex) => {
    const pageIndex = Math.floor(cardIndex / 9);
    const localCardIndex = cardIndex % 9;
    const column = localCardIndex % 3;
    const row = Math.floor(localCardIndex / 3);
    const top = CARD_TOPS[row];
    if (top === undefined) return;
    const x = PAGE_MARGIN + column * (CARD_WIDTH + CARD_GUTTER);
    const add = (
      text: string,
      y: number,
      role: LayoutRun["role"],
      fontSize: number,
      style: LayoutRun["style"] = "regular",
      xOffset = 3,
      align: LayoutRun["align"] = "left",
      rightInset = 3,
      targetPage = pageIndex,
    ): void => {
      if (text === "") return;
      const run: LayoutRun = {
        text,
        x: x + xOffset,
        y,
        width: CARD_WIDTH - xOffset - rightInset,
        height: fontSize,
        card: localCardIndex,
        page: targetPage,
        role,
        fontSize,
        style,
        align,
      };
      if (!overlapsFixedLabel(run)) runs.push(run);
    };
    add(card.title, top - 13.5, "title", 10, "regular", 0, "center", 0);
    add(card.subtitle, top - 26, "subtitle", 6, "italic", 0, "center", 0);

    const appendBody = (bodyRuns: readonly LayoutRun[], targetPage: number, yShift = 0): void => {
      for (const run of bodyRuns) {
        runs.push({ ...run, card: localCardIndex, page: targetPage, y: run.y + yShift });
      }
    };

    if (card.kind === "spell") {
      let metadataY = top - 39;
      for (const [label, value] of card.metadata) {
        add(label, metadataY, "metadata", 6, "bold");
        add(clippedText(value, 120.5, 6), metadataY, "metadata-value", 6, "regular", 53.5);
        metadataY -= 11;
      }
      const bodyTop = top - 83;
      const bodyBottom = top - 225;
      const normalSize = 5;
      const normalRuns = cardBodyRuns(card, localCardIndex, normalSize, SPELL_BODY_WIDTH, bodyTop);
      let chosenSize = normalSize;
      let chosenRuns = normalRuns;
      if (!bodyFits(normalRuns, bodyBottom)) {
        const minimumRuns = cardBodyRuns(card, localCardIndex, CARD_BODY_MIN_FONT_SIZE, SPELL_BODY_WIDTH, bodyTop);
        if (bodyFits(minimumRuns, bodyBottom)) {
          let low = CARD_BODY_MIN_FONT_SIZE;
          let high = normalSize;
          for (let pass = 0; pass < 8; pass += 1) {
            const candidate = (low + high) / 2;
            const candidateRuns = cardBodyRuns(card, localCardIndex, candidate, SPELL_BODY_WIDTH, bodyTop);
            if (bodyFits(candidateRuns, bodyBottom)) low = candidate;
            else high = candidate;
          }
          chosenSize = low;
          chosenRuns = cardBodyRuns(card, localCardIndex, chosenSize, SPELL_BODY_WIDTH, bodyTop);
        } else {
          chosenSize = CARD_BODY_MIN_FONT_SIZE;
          chosenRuns = minimumRuns;
        }
      }
      const groups = bodyLineGroups(chosenRuns);
      let groupIndex = 0;
      let bodyPage = pageIndex;
      while (groupIndex < groups.length) {
        const firstY = groups[groupIndex]![0]!.y;
        let end = groupIndex;
        while (end < groups.length && groups[end]![0]!.y + bodyTop - firstY >= bodyBottom) end += 1;
        if (end === groupIndex) end += 1;
        const pageGroups = groups.slice(groupIndex, end);
        const pageRuns = pageGroups.flat();
        appendBody(pageRuns, bodyPage, bodyTop - firstY);
        if (bodyPage > pageIndex) {
          add(card.title, top - 13.5, "title", 10, "regular", 0, "center", 0, bodyPage);
          add(card.subtitle, top - 26, "subtitle", 6, "italic", 0, "center", 0, bodyPage);
        }
        groupIndex = end;
        bodyPage += 1;
      }
    } else {
      const bodyTop = top - 38;
      const bodyBottom = top - 225;
      const normalSize = 6;
      const normalRuns = cardBodyRuns(card, localCardIndex, normalSize, 162, bodyTop);
      let chosenSize = normalSize;
      let chosenRuns = normalRuns;
      if (!bodyFits(normalRuns, bodyBottom)) {
        const minimumRuns = cardBodyRuns(card, localCardIndex, CARD_BODY_MIN_FONT_SIZE, 162, bodyTop);
        if (bodyFits(minimumRuns, bodyBottom)) {
          let low = CARD_BODY_MIN_FONT_SIZE;
          let high = normalSize;
          for (let pass = 0; pass < 8; pass += 1) {
            const candidate = (low + high) / 2;
            const candidateRuns = cardBodyRuns(card, localCardIndex, candidate, 162, bodyTop);
            if (bodyFits(candidateRuns, bodyBottom)) low = candidate;
            else high = candidate;
          }
          chosenSize = low;
          chosenRuns = cardBodyRuns(card, localCardIndex, chosenSize, 162, bodyTop);
        } else {
          chosenSize = CARD_BODY_MIN_FONT_SIZE;
          chosenRuns = minimumRuns;
        }
      }
      const groups = bodyLineGroups(chosenRuns);
      let groupIndex = 0;
      let bodyPage = pageIndex;
      while (groupIndex < groups.length) {
        const firstY = groups[groupIndex]![0]!.y;
        let end = groupIndex;
        while (end < groups.length && groups[end]![0]!.y + bodyTop - firstY >= bodyBottom) end += 1;
        if (end === groupIndex) end += 1;
        const pageGroups = groups.slice(groupIndex, end);
        appendBody(pageGroups.flat(), bodyPage, bodyTop - firstY);
        if (bodyPage > pageIndex) {
          add(card.title, top - 13.5, "title", 10, "regular", 0, "center", 0, bodyPage);
          add(card.subtitle, top - 26, "subtitle", 6, "italic", 0, "center", 0, bodyPage);
        }
        groupIndex = end;
        bodyPage += 1;
      }
    }
    add(card.footer, top - 233.5, "footer", 6, "regular", CARD_FOOTER_INSET, "left", CARD_FOOTER_INSET, pageIndex);
    if (card.footerRight !== undefined) {
      add(card.footerRight, top - 233.5, "footer", 6, "regular", CARD_FOOTER_INSET, "right", CARD_FOOTER_INSET, pageIndex);
    }
  });
  return runs;
}

// The equipment template's notes column, inset the way richTextBox insets a
// field: 3pt horizontally, the first baseline a line below the top edge and
// the last baseline held a point above the floor.
const SIDEBAR_FONT_SIZE = 7;
const SIDEBAR_LINE_HEIGHT = 10;
const SIDEBAR_TOP = SHEET_TEMPLATE_CONTRACT.equipmentNotes.y + SHEET_TEMPLATE_CONTRACT.equipmentNotes.height - SIDEBAR_LINE_HEIGHT;
const SIDEBAR_BOTTOM = SHEET_TEMPLATE_CONTRACT.equipmentNotes.y + 1;
const SIDEBAR_X = SHEET_TEMPLATE_CONTRACT.equipmentNotes.x + 3;
const SIDEBAR_WIDTH = SHEET_TEMPLATE_CONTRACT.equipmentNotes.width - 6;
const SIDEBAR_GAP = 13;

/** One flowed column of item descriptions, leading and gaps scaled to `fontSize`. */
function sidebarBlockRuns(sidebars: readonly InventorySidebar[], fontSize: number): LayoutRun[] {
  const scale = fontSize / SIDEBAR_FONT_SIZE;
  const runs: LayoutRun[] = [];
  let y = SIDEBAR_TOP;
  for (const sidebar of sidebars) {
    const sidebarRuns = layoutHtmlRuns(
      `<strong><em>${sidebar.title}.</em></strong> ${sidebar.html}`,
      {
        x: SIDEBAR_X,
        top: y,
        width: SIDEBAR_WIDTH,
        fontSize,
        lineHeight: SIDEBAR_LINE_HEIGHT * scale,
        role: "sidebar",
      },
    );
    runs.push(...sidebarRuns);
    y = Math.min(...sidebarRuns.map((run) => run.y)) - SIDEBAR_GAP * scale;
  }
  return runs;
}

/**
 * The item-descriptions column, kept inside its box. A character carrying more
 * attunements than the column holds gets smaller text rather than prose walking
 * off the bottom of the page, and prose too long even at the floor size
 * continues onto a further copy of the page -- a sidebar item is not guaranteed
 * a card elsewhere in the sheet, so overflow here would otherwise be lost.
 */
function boundedSidebarRuns(sidebars: readonly InventorySidebar[]): LayoutRun[] {
  const normal = sidebarBlockRuns(sidebars, SIDEBAR_FONT_SIZE);
  if (sidebars.length === 0 || bodyFits(normal, SIDEBAR_BOTTOM)) return normal;

  if (bodyFits(sidebarBlockRuns(sidebars, CARD_BODY_MIN_FONT_SIZE), SIDEBAR_BOTTOM)) {
    // Take the largest size that still fits, so the column shrinks only as far
    // as the content demands.
    let low = CARD_BODY_MIN_FONT_SIZE;
    let high = SIDEBAR_FONT_SIZE;
    for (let pass = 0; pass < 8; pass += 1) {
      const candidate = (low + high) / 2;
      if (bodyFits(sidebarBlockRuns(sidebars, candidate), SIDEBAR_BOTTOM)) low = candidate;
      else high = candidate;
    }
    return sidebarBlockRuns(sidebars, low);
  }

  // Beyond what shrinking can rescue: keep the text legible and spill whole
  // lines onto continuation pages, each restarting at the top of the column.
  const paginated: LayoutRun[] = [];
  const groups = bodyLineGroups(normal);
  let groupIndex = 0;
  let page = 0;
  while (groupIndex < groups.length) {
    const firstY = groups[groupIndex]![0]!.y;
    let end = groupIndex;
    while (end < groups.length && groups[end]![0]!.y + SIDEBAR_TOP - firstY >= SIDEBAR_BOTTOM) end += 1;
    if (end === groupIndex) end += 1;
    for (const run of groups.slice(groupIndex, end).flat()) {
      paginated.push({ ...run, page, y: run.y + SIDEBAR_TOP - firstY });
    }
    groupIndex = end;
    page += 1;
  }
  return paginated;
}

export function inventoryRuns(
  tableColumns: readonly [readonly (readonly string[])[], readonly (readonly string[])[]],
  sidebars: readonly InventorySidebar[],
  summaryRows: readonly (readonly string[])[] = [],
): LayoutRun[] {
  const runs: LayoutRun[] = [];
  tableColumns.forEach((column, columnIndex) => column.forEach((tokens, row) => {
    runs.push({ text: tokens.join(" "), x: columnIndex === 0 ? 33 : 218, y: 748 - row * 10, width: 168, height: 8, role: "table" });
  }));
  runs.push(...boundedSidebarRuns(sidebars));
  summaryRows.forEach((tokens, index) => {
    const summaryY = index === 0 ? 510 : 345 - (index - 1) * 10;
    runs.push({ text: tokens.join(" "), x: 33, y: summaryY, width: 353, height: 8, role: "table" });
  });
  return runs;
}

function htmlTextBlocks(html: string): string[] {
  return html
    .replace(/<li\b[^>]*>/gi, "<p>\u0007 ")
    .replace(/<\/li>/gi, "</p>")
    .replace(/<br\s*\/?>/gi, "</p><p>")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split(/\n+/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function canonicalInventoryRuns(
  tableColumns: readonly [readonly (readonly string[])[], readonly (readonly string[])[]],
  sidebars: readonly InventorySidebar[],
  summaryRows: readonly (readonly string[])[] = [],
): LayoutRun[] {
  const runs: LayoutRun[] = [];
  tableColumns.forEach((column, columnIndex) => column.forEach((tokens, row) => {
    runs.push({ text: tokens.join(" "), x: columnIndex === 0 ? 33 : 218, y: 748 - row * 10, width: 168, height: 8, role: "table" });
  }));
  let y = 758;
  for (const sidebar of sidebars) {
    const blocks = htmlTextBlocks(sidebar.html);
    const lines = blocks.flatMap((block) => {
      const wrapped = block.startsWith("\u0007")
        ? wrapWithContinuation(block, 168, 150, 8)
        : wrapWithContinuation(block, 168, 150, 14);
      const step = block.startsWith("\u0007") ? 8 : 6.5;
      return block.startsWith("\u0007")
        ? [...wrapped.map((text) => ({ text, step })), { text: "", step: 3.5 }]
        : wrapped.map((text) => ({ text, step }));
    });
    const first = lines.shift();
    if (first !== undefined) {
      runs.push({ text: `${sidebar.title}. ${first.text}`, x: 410, y, width: 168, height: 8, role: "sidebar" });
      y -= 10;
    } else {
      runs.push({ text: `${sidebar.title}.`, x: 410, y, width: 168, height: 8, role: "sidebar" });
      y -= 10;
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      if (line.text === "") {
        y -= line.step;
        continue;
      }
      if (510 <= y && y <= 516 && measuredWidth(line.text, 14) > 100) {
        const narrowed = wrap(line.text, 100, 14);
        line.text = narrowed.shift() ?? line.text;
        lines.splice(lineIndex + 1, 0, ...narrowed.map((text) => ({ text, step: line.step })));
      }
      runs.push({ text: line.text, x: 410, y, width: 168, height: 8, role: "sidebar" });
      y -= line.step;
    }
  }
  summaryRows.forEach((tokens, index) => {
    const summaryY = index === 0 ? 510 : 345 - (index - 1) * 10;
    runs.push({ text: tokens.join(" "), x: 33, y: summaryY, width: 353, height: 8, role: "table" });
  });
  return runs;
}

export function sortedLayoutTokens(runs: readonly LayoutRun[]): string[] {
  return runs
    .filter((run) => !(run.role === "metadata-value" && (run.card ?? 3) < 3))
    .map((run, index) => ({ run, index }))
    .sort((left, right) => right.run.y - left.run.y || left.run.x - right.run.x || left.index - right.index)
    .flatMap(({ run }) => run.text.split(/\s+/).filter(Boolean));
}

export function resolveSpellCardOrigin(input: {
  caster: string;
  requiresPreparation: boolean;
  prepared: boolean;
  alwaysPrepared: boolean;
  alwaysPreparedLabel?: string;
  pactMagic?: boolean;
}): string {
  if (input.alwaysPrepared) return input.alwaysPreparedLabel ?? `Domain Spells (${input.caster})`;
  if (input.prepared) return `Prepared (${input.caster})`;
  if (input.pactMagic) return `Pact Magic (${input.caster})`;
  return `Spellcasting (${input.caster})`;
}
