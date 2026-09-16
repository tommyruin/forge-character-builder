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
 * score, as the 2024 rules present them, with titles on the upper edge.
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
const { SHEET_TEMPLATE_CONTRACT: C, SHEET_TEMPLATE_SETS, SHEET_PALETTE, DEFAULT_SHEET_COLOURS, SHEET_FIXED_COLOURS } = await import(pathToFileURL(CONTRACT_MODULE).href);
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
   * `plate` sets it inside, over an ornamented rule. Returns the inner content box.
   */
  section(title, x, y, width, height, { style = this.style.titleStyle, at = this.style.titleAt, size = 6.2 } = {}) {
    this.frame(x, y, width, height);
    if (style === "ribbon") {
      const fitted = Math.min(size, (size * (width - 56)) / this.textWidth(title, "display", size));
      if (at === "bottom") {
        this.ribbon(title, x + width / 2, y, { size: fitted });
        return { x: x + 4, y: y + 8, width: width - 8, height: height - 12 };
      }
      this.ribbon(title, x + width / 2, y + height, { size: fitted });
      return { x: x + 4, y: y + 4, width: width - 8, height: height - 12 };
    }
    if (style === "caption") {
      // The printed sheets label a panel inside its lower edge, centred.
      this.label(title, x, y + 5, { size: Math.min(size - 1.2, (width - 12) / (title.length * 0.62)), align: "center", width, color: "text" });
      return { x: x + 4, y: y + 13, width: width - 8, height: height - 17 };
    }
    this.display(title, x, y + height - 11, { size, align: "center", width });
    this.ornamentRule(x + 8, x + width - 8, y + height - 15);
    return { x: x + 4, y: y + 4, width: width - 8, height: height - 20 };
  }
  /** A framed stat: a large centred value over its caption. */
  stat(name, caption, x, y, width, height, { size = 12, radius = 4 } = {}) {
    this.frame(x, y, width, height, { radius });
    this.text(name, x + 3, y + 12, width - 6, height - 16, { align: "center", size, box: "none" });
    this.label(caption, x, y + 4.5, { size: Math.min(4.6, width / 14), align: "center", width });
  }
  /** A heater shield holding a large value, its caption on the shield's brow. */
  shield(name, caption, x, top, width, height, { size = 18 } = {}) {
    this.path(shieldPath(width, height), x, top, { fill: FILL, stroke: ACCENT, lineWidth: 1 });
    this.path(shieldPath(width - 5.2, height - 5), x + 2.6, top - 2.5, { stroke: GOLD, lineWidth: 0.35 });
    this.label(caption, x, top - 9, { size: 3.8, align: "center", width });
    this.text(name, x + 2, top - height * 0.72, width - 4, height * 0.5, { align: "center", size, box: "none" });
  }
  /**
   * An ability shield: the name on the brow, the score in the body and the
   * modifier in a roundel over the tip.
   */
  abilityShield(prefix, key, caption, cx, top, { width = 54, height = 65 } = {}) {
    const x = cx - width / 2;
    this.path(shieldPath(width, height), x, top, { fill: FILL, stroke: ACCENT, lineWidth: 1 });
    this.path(shieldPath(width - 5.2, height - 5), x + 2.6, top - 2.5, { stroke: GOLD, lineWidth: 0.35 });
    this.display(caption, x, top - 10, { size: 4.2, align: "center", width });
    // A heater shield's optical centre sits above its bounding box's, and the
    // writer centres the digits on this rectangle, so it is derived from the
    // height rather than pinned — the 65pt and 62pt shields then agree.
    const scoreHeight = height * 0.46;
    const scoreMiddle = top - height * 0.45;
    this.text(`${prefix}_${key}_score`, x + 6, scoreMiddle - scoreHeight / 2, width - 12, scoreHeight, { align: "center", size: 18, box: "none" });
    const roundel = top - height + 6;
    this.circle(cx, roundel, 9, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
    this.circle(cx, roundel, 7, { stroke: GOLD, lineWidth: 0.3 });
    this.text(`${prefix}_${key}_modifier`, cx - 12, roundel - 6.5, 24, 13, { align: "center", size: 9, box: "none" });
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
    this.label(caption, x, y - 6.5, { size: 4.2, align: options.captionAlign ?? "left", width });
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
  /** A framed multiline field with a title. */
  block(title, name, x, y, width, height, { size = 6, style, at } = {}) {
    const inner = this.section(title, x, y, width, height, { style, at });
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
 */
function hitPointBox(s, prefix, x, y, width, height) {
  // The printed sheets carry the running total in one panel, with hit dice and
  // the death saves in two smaller panels beneath it.
  const tallyHeight = 32;
  const mainY = y + tallyHeight + 5;
  const mainHeight = height - tallyHeight - 5;
  s.section("CURRENT HIT POINTS", x, mainY, width, mainHeight, { style: "caption" });
  [[`${prefix}_hp_max`, "MAXIMUM", x + 12, 46], [`${prefix}_hp_temp`, "TEMPORARY", x + width - 58, 46]].forEach(([name, caption, fx, fw]) => {
    s.captioned(name, caption, fx, mainY + mainHeight - 20, fw, 9, { align: "center", captionAlign: "center", size: 8, captionSize: 3.4 });
  });
  s.text(`${prefix}_hp_current`, x + 12, mainY + 16, width - 24, 16, { align: "center", size: 14, box: "none" });
  const half = (width - 6) / 2;
  const dice = s.section("HIT DICE", x, y, half, tallyHeight, { style: "caption" });
  s.text(`${prefix}_hd`, dice.x + 4, y + 13, dice.width - 8, 15, { align: "center", size: 12, box: "none" });
  const saves = s.section("DEATH SAVES", x + half + 6, y, half, tallyHeight, { style: "caption" });
  for (let index = 1; index <= 3; index += 1) {
    s.check(`${prefix}_death_save_success_${index}`, saves.x + 38 + (index - 1) * 9, y + 21, 6);
    s.check(`${prefix}_death_save_fail_${index}`, saves.x + 38 + (index - 1) * 9, y + 13, 6);
  }
  s.label("SUCCESSES", saves.x + 4, y + 22.5, { size: 3.2, color: "lines" });
  s.label("FAILURES", saves.x + 4, y + 14.5, { size: 3.2, color: "lines" });
}

// ---------------------------------------------------------------------------
// Character page, 2014 arrangement.
// ---------------------------------------------------------------------------

async function details2014(edition) {
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

  // Column A: the six ability shields on a grey backing panel.
  s.panel(27, 230, 67, 440);
  ABILITIES.forEach(([key, caption], index) => {
    s.abilityShield("details", key, caption, 60.6, 662 - index * 71.5);
  });

  // Column B: proficiency bonus, saving throws, skills, passive perception, initiative.
  s.pill(96, 626, 105, 24);
  s.label("PROFICIENCY BONUS", 104, 636, { size: 4.4 });
  s.circle(184, 638, 10.5, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.text("details_proficiency_bonus", 171, 631, 26, 14, { align: "center", size: 10, box: "none" });
  s.section("SAVING THROWS", 96, 496, 105, 124);
  ABILITIES.forEach(([key], index) => {
    const y = 605.6 - index * 12;
    s.check(`details_${key}_save_proficiency`, 102, y, 6.7);
    s.text(`details_${key}_save_total`, 111, y - 1, 17, 9, { align: "center", size: 8 });
    s.note(ABILITY_NAME[key], 131, y + 1, { size: 5.6 });
  });
  s.text("details_saving_throws", 100, 504, 97, 34, { multiline: true, size: 5.5, box: "none" });
  s.section("SKILLS", 96, 262, 105, 228);
  SKILLS.forEach(([key, caption, ability], index) => {
    const y = 476.4 - index * 11.2;
    s.check(`details_${key}_proficiency`, 101, y, 6);
    s.check(`details_${key}_expertise`, 108, y, 6);
    s.text(`details_${key}_total`, 115, y - 1, 15, 9, { align: "center", size: 8 });
    s.note(caption, 131, y + 0.5, { size: 5.2 });
    s.note(`(${ability[0].toUpperCase()}${ability.slice(1)})`, 131 + s.textWidth(caption, "captionLight", 5.2) + 2, y + 0.5, { size: 4.2, color: "lines" });
  });
  s.pill(96, 235, 105, 24);
  s.circle(108, 247, 10.5, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.text("details_passive_perception_total", 95, 240, 26, 14, { align: "center", size: 10, box: "none" });
  s.label("PASSIVE PERCEPTION", 122, 245, { size: 4.4 });
  // Initiative: the bonus in a roundel over its caption, the advantage
  // mark beside it, and the action summary on the right.
  s.frame(31, 194, 170, 34);
  s.circle(52, 214, 10.5, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.text("details_initiative", 39, 207, 26, 14, { align: "center", size: 10, box: "none" });
  s.label("INITIATIVE", 40, 199, { size: 3.8, align: "center", width: 36 });
  s.check("details_initiative_advantage", 74, 210.5, 6.5);
  s.label("ADVANTAGE", 70, 203, { size: 3.4, color: "lines", align: "center", width: 26 });
  s.text("details_encounter_box", 104, 206, 92, 10, { size: 7 });
  s.label("ACTIONS", 104, 217.5, { size: 3.8, color: "lines" });

  // Column C: armor, hit points, senses and racial traits.
  s.section("ARMOR CLASS", 213, 580, 182, 85);
  s.captioned("details_equipped_armor", "ARMOR", 224, 643.6, 123, 10, { size: 7 });
  s.captioned("details_equipped_shield", "SHIELD", 224, 621.6, 123, 10, { size: 7 });
  s.text("details_armor_conditional", 224, 589, 164, 30, { multiline: true, size: 6, box: "none" });
  s.check("details_armor_stealth_disadvantage", 306, 654.5, 6.5);
  s.label("STEALTH DISADV.", 270, 655.6, { size: 3.4, color: "lines" });
  s.shield("details_armor_class", "AC", 355, 674, 44, 48);
  hitPointBox(s, "details", 213, 492, 182, 86);
  s.section("SPEED, SENSES & CONDITIONS", 213, 392, 182, 96);
  [["details_speed_walking", "SPEED", 224], ["details_speed_fly", "FLY", 267], ["details_speed_climb", "CLIMB", 310], ["details_speed_swim", "SWIM", 353]].forEach(([name, caption, x]) => {
    s.captioned(name, caption, x, 470, 35, 10, { align: "center", captionAlign: "center", size: 7 });
  });
  s.captioned("details_vision", "VISION", 224, 448, 78, 10, { size: 7 });
  s.captioned("details_inspiration", style.inspiration, 310, 448, 35, 10, { align: "center", captionAlign: "center", size: 7 });
  s.captioned("details_exhaustion", "EXHAUSTION", 353, 448, 35, 10, { align: "center", captionAlign: "center", size: 7 });
  s.text("details_resistances", 224, 404, 164, 38, { multiline: true, size: 6, box: "none" });
  s.block(style.traits, "details_additional_notes", 213, 196, 182, 188);

  // Bottom: attacks and spellcasting across columns A–C.
  s.section("ATTACKS & SPELLCASTING", 29, 27, 366, 162);
  [["NAME", 34], ["RANGE", 173], ["ATTACK", 222], ["DAMAGE / TYPE", 273]].forEach(([caption, x]) => s.label(caption, x, 178, { size: 3.8, color: "lines" }));
  for (let row = 1; row <= 4; row += 1) {
    const y = 166.7 - (row - 1) * 22;
    s.text(`details_attack${row}_weapon`, 34, y, 132, 10, { size: 7 });
    s.text(`details_attack${row}_range`, 173, y, 45, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_attack`, 222, y, 45, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_damage`, 273, y, 115, 10, { size: 7 });
    s.text(`details_attack${row}_description`, 34, y - 9.5, 354, 8, { size: 6, box: "none" });
  }
  s.text("details_attack_description", 34, 34, 355, 55, { multiline: true, size: 6, box: "none" });

  // Column D: features and proficiencies.
  s.block("FEATURES & TRAITS", "details_features", 404, 150, 182, 515);
  s.block("PROFICIENCIES & LANGUAGES", "details_proficiencies_languages", 404, 27, 182, 115);
  return finish(doc, s);
}

// ---------------------------------------------------------------------------
// Character page, 2024 arrangement: each ability's saving throw and skills sit
// beneath its score; weapons, class features and species traits on the right.
// ---------------------------------------------------------------------------

/** An ability panel: modifier roundel, score, saving throw and the ability's skills. */
function abilityPanel2024(s, key, caption, x, y, width, height, extra) {
  s.frame(x, y, width, height, { radius: 6 });
  const top = y + height;
  s.display(caption, x, top - 11, { size: 5.6, align: "center", width });
  s.ornamentRule(x + 8, x + width - 8, top - 14.5);
  s.circle(x + 30, top - 36, 15, { fill: WHITE, stroke: ACCENT, lineWidth: 0.9 });
  s.circle(x + 30, top - 36, 12.5, { stroke: GOLD, lineWidth: 0.35 });
  s.text(`details_${key}_modifier`, x + 14, top - 42, 32, 13, { align: "center", size: 9, box: "none" });
  s.label("MODIFIER", x + 30 - 12, top - 56, { size: 3.6, align: "center", width: 24 });
  s.rounded(x + 60, top - 46, width - 70, 24, 3, { fill: WHITE, stroke: GOLD, lineWidth: 0.4 });
  s.text(`details_${key}_score`, x + 60, top - 46, width - 70, 24, { align: "center", size: 15, box: "none" });
  s.label("SCORE", x + 60, top - 52, { size: 3.6, align: "center", width: width - 70 });
  let rowY = top - 68;
  s.rule(x + 6, rowY + 9, x + width - 6, rowY + 9, RULE, 0.4);
  s.check(`details_${key}_save_proficiency`, x + 8, rowY - 1, 6.5);
  s.text(`details_${key}_save_total`, x + 18, rowY - 2, 22, 9, { align: "center", size: 8 });
  s.label("SAVING THROW", x + 44, rowY, { size: 4.4 });
  rowY -= 11;
  s.rule(x + 6, rowY + 9, x + width - 6, rowY + 9, RULE, 0.4);
  for (const [skill, name] of SKILLS.filter(([, , ability]) => ability === key)) {
    s.check(`details_${skill}_proficiency`, x + 8, rowY - 1, 6);
    s.check(`details_${skill}_expertise`, x + 15.5, rowY - 1, 6);
    s.text(`details_${skill}_total`, x + 24, rowY - 2, 20, 9, { align: "center", size: 7 });
    s.note(name, x + 48, rowY, { size: 5.4 });
    rowY -= 11;
  }
  if (extra) extra(rowY, x, width);
}

async function details2024(edition) {
  const style = EDITION[edition];
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  pageChrome(s, "CHARACTER", edition);

  // Identity, level, armor class and hit points across the top.
  s.brush(26, 696, 322, 64);
  s.frame(26, 696, 322, 64);
  s.text("details_character_name", 32, 740, 240, 16, { size: 12 });
  s.label("CHARACTER NAME", 32, 733.5, { size: 4.2 });
  s.entry("details_player", "PLAYER", 280, 741, 62, 11);
  s.entry("details_build", "CLASS & LEVEL", 32, 719, 310, 11);
  [["details_background", style.origin, 32, 118], ["details_alignment", "ALIGNMENT", 158, 88], ["details_deity", "DEITY", 254, 88]].forEach(([name, caption, x, width]) => {
    const captionWidth = s.textWidth(caption, "caption", 3.4) + 4;
    s.label(caption, x, 702.5, { size: 3.4, color: "lines" });
    s.text(name, x + captionWidth, 702, width - captionWidth, 8, { size: 6 });
  });
  s.circle(376, 730, 24, { fill: FILL, stroke: ACCENT, lineWidth: 1 });
  s.circle(376, 730, 21, { stroke: GOLD, lineWidth: 0.35 });
  s.text("details_xp", 356, 722, 40, 16, { align: "center", size: 12, box: "none" });
  s.label("XP", 356, 715.5, { size: 3.8, align: "center", width: 40 });
  s.shield("details_armor_class", "ARMOR CLASS", 406, 762, 52, 46);
  s.text("details_equipped_shield", 406, 705, 52, 9, { align: "center", size: 5, box: "none" });
  s.label("SHIELD", 406, 699, { size: 3.4, align: "center", width: 52 });
  const hp = s.section("HIT POINTS", 466, 700, 120, 60, { style: "plate", at: "top", size: 5.8 });
  s.text("details_hp_current", hp.x + 2, hp.y + 8, 52, 26, { align: "center", size: 20, box: "none" });
  s.rounded(hp.x + 2, hp.y + 8, 52, 26, 3, { stroke: GOLD, lineWidth: 0.4 });
  s.label("CURRENT", hp.x + 2, hp.y + 2, { size: 3.8, align: "center", width: 52 });
  s.label("TEMP", hp.x + 58, hp.y + 24, { size: 3.8, color: "lines" });
  s.text("details_hp_temp", hp.x + 74, hp.y + 22, 36, 11, { align: "center", size: 8 });
  s.label("MAX", hp.x + 58, hp.y + 8, { size: 3.8, color: "lines" });
  s.text("details_hp_max", hp.x + 74, hp.y + 6, 36, 11, { align: "center", size: 8 });

  // The vitals row.
  const vitalY = 640;
  const vitalW = 76;
  const vitalX = (index) => 26 + index * 82;
  s.stat("details_proficiency_bonus", "PROFICIENCY BONUS", vitalX(0), vitalY, vitalW, 52, { size: 20 });
  s.stat("details_initiative", "INITIATIVE", vitalX(1), vitalY, vitalW, 52, { size: 20 });
  s.check("details_initiative_advantage", vitalX(1) + 6, vitalY + 39, 6);
  s.label("ADV", vitalX(1) + 14, vitalY + 40, { size: 3.6 });
  s.frame(vitalX(2), vitalY, vitalW, 52);
  s.text("details_speed_walking", vitalX(2) + 3, vitalY + 30, vitalW - 6, 18, { align: "center", size: 16, box: "none" });
  s.label("SPEED", vitalX(2), vitalY + 24, { size: 4.4, align: "center", width: vitalW });
  [["details_speed_fly", "FLY"], ["details_speed_climb", "CLIMB"], ["details_speed_swim", "SWIM"]].forEach(([name, caption], index) => {
    const x = vitalX(2) + 5 + index * 22;
    s.text(name, x, vitalY + 12, 20, 9, { align: "center", size: 6 });
    s.label(caption, x, vitalY + 5.5, { size: 3.4, align: "center", width: 20 });
  });
  s.stat("details_hd", "HIT DICE", vitalX(3), vitalY, vitalW, 52, { size: 18 });
  s.frame(vitalX(4), vitalY, vitalW, 52);
  s.label("SUCCESSES", vitalX(4) + 6, vitalY + 35, { size: 3.4, color: "lines" });
  s.label("FAILURES", vitalX(4) + 6, vitalY + 22.5, { size: 3.4, color: "lines" });
  for (let index = 1; index <= 3; index += 1) {
    s.check(`details_death_save_success_${index}`, vitalX(4) + 36 + (index - 1) * 11, vitalY + 33.5, 7);
    s.check(`details_death_save_fail_${index}`, vitalX(4) + 36 + (index - 1) * 11, vitalY + 21, 7);
  }
  s.label("DEATH SAVES", vitalX(4), vitalY + 4.5, { size: 4.6, align: "center", width: vitalW });
  s.stat("details_passive_perception_total", "PASSIVE PERCEPTION", vitalX(5), vitalY, vitalW, 52, { size: 20 });
  const inspirationW = 586 - vitalX(6);
  s.frame(vitalX(6), vitalY, inspirationW, 52);
  s.diamond(vitalX(6) + inspirationW / 2, vitalY + 32, 10, GOLD);
  s.diamond(vitalX(6) + inspirationW / 2, vitalY + 32, 8, WHITE);
  s.text("details_inspiration", vitalX(6) + inspirationW / 2 - 16, vitalY + 26, 32, 12, { align: "center", size: 12, box: "none" });
  s.label("HEROIC INSPIRATION", vitalX(6), vitalY + 4.5, { size: Math.min(4.6, inspirationW / 16), align: "center", width: inspirationW });

  // Two columns of ability panels, each on a grey backing panel.
  const panelW = 124;
  const heights = { str: 88, dex: 110, con: 98, int: 132, wis: 132, cha: 121 };
  const columnDepth = Math.max(heights.str + heights.dex + heights.con, heights.int + heights.wis + heights.cha) + 16;
  s.panel(22, 632 - columnDepth - 4, 264, columnDepth + 8);
  let top = 632;
  for (const key of ["str", "dex", "con"]) {
    abilityPanel2024(s, key, ABILITY_NAME[key].toUpperCase(), 26, top - heights[key], panelW, heights[key], key === "con" ? (rowY, x, width) => {
      s.label("SAVING THROW NOTES", x + 8, rowY + 1, { size: 3.6, color: "lines" });
      s.text("details_saving_throws", x + 8, rowY - 7, width - 16, 9, { size: 5.5, box: "none" });
    } : undefined);
    top -= heights[key] + 8;
  }
  const leftBottom = top + 8;
  top = 632;
  for (const key of ["int", "wis", "cha"]) {
    abilityPanel2024(s, key, ABILITY_NAME[key].toUpperCase(), 158, top - heights[key], panelW, heights[key]);
    top -= heights[key] + 8;
  }
  const rightBottom = top + 8;

  // Beneath the shorter column: senses and resistances.
  let inner = s.section("SENSES & RESISTANCES", 26, rightBottom, panelW, leftBottom - 8 - rightBottom, { size: 5.2 });
  s.text("details_vision", inner.x, inner.y + inner.height - 10, inner.width, 9, { size: 6 });
  s.text("details_resistances", inner.x, inner.y, inner.width, inner.height - 13, { multiline: true, size: 5.5, box: "none" });

  // Both columns: armor, then equipment training, proficiencies and languages.
  const armorTop = rightBottom - 8;
  inner = s.section("ARMOR", 26, armorTop - 38, 256, 38, { size: 5.6 });
  s.text("details_equipped_armor", inner.x + 3, inner.y + 2, 107, 10, { size: 6.5 });
  s.text("details_armor_conditional", inner.x + 116, inner.y + 2, 84, 10, { size: 5.5 });
  s.check("details_armor_stealth_disadvantage", inner.x + 206, inner.y + 3, 6);
  s.label("STEALTH DISADV.", inner.x + 214, inner.y + 4, { size: 3.4 });
  s.block("PROFICIENCIES, TRAINING & LANGUAGES", "details_proficiencies_languages", 26, 60, 256, armorTop - 38 - 8 - 60);

  // The right-hand area.
  const areaX = 290;
  const areaW = 296;
  inner = s.section("WEAPONS & DAMAGE CANTRIPS", areaX, 500, areaW, 132);
  // The band runs 504..604 between the column captions and the panel's foot,
  // and the columns share the 288pt between 294 and 582 with 2pt gutters. Both
  // budgets are spent on the NOTES column, because it is the only cell holding
  // a phrase rather than a token: a 2024 property list with a "Mastery: <Name>"
  // suffix runs to 52 characters ("Reach, Special, Special Lance, Heavy,
  // Mastery: Topple"), while the widest name the SRD weapons offer needs 58pt
  // and the widest damage string ("1d10+0 bludgeoning") 68pt. NAME keeps 68 and
  // DAMAGE 64 — every SRD weapon name and every damage string but a versatile
  // warhammer's still prints at its full 7pt — and NOTES takes the 20pt freed,
  // which is what carries the longest property list at a full 6pt in every
  // body face rather than shrinking it to 4.75pt as a 66pt column did.
  const columns = [["NAME", 294, 68], ["RANGE", 364, 28], ["ATK / DC", 394, 34], ["DAMAGE & TYPE", 430, 64], ["NOTES", 496, 86]];
  columns.forEach(([caption, x]) => s.label(caption, x, 605, { size: 3.8, color: "lines" }));
  for (let row = 1; row <= 4; row += 1) {
    const y = 594 - (row - 1) * 21;
    const [[, nx, nw], [, rx, rw], [, ax, aw], [, dx, dw], [, ox, ow]] = columns;
    s.text(`details_attack${row}_weapon`, nx, y, nw, 10, { size: 7 });
    s.text(`details_attack${row}_range`, rx, y, rw, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_attack`, ax, y, aw, 10, { size: 7, align: "center" });
    s.text(`details_attack${row}_damage`, dx, y, dw, 10, { size: 7 });
    // The notes cell alone wraps: a 2024 property list with a mastery suffix
    // ("Heavy, Reach, Two-Handed, Mastery: Cleave") is far too long for one
    // line of this column, and a single-line cell clips the overflow through
    // the middle of the second line. It keeps the row's whole 21pt pitch — the
    // shortest cell that holds three wrapped lines at the writer's 4.5pt floor,
    // so even a hand-written note never clips — but sits 0.9pt proud of the
    // row's own top, which is what makes its first line read as level with the
    // rest of the row rather than sinking below it.
    //
    // The offset is the difference between the two ways the writer places a
    // line. A single-line value is centred on its box by cap height, at
    // `y + height/2 - capRatio*size/2`; a wrapped cell's first baseline is a
    // fixed inset from its top, `top - 2 - size`. Sharing the top (604) put the
    // 6pt note's baseline 0.5pt under the 7pt values' and its cap top 1.2pt
    // under theirs. Optically centring the 6pt line on the same 594..604 band
    // wants a baseline of `599 - 3*capRatio`, so a top of `607 - 3*capRatio`:
    // 604.85 for Helvetica (cap 0.718), 605.02 for Spectral (0.660), 605.08 for
    // Alegreya Sans (0.641). The rect is one number for every face and has to
    // stay under the column captions at 605, so it takes 604.9 — the value that
    // balances the worst baseline error against the worst cap-top error across
    // the three body faces, holding both inside half a point.
    //
    // It carries no rule of its own: one would strike through the wrapped line,
    // and the four ruled columns still mark the row.
    s.text(`details_attack${row}_description`, ox, y - 10.1, ow, 21, { multiline: true, size: 6, box: "none" });
  }
  // The free-text note under the rows is prose, so it wraps too, filling what
  // is left between the last row's notes cell and the foot of the panel. The
  // rows took 5pt of it to spread over the band the fourth row used to leave
  // blank; 16pt still holds two lines of the user's own attack notes.
  s.text("details_attack_description", 294, 504, 288, 16, { multiline: true, size: 6, box: "none" });
  s.block("CLASS FEATURES", "details_features", areaX, 236, areaW, 256);
  s.block(style.traits, "details_additional_notes", areaX, 60, 146, 168);
  s.block("CONDITIONS & EXHAUSTION", "details_conditions", 444, 158, 142, 70, { size: 5.5 });
  s.text("details_exhaustion", 448, 162, 134, 8, { size: 5.5, box: "none" });
  s.label("EXHAUSTION", 448, 170.5, { size: 3.4, color: "lines" });
  s.block("ENCOUNTER NOTES", "details_encounter_box", 444, 60, 142, 90, { size: 5.5 });
  return finish(doc, s);
}

// ---------------------------------------------------------------------------
// Background, companion, inventory and spellcasting pages, shared by both sets.
// ---------------------------------------------------------------------------

async function backgroundTemplate(edition) {
  const style = EDITION[edition];
  const { doc, sheet: s } = await newDocument(C.pageWidth, C.pageHeight, style);
  masthead(s, edition, edition === "2024" ? "APPEARANCE" : "BACKGROUND", "background_character_name", "CHARACTER NAME", [
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
  s.section(edition === "2024" ? "BACKSTORY & PERSONALITY" : "BACKGROUND STORY", 214, 215, 372, 250, { style: "caption" });
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
  files.set(C.files.details, await (edition === "2024" ? details2024 : details2014)(edition));
  files.set(C.files.background, await backgroundTemplate(edition));
  files.set(C.files.companion, await companionTemplate(edition));
  files.set(C.files.equipment, await equipmentTemplate(edition));
  files.set(C.files.spellcastingHeader, await spellHeaderTemplate(edition));
  files.set(C.files.spellcastingSectionCenter, await spellRowTemplate(false, edition));
  files.set(C.files.spellcastingSectionBottom, await spellRowTemplate(true, edition));
  files.set(C.files.spellCard, await cardTemplate("spell", edition));
  files.set(C.files.genericCard, await cardTemplate("generic", edition));
  for (const [level, name] of C.spellcastingSectionTops.entries()) files.set(name, await spellLevelTemplate(level, edition));
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
