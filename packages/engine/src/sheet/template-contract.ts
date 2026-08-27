/**
 * The sheet template contract: which PDF files make up a template set, and
 * the geometry the writer draws against. `scripts/build-sheet-templates.mjs`
 * generates every set from this description, so the writer and the artwork
 * cannot drift apart.
 *
 * Template files are served from `<base>/sheets/<set>/`. Every page template
 * is a single 612x792 page whose AcroForm fields are named for the sheet
 * model's form values; the writer fills them by name, flattens the page and
 * draws flowing text into the rectangles of the rich-text fields.
 */

export const SHEET_TEMPLATE_SETS = ["2014", "2024"] as const;
export type SheetTemplateSet = (typeof SHEET_TEMPLATE_SETS)[number];
export const DEFAULT_SHEET_TEMPLATE_SET: SheetTemplateSet = "2014";

export function isSheetTemplateSet(value: unknown): value is SheetTemplateSet {
  return (SHEET_TEMPLATE_SETS as readonly unknown[]).includes(value);
}

/**
 * Sheet colours. The templates are generated in the default colours; the
 * writer recolours their content streams to any other named choice before
 * filling them, so one template set serves every scheme. Every colour is
 * available to every part; each part's default value is unique on the page,
 * so nothing else in the artwork may share it.
 */
export const SHEET_PALETTE = {
  crimson: { label: "Crimson", rgb: [0.47, 0.13, 0.11] },
  ember: { label: "Ember", rgb: [0.62, 0.32, 0.08] },
  gold: { label: "Gold", rgb: [0.64, 0.5, 0.24] },
  bronze: { label: "Bronze", rgb: [0.55, 0.36, 0.2] },
  sepia: { label: "Sepia", rgb: [0.32, 0.22, 0.12] },
  ink: { label: "Ink", rgb: [0.17, 0.13, 0.11] },
  forest: { label: "Forest", rgb: [0.14, 0.36, 0.22] },
  sage: { label: "Sage", rgb: [0.45, 0.55, 0.4] },
  ocean: { label: "Ocean", rgb: [0.12, 0.3, 0.47] },
  navy: { label: "Navy", rgb: [0.1, 0.14, 0.3] },
  royal: { label: "Royal", rgb: [0.34, 0.17, 0.46] },
  silver: { label: "Silver", rgb: [0.58, 0.6, 0.64] },
  slate: { label: "Slate", rgb: [0.22, 0.24, 0.28] },
  charcoal: { label: "Charcoal", rgb: [0.3, 0.3, 0.32] },
  black: { label: "Black", rgb: [0.05, 0.05, 0.05] },
} as const;
export type SheetColourName = keyof typeof SHEET_PALETTE;
export const SHEET_COLOUR_NAMES = Object.keys(SHEET_PALETTE) as SheetColourName[];
export const SHEET_COLOUR_PARTS = ["accent", "lines", "text"] as const;
export type SheetColourPart = (typeof SHEET_COLOUR_PARTS)[number];

/** A full colour choice: one palette name per part. */
export type SheetColours = Record<SheetColourPart, SheetColourName>;

/** Preset combinations; the first is the default and the templates' own colours. */
export const SHEET_THEMES = {
  crimson: { label: "Crimson & Gold", accent: "crimson", lines: "gold", text: "ink" },
  forest: { label: "Forest & Brass", accent: "forest", lines: "gold", text: "ink" },
  ocean: { label: "Ocean & Silver", accent: "ocean", lines: "silver", text: "navy" },
  royal: { label: "Royal & Gold", accent: "royal", lines: "gold", text: "ink" },
  ember: { label: "Ember & Bronze", accent: "ember", lines: "bronze", text: "sepia" },
  slate: { label: "Slate & Steel", accent: "slate", lines: "silver", text: "black" },
  monochrome: { label: "Monochrome", accent: "black", lines: "charcoal", text: "black" },
} as const satisfies Record<string, SheetColours & { label: string }>;
export type SheetThemeName = keyof typeof SHEET_THEMES;
export const SHEET_THEME_NAMES = Object.keys(SHEET_THEMES) as SheetThemeName[];
export const DEFAULT_SHEET_THEME: SheetThemeName = "crimson";
export const DEFAULT_SHEET_COLOURS: SheetColours = {
  accent: SHEET_THEMES[DEFAULT_SHEET_THEME].accent,
  lines: SHEET_THEMES[DEFAULT_SHEET_THEME].lines,
  text: SHEET_THEMES[DEFAULT_SHEET_THEME].text,
};

