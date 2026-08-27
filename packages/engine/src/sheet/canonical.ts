/**
 * Canonical manifest serialization of the pure sheet model.
 *
 * The engine's sheet model serializes to a canonical shape for sheet
 * comparison and testing: per page, ordered sections with ordered token
 * streams.
 *
 * The extraction parses the 4th and 5th PDF pages as caster blocks
 * (summary/name/cantrips/level headers) regardless of their actual
 * content, so any content flowing onto those pages (caster blocks, item or
 * spell description pages, backstory continuations) canonicalizes as caster
 * sections — empty when no caster block is present. From the 6th page onward
 * the extraction uses the descriptions band, so description pages render as a
 * single "descriptions" section there.
 */

import type { CharacterSheetModel, SheetPage, SheetRow, SheetSection } from "./model.js";
import { sortedLayoutTokens } from "./card-layout.js";

export interface CanonicalSection {
  title: string;
  tokens: string[];
}

export interface CanonicalPage {
  sections: CanonicalSection[];
}

export interface CanonicalManifest {
  characterId: string;
  mode: string;
  pageCount: number;
  pageSize: { width: number; height: number };
  pages: CanonicalPage[];
}

function rowTokens(row: SheetRow): string[] {
  if (row.kind === "tokens") return mergeParenthesized([...row.tokens]);
  const out: string[] = [];
  for (const line of row.lines) {
    for (const word of line.split(/\s+/)) {
      if (word !== "") out.push(word);
    }
  }
  return mergeParenthesized(out);
}

/** Token normalization: line-wrapped hyphens rejoin and bare
 * parenthesized single words collapse. */
function mergeParenthesized(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (
      token === "(" &&
      i + 2 < tokens.length &&
      tokens[i + 2] === ")" &&
      /^[A-Za-z]+$/.test(tokens[i + 1]!)
    ) {
      out.push(`(${tokens[i + 1]})`);
      i += 2;
    } else if (
      token.endsWith("-") &&
      token.length > 1 &&
      i + 1 < tokens.length &&
      !token.endsWith("—")
    ) {
      out.push(`${token}${tokens[i + 1]}`);
      i += 1;
    } else {
      out.push(token);
    }
  }
  return out;
}

/** Description pages: blocks interleave row by row across the 3 columns. */
function descriptionPageTokens(sections: readonly SheetSection[]): string[] {
  const positioned = sections.flatMap((section) => section.canonicalRuns ?? section.positionedRuns ?? []);
  if (positioned.length > 0) return mergeParenthesized(sortedLayoutTokens(positioned));
  const blocks = sections.map((section) => section.rows.map(rowTokens));
  if (blocks.length === 0) return [];
  const tokens: string[] = [];
  const bandSize = 3;
  for (let band = 0; band < blocks.length; band += bandSize) {
    const bandBlocks = blocks.slice(band, band + bandSize);
    const rows = Math.max(...bandBlocks.map((b) => b.length), 0);
    for (let r = 0; r < rows; r++) {
      for (const block of bandBlocks) {
        if (r < block.length) tokens.push(...block[r]!);
      }
    }
  }
  return tokens;
}

const CASTER_TITLES = new Set(["caster-summary", "caster-name", "cantrips", "spells"]);
const isCasterTitle = (title: string): boolean => CASTER_TITLES.has(title) || /^spells-\d+$/.test(title);

function sectionTokens(section: SheetSection): string[] {
  const positioned = section.canonicalRuns ?? section.positionedRuns;
  if (positioned !== undefined) return mergeParenthesized(sortedLayoutTokens(positioned));
  const tokens: string[] = [];
  for (const row of section.rows) tokens.push(...rowTokens(row));
  return tokens;
}

/**
 * The 4th/5th pages canonicalize as caster pages: the caster sections keep
 * their content (with the always-empty "spells" band between the
 * cantrips and the level blocks); any other page content is dropped.
 */
function casterPageCanonical(page: SheetPage): CanonicalPage {
  const casterSections = page.sections.filter((section) => isCasterTitle(section.title));
  const sections: CanonicalSection[] = [];
  for (const section of casterSections) {
    sections.push({ title: section.title, tokens: sectionTokens(section) });
  }
  if (sections.length > 0) {
    const cantripsIndex = sections.findIndex((section) => section.title === "cantrips");
    if (cantripsIndex >= 0) {
      const spellBand = sections.find((section) => section.title === "spells");
      if (spellBand === undefined) {
        sections.splice(cantripsIndex + 1, 0, { title: "spells", tokens: [] });
      }
    }
    return { sections };
  }
  return {
    sections: [
      { title: "caster-summary", tokens: [] },
      { title: "caster-name", tokens: [] },
      { title: "cantrips", tokens: [] },
      { title: "spells", tokens: [] },
    ],
  };
}

export function sheetCanonical(model: CharacterSheetModel): CanonicalManifest {
  const pages: CanonicalPage[] = model.pages.map((page: SheetPage, index: number) => {
    if (index === 3 || index === 4) return casterPageCanonical(page);
    if (index >= 5) {
      const descriptionPage =
        page.sections.length > 0 &&
        (page.sections[0]!.title === "spell-description" || page.sections[0]!.title === "item-description");
      if (descriptionPage) {
        return {
          sections: [{ title: "descriptions", tokens: descriptionPageTokens(page.sections) }],
        };
      }
    }
    const sections: CanonicalSection[] = page.sections.map((section) => ({
      title: section.title,
      tokens: sectionTokens(section),
    }));
    return { sections };
  });
  return {
    characterId: model.characterId,
    mode: model.mode,
    pageCount: model.pageCount,
    pageSize: { width: 612, height: 792 },
    pages,
  };
}
