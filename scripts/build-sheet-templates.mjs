#!/usr/bin/env node
/**
 * Generates the character sheet template sets under
 * apps/client/public/sheets/<set>/ from the contract in
 * packages/engine/src/sheet/template-contract.ts.
 *
 *   node scripts/build-sheet-templates.mjs build   # write the PDFs
 *   node scripts/build-sheet-templates.mjs check   # regenerate in memory and fail on drift
 *
 * The templates are original vector layouts: framed sections, titles and
 * named AcroForm fields. The two sets share one decorative style but lay the
 * character page out differently. The 2014 set follows the classic sheet
 * arrangement — ability shields down the left, saving throws and skills
 * beside them, armor, hit points and senses in the middle, attacks along the
 * bottom and features on the right, every section titled on its lower edge.
 * The 2024 set groups each ability's saving throw and skills beneath its
 * score, as the 2024 rules present them, with titles on the upper edge. The
 * 2024 Hybrid set keeps the 2024 page but restores the classic ability
 * column, saving throws and skills list, and splits the features by origin.
 *
 * Each set's character page also has layout variants, one per combination of
 * the contract's implemented layout switches away from the set's defaults
 * (details~split.pdf, details~unsplit.pdf, details~top.readable.pdf, ...).
 * The page functions take the switches; the defaults draw the set's own page
 * exactly as before.
 *
 * The templates carry artwork and fields only. Every title, caption and ribbon
 * is recorded in the set's labels.json and drawn by the writer at render time
 * in the reader's chosen typefaces and colours; the generator measures text
 * with the default faces (under apps/client/public/sheets/fonts) purely to lay
 * the artwork out. The engine build must exist (npm run build) because the
 * contract is imported from the compiled engine.
 */

import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, TextAlignment, degrees, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_MODULE = join(ROOT, "packages", "engine", "dist", "sheet", "template-contract.js");
if (!existsSync(CONTRACT_MODULE)) {
  console.error("build the engine first (npm run build): missing " + CONTRACT_MODULE);
  process.exit(1);
}
const {
  SHEET_TEMPLATE_CONTRACT: C, SHEET_TEMPLATE_SETS, SHEET_PALETTE, DEFAULT_SHEET_COLOURS, SHEET_FIXED_COLOURS,
  SHEET_LAYOUT_DEFAULTS, sheetLayoutVariants,
} = await import(pathToFileURL(CONTRACT_MODULE).href);
const OUTPUT_ROOT = join(ROOT, "apps", "client", "public", C.directory);
const FONT_DIR = join(OUTPUT_ROOT, C.fontsDirectory);

// The default faces, embedded once in a scratch document purely for measuring.
const MEASURE = await (async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return {
    display: await doc.embedFont(readFileSync(join(FONT_DIR, "CinzelDecorative-Bold.ttf"))),
    caption: await doc.embedFont(readFileSync(join(FONT_DIR, "Spectral-SemiBold.ttf"))),
    captionLight: await doc.embedFont(StandardFonts.Helvetica),
  };
})();

// Palette: the contract's default text, accent and line colours (dark ink,
// a deep crimson, an antique gold) plus the contract's fixed colours — a
// parchment tint inside the frames and the greys. The writer recolours the
// three named parts at render time, so they must be the contract's defaults
// and nothing else may share their values.
const INK = rgb(...SHEET_PALETTE[DEFAULT_SHEET_COLOURS.text].rgb);
const ACCENT = rgb(...SHEET_PALETTE[DEFAULT_SHEET_COLOURS.accent].rgb);
const GOLD = rgb(...SHEET_PALETTE[DEFAULT_SHEET_COLOURS.lines].rgb);
const RULE = rgb(...SHEET_FIXED_COLOURS.rule);
const FILL = rgb(...SHEET_FIXED_COLOURS.fill);
const CREAM = rgb(...SHEET_FIXED_COLOURS.cream);
const WHITE = rgb(1, 1, 1);
const BAND = ACCENT;
const SHADOW = rgb(...SHEET_FIXED_COLOURS.shadow);
const PANEL_GREY = rgb(...SHEET_FIXED_COLOURS.panelGrey);
const LABEL_FONT = { display: "titles", caption: "captions", captionLight: "notes" };

const EDITION = {
  "2014": {
    rules: "2014 RULES",
    inspiration: "INSPIRATION",
    traits: "RACIAL TRAITS",
    origin: "RACE & BACKGROUND",
    titleStyle: "caption",
    titleAt: "bottom",
    marker: "square",
  },
  "2024": {
    rules: "2024 RULES",
    inspiration: "HEROIC INSPIRATION",
    traits: "SPECIES TRAITS",
    origin: "SPECIES & BACKGROUND",
    titleStyle: "plate",
    titleAt: "top",
    marker: "circle",
  },
};
// The hybrid set prints 2024 rules on the classic ability column.
EDITION["2024-hybrid"] = { ...EDITION["2024"] };

// SVG path helpers. drawSvgPath places the path's origin at the given point
// with y running downwards, so every path is authored from its top-left corner.
/** A small deterministic jitter in [-1, 1] for roughened edges. */
const jitter = (seed) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
/**
 * A rounded rectangle whose edge wanders by up to `rough` points, sampled
 * every few points around the perimeter, so it reads as brushed or torn
 * rather than ruled.
 */
const roughRectPath = (w, h, r, rough, seed) => {
  const points = [];
  const arc = (cx, cy, from, to) => {
    for (let index = 0; index <= 6; index += 1) {
      const angle = from + ((to - from) * index) / 6;
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  };
  const edge = (x1, y1, x2, y2) => {
    const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 7));
    for (let index = 1; index < steps; index += 1) points.push([x1 + ((x2 - x1) * index) / steps, y1 + ((y2 - y1) * index) / steps]);
  };
  arc(r, r, Math.PI, Math.PI * 1.5);
  edge(r, 0, w - r, 0);
  arc(w - r, r, Math.PI * 1.5, Math.PI * 2);
  edge(w, r, w, h - r);
  arc(w - r, h - r, 0, Math.PI * 0.5);
  edge(w - r, h, r, h);
  arc(r, h - r, Math.PI * 0.5, Math.PI);
  edge(0, h - r, 0, r);
  const cx = w / 2;
  const cy = h / 2;
  return points.map(([x, y], index) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const offset = jitter(seed + index) * rough;
    return `${index === 0 ? "M" : "L"} ${(x + (dx / length) * offset).toFixed(2)} ${(y + (dy / length) * offset).toFixed(2)}`;
  }).join(" ") + " Z";
};
/** A rectangle with its corners cut at 45 degrees, as the printed sheets' panels are. */
const chamferRectPath = (w, h, c) =>
  `M ${c} 0 H ${w - c} L ${w} ${c} V ${h - c} L ${w - c} ${h} H ${c} L 0 ${h - c} V ${c} Z`;
/** A pointy-top hexagon inscribed in w x h. */
const hexPath = (w, h) =>
  `M ${w / 2} 0 L ${w} ${h * 0.25} L ${w} ${h * 0.75} L ${w / 2} ${h} L 0 ${h * 0.75} L 0 ${h * 0.25} Z`;