export function isSheetColourName(value: unknown): value is SheetColourName {
  return typeof value === "string" && Object.hasOwn(SHEET_PALETTE, value);
}

/** The colours named by `value`, each part falling back to the default when unknown. */
export function resolveSheetColours(value: unknown): SheetColours {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    accent: isSheetColourName(input.accent) ? input.accent : DEFAULT_SHEET_COLOURS.accent,
    lines: isSheetColourName(input.lines) ? input.lines : DEFAULT_SHEET_COLOURS.lines,
    text: isSheetColourName(input.text) ? input.text : DEFAULT_SHEET_COLOURS.text,
  };
}

/** The theme whose three parts match `colours`, if any. */
export function sheetThemeOf(colours: SheetColours): SheetThemeName | null {
  const match = SHEET_THEME_NAMES.find((name) => {
    const theme = SHEET_THEMES[name];
    return theme.accent === colours.accent && theme.lines === colours.lines && theme.text === colours.text;
  });
  return match ?? null;
}

/** A stable identity for `colours`, for cache keys. */
export function sheetColoursKey(colours: SheetColours): string {
  return `${colours.accent}/${colours.lines}/${colours.text}`;
}

/**
 * Sheet typefaces. The templates carry no text of their own: every title,
 * caption and value is drawn by the writer in the faces chosen here, so the
 * choice is free at render time. Files are served from `<base>/sheets/fonts/`;
 * a face without files is one of the PDF standard fonts.
 */
export const SHEET_FONT_ROLES = ["titles", "captions", "body", "numbers"] as const;
export type SheetFontRole = (typeof SHEET_FONT_ROLES)[number];
export interface SheetFontFace {
  label: string;
  /** Roles the face suits; the settings panel offers it for these only. */
  roles: readonly SheetFontRole[];
  /** Font files by style; `caption` is the weight used for small captions. Absent for standard fonts. */
  files?: { regular: string; bold?: string; italic?: string; boldItalic?: string; caption?: string };
  /** PDF standard font names by style, for a face with no files. */
  standard?: { regular: string; bold: string; italic: string; boldItalic: string };
}
export const SHEET_FONT_FACES = {
  cinzelDecorative: { label: "Cinzel Decorative", roles: ["titles", "numbers"], files: { regular: "CinzelDecorative-Bold.ttf" } },
  cinzel: { label: "Cinzel", roles: ["titles", "captions", "numbers"], files: { regular: "Cinzel.ttf" } },
  medievalSharp: { label: "MedievalSharp", roles: ["titles", "numbers"], files: { regular: "MedievalSharp.ttf" } },
  uncialAntiqua: { label: "Uncial Antiqua", roles: ["titles", "numbers"], files: { regular: "UncialAntiqua.ttf" } },
  pirataOne: { label: "Pirata One", roles: ["titles", "numbers"], files: { regular: "PirataOne.ttf" } },
  almendra: { label: "Almendra", roles: ["titles", "captions"], files: { regular: "Almendra-Bold.ttf" } },
  spectral: {
    label: "Spectral",
    roles: ["titles", "captions", "body", "numbers"],
    files: { regular: "Spectral-Regular.ttf", bold: "Spectral-Bold.ttf", italic: "Spectral-Italic.ttf", boldItalic: "Spectral-BoldItalic.ttf", caption: "Spectral-SemiBold.ttf" },
  },
  alegreyaSans: {
    label: "Alegreya Sans",
    roles: ["captions", "body", "numbers"],
    files: { regular: "AlegreyaSans-Regular.ttf", bold: "AlegreyaSans-Bold.ttf", italic: "AlegreyaSans-Italic.ttf", boldItalic: "AlegreyaSans-BoldItalic.ttf", caption: "AlegreyaSans-Bold.ttf" },
  },
  helvetica: {
    label: "Helvetica",
    roles: ["captions", "body", "numbers"],
    standard: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique" },
  },
} as const satisfies Record<string, SheetFontFace>;
export type SheetFontFaceName = keyof typeof SHEET_FONT_FACES;
export const SHEET_FONT_FACE_NAMES = Object.keys(SHEET_FONT_FACES) as SheetFontFaceName[];
export type SheetFonts = Record<SheetFontRole, SheetFontFaceName>;
export const DEFAULT_SHEET_FONTS: SheetFonts = { titles: "cinzelDecorative", captions: "spectral", body: "helvetica", numbers: "helvetica" };

export function isSheetFontFaceName(value: unknown): value is SheetFontFaceName {
  return typeof value === "string" && Object.hasOwn(SHEET_FONT_FACES, value);
}