const roundedRectPath = (w, h, r) =>
  `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
const ribbonPath = (w, h) => `M 4 0 H ${w - 4} L ${w} ${h / 2} L ${w - 4} ${h} H 4 L 0 ${h / 2} Z`;
const diamondPath = (r) => `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`;
const shieldPath = (w, h) =>
  `M 0 0 H ${w} V ${h * 0.55} C ${w} ${h * 0.82}, ${w * 0.62} ${h * 0.94}, ${w / 2} ${h} C ${w * 0.38} ${h * 0.94}, 0 ${h * 0.82}, 0 ${h * 0.55} Z`;

class Sheet {
  constructor(doc, page, fonts, style) {
    this.doc = doc;
    this.page = page;
    this.fonts = fonts;
    this.style = style;
    this.form = doc.getForm();
    /** Text the writer draws onto this template, in draw order. */
    this.labels = [];
    this.ribbons = [];
  }

  // --- primitives -----------------------------------------------------------

  path(svg, x, top, { stroke, lineWidth = 0.6, fill, opacity } = {}) {
    this.page.drawSvgPath(svg, { x, y: top, borderColor: stroke, borderWidth: stroke ? lineWidth : 0, color: fill, ...(opacity === undefined ? {} : { opacity }) });
  }
  /**
   * A brushed grey wash behind a shape: offset, translucent rounded blocks
   * that give the artwork some depth, like the sketched shadow under a badge.
   */
  shadow(x, y, width, height, { radius = 6 } = {}) {
    for (const [dx, dy, grow, opacity] of [[3, -4, 2, 0.1], [-2, -2, 4, 0.06], [5, 1, 0, 0.05]]) {
      this.rounded(x + dx - grow, y + dy - grow, width + grow * 2, height + grow * 2, radius + grow, { fill: SHADOW, opacity });
    }
  }
  /**
   * A grey backing panel with a roughened edge: the solid panel plus a few
   * translucent, slightly offset copies, so the boundary reads as brushed
   * rather than ruled. Sections sit on it for depth.
   */
  panel(x, y, width, height, { radius = 9 } = {}) {
    let seed = Math.round(x * 7 + y * 3);
    for (const [dx, dy, grow, opacity, rough] of [[-2, 2, 4, 0.16, 2.2], [3, -2, 2, 0.12, 1.6]]) {
      this.path(roughRectPath(width + grow * 2, height + grow * 2, radius + grow, rough, seed), x + dx - grow, y + height + dy + grow, { fill: SHADOW, opacity });
      seed += 101;
    }
    this.path(roughRectPath(width, height, radius, 1.2, seed), x, y + height, { fill: PANEL_GREY });
  }
  /** Brushed strokes behind a header: faint, slightly tilted bands trailing past its ends. */
  brush(x, y, width, height) {
    const strokes = [
      [-15, height * 0.55, width + 30, 16, -1.2, 0.14],
      [-8, height * 0.2, width + 22, 12, 0.9, 0.11],
      [10, height * 0.8, width + 8, 9, -0.4, 0.09],
    ];
    strokes.forEach(([dx, dy, w, h, angle, opacity], index) => {
      this.page.drawSvgPath(roughRectPath(w, h, h / 2, 1.5, Math.round(x + index * 37)), {
        x: x + dx,
        y: y + dy + h / 2,
        color: SHADOW,
        borderWidth: 0,
        opacity,
        rotate: degrees(angle),
      });
    });
  }
  rect(x, y, width, height, { fill, stroke, lineWidth = 0.5 } = {}) {
    this.page.drawRectangle({ x, y, width, height, color: fill, borderColor: stroke, borderWidth: stroke ? lineWidth : 0 });
  }
  rounded(x, y, width, height, radius, options = {}) {
    this.path(roundedRectPath(width, height, radius), x, y + height, options);
  }
  circle(cx, cy, r, { fill, stroke, lineWidth = 0.6 } = {}) {
    this.page.drawCircle({ x: cx, y: cy, size: r, color: fill, borderColor: stroke, borderWidth: stroke ? lineWidth : 0 });
  }
  rule(x1, y1, x2, y2, color = RULE, thickness = 0.4) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  }
  diamond(cx, cy, r, color = ACCENT) {
    this.path(diamondPath(r), cx, cy, { fill: color });
  }
  /** A thin rule with a diamond at each end. */
  ornamentRule(x1, x2, y, color = GOLD) {
    const { thickness, capRadius } = C.ornament;
    this.rule(x1 + capRadius * 2, y, x2 - capRadius * 2, y, color, thickness);
    this.diamond(x1 + capRadius, y, capRadius, color);
    this.diamond(x2 - capRadius, y, capRadius, color);
  }

  // --- type ------------------------------------------------------------------

  textWidth(text, font, size) {
    return MEASURE[font].widthOfTextAtSize(text, size);
  }
  /** Records a label for the writer; `color` is a scheme part name. */
  draw(text, x, y, { font = "caption", size = 5, color = "text", align = "left", width = 0 } = {}) {
    const label = { text, x, y, size, font: LABEL_FONT[font], color };
    if (align !== "left") Object.assign(label, { align, width });
    this.labels.push(label);
  }
  /** A section or page title in the display face. */
  display(text, x, y, options = {}) {
    this.draw(text, x, y, { font: "display", size: 7, color: "accent", ...options });
  }
  /** A small uppercase caption. */
  label(text, x, y, options = {}) {
    this.draw(text, x, y, { font: "caption", size: 4.6, color: "text", ...options });
  }
  /** A quiet lowercase note. */
  note(text, x, y, options = {}) {
    this.draw(text, x, y, { font: "captionLight", size: 4.6, color: "text", ...options });
  }

  // --- ornament ---------------------------------------------------------------

  /** A chamfered panel with an inner hairline, the printed sheets' box idiom. */
  frame(x, y, width, height, { radius = 4, fill = FILL, lineWidth = 0.9 } = {}) {
    const cut = Math.min(radius + 2, width / 3, height / 3);
    this.path(chamferRectPath(width, height, cut), x, y + height, { fill, stroke: ACCENT, lineWidth });
    this.path(chamferRectPath(width - 4.4, height - 4.4, Math.max(1, cut - 2)), x + 2.2, y + height - 2.2, { stroke: GOLD, lineWidth: 0.35 });
  }
  /** The brand badge: a die mark the writer may paint a host logo over. */
  dieBadge(name, cx, cy, size) {
    const x = cx - size / 2;
    const top = cy + size / 2;
    // The hex is inset by a full stroke so the mark — mitred vertices and all —
    // stays inside the badge's box. The writer knocks that box out to paint a
    // host logo over the mark, and anything reaching past it survives beside
    // the logo as a hairline.
    const stroke = size * C.masthead.badgeStroke;
    this.path(hexPath(size - stroke * 2, size - stroke * 2), x + stroke, top - stroke, { fill: FILL, stroke: ACCENT, lineWidth: stroke });
    this.path(hexPath(size * 0.56, size * 0.5), cx - size * 0.28, cy + size * 0.2, { stroke: GOLD, lineWidth: size * 0.045 });
    this.draw("20", x, cy - size * 0.17, { font: "display", size: size * 0.36, color: "accent", align: "center", width: size });
    const field = this.form.createButton(name);
    field.addToPage("", this.page, { x, y: cy - size / 2, width: size, height: size, borderWidth: 0, backgroundColor: undefined, borderColor: undefined, font: this.fonts.field });
  }
  /** A pill-shaped frame. */
  pill(x, y, width, height, { fill = FILL } = {}) {
    this.rounded(x, y, width, height, height / 2, { fill, stroke: ACCENT, lineWidth: 0.9 });
    this.rounded(x + 2.2, y + 2.2, width - 4.4, height - 4.4, (height - 4.4) / 2, { stroke: GOLD, lineWidth: 0.35 });
  }
  /** A ribbon with pointed ends, its title in cream; the writer draws both, sized to its face. */
  ribbon(title, cx, cy, { size = 6, pad = 12, height = 10 } = {}) {
    this.ribbons.push({ text: title, cx, cy, size, height, pad });
    return this.textWidth(title, "display", size) + pad * 2;
  }
  /**
   * A titled section. `ribbon` hangs the title over the top or bottom edge;
   * `plate` sets it inside, over an ornamented rule. Returns the inner content
   * box, `padTop` short of the frame's top so its contents clear the border.
   */
  section(title, x, y, width, height, { style = this.style.titleStyle, at = this.style.titleAt, size = 6.2, padTop = 0 } = {}) {
    this.frame(x, y, width, height);
    if (style === "ribbon") {
      const fitted = Math.min(size, (size * (width - 56)) / this.textWidth(title, "display", size));
      if (at === "bottom") {
        this.ribbon(title, x + width / 2, y, { size: fitted });
        return { x: x + 4, y: y + 8, width: width - 8, height: height - 12 - padTop };
      }
      this.ribbon(title, x + width / 2, y + height, { size: fitted });
      return { x: x + 4, y: y + 4, width: width - 8, height: height - 12 - padTop };
    }
    if (style === "caption") {
      // The printed sheets label a panel inside its lower edge, centred.
      this.label(title, x, y + 5, { size: Math.min(size - 1.2, (width - 12) / (title.length * 0.62)), align: "center", width, color: "text" });
      return { x: x + 4, y: y + 13, width: width - 8, height: height - 17 - padTop };
    }
    this.display(title, x, y + height - 11, { size, align: "center", width });
    this.ornamentRule(x + 8, x + width - 8, y + height - 15);
    return { x: x + 4, y: y + 4, width: width - 8, height: height - 20 - padTop };
  }
  /** A framed stat: a large centred value over its caption. */
  stat(name, caption, x, y, width, height, { size = 12, radius = 4 } = {}) {
    this.frame(x, y, width, height, { radius });
    this.text(name, x + 3, y + 12, width - 6, height - 16, { align: "center", size, box: "none" });
    this.label(caption, x, y + 4.5, { size: Math.min(4.6, width / 14), align: "center", width });
  }
  /** A heater shield holding a large value, its caption on the shield's brow. */
  shield(name, caption, x, top, width, height, { size = 18, captionSize = 3.8 } = {}) {
    this.path(shieldPath(width, height), x, top, { fill: FILL, stroke: ACCENT, lineWidth: 1 });
    this.path(shieldPath(width - 5.2, height - 5), x + 2.6, top - 2.5, { stroke: GOLD, lineWidth: 0.35 });
    this.label(caption, x, top - 9, { size: captionSize, align: "center", width });
    this.text(name, x + 2, top - height * 0.72, width - 4, height * 0.5, { align: "center", size, box: "none" });
  }
  /**
   * An ability shield: the name on the brow, the score in the body and the
   * modifier in a roundel over the tip — or, with `large: "modifier"`, the
   * modifier in the body and the score in the roundel.
   */
  abilityShield(prefix, key, caption, cx, top, { width = 54, height = 65, captionSize = 4.2, large = "score" } = {}) {
    const x = cx - width / 2;
    this.path(shieldPath(width, height), x, top, { fill: FILL, stroke: ACCENT, lineWidth: 1 });
    this.path(shieldPath(width - 5.2, height - 5), x + 2.6, top - 2.5, { stroke: GOLD, lineWidth: 0.35 });
    this.display(caption, x, top - 10, { size: captionSize, align: "center", width });
    // A heater shield's optical centre sits above its bounding box's, and the
    // writer centres the digits on this rectangle, so it is derived from the
    // height rather than pinned — the 65pt and 62pt shields then agree.
    const scoreHeight = height * 0.46;
    const scoreMiddle = top - height * 0.45;
    const [body, small] = large === "modifier" ? ["modifier", "score"] : ["score", "modifier"];
    this.text(`${prefix}_${key}_${body}`, x + 6, scoreMiddle - scoreHeight / 2, width - 12, scoreHeight, { align: "center", size: 18, box: "none" });
    const roundel = top - height + 6;
    this.circle(cx, roundel, 9, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
    this.circle(cx, roundel, 7, { stroke: GOLD, lineWidth: 0.3 });
    this.text(`${prefix}_${key}_${small}`, cx - 12, roundel - 6.5, 24, 13, { align: "center", size: 9, box: "none" });
  }

  // --- fields -------------------------------------------------------------------

  /** A text field; the widget itself is invisible, the art beneath is ours. */
  text(name, x, y, width, height, { multiline = false, align = "left", size = 8, box = "underline" } = {}) {
    if (box === "underline") this.rule(x, y - 2.5, x + width, y - 2.5, RULE, 0.5);
    else if (box === "frame") this.rounded(x, y, width, height, 2, { fill: WHITE, stroke: RULE, lineWidth: 0.5 });
    const field = this.form.createTextField(name);
    if (multiline) field.enableMultiline();
    field.setAlignment(align === "center" ? TextAlignment.Center : align === "right" ? TextAlignment.Right : TextAlignment.Left);
    field.addToPage(this.page, { x, y, width, height, borderWidth: 0, backgroundColor: undefined, borderColor: undefined, textColor: INK, font: this.fonts.field });
    field.setFontSize(size);
    return field;
  }
  /** A labelled entry: the field over a rule with its caption underneath. */
  entry(name, caption, x, y, width, height, options = {}) {
    this.text(name, x, y, width, height, options);
    this.label(caption, x, y - 6.5, { size: options.captionSize ?? 4.2, align: options.captionAlign ?? "left", width });
  }
  /** A captioned entry: the caption above the field, as the classic sheet has it. */
  captioned(name, caption, x, y, width, height, options = {}) {
    this.text(name, x, y, width, height, options);
    this.label(caption, x, y + height + 2, { size: options.captionSize ?? 3.8, color: "lines", align: options.captionAlign ?? "left", width });
  }
  /** A checkbox: the empty marker is page art; the widget adds only the check. */
  check(name, x, y, size = 7, { marker = this.style.marker } = {}) {
    if (marker === "circle") this.circle(x + size / 2, y + size / 2, size / 2, { fill: WHITE, stroke: ACCENT, lineWidth: 0.6 });
    else this.rounded(x, y, size, size, 1.2, { fill: WHITE, stroke: ACCENT, lineWidth: 0.6 });
    const field = this.form.createCheckBox(name);
    field.addToPage(this.page, { x, y, width: size, height: size, borderWidth: 0, backgroundColor: undefined, borderColor: undefined, textColor: INK });
    return field;
  }
  /** An image frame the writer paints a portrait into. */
  image(name, x, y, width, height) {
    this.frame(x, y, width, height);
    const field = this.form.createButton(name);
    field.addToPage("", this.page, { x, y, width, height, borderWidth: 0, backgroundColor: undefined, borderColor: undefined, font: this.fonts.field });
    return field;
  }
  /** A framed multiline field with a title; `padTop` drops the field's top below the frame's. */
  block(title, name, x, y, width, height, { size = 6, style, at, padTop = 0 } = {}) {
    const inner = this.section(title, x, y, width, height, { style, at, padTop });
    this.text(name, inner.x, inner.y, inner.width, inner.height, { multiline: true, size, box: "none" });
    return inner;
  }
}

async function newDocument(width, height, style) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("");
  doc.setProducer("build-sheet-templates");
  doc.setCreator("build-sheet-templates");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const page = doc.addPage([width, height]);
  const fonts = { field: await doc.embedFont(StandardFonts.Helvetica) };
  return { doc, sheet: new Sheet(doc, page, fonts, style) };
}

/** The template bytes with the text the writer draws onto them. */
async function finish(doc, sheet) {
  doc.getForm().updateFieldAppearances();
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes, text: { labels: sheet.labels, ribbons: sheet.ribbons } };
}

const ABILITIES = [["str", "STRENGTH"], ["dex", "DEXTERITY"], ["con", "CONSTITUTION"], ["int", "INTELLIGENCE"], ["wis", "WISDOM"], ["cha", "CHARISMA"]];
const SKILLS = [
  ["acrobatics", "Acrobatics", "dex"], ["animalhandling", "Animal Handling", "wis"], ["arcana", "Arcana", "int"],
  ["athletics", "Athletics", "str"], ["deception", "Deception", "cha"], ["history", "History", "int"],
  ["insight", "Insight", "wis"], ["intimidation", "Intimidation", "cha"], ["investigation", "Investigation", "int"],
  ["medicine", "Medicine", "wis"], ["nature", "Nature", "int"], ["perception", "Perception", "wis"],
  ["performance", "Performance", "cha"], ["persuasion", "Persuasion", "cha"], ["religion", "Religion", "int"],
  ["sleightofhand", "Sleight of Hand", "dex"], ["stealth", "Stealth", "dex"], ["survival", "Survival", "wis"],
];
const ABILITY_NAME = Object.fromEntries(ABILITIES.map(([key, name]) => [key, name[0] + name.slice(1).toLowerCase()]));

/**
 * The page title band: a centred display title between ornamented rules, with
 * the edition label at the right. The label sits above the rules rather than on
 * the masthead's line, which the 2024 hit points plate covers.
 */
function pageChrome(s, title, edition) {
  const size = 10.5;
  // The rules flank the widest title face the writer may pick; the title itself centres in whatever face is chosen.
  const width = s.textWidth(title, "display", size) * 1.25;
  const cx = C.pageWidth / 2;
  s.display(title, 0, 768, { size, align: "center", width: C.pageWidth });
  s.ornamentRule(30, cx - width / 2 - 8, 771.5, ACCENT);
  s.ornamentRule(cx + width / 2 + 8, 582, 771.5, ACCENT);
  s.label(EDITION[edition].rules, 486, 776, { size: 4.4, color: "lines", align: "right", width: 100 });
}

/**
 * The printed sheets' masthead: a brand badge and page title over a rule, the
 * character's name on a plate at the left, and the identity grid beside it.
 */
function masthead(s, edition, title, nameField, nameCaption, fields) {
  const M = C.masthead;
  s.dieBadge("sheet_brand_image", M.badgeCenterX, M.badgeCenterY, M.badgeSize);
  s.display(title, M.badgeCenterX + M.badgeSize / 2 + 10, 742, { size: 11 });
  s.label(EDITION[edition].rules, 486, 744, { size: 4.4, color: "lines", align: "right", width: 100 });
  s.ornamentRule(M.rule.x1, M.rule.x2, M.rule.y, ACCENT);
  if (nameField !== null) {
    const plate = s.section(nameCaption, 27, 690, 246, 40, { style: "caption", size: 5 });
    s.text(nameField, plate.x + 6, plate.y + 4, plate.width - 12, 18, { size: 12, box: "none" });
  }
  if (fields.length > 0) s.frame(nameField === null ? 27 : 281, 690, nameField === null ? 559 : 305, 40);
  for (const [name, caption, x, width, row] of fields) {
    // Each caption sits above its rule; the upper row must clear the plate's inner hairline.
    s.captioned(name, caption, x, row === 0 ? 714 : 697, width, 8, { size: 6.5, captionSize: 3.4 });
  }
}

/** The full-width header bar: a name field on the left, a captioned grid on the right. */
function headerBar(s, nameField, nameCaption) {
  s.brush(27, 690, 559, 66);
  s.frame(27, 690, 559, 66);
  s.text(nameField, 38, 712, 208, 18, { size: 12 });
  s.label(nameCaption, 38, 704.5, { size: 4.2 });
  s.rule(256, 698, 256, 748, GOLD, 0.4);
  s.diamond(256, 698, 1.5, GOLD);
  s.diamond(256, 748, 1.5, GOLD);
}

/** Three framed stats in a row from `x`, each `width` wide with a `gap`. */
function statRow(s, items, x, y, width, height, gap, options = {}) {
  items.forEach(([name, caption], index) => {
    s.stat(name, caption, x + index * (width + gap), y, width, height, options);
  });
}

function deathSaves(s, prefix, x, y) {
  s.label("DEATH SAVES", x, y + 18, { size: 4.4 });
  s.note("successes", x, y + 9.5, { size: 4.2 });
  s.note("failures", x, y - 1.5, { size: 4.2 });
  for (let index = 1; index <= 3; index += 1) {
    s.check(`${prefix}_death_save_success_${index}`, x + 28 + (index - 1) * 8.5, y + 8.5, 6);
    s.check(`${prefix}_death_save_fail_${index}`, x + 28 + (index - 1) * 8.5, y - 2.5, 6);
  }
}

/**
 * The classic hit point box: maximum, hit dice and temporary above the
 * current total, with the death saves in a tab on the lower edge.
 * `splitDice` gives the hit dice a maximum and a write-in for the dice spent.
 * `readable` sets the captions larger and drops the maximum and temporary
 * fields further below the frame's top, which wants a taller box.
 */
function hitPointBox(s, prefix, x, y, width, height, { splitDice = false, readable = false } = {}) {
  // The printed sheets carry the running total in one panel, with hit dice and
  // the death saves in two smaller panels beneath it.
  const tallyHeight = 32;
  const mainY = y + tallyHeight + 5;
  const mainHeight = height - tallyHeight - 5;
  s.section("CURRENT HIT POINTS", x, mainY, width, mainHeight, { style: "caption" });
  [[`${prefix}_hp_max`, "MAXIMUM", x + 12, 46], [`${prefix}_hp_temp`, "TEMPORARY", x + width - 58, 46]].forEach(([name, caption, fx, fw]) => {
    s.captioned(name, caption, fx, mainY + mainHeight - (readable ? 24 : 20), fw, 9, { align: "center", captionAlign: "center", size: 8, captionSize: readable ? 5.2 : 3.4 });
  });
  s.text(`${prefix}_hp_current`, x + 12, mainY + (readable ? 14 : 16), width - 24, 16, { align: "center", size: 14, box: "none" });
  const half = (width - 6) / 2;
  const dice = s.section("HIT DICE", x, y, half, tallyHeight, { style: "caption" });
  if (splitDice) {
    // Maximum and spent side by side, each captioned above its rule.
    const cell = (dice.width - 10) / 2;
    const [fieldY, fieldH, captionSize] = readable ? [y + 13, 10, 4.6] : [y + 13, 11, 3.2];
    s.captioned(`${prefix}_hd`, "MAX", dice.x + 3, fieldY, cell, fieldH, { align: "center", captionAlign: "center", size: 10, captionSize });
    s.captioned(`${prefix}_hd_spent`, "SPENT", dice.x + 7 + cell, fieldY, cell, fieldH, { align: "center", captionAlign: "center", size: 10, captionSize });
  } else {
    s.text(`${prefix}_hd`, dice.x + 4, y + 13, dice.width - 8, 15, { align: "center", size: 12, box: "none" });
  }
  const saves = s.section("DEATH SAVES", x + half + 6, y, half, tallyHeight, { style: "caption" });
  // Readable, the larger captions push the marks right and a point lower,
  // clear of the frame's top.
  const checksX = saves.x + (readable ? 44 : 38);
  const [successY, failY] = readable ? [y + 20, y + 12] : [y + 21, y + 13];
  for (let index = 1; index <= 3; index += 1) {
    s.check(`${prefix}_death_save_success_${index}`, checksX + (index - 1) * 9, successY, 6);
    s.check(`${prefix}_death_save_fail_${index}`, checksX + (index - 1) * 9, failY, 6);
  }
  s.label("SUCCESSES", saves.x + 4, readable ? successY + 0.9 : y + 22.5, { size: readable ? 6 : 3.2, color: "lines" });
  s.label("FAILURES", saves.x + 4, readable ? failY + 0.9 : y + 14.5, { size: readable ? 6 : 3.2, color: "lines" });
}

/**
 * A half-width pill: its caption on one or two lines at the left, the value
 * in a roundel at the right. The compact 2014 column pairs two of them. The
 * captions are short so they print at 5.5pt: every pill's first line shares
 * one baseline, and a second line sits a line's height beneath it.
 */
function roundelPill(s, name, lines, x, y, width) {
  s.pill(x, y, width, 24);
  const cx = x + width - 12;
  s.circle(cx, y + 12, 9, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.text(name, cx - 12, y + 5, 24, 14, { align: "center", size: 10, box: "none" });
  const room = cx - 9 - 1.5 - (x + 5);
  const size = Math.min(5.5, ...lines.map((line) => room / s.textWidth(line, "caption", 1)));
  lines.forEach((line, index) => s.label(line, x + 5, y + 13.1 - index * 6, { size }));
}

/**
 * The readable 2014 page's middle column: armor class, hit points, speed and
 * senses, and racial traits, each with larger captions and its contents
 * dropped clear of the frame's top. The hit point box grows for it, and the
 * racial traits give up the difference.
 */
function readableColumnC2014(s, style, layout) {
  s.section("ARMOR CLASS", 213, 580, 182, 85);
  s.captioned("details_equipped_armor", "ARMOR", 224, 640, 123, 10, { size: 7, captionSize: 5.5 });
  s.captioned("details_equipped_shield", "SHIELD", 224, 618, 123, 10, { size: 7, captionSize: 5.5 });
  s.text("details_armor_conditional", 224, 589, 164, 26.5, { multiline: true, size: 6, box: "none" });
  s.label("STEALTH DISADV.", 262, 651, { size: 4.6, color: "lines" });
  s.check("details_armor_stealth_disadvantage", 308, 650, 6.5);
  s.shield("details_armor_class", "AC", 355, 674, 44, 48, { captionSize: 7 });
  hitPointBox(s, "details", 213, 484, 182, 92, { splitDice: layout.top, readable: true });
  s.section("SPEED, SENSES & CONDITIONS", 213, 384, 182, 96);
  [["details_speed_walking", "SPEED", 224], ["details_speed_fly", "FLY", 267], ["details_speed_climb", "CLIMB", 310], ["details_speed_swim", "SWIM", 353]].forEach(([name, caption, x]) => {
    s.captioned(name, caption, x, 456, 35, 10, { align: "center", captionAlign: "center", size: 7, captionSize: 6.5 });
  });
  s.captioned("details_vision", "VISION", 224, 432, 66, 10, { size: 7, captionSize: 5.5 });
  const inspirationSize = Math.min(5.5, 35 / s.textWidth(style.inspiration, "caption", 1));
  s.captioned("details_inspiration", style.inspiration, 296, 432, 35, 10, { align: "center", captionAlign: "center", size: 7, captionSize: inspirationSize });
  s.label("EXHAUSTION", 335, 444, { size: 5 });
  for (let i = 1; i <= 6; i++) s.check(`details_exhaustion_${i}`, 335 + (i - 1) * 9, 434, 6, { marker: "square" });
  s.text("details_resistances", 224, 397, 164, 30, { multiline: true, size: 6, box: "none" });
  s.block(style.traits, "details_additional_notes", 213, 196, 182, 184, { padTop: 4 });
}

// ---------------------------------------------------------------------------
// Character page, 2014 arrangement.
// ---------------------------------------------------------------------------

async function details2014(edition, layout = SHEET_LAYOUT_DEFAULTS[edition]) {
  const style = EDITION[edition];
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  masthead(s, edition, "CHARACTER", "details_character_name", "CHARACTER NAME", [
    ["details_build", "CLASS & LEVEL", 289, 196, 0],
    ["details_xp", "EXPERIENCE POINTS", 493, 87, 0],
    ["details_background", "BACKGROUND", 289, 92, 1],
    ["details_alignment", "ALIGNMENT", 389, 92, 1],
    ["details_deity", "DEITY", 489, 44, 1],
    ["details_player", "PLAYER", 541, 39, 1],
  ]);

  // Column A: the six ability shields on a grey backing panel. Readable, the
  // shields widen to the panel and every name takes the size the longest fits.
  s.panel(27, 230, 67, 440);
  const readableShieldWidth = 62;
  const readableCaptionSize = Math.min(7, ...ABILITIES.map(([, caption]) => (readableShieldWidth - 12) / MEASURE.display.widthOfTextAtSize(caption, 1)));
  ABILITIES.forEach(([key, caption], index) => {
    if (layout.readable) s.abilityShield("details", key, caption, 60.5, 662 - index * 71.5, { width: readableShieldWidth, captionSize: readableCaptionSize });
    else s.abilityShield("details", key, caption, 60.6, 662 - index * 71.5);
  });

  // Column B: proficiency bonus, saving throws, skills, passive perception, initiative.
  if (layout.top) {
    // Compact: proficiency bonus and initiative in two pills side by side.
    roundelPill(s, "details_proficiency_bonus", ["PROF.", "BONUS"], 96, 626, 51);
    roundelPill(s, "details_initiative", ["INIT."], 150, 626, 51);
    s.check("details_initiative_advantage", 158, 629.5, 5.5);
    s.label("ADV.", 165, 630.5, { size: 3.4, color: "lines" });
  } else {
    s.pill(96, 626, 105, 24);
    s.label("PROFICIENCY BONUS", 104, 636, { size: 4.4 });
    s.circle(184, 638, 10.5, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
    s.text("details_proficiency_bonus", 171, 631, 26, 14, { align: "center", size: 10, box: "none" });
  }
  // Readable, the saving throws keep their six rows and one notes line in a
  // shorter box, and the skills spread over the room that frees.
  const saves = layout.readable ? { y: 514, height: 106, name: 6.2 } : { y: 496, height: 124, name: 5.6 };
  s.section("SAVING THROWS", 96, saves.y, 105, saves.height);
  ABILITIES.forEach(([key], index) => {
    const y = 605.6 - index * 12;
    s.check(`details_${key}_save_proficiency`, 102, y, 6.7);
    s.text(`details_${key}_save_total`, 111, y - 1, 17, 9, { align: "center", size: 8 });
    s.note(ABILITY_NAME[key], 131, y + 1, { size: saves.name });
  });
  if (layout.readable) s.text("details_saving_throws", 100, 526, 97, 16, { multiline: true, size: 5.5, box: "none" });
  else s.text("details_saving_throws", 100, 504, 97, 34, { multiline: true, size: 5.5, box: "none" });
  const skills = layout.readable ? { height: 246, first: 494, pitch: 12.6, name: 5.8, ability: 4.6 } : { height: 228, first: 476.4, pitch: 11.2, name: 5.2, ability: 4.2 };
  s.section("SKILLS", 96, 262, 105, skills.height);
  SKILLS.forEach(([key, caption, ability], index) => {
    const y = skills.first - index * skills.pitch;
    s.check(`details_${key}_proficiency`, 101, y, 6);
    s.check(`details_${key}_expertise`, 108, y, 6);
    s.text(`details_${key}_total`, 115, y - 1, 15, 9, { align: "center", size: 8 });
    s.note(caption, 131, y + 0.5, { size: skills.name });
    s.note(`(${ability[0].toUpperCase()}${ability.slice(1)})`, 131 + s.textWidth(caption, "captionLight", skills.name) + 2, y + 0.5, { size: skills.ability, color: "lines" });
  });
  s.pill(96, 235, 105, 24);
  s.circle(108, 247, 10.5, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.text("details_passive_perception_total", 95, 240, 26, 14, { align: "center", size: 10, box: "none" });
  s.label("PASSIVE PERCEPTION", 122, 245, { size: 4.4 });
  // Initiative: the bonus in a roundel over its caption, the advantage
  // mark beside it, and the action summary on the right. Compact, initiative
  // sits by the proficiency bonus and the actions take the whole frame.
  s.frame(31, 194, 170, 34);
  if (layout.top) {
    s.text("details_encounter_box", 38, 206, 156, 10, { size: 7 });
    s.label("ACTIONS", 38, 217.5, { size: 3.8, color: "lines" });
  } else {
    s.circle(52, 214, 10.5, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
    s.text("details_initiative", 39, 207, 26, 14, { align: "center", size: 10, box: "none" });
    s.label("INITIATIVE", 40, 199, { size: 3.8, align: "center", width: 36 });
    s.check("details_initiative_advantage", 74, 210.5, 6.5);
    s.label("ADVANTAGE", 70, 203, { size: 3.4, color: "lines", align: "center", width: 26 });
    s.text("details_encounter_box", 104, 206, 92, 10, { size: 7 });
    s.label("ACTIONS", 104, 217.5, { size: 3.8, color: "lines" });
  }

  // Column C: armor, hit points, senses and racial traits.
  if (layout.readable) readableColumnC2014(s, style, layout);
  else {
    s.section("ARMOR CLASS", 213, 580, 182, 85);
    s.captioned("details_equipped_armor", "ARMOR", 224, 643.6, 123, 10, { size: 7 });
    s.captioned("details_equipped_shield", "SHIELD", 224, 621.6, 123, 10, { size: 7 });
    s.text("details_armor_conditional", 224, 589, 164, 30, { multiline: true, size: 6, box: "none" });
    s.check("details_armor_stealth_disadvantage", 306, 654.5, 6.5);
    s.label("STEALTH DISADV.", 270, 655.6, { size: 3.4, color: "lines" });
    s.shield("details_armor_class", "AC", 355, 674, 44, 48);
    hitPointBox(s, "details", 213, 492, 182, 86, { splitDice: layout.top });
    s.section("SPEED, SENSES & CONDITIONS", 213, 392, 182, 96);
    [["details_speed_walking", "SPEED", 224], ["details_speed_fly", "FLY", 267], ["details_speed_climb", "CLIMB", 310], ["details_speed_swim", "SWIM", 353]].forEach(([name, caption, x]) => {
      s.captioned(name, caption, x, 470, 35, 10, { align: "center", captionAlign: "center", size: 7 });
    });
    s.captioned("details_vision", "VISION", 224, 448, 66, 10, { size: 7 });
    s.captioned("details_inspiration", style.inspiration, 296, 448, 35, 10, { align: "center", captionAlign: "center", size: 7 });
    s.label("EXHAUSTION", 335, 460, { size: 3.4 });
    for (let i = 1; i <= 6; i++) s.check(`details_exhaustion_${i}`, 335 + (i - 1) * 9, 450, 6, { marker: "square" });
    s.text("details_resistances", 224, 404, 164, 38, { multiline: true, size: 6, box: "none" });
    s.block(style.traits, "details_additional_notes", 213, 196, 182, 188);
  }

  // Bottom: attacks and spellcasting across columns A–C. Readable, six rows
  // share the panel with a shorter free-text note.
  s.section("ATTACKS & SPELLCASTING", 29, 27, 366, 162);
  [["NAME", 34], ["RANGE", 173], ["ATTACK", 222], ["DAMAGE / TYPE", 273]].forEach(([caption, x]) => s.label(caption, x, 178, { size: layout.readable ? 4.6 : 3.8, color: "lines" }));
  const attackRows = layout.readable ? 6 : 4;
  const attackPitch = layout.readable ? 19.5 : 22;
  for (let row = 1; row <= attackRows; row += 1) {
    const y = 166.7 - (row - 1) * attackPitch;
    s.text(`details_attack${row}_weapon`, 34, y, 132, 10, { size: 7 });
    s.text(`details_attack${row}_range`, 173, y, 45, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_attack`, 222, y, 45, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_damage`, 273, y, 115, 10, { size: 7 });
    s.text(`details_attack${row}_description`, 34, y - 9.5, 354, 8, { size: 6, box: "none" });
  }
  if (layout.readable) s.text("details_attack_description", 34, 34, 355, 24, { multiline: true, size: 6, box: "none" });
  else s.text("details_attack_description", 34, 34, 355, 55, { multiline: true, size: 6, box: "none" });

  // Column D: features and proficiencies. Split, the features column holds
  // class features, subclass features and feats in boxes of their own.
  if (layout.split) {
    s.block("CLASS FEATURES", "details_features", 404, 410, 182, 255);
    s.block("SUBCLASS FEATURES", "details_subclass_features", 404, 262, 182, 140);
    s.block("FEATS", "details_feats", 404, 150, 182, 104);
  } else {
    s.block("FEATURES & TRAITS", "details_features", 404, 150, 182, 515);
  }
  s.block("PROFICIENCIES & LANGUAGES", "details_proficiencies_languages", 404, 27, 182, 115);
  return finish(doc, s);
}

// ---------------------------------------------------------------------------
// Character page, 2024 arrangement: each ability's saving throw and skills sit
// beneath its score; species traits, class features and weapons on the right.
// Every variant shares the body; `top` picks the top band (the compact one by
// default, or the classic header) and `readable` sets the small captions
// larger and the free-text attack note at 7pt.
// ---------------------------------------------------------------------------

/**
 * An ability panel, after D&D Beyond's 2024 block: the modifier in a roundel
 * with the score in a small box tucked behind its right side, then the saving
 * throw and the ability's skills. The score prints in the body face — the
 * writer gives a score smaller than its modifier the regular weight.
 *
 * Each row's contents centre between the rules above and below it: the save
 * sits between two full-width rules, each skill total over its own short
 * rule, every rule half a row below its row's middle.
 */
function abilityPanel2024(s, layout, key, caption, x, y, width, height, extra) {
  const readable = layout.readable;
  s.frame(x, y, width, height, { radius: 6 });
  const top = y + height;
  s.display(caption, x, top - 10.5, { size: 6, align: "center", width });
  s.ornamentRule(x + 8, x + width - 8, top - 13.5);
  const cx = x + width / 2 - 10;
  const cy = top - 29;
  const r = 13;
  // The score box first, so the roundel covers its left end.
  const boxRight = cx + r + 19;
  s.rounded(cx + 4, cy - 8, boxRight - cx - 4, 15, 3, { fill: WHITE, stroke: ACCENT, lineWidth: 0.8 });
  s.rounded(cx + 6, cy - 6, boxRight - cx - 8, 11, 2, { stroke: GOLD, lineWidth: 0.35 });
  s.circle(cx, cy, r, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.circle(cx, cy, r - 2.2, { stroke: GOLD, lineWidth: 0.35 });
  s.text(`details_${key}_modifier`, cx - r + 1, cy - 7, r * 2 - 2, 14, { align: "center", size: 12, box: "none" });
  s.text(`details_${key}_score`, cx + r, cy - 5.5, boxRight - 2 - (cx + r), 11, { align: "center", size: 9, box: "none" });
  s.label("MODIFIER", cx - 15, top - 47.5, { size: readable ? 4.4 : 3.6, align: "center", width: 30 });
  s.label("SCORE", cx + r, top - 44, { size: readable ? 4.2 : 3.4, align: "center", width: boxRight - 2 - (cx + r) });
  const pitch = 11;
  // A row's contents centre 2.5pt above its baseline; its rules sit half a pitch either side.
  let rowY = top - 59;
  const below = (baseline) => baseline + 2.5 - pitch / 2;
  s.rule(x + 5, below(rowY) + pitch, x + width - 5, below(rowY) + pitch, RULE, 0.4);
  s.check(`details_${key}_save_proficiency`, x + 5, rowY - 1.25, 6.5);
  s.text(`details_${key}_save_total`, x + 15, rowY - 2, 22, 9, { align: "center", size: 8, box: "none" });
  s.label("SAVING THROW", x + 41, rowY + (readable ? 0.2 : 0.5), { size: readable ? 5.4 : 4.6 });
  s.rule(x + 5, below(rowY), x + width - 5, below(rowY), RULE, 0.4);
  rowY -= pitch;
  for (const [skill, name] of SKILLS.filter(([, , ability]) => ability === key)) {
    s.check(`details_${skill}_proficiency`, x + 5, rowY - 1, 6);
    s.check(`details_${skill}_expertise`, x + 12.5, rowY - 1, 6);
    s.text(`details_${skill}_total`, x + 20, rowY - 2, 20, 9, { align: "center", size: 7.5, box: "none" });
    s.rule(x + 20, below(rowY), x + 40, below(rowY), RULE, 0.5);
    s.note(name, x + 43, rowY + 0.3, { size: Math.min(6.4, (width - 47) / s.textWidth(name, "captionLight", 1)) });
    rowY -= pitch;
  }
  if (extra) extra(rowY, x, width);
}

/** The 2024 and Hybrid pages' top band: the compact one, or with `top` off the classic header. */
function characterHeader2024(s, edition, style, layout) {
  if (layout.top) topBand2024(s, edition, layout);
  else classicHeader2024(s, edition, style, layout);
}

/**
 * The classic 2024 header, y 650..760: the identity with class and level on
 * one line, the armor in a frame right beside the AC shield (armor class is
 * read with the armor that gives it) and the hit points, over a row of large
 * vitals that holds the hit dice and death saves.
 */
function classicHeader2024(s, edition, style, layout) {
  const readable = layout.readable;
  pageChrome(s, "CHARACTER", edition);

  s.brush(26, 696, 322, 64);
  s.frame(26, 696, 322, 64);
  s.text("details_character_name", 32, 740, 240, 16, { size: 12 });
  s.label("CHARACTER NAME", 32, 733.5, { size: readable ? 5 : 4.2 });
  s.entry("details_player", "PLAYER", 280, 741, 62, 11, { captionSize: readable ? 5 : 4.2 });
  s.entry("details_build", "CLASS & LEVEL", 32, 719, 310, 11, { captionSize: readable ? 5 : 4.2 });
  const captionSize = readable ? 4.4 : 3.4;
  [["details_background", style.origin, 32, 110], ["details_alignment", "ALIGNMENT", 148, 76], ["details_deity", "DEITY", 230, 58], ["details_xp", "XP", 294, 48]].forEach(([name, caption, x, width]) => {
    const captionWidth = s.textWidth(caption, "caption", captionSize) + 4;
    s.label(caption, x, 702.5, { size: captionSize, color: "lines" });
    s.text(name, x + captionWidth, 702, width - captionWidth, 8, { size: 6 });
  });

  armorBeside2024(s, layout, 354, 696, 76, 64);
  s.shield("details_armor_class", "ARMOR CLASS", 436, 762, 46, 46, { captionSize: readable ? 4.2 : 3.8 });
  s.text("details_equipped_shield", 436, 705, 46, 9, { align: "center", size: 5, box: "none" });
  s.label("SHIELD", 436, 699, { size: 5, align: "center", width: 46 });

  const hp = s.section("HIT POINTS", 488, 700, 98, 60, { style: "plate", at: "top", size: 5.8 });
  const hpCaption = readable ? 4.8 : 3.8;
  s.text("details_hp_current", hp.x + 2, hp.y + 8, 44, 26, { align: "center", size: 20, box: "none" });
  s.rounded(hp.x + 2, hp.y + 8, 44, 26, 3, { stroke: GOLD, lineWidth: 0.4 });
  s.label("CURRENT", hp.x + 2, hp.y + 2, { size: hpCaption, align: "center", width: 44 });
  s.label("TEMP", hp.x + 50, hp.y + 24, { size: hpCaption, color: "lines" });
  s.text("details_hp_temp", hp.x + 62, hp.y + 22, 26, 11, { align: "center", size: 8 });
  s.label("MAX", hp.x + 50, hp.y + 8, { size: hpCaption, color: "lines" });
  s.text("details_hp_max", hp.x + 62, hp.y + 6, 26, 11, { align: "center", size: 8 });

  vitalsRow2024(s, layout);
}

/**
 * The classic header's armor frame, right beside the AC shield: the armor
 * worn, the stealth mark on a line of its own beneath it (ending the line,
 * nearest the shield, its caption right-aligned against it in whichever face
 * is chosen), then any other armor class sources over the resistances.
 */
function armorBeside2024(s, layout, x, y, width, height) {
  const top = y + height;
  s.frame(x, y, width, height);
  s.label("ARMOR", x + 5, top - 10, { size: layout.readable ? 5 : 4.2, color: "lines" });
  s.text("details_equipped_armor", x + 5, top - 23, width - 10, 9, { size: 6.5 });
  const checkX = x + width - 5 - 5.5;
  s.check("details_armor_stealth_disadvantage", checkX, top - 31.5, 5.5);
  s.label("STEALTH DISADV.", x + 5, top - 30.5, { size: 5, color: "lines", align: "right", width: checkX - 2 - (x + 5) });
  s.text("details_armor_resistances", x + 4, y + 4, width - 8, height - 38, { multiline: true, size: 6, box: "none" });
}

/** The classic header's row of large vitals, y 650..692: proficiency to heroic inspiration. */
function vitalsRow2024(s, layout) {
  const readable = layout.readable;
  const vitalY = 650;
  const vitalH = 42;
  const vitalW = 76;
  const vitalX = (index) => 26 + index * 82;
  const caption = readable ? 5 : 4.4;
  const stat = (name, label, index) => {
    s.frame(vitalX(index), vitalY, vitalW, vitalH);
    s.text(name, vitalX(index) + 3, vitalY + 12, vitalW - 6, 26, { align: "center", size: 18, box: "none" });
    s.label(label, vitalX(index), vitalY + 4.5, { size: Math.min(caption, (vitalW - 8) / s.textWidth(label, "caption", 1)), align: "center", width: vitalW });
  };
  stat("details_proficiency_bonus", "PROFICIENCY BONUS", 0);
  stat("details_initiative", "INITIATIVE", 1);
  s.check("details_initiative_advantage", vitalX(1) + 6, vitalY + 30, 6);
  s.label("ADV", vitalX(1) + 14, vitalY + 31.2, { size: readable ? 4.4 : 3.6 });
  s.frame(vitalX(2), vitalY, vitalW, vitalH);
  s.text("details_speed_walking", vitalX(2) + 3, vitalY + 15, 38, 20, { align: "center", size: 14, box: "none" });
  s.label("SPEED", vitalX(2) + 3, vitalY + 5, { size: caption, align: "center", width: 38 });
  s.rule(vitalX(2) + 43, vitalY + 6, vitalX(2) + 43, vitalY + vitalH - 6, GOLD, 0.4);
  [["details_speed_fly", "FLY"], ["details_speed_climb", "CLIMB"], ["details_speed_swim", "SWIM"]].forEach(([name, label], index) => {
    const y = vitalY + 27 - index * 9.5;
    s.label(label, vitalX(2) + 46, y + 1.5, { size: 3.4, color: "lines" });
    s.text(name, vitalX(2) + 58, y, 14, 8, { align: "center", size: 5.5 });
  });
  stat("details_hd", "HIT DICE", 3);
  s.frame(vitalX(4), vitalY, vitalW, vitalH);
  s.label("SUCCESSES", vitalX(4) + 6, vitalY + 27, { size: 3.4, color: "lines" });
  s.label("FAILURES", vitalX(4) + 6, vitalY + 17, { size: 3.4, color: "lines" });
  for (let index = 1; index <= 3; index += 1) {
    s.check(`details_death_save_success_${index}`, vitalX(4) + 36 + (index - 1) * 11, vitalY + 25, 7);
    s.check(`details_death_save_fail_${index}`, vitalX(4) + 36 + (index - 1) * 11, vitalY + 15, 7);
  }
  s.label("DEATH SAVES", vitalX(4), vitalY + 4.5, { size: caption, align: "center", width: vitalW });
  stat("details_passive_perception_total", "PASSIVE PERCEPTION", 5);
  const inspirationW = 586 - vitalX(6);
  s.frame(vitalX(6), vitalY, inspirationW, vitalH);
  s.diamond(vitalX(6) + inspirationW / 2, vitalY + 25, 9, GOLD);
  s.diamond(vitalX(6) + inspirationW / 2, vitalY + 25, 7.2, WHITE);
  s.text("details_inspiration", vitalX(6) + inspirationW / 2 - 14, vitalY + 19, 28, 12, { align: "center", size: 11, box: "none" });
  s.label("HEROIC INSPIRATION", vitalX(6), vitalY + 4.5, { size: Math.min(caption, (inspirationW - 8) / s.textWidth("HEROIC INSPIRATION", "caption", 1)), align: "center", width: inspirationW });
}

/**
 * The compact top band, x 26..586 and y 650..760, the 2024 and Hybrid pages'
 * default: the identity at the left; to its right the defences a reader
 * checks first — armor class in a box with the armor, the shield and stealth
 * marks and the resistances — then hit points and hit dice, over a row of
 * compact vitals that ends with the death saves and heroic inspiration. Both
 * halves share the band's top and bottom.
 */
function topBand2024(s, edition, layout) {
  const readable = layout.readable;
  pageChrome(s, "CHARACTER", edition);
  const bandY = 650;
  const bandTop = 760;

  // Identity, x 26..268, each a labelled field of its own.
  const captionSize = readable ? 5 : 4.2;
  s.brush(26, bandY, 242, bandTop - bandY);
  s.frame(26, bandY, 242, bandTop - bandY);
  s.text("details_character_name", 32, 738, 168, 16, { size: 12 });
  s.label("CHARACTER NAME", 32, 731.5, { size: captionSize });
  s.entry("details_player", "PLAYER", 206, 739, 56, 11, { captionSize });
  // One line; a long multiclass shrinks to fit, and wraps only past the floor.
  s.entry("details_class", "CLASS", 32, 716, 182, 11, { size: 7, captionSize });
  s.entry("details_level", "LEVEL", 220, 716, 42, 11, { align: "center", size: 10, captionAlign: "center", captionSize });
  s.entry("details_species", "SPECIES", 32, 692, 80, 10, { size: 7, captionSize });
  s.entry("details_background", "BACKGROUND", 118, 692, 96, 10, { size: 7, captionSize });
  s.entry("details_xp", "XP", 220, 692, 42, 10, { align: "center", size: 7, captionAlign: "center", captionSize });
  s.entry("details_alignment", "ALIGNMENT", 32, 668, 106, 10, { size: 7, captionSize });
  s.entry("details_deity", "DEITY", 144, 668, 118, 10, { size: 7, captionSize });

  // The top row, x 274..586: armor and resistances, hit points, hit dice.
  const rowY = 696;
  const rowH = bandTop - rowY;
  const ax = 274;
  const aw = 144;
  s.frame(ax, rowY, aw, rowH);
  // The shield stands over the box's left edge, its top on the frame's.
  s.shield("details_armor_class", "ARMOR CLASS", ax, bandTop, 44, 60, { captionSize: readable ? 4.2 : 3.6 });
  const tx = ax + 49;
  const tw = ax + aw - 6 - tx;
  const title = "ARMOR & RESISTANCES";
  s.display(title, tx, bandTop - 10.5, { size: Math.min(5.6, (tw - 4) / s.textWidth(title, "display", 1)), align: "center", width: tw });
  s.ornamentRule(tx, tx + tw, bandTop - 14);
  s.text("details_equipped_armor", tx, bandTop - 25, tw, 9, { size: 6.5 });
  // Other armor class sources over the resistances: three 6pt lines.
  s.text("details_armor_resistances", tx, rowY + 11, tw, bandTop - 28 - rowY - 11, { multiline: true, size: 6, box: "none" });
  // 5pt fits both ticks' captions in the widest caption face.
  const tickSize = 5;
  s.check("details_shield_equipped", tx, rowY + 4, 6);
  s.label("SHIELD", tx + 8, rowY + 5.3, { size: tickSize });
  const stealthX = tx + 12 + s.textWidth("SHIELD", "caption", tickSize);
  s.check("details_armor_stealth_disadvantage", stealthX, rowY + 4, 6);
  s.label("STEALTH DISADV.", stealthX + 8, rowY + 5.3, { size: tickSize });

  const hpCaption = readable ? 4.8 : 3.8;
  const hp = plateSection(s, "HIT POINTS", 424, rowY, 110, rowH);
  s.text("details_hp_current", hp.x + 2, hp.y + 8, 50, 26, { align: "center", size: 20, box: "none" });
  s.rounded(hp.x + 2, hp.y + 8, 50, 26, 3, { stroke: GOLD, lineWidth: 0.4 });
  s.label("CURRENT", hp.x + 2, hp.y + 1.5, { size: hpCaption, align: "center", width: 50 });
  s.label("TEMP", hp.x + 56, hp.y + 26, { size: hpCaption, color: "lines" });
  s.text("details_hp_temp", hp.x + 70, hp.y + 24, 30, 11, { align: "center", size: 8 });
  s.label("MAX", hp.x + 56, hp.y + 10, { size: hpCaption, color: "lines" });
  s.text("details_hp_max", hp.x + 70, hp.y + 8, 30, 11, { align: "center", size: 8 });

  const dice = plateSection(s, "HIT DICE", 540, rowY, 46, rowH);
  s.text("details_hd", dice.x, 725, dice.width, 18, { align: "center", size: 14, box: "none" });
  s.label("MAX", dice.x, 719.5, { size: hpCaption, align: "center", width: dice.width });
  s.text("details_hd_spent", dice.x + 4, 707, dice.width - 8, 10, { align: "center", size: 8 });
  s.label("SPENT", dice.x, 699.5, { size: hpCaption, align: "center", width: dice.width });

  // The vitals, x 274..586.
  const vitalY = bandY;
  const vitalH = 42;
  const statCaption = readable ? 4.2 : 3.6;
  compactStat(s, "details_proficiency_bonus", ["PROFICIENCY", "BONUS"], 274, vitalY, 40, vitalH, statCaption);
  compactStat(s, "details_initiative", ["INITIATIVE"], 318, vitalY, 40, vitalH, statCaption);
  s.check("details_initiative_advantage", 323, vitalY + vitalH - 10, 5.5);
  s.label("ADV", 330, vitalY + vitalH - 9, { size: readable ? 4 : 3.2 });
  compactStat(s, "details_passive_perception_total", ["PASSIVE", "PERCEPTION"], 362, vitalY, 40, vitalH, statCaption);

  // Speed: walking large on the left, a labelled line for each other mode on the right.
  const speedX = 406;
  const speedW = 80;
  s.frame(speedX, vitalY, speedW, vitalH);
  s.text("details_speed_walking", speedX + 3, vitalY + 14, 41, 20, { align: "center", size: 16, box: "none" });
  s.label("SPEED", speedX + 3, vitalY + 5, { size: readable ? 5 : 4.2, align: "center", width: 41 });
  s.rule(speedX + 46, vitalY + 6, speedX + 46, vitalY + vitalH - 6, GOLD, 0.4);
  const modeCaption = readable ? 4 : 3.4;
  const modeX = speedX + 50 + s.textWidth("CLIMB", "caption", modeCaption);
  [["details_speed_fly", "FLY"], ["details_speed_climb", "CLIMB"], ["details_speed_swim", "SWIM"]].forEach(([name, caption], index) => {
    const y = vitalY + 28 - index * 10.5;
    s.label(caption, speedX + 49, y + 1.5, { size: modeCaption, color: "lines" });
    s.text(name, modeX, y, speedX + speedW - 4 - modeX, 9, { align: "center", size: 6 });
  });

  const savesX = 490;
  const savesW = 54;
  s.frame(savesX, vitalY, savesW, vitalH);
  s.label("SUCCESSES", savesX + 5, vitalY + 28, { size: 3.2, color: "lines" });
  s.label("FAILURES", savesX + 5, vitalY + 18, { size: 3.2, color: "lines" });
  for (let index = 1; index <= 3; index += 1) {
    s.check(`details_death_save_success_${index}`, savesX + 27 + (index - 1) * 7.5, vitalY + 26.5, 6);
    s.check(`details_death_save_fail_${index}`, savesX + 27 + (index - 1) * 7.5, vitalY + 16.5, 6);
  }
  s.label("DEATH SAVES", savesX, vitalY + 5, { size: readable ? 4.8 : 4, align: "center", width: savesW });

  const inspirationX = 548;
  const inspirationW = 586 - inspirationX;
  s.frame(inspirationX, vitalY, inspirationW, vitalH);
  s.diamond(inspirationX + inspirationW / 2, vitalY + 26, 9, GOLD);
  s.diamond(inspirationX + inspirationW / 2, vitalY + 26, 7.2, WHITE);
  s.text("details_inspiration", inspirationX + inspirationW / 2 - 14, vitalY + 20, 28, 12, { align: "center", size: 11, box: "none" });
  const inspirationCaption = Math.min(statCaption, (inspirationW - 10) / s.textWidth("INSPIRATION", "caption", 1));
  s.label("HEROIC", inspirationX, vitalY + 4.2 + statCaption + 0.8, { size: inspirationCaption, align: "center", width: inspirationW });
  s.label("INSPIRATION", inspirationX, vitalY + 4.2, { size: inspirationCaption, align: "center", width: inspirationW });
}

/**
 * The 2024 and Hybrid pages' right-hand column from x `areaX`: the species
 * traits at the top, the features beneath, and five rows of weapons and
 * damage cantrips along the foot. The features take every point the other
 * two leave; split, they stay one box, and the writer heads its class,
 * subclass and feat groups inside it.
 */
function rightColumn2024(s, style, layout, areaX, areaW, columns, captionSize, featuresTitle) {
  s.block(style.traits, "details_additional_notes", areaX, 557, areaW, 642 - 557);
  const weaponsTop = 218;
  s.section("WEAPONS & DAMAGE CANTRIPS", areaX, 60, areaW, weaponsTop - 60);
  columns.forEach(([caption, x]) => s.label(caption, x, weaponsTop - 25, { size: captionSize, color: "lines" }));
  for (let row = 1; row <= 5; row += 1) {
    const y = weaponsTop - 36 - (row - 1) * 21;
    const [[, nx, nw], [, rx, rw], [, ax, aw], [, dx, dw], [, ox, ow]] = columns;
    s.text(`details_attack${row}_weapon`, nx, y, nw, 10, { size: 7 });
    s.text(`details_attack${row}_range`, rx, y, rw, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_attack`, ax, y, aw, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_damage`, dx, y, dw, 10, { size: 7 });
    // Match the first baseline to the adjacent values; overflow continues in the writer.
    s.text(`details_attack${row}_description`, ox, y - 10.1, ow, 21, { multiline: true, size: 6, box: "none" });
  }
  // The attacks without a row and the user's own notes, under the last row's notes cell.
  s.text("details_attack_description", areaX + 4, 64, areaW - 8, 22, { multiline: true, size: layout.readable ? 7 : 6, box: "none" });
  // Split, the box's title must not repeat the writer's first heading, "Class Features".
  s.block(layout.split ? "FEATURES" : featuresTitle, "details_features", areaX, weaponsTop + 8, areaW, 557 - 8 - weaponsTop - 8);
}

/** A compact framed stat: a large value over a one- or two-line caption. */
function compactStat(s, name, lines, x, y, width, height, captionSize = 3.6) {
  s.frame(x, y, width, height);
  s.text(name, x + 3, y + 13, width - 6, height - 17, { align: "center", size: 16, box: "none" });
  lines.forEach((line, index) => {
    const size = Math.min(captionSize, (width - 7) / s.textWidth(line, "caption", 1));
    s.label(line, x, lines.length === 1 ? y + 5 : y + 4.2 + (lines.length - 1 - index) * (captionSize + 0.8), { size, align: "center", width });
  });
}

/** A section with its title on a plate at the top, the title shrunk to suit a narrow box. */
function plateSection(s, title, x, y, width, height) {
  const size = Math.min(5.8, (width - 14) / s.textWidth(title, "display", 1));
  return s.section(title, x, y, width, height, { style: "plate", at: "top", size });
}

/** The conditions box: conditions over the exhaustion marks. */
function conditions2024(s, layout, x, y, width, height) {
  const title = "CONDITIONS & EXHAUSTION";
  const inner = s.section(title, x, y, width, height, { size: Math.min(5.6, (width - 14) / s.textWidth(title, "display", 1)) });
  const pitch = Math.min(16, (inner.width - 6) / 6);
  s.label("EXHAUSTION", inner.x + 2, inner.y + 12, { size: layout.readable ? 5.5 : 4.6, color: "lines" });
  for (let i = 1; i <= 6; i++) s.check(`details_exhaustion_${i}`, inner.x + 2 + (i - 1) * pitch, inner.y + 2, 7, { marker: "square" });
  s.text("details_conditions", inner.x, inner.y + 19, inner.width, inner.height - 19, { multiline: true, size: 6, box: "none" });
}

async function details2024(edition, layout = SHEET_LAYOUT_DEFAULTS[edition]) {
  const style = EDITION[edition];
  const readable = layout.readable;
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  characterHeader2024(s, edition, style, layout);

  // Two columns of ability panels on a grey backing panel, conditions and
  // exhaustion under the shorter one.
  const panelW = 114;
  const heights = { str: 79, dex: 101, con: 89, int: 123, wis: 123, cha: 112 };
  const columnTop = 642;
  const columnDepth = Math.max(heights.str + heights.dex + heights.con, heights.int + heights.wis + heights.cha) + 16;
  s.panel(22, columnTop - columnDepth - 4, 244, columnDepth + 8);
  let top = columnTop;
  for (const key of ["str", "dex", "con"]) {
    abilityPanel2024(s, layout, key, ABILITY_NAME[key].toUpperCase(), 26, top - heights[key], panelW, heights[key], key === "con" ? (rowY, x, width) => {
      s.label("SAVING THROW NOTES", x + 5, rowY + 1, { size: readable ? 5 : 4.2, color: "lines" });
      s.text("details_saving_throws", x + 5, rowY - 7, width - 10, 9, { size: 6, box: "none" });
    } : undefined);
    top -= heights[key] + 8;
  }
  const leftBottom = top + 8;
  top = columnTop;
  for (const key of ["int", "wis", "cha"]) {
    abilityPanel2024(s, layout, key, ABILITY_NAME[key].toUpperCase(), 148, top - heights[key], panelW, heights[key]);
    top -= heights[key] + 8;
  }
  const rightBottom = top + 8;
  conditions2024(s, layout, 26, rightBottom, panelW, leftBottom - 8 - rightBottom);

  // Under both columns: training and languages, then senses.
  s.block("PROFICIENCIES, TRAINING & LANGUAGES", "details_proficiencies_languages", 26, 144, 236, rightBottom - 8 - 144, { padTop: 4 });
  const inner = s.section("SENSES", 26, 60, 236, 76, { size: 5.6 });
  s.label("VISION", inner.x + 3, inner.y + inner.height - 8, { size: readable ? 5.5 : 4.6, color: "lines" });
  s.text("details_vision", inner.x + 30, inner.y + inner.height - 10, inner.width - 33, 10, { size: 7 });

  rightColumn2024(s, style, layout, 270, 316,
    [["NAME", 274, 68], ["RANGE", 344, 28], ["ATK / DC", 374, 34], ["DAMAGE & TYPE", 410, 64], ["NOTES", 476, 106]], readable ? 5 : 3.8, "CLASS FEATURES");
  return finish(doc, s);
}

// ---------------------------------------------------------------------------
// Character page, 2024 Hybrid arrangement: the 2024 page with the classic
// ability column — six shields, then saving throws and an alphabetical skills
// list — in place of the per-ability panels. The width that frees widens the
// species traits, features and weapons; the senses join the proficiencies.
// ---------------------------------------------------------------------------

/**
 * The Hybrid page's classic ability column: six shields, each with its
 * modifier large and the score in the roundel, then saving throws over the
 * skills list, from y 642 down to 268. Every row's contents centre between
 * its rule and the one above.
 */
function hybridAbilityColumns(s, layout) {
  // Column A: the six ability shields on a grey backing panel.
  const columnTop = 642;
  const columnBottom = 268;
  const shieldH = 56;
  const shieldPitch = (columnTop - 2 - shieldH - columnBottom - 4) / 5;
  s.panel(23, columnBottom - 6, 68, columnTop - columnBottom + 8);
  ABILITIES.forEach(([key, caption], index) => {
    // The brow takes the name at up to 5.6pt, the 2024 panels' size.
    const captionSize = Math.min(5.6, 48 / MEASURE.display.widthOfTextAtSize(caption, 1));
    s.abilityShield("details", key, caption, 57, columnTop - 2 - index * shieldPitch, { width: 58, height: shieldH, captionSize, large: "modifier" });
  });

  // Column B: saving throws, with their notes, over the skills list.
  const bx = 96;
  const bw = 126;
  const savesBottom = 518;
  const saves = s.section("SAVING THROWS", bx, savesBottom, bw, columnTop - savesBottom);
  const savePitch = 11.5;
  ABILITIES.forEach(([key], index) => {
    const y = columnTop - 32 - index * savePitch;
    s.check(`details_${key}_save_proficiency`, bx + 6, y, 6.5);
    s.text(`details_${key}_save_total`, bx + 16, y - 1, 20, 9, { align: "center", size: 8, box: "none" });
    s.rule(bx + 16, y + 3.5 - savePitch / 2, bx + 36, y + 3.5 - savePitch / 2, RULE, 0.5);
    s.note(ABILITY_NAME[key], bx + 40, y + 1, { size: 6.5 });
  });
  s.label("SAVING THROW NOTES", saves.x + 2, savesBottom + 17, { size: layout.readable ? 5.5 : 4.6, color: "lines" });
  s.text("details_saving_throws", saves.x + 2, saves.y, saves.width - 4, 12, { multiline: true, size: 6, box: "none" });
  const skillsTop = savesBottom - 6;
  s.section("SKILLS", bx, columnBottom, bw, skillsTop - columnBottom);
  const skillPitch = (skillsTop - 28 - (columnBottom + 9)) / (SKILLS.length - 1);
  SKILLS.forEach(([key, caption, ability], index) => {
    const y = skillsTop - 28 - index * skillPitch;
    s.check(`details_${key}_proficiency`, bx + 5, y, 6);
    s.check(`details_${key}_expertise`, bx + 12.5, y, 6);
    s.text(`details_${key}_total`, bx + 20, y - 1.5, 18, 9, { align: "center", size: 7, box: "none" });
    s.rule(bx + 20, y + 3 - skillPitch / 2, bx + 38, y + 3 - skillPitch / 2, RULE, 0.5);
    s.note(caption, bx + 41, y + 0.5, { size: 6.2 });
    s.note(`(${ability[0].toUpperCase()}${ability.slice(1)})`, bx + 41 + s.textWidth(caption, "captionLight", 6.2) + 2, y + 0.5, { size: 5, color: "lines" });
  });
}

async function detailsHybrid(edition, layout = SHEET_LAYOUT_DEFAULTS[edition]) {
  const style = EDITION[edition];
  const readable = layout.readable;
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  characterHeader2024(s, edition, style, layout);
  hybridAbilityColumns(s, layout);

  // Beneath both columns: training, languages and senses, then conditions.
  const lw = 196;
  const title = "PROFICIENCIES, TRAINING, LANGUAGES & SENSES";
  const inner = s.section(title, 26, 144, lw, 116, { size: Math.min(6.2, (lw - 14) / s.textWidth(title, "display", 1)) });
  s.text("details_proficiencies_languages", inner.x, inner.y + 17, inner.width, inner.height - 21, { multiline: true, size: 6, box: "none" });
  s.label("SENSES", inner.x + 3, inner.y + 6, { size: readable ? 5.5 : 4.6, color: "lines" });
  s.text("details_vision", inner.x + 30, inner.y + 4, inner.width - 33, 10, { size: 7 });
  conditions2024(s, layout, 26, 60, lw, 76);

  rightColumn2024(s, style, layout, 230, 356,
    [["NAME", 234, 82], ["RANGE", 318, 32], ["ATK / DC", 352, 36], ["DAMAGE & TYPE", 390, 72], ["NOTES", 464, 118]], readable ? 5.5 : 5, "FEATURES");
  return finish(doc, s);
}

// ---------------------------------------------------------------------------
// Background, companion, inventory and spellcasting pages, shared by every set.
// ---------------------------------------------------------------------------

async function backgroundTemplate(edition) {
  const style = EDITION[edition];
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  masthead(s, edition, edition !== "2014" ? "APPEARANCE" : "BACKGROUND", "background_character_name", "CHARACTER NAME", [
    ["background_age", "AGE", 289, 66, 0],
    ["background_height", "HEIGHT", 363, 72, 0],
    ["background_weight", "WEIGHT", 443, 72, 0],
    ["background_gender", "GENDER", 523, 57, 0],
    ["background_eyes", "EYES", 289, 66, 1],
    ["background_skin", "SKIN", 363, 72, 1],
    ["background_hair", "HAIR", 443, 137, 1],
  ]);
  s.section("CHARACTER PORTRAIT", 27, 477, 182, 188, { style: "caption" });
  s.image("background_portrait_image", 32, 486, 171, 174);
  s.section("ALLIES & ORGANIZATIONS", 214, 477, 372, 188, { style: "caption" });
  s.text("background_allies", 223, 486, 182, 175, { multiline: true, size: 6.5, box: "none" });
  s.frame(416, 496, 152, 148);
  s.captioned("background_organization_name", "NAME", 425, 617, 135, 14, { size: 8 });
  s.label("SYMBOL", 416, 502, { size: 3.8, color: "lines", align: "center", width: 152 });
  [["background_traits", "PERSONALITY TRAITS", 380, 73], ["background_ideals", "IDEAL", 327, 46], ["background_bonds", "BOND", 270, 47], ["background_flaws", "FLAW", 215, 46]].forEach(([name, caption, y, height]) => {
    s.block(caption, name, 27, y, 182, height, { size: 6.5, style: "caption" });
  });
  s.section("BACKGROUND FEATURE", 27, 88, 182, 118, { style: "caption" });
  s.text("background_feature_name", 45, 183.5, 144, 13, { size: 8, align: "center", box: "none" });
  s.text("background_feature", 42, 96, 151, 84, { multiline: true, size: 6.5, box: "none" });
  s.block("TRINKET", "background_trinket", 27, 34, 182, 46, { size: 6.5, style: "caption" });
  s.section(edition !== "2014" ? "BACKSTORY & PERSONALITY" : "BACKGROUND STORY", 214, 215, 372, 250, { style: "caption" });
  s.text("background_story", 224, 222, 354, 240, { multiline: true, size: 6.5, box: "none" });
  s.section("ADDITIONAL FEATURES", 214, 27, 372, 180, { style: "caption" });
  s.text("background_additional_features", 222, 35, 358, 162, { multiline: true, size: 6.5, box: "none" });
  return finish(doc, s);
}

async function companionTemplate(edition) {
  const style = EDITION[edition];
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  masthead(s, edition, "COMPANION", "companion_name", "COMPANION NAME", [
    ["companion_kind", "CREATURE", 289, 196, 0],
    ["companion_challenge", "CHALLENGE", 493, 87, 0],
    ["companion_build", "SIZE, TYPE & ALIGNMENT", 289, 196, 1],
    ["companion_owner", "GRANTED BY", 493, 87, 1],
  ]);

  // The creature panel: portrait over two rows of ability shields.
  s.panel(27, 392, 182, 273);
  s.section("PORTRAIT", 55, 538, 126, 126, { style: "caption" });
  s.image("companion_portrait_image", 62, 551, 112, 104);
  ABILITIES.forEach(([key, caption], index) => {
    const cx = 57 + (index % 3) * 59.3;
    s.abilityShield("companion", key, caption, cx, index < 3 ? 532 : 465, { width: 52, height: 62 });
  });

  // Vitals across the top of the two right-hand columns, then the creature's
  // senses under its portrait and its traits filling the rest of the page.
  hitPointBox(s, "companion", 214, 582, 180, 83);
  s.section("VITALS", 404, 582, 182, 83, { style: "caption" });
  s.captioned("companion_proficiency", "PROFICIENCY", 414, 636, 48, 14, { align: "center", captionAlign: "center", size: 12 });
  s.captioned("companion_initiative", "INITIATIVE", 468, 636, 48, 14, { align: "center", captionAlign: "center", size: 12 });
  s.shield("companion_armor_class", "AC", 534, 664, 42, 44, { size: 12 });
  s.captioned("companion_speed", "SPEED", 414, 606, 102, 12, { size: 9 });
  s.section("SENSES, SKILLS & DEFENCES", 27, 27, 182, 357, { style: "caption" });
  s.text("companion_stats", 34, 42, 168, 320, { multiline: true, size: 6.5, box: "none" });
  s.section("TRAITS & ACTIONS", 214, 27, 372, 545, { style: "caption" });
  s.text("companion_features", 222, 42, 356, 508, { multiline: true, size: 6.5, box: "none" });
  return finish(doc, s);
}

async function equipmentTemplate(edition) {
  const style = EDITION[edition];
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  // The inventory tables run to the top of the page, so this one keeps the
  // slim title line rather than the masthead.
  pageChrome(s, "INVENTORY", edition);
  const ROW = 10;
  // A two-column item table: name, then quantity and weight in narrow cells.
  const table = (prefix, title, x, top, rows, { nameWidth = 148, cell = 12 } = {}) => {
    s.label(title, x, top + 3, { size: 3.8, color: "lines" });
    s.label("#", x + nameWidth + 4, top + 3, { size: 3.8, color: "lines" });
    s.label("lb", x + nameWidth + cell + 3, top + 3, { size: 3.8, color: "lines" });
    for (let row = 0; row < rows; row += 1) {
      const y = top - (row + 1) * ROW;
      s.text(`${prefix}_name.${row}`, x, y, nameWidth, ROW, { size: 7, box: "none" });
      s.text(`${prefix}_count.${row}`, x + nameWidth + 1, y, cell, ROW, { size: 7, align: "right", box: "none" });
      s.text(`${prefix}_weight.${row}`, x + nameWidth + cell + 1, y, cell, ROW, { size: 7, align: "right", box: "none" });
      s.rule(x, y, x + nameWidth + cell * 2 + 2, y, RULE, 0.3);
    }
    return top - rows * ROW;
  };
  s.section("INVENTORY — ADVENTURING GEAR, ARMS, ARMOR & OTHER EQUIPMENT", 27, 332, 367, 429, { style: "caption" });
  table("equipment_page_gear", "ADVENTURING GEAR", 35, 751, 40);
  table("equipment_page_magic_gear", "MAGIC ITEMS", 215, 751, 20);
  s.label("ATTUNED MAGIC ITEMS", 246, 537, { size: 3.8, color: "lines" });
  s.text("equipment_page_attunement_current", 324, 534, 27, 12, { size: 8, align: "center", box: "frame" });
  s.note("/", 353, 536.5, { size: 8 });
  s.text("equipment_page_attunement_max", 360, 534, 27, 12, { size: 8, align: "center", box: "frame" });
  table("equipment_page_valuable", "VALUABLES — GEMS, ART OBJECTS, TRADE GOODS", 216, 521, 10);
  [["cp", "COPPER"], ["sp", "SILVER"], ["ep", "ELECTRUM"], ["gp", "GOLD"], ["pp", "PLATINUM"]].forEach(([coin, caption], index) => {
    const x = 216 + index * 36;
    s.label(caption, x, 410, { size: 3.6, color: "lines", align: "center", width: 27 });
    s.text(`equipment_page_coins_${coin}`, x, 395, 27, 12, { size: 8, align: "center", box: "frame" });
  });
  s.label("ENCUMBRANCE — LIFTING AND CARRYING", 216, 377, { size: 3.8, color: "lines" });
  s.ornamentRule(216 + s.textWidth("ENCUMBRANCE — LIFTING AND CARRYING", "caption", 3.8) + 4, 387, 378.5);
  [["equipment_page_weight_carried", "WEIGHT CARRIED", 216], ["equipment_page_weight_capacity", "CARRY CAPACITY", 270], ["equipment_page_weight_drag", "PUSH, DRAG, LIFT", 342]].forEach(([name, caption, x]) => {
    s.label(caption, x, 366, { size: 3.6, color: "lines", align: "center", width: 45 });
    s.text(name, x, 351, 45, 12.8, { size: 8, align: "center", box: "frame" });
  });
  s.note("/", 263.5, 354, { size: 8 });
  s.block("ADDITIONAL TREASURE", "equipment_page_additional_treasure", 27, 180, 367, 143, { size: 6.5, style: "caption" });
  s.section("STORED ITEMS", 27, 27, 367, 146, { style: "caption" });
  for (let vehicle = 1; vehicle <= 2; vehicle += 1) {
    const x = vehicle === 1 ? 36 : 216;
    s.text(`equipment_page_vehicle_${vehicle}_name`, x, 149, 171, 13.5, { size: 8, align: "center", box: "frame" });
    table(`equipment_page_vehicle_${vehicle}_cargo`, "STORED ITEM", x - 1, 139, 10);
  }
  const notes = C.equipmentNotes;
  s.section("INVENTORY — ITEM DESCRIPTIONS & NOTES", notes.x - 6, notes.y - 7, notes.width + 12, notes.height + 12, { style: "caption" });
  s.text("equipment_page_magic_items", notes.x, notes.y, notes.width, notes.height, { multiline: true, size: 6.5, box: "none" });
  s.block("QUEST ITEMS & TRINKETS", "equipment_page_quest_items", 404, 27, 182, 146, { size: 6.5, style: "caption" });
  return finish(doc, s);
}

async function spellHeaderTemplate(edition) {
  const style = EDITION[edition];
  const H = C.spellHeader;
  const { doc, sheet: s } = await newDocument(C.pageWidth, H.height, style);
  // The title rule runs the page width; the class banner and stat boxes share one line beneath it.
  s.display("SPELLCASTING", 30, H.height - 14, { size: 7.5 });
  s.ornamentRule(30 + s.textWidth("SPELLCASTING", "display", 7.5) + 8, 582, H.height - 11.5, ACCENT);
  s.frame(30, H.bannerMiddle - 14, 240, 28);
  s.label("CLASS", 30, H.bannerMiddle - 10, { size: 3.6, color: "lines", align: "center", width: 240 });
  H.statCenters.forEach((center, index) => {
    s.frame(center - 32, H.statMiddle - 13, 64, 26);
    s.label(H.statLabels[index], center - 32, H.statMiddle - 9, { size: 3.4, align: "center", width: 64 });
  });
  return finish(doc, s);
}

const LEVEL_LABELS = ["CANTRIPS", "1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH"];

/**
 * One spell row: three cells, each with a bubble where the writer marks a
 * prepared spell. The first cell of a level band is the crimson label cell.
 */
function rowCells(s, y, height, { first = "light" } = {}) {
  const L = C.spellList;
  const cells = L.cellRights.map((right, index) => [index === 0 ? 40 : L.cellRights[index - 1] + 2, right]);
  cells.forEach(([left, right], index) => {
    if (index === 0 && first === "dark") {
      s.page.drawRectangle({ x: left, y, width: right - left, height, color: BAND });
      return;
    }
    s.page.drawRectangle({ x: left, y, width: right - left, height, color: WHITE, borderColor: RULE, borderWidth: 0.35 });
    s.circle(L.columns[index] - 11.6, y + L.textBaseline + 1.7, 2.8, { stroke: RULE, lineWidth: 0.4 });
  });
}

async function spellLevelTemplate(level, edition) {
  const L = C.spellList;
  const { doc, sheet: s } = await newDocument(C.pageWidth, L.topHeight, EDITION[edition]);
  // The upper half is the section's top edge; the lower half is the first row,
  // with the level label in the crimson cell where column 0 would be.
  s.ornamentRule(40, 582, L.topHeight - 4, GOLD);
  rowCells(s, 0, L.rowHeight, { first: "dark" });
  s.display(LEVEL_LABELS[level], 46, L.textBaseline, { size: 5.6, color: "cream" });
  return finish(doc, s);
}

async function spellRowTemplate(closing, edition) {
  const L = C.spellList;
  const { doc, sheet: s } = await newDocument(C.pageWidth, closing ? L.endHeight : L.rowHeight, EDITION[edition]);
  if (closing) s.ornamentRule(40, 582, L.endHeight - 4, GOLD);
  else rowCells(s, 0, L.rowHeight);
  return finish(doc, s);
}

async function cardTemplate(kind, edition) {
  const K = C.cards;
  const { doc, sheet: s } = await newDocument(K.width, K.height, EDITION[edition]);
  s.frame(1, 1, K.width - 2, K.height - 2, { radius: 6, fill: WHITE });
  const titleBottom = K.height - K.titleDrop - 6;
  s.page.drawRectangle({ x: 4, y: titleBottom, width: K.width - 8, height: K.height - 5 - titleBottom, color: FILL });
  s.ornamentRule(5, K.width - 5, titleBottom, GOLD);
  if (kind === "spell") {
    K.spell.labels.forEach((label, index) => {
      s.label(label, 5, K.height - K.spell.metadataTop - index * K.spell.metadataStep, { size: 5.4, color: "lines" });
    });
    s.ornamentRule(5, K.width - 5, K.height - K.spell.bodyTop + 8, RULE);
  }
  const footerTop = K.height - K.footerDrop + 5;
  s.page.drawRectangle({ x: K.footerInset, y: 4, width: K.width - K.footerInset * 2, height: footerTop - 4, color: FILL });
  return finish(doc, s);
}

async function buildSet(edition) {
  const files = new Map();
  const details = { "2014": details2014, "2024": details2024, "2024-hybrid": detailsHybrid }[edition];
  files.set(C.files.details, await details(edition));
  files.set(C.files.background, await backgroundTemplate(edition));
  files.set(C.files.companion, await companionTemplate(edition));
  files.set(C.files.equipment, await equipmentTemplate(edition));
  files.set(C.files.spellcastingHeader, await spellHeaderTemplate(edition));
  files.set(C.files.spellcastingSectionCenter, await spellRowTemplate(false, edition));
  files.set(C.files.spellcastingSectionBottom, await spellRowTemplate(true, edition));
  files.set(C.files.spellCard, await cardTemplate("spell", edition));
  files.set(C.files.genericCard, await cardTemplate("generic", edition));
  for (const [level, name] of C.spellcastingSectionTops.entries()) files.set(name, await spellLevelTemplate(level, edition));
  // Layout variants of the character page, after the shared files so the
  // existing labels keep their place in labels.json.
  for (const { file, layout } of sheetLayoutVariants(edition)) files.set(file, await details(edition, layout));
  return files;
}

const command = process.argv[2];
if (command !== "build" && command !== "check") {
  console.error("usage: build-sheet-templates.mjs build|check");
  process.exit(2);
}
let drift = 0;
for (const edition of SHEET_TEMPLATE_SETS) {
  const dir = join(OUTPUT_ROOT, edition);
  const built = await buildSet(edition);
  const files = new Map([...built].map(([name, { bytes }]) => [name, Buffer.from(bytes)]));
  const text = Object.fromEntries([...built].map(([name, { text: labels }]) => [name, labels]));
  files.set(C.labelsFile, Buffer.from(JSON.stringify(text, null, 1) + "\n"));
  if (command === "build") {
    await mkdir(dir, { recursive: true });
    for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
    console.log(`wrote ${files.size} files to ${dir}`);
    continue;
  }
  const existing = existsSync(dir) ? await readdir(dir) : [];
  for (const [name, bytes] of files) {
    const current = existsSync(join(dir, name)) ? await readFile(join(dir, name)) : null;
    if (current === null || Buffer.compare(current, bytes) !== 0) { drift += 1; console.log(`drift: ${edition}/${name}`); }
  }
  for (const name of existing) if (!files.has(name)) { drift += 1; console.log(`stale: ${edition}/${name}`); }
}
if (command === "check") {
  if (drift) { console.error(`${drift} template file(s) differ from the generator output`); process.exit(1); }
  console.log("committed templates match the generator");
}