/** The faces named by `value`, each role falling back to the default when unknown or unsuited. */
export function resolveSheetFonts(value: unknown): SheetFonts {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const pick = (role: SheetFontRole): SheetFontFaceName => {
    const candidate = input[role];
    return isSheetFontFaceName(candidate) && (SHEET_FONT_FACES[candidate].roles as readonly SheetFontRole[]).includes(role)
      ? candidate
      : DEFAULT_SHEET_FONTS[role];
  };
  return { titles: pick("titles"), captions: pick("captions"), body: pick("body"), numbers: pick("numbers") };
}

/** A stable identity for `fonts`, for cache keys. */
export function sheetFontsKey(fonts: SheetFonts): string {
  return `${fonts.titles}/${fonts.captions}/${fonts.body}/${fonts.numbers}`;
}

/**
 * The text a template set draws through the writer: one entry per template
 * file. Positions are page points from the file's lower-left corner; a
 * fragment's labels follow the fragment wherever the writer places it.
 */
export interface SheetLabel {
  text: string;
  x: number;
  /** The baseline. */
  y: number;
  size: number;
  font: "titles" | "captions" | "notes";
  color: "accent" | "lines" | "text" | "cream";
  align?: "left" | "center" | "right";
  /** The box width `align` centres or right-aligns within. */
  width?: number;
}
export interface SheetRibbon {
  text: string;
  cx: number;
  cy: number;
  size: number;
  height: number;
  pad: number;
}
export type SheetTemplateLabels = Record<string, { labels: SheetLabel[]; ribbons: SheetRibbon[] }>;

export const SHEET_TEMPLATE_CONTRACT = {
  directory: "sheets",
  /** Font files, under the directory. */
  fontsDirectory: "fonts",
  /** The set's text, generated beside its templates. */
  labelsFile: "labels.json",
  pageWidth: 612,
  pageHeight: 792,
  files: {
    details: "details.pdf",
    background: "background.pdf",
    companion: "companion.pdf",
    equipment: "equipment.pdf",
    spellcastingHeader: "spellcasting-header.pdf",
    spellcastingSectionCenter: "spellcasting-row.pdf",
    spellcastingSectionBottom: "spellcasting-row-end.pdf",
    spellCard: "spell-card.pdf",
    genericCard: "item-card.pdf",
  },
  /** One level band per spell level, cantrips first. */
  spellcastingSectionTops: Array.from({ length: 10 }, (_, level) => `spellcasting-level-${level}.pdf`),
  /** The caster header strip: a class banner and four stat boxes on one line beneath the title. */
  spellHeader: {
    height: 76,
    bannerCenter: 150,
    bannerMiddle: 34,
    statCenters: [317, 392, 468, 543],
    statMiddle: 34,
    statLabels: ["SPELLCASTING ABILITY", "SPELL ATTACK BONUS", "SPELL SAVE DC", "PREPARED"],
  },
  /** Spell level sections: a 24pt level band, 12pt rows, and a 12pt closing strip. */
  spellList: {
    topHeight: 24,
    rowHeight: 12,
    endHeight: 12,
    /** Text x for the three spell columns; the first band holds the level label instead of column 0. */
    columns: [58, 248, 437],
    /** Cell edges: the first cell ends at labelCellRight; the next two start 2pt after the previous cell. */
    labelCellRight: 228,
    slotTextX: 82,
    textBaseline: 3.5,
  },
  /** Description cards: a 3x3 grid of 180x240 cards. */
  cards: {
    width: 180,
    height: 240,
    columns: 3,
    originX: 26,
    gutter: 9,
    rowTops: [766, 517, 268],
    titleDrop: 13.5,
    subtitleDrop: 26,
    spell: {
      metadataTop: 39,
      metadataStep: 11,
      metadataValueInset: 53.5,
      labels: ["CASTING TIME", "RANGE", "DURATION", "COMPONENTS"],
      bodyTop: 83,
    },
    generic: { bodyTop: 38 },
    bodyBottom: 225,
    footerDrop: 233.5,
    footerInset: 6,
  },
  /**
   * The masthead's brand badge. The templates draw a die mark there; a host
   * may supply its own logo, which the writer paints over it.
   */
  masthead: { badgeCenterX: 48, badgeCenterY: 748, badgeSize: 34, field: "sheet_brand_image" },
  /** The equipment page's notes column; item descriptions flow inside it. */
  equipmentNotes: { x: 410, y: 192, width: 172, height: 570 },
} as const;
