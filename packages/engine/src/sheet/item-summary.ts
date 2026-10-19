/**
 * The brief description the equipment page's notes column prints for a tool or
 * a piece of useful gear.
 *
 * An item's description is markup: a paragraph or two of prose, indented rule
 * paragraphs with a run-in heading ("Dousing a Space."), the 2024 tools' list
 * of Ability / Weight / Utilize / Craft, the 2014 tools' DC table. A first
 * sentence loses most of what matters, so this reads the structure instead and
 * keeps the passages that say how the item works, ranked by how much rules text
 * they carry, until the note fits {@link NOTE_BUDGET}. Weight is dropped (the
 * inventory table has it).
 *
 * Whole sentences only: a note either reads cleanly or the item prints by name
 * alone, never a clause cut mid-thought.
 */

import { plainDescriptionText, rulesCueScore } from "../content/equipment/significance.js";

/** The characters of text one note may carry, headings included. */
export const NOTE_BUDGET = 450;

export interface ItemNote {
  /** Escaped `<p>` markup for the column; empty when the item prints by name alone. */
  html: string;
  /** The same text without markup. */
  text: string;
}

interface Unit {
  text: string;
  score: number;
}

/** One paragraph, list line or table: a run-in heading and the units under it. */
interface Block {
  heading: string;
  units: Unit[];
  /** A list line or table keeps its own punctuation and is never split into sentences. */
  field: boolean;
}

const FIELD_SCORES: Record<string, number> = { ability: 4, utilize: 6, craft: 3 };
const IGNORED_FIELDS = new Set(["weight"]);
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z“‘("])/;
/** "as detailed below": a pointer to text the note does not carry. */
const DANGLING = /\b(?:detailed|described|listed|shown|given|explained)\s+(?:below|above)\b/i;
const HEADING = /^\s*<(strong|b)>\s*<(em|i)>([\s\S]*?)<\/\2>\s*<\/\1>([\s\S]*)$/i;

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sentences(text: string): string[] {
  return text.split(SENTENCE_BREAK).map((part) => part.trim()).filter((part) => part !== "");
}

/** Headings of the 2014 tools' "what this proficiency adds" paragraphs: insight, not rules. */
const SKILL_HEADING =
  /^(?:components|(?:acrobatics|animal handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight of hand|stealth|survival)(?:\s*(?:,|and|&)\s*)?)+$/i;
/** A headed paragraph this short is one idea; cutting a sentence out of it loses the thread. */
const WHOLE_PARAGRAPH = 260;
/** "The DM can allow ...": table advice, not something the sheet can act on. */
const DM_ASIDE = /^The DM\b/;
/** Shorter than this, an opening sentence is a remark ("Adventuring is a hard life."), not a description. */
const MIN_PURPOSE = 40;

function proseBlock(markup: string, first: boolean): Block | null {
  const match = HEADING.exec(markup);
  const heading = match === null ? "" : plainDescriptionText(match[3]).replace(/\.$/, "");
  if (SKILL_HEADING.test(heading)) return null;
  const body = plainDescriptionText(match === null ? markup : match[4]);
  if (heading !== "" && body.length <= WHOLE_PARAGRAPH && !DANGLING.test(body)) {
    return body === "" ? null : { heading, units: [{ text: body, score: rulesCueScore(body) }], field: false };
  }
  const units = sentences(body)
    .filter((part) => !DANGLING.test(part))
    .map((part, index) => ({
      text: part,
      // What the item is for reads well when there is room, and not before a rule.
      score: (DM_ASIDE.test(part) ? 0 : rulesCueScore(part)) + (first && index === 0 && part.length >= MIN_PURPOSE ? 0.5 : 0),
    }));
  return units.length === 0 ? null : { heading, units, field: false };
}

function fieldBlock(label: string, value: string): Block | null {
  const text = plainDescriptionText(value).replace(/[.]$/, "");
  if (text === "" || IGNORED_FIELDS.has(label.toLowerCase())) return null;
  const score = FIELD_SCORES[label.toLowerCase()] ?? rulesCueScore(text) + 1;
  return { heading: label, units: [{ text, score }], field: true };
}

/** A DC table as one line: "Plot a course DC 10; ...". Rows that only say "Varies" say nothing. */
function tableBlock(markup: string): Block | null {
  const rows = [...markup.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => plainDescriptionText(cell[1])),
  );
  const unit = /<thead\b/i.test(markup) ? rows[0]?.[1] : undefined;
  const lines = rows
    .slice(/<thead\b/i.test(markup) ? 1 : 0)
    .filter((row) => row.length >= 2 && !/^varies$/i.test(row[1]!))
    .map((row) => `${row[0]} ${unit === undefined ? "" : `${unit} `}${row[1]}`.replace(/\s+/g, " "));
  if (lines.length === 0) return null;
  const text = lines.join("; ");
  return { heading: "", units: [{ text, score: rulesCueScore(text) + 1 }], field: true };
}

function parse(xml: string): Block[] {
  const source = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class="reference"[^>]*>[\s\S]*?<\/div>/gi, "");
  const blocks: Block[] = [];
  for (const match of source.matchAll(/<(p|ul|table)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const kind = match[1]!.toLowerCase();
    const inner = match[2]!;
    if (kind === "p") {
      const block = proseBlock(inner, blocks.length === 0);
      if (block !== null) blocks.push(block);
    } else if (kind === "table") {
      const block = tableBlock(inner);
      if (block !== null) blocks.push(block);
    } else {
      for (const item of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const labelled = /^\s*<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>([\s\S]*)$/i.exec(item[1]!);
        const block = labelled === null
          ? proseBlock(item[1]!, blocks.length === 0)
          : fieldBlock(plainDescriptionText(labelled[1]).replace(/:$/, ""), labelled[2]!);
        if (block !== null) blocks.push(block);
      }
    }
  }
  return blocks;
}

const blockText = (block: Block): string => {
  const body = block.units.map((unit) => unit.text).join(" ");
  const tail = /[.!?]$/.test(body) ? "" : ".";
  if (block.heading === "") return `${body}${tail}`;
  return block.field ? `${block.heading}: ${body}${tail}` : `${block.heading}. ${body}`;
};

const noteLength = (blocks: readonly Block[]): number =>
  blocks.filter((block) => block.units.length > 0).map(blockText).join(" ").length;

function blockHtml(block: Block): string {
  const body = escapeHtml(block.units.map((unit) => unit.text).join(" "));
  const tail = /[.!?]$/.test(body) ? "" : ".";
  if (block.heading === "") return `<p>${body}${tail}</p>`;
  const heading = escapeHtml(block.heading);
  return block.field
    ? `<p><strong>${heading}:</strong> ${body}${tail}</p>`
    : `<p><strong><em>${heading}.</em></strong> ${body}</p>`;
}

/**
 * The note for one item description: the highest-ranked sentences that fit
 * `budget`, in the description's own order, each rule paragraph keeping its
 * heading. Null when the description says nothing; an empty note when its
 * rules cannot be shortened to fit.
 *
 * Each paragraph's best sentence is placed first, strongest paragraph first, so
 * every way of using the item gets a say before any of them gets a second
 * sentence. Passages with no rules cue are flavour and only stand in when there
 * is nothing else.
 */
export function itemNote(xml: string | undefined, budget = NOTE_BUDGET): ItemNote | null {
  const blocks = parse(xml ?? "");
  if (blocks.length === 0) return null;
  const all = blocks.flatMap((block) => block.units.map((unit) => ({ block, unit })));
  const anchors = new Set(
    blocks.map((block) => block.units.reduce((best, unit) => (unit.score > best.score ? unit : best))),
  );
  const ranked = all
    .filter(({ unit }) => unit.score > 0)
    .sort((a, b) => Number(anchors.has(b.unit)) - Number(anchors.has(a.unit)) || b.unit.score - a.unit.score);
  const kept = new Set<Unit>();
  const view = (): Block[] =>
    blocks.map((block) => ({ ...block, units: block.units.filter((unit) => kept.has(unit)) }));
  for (const { unit } of ranked) {
    kept.add(unit);
    if (noteLength(view()) > budget) kept.delete(unit);
  }
  if (kept.size === 0) {
    if (ranked.length > 0) return { html: "", text: "" };
    kept.add(all[0]!.unit);
    if (noteLength(view()) > budget) return { html: "", text: "" };
  }
  const shown = view().filter((block) => block.units.length > 0);
  return { html: shown.map(blockHtml).join(""), text: shown.map(blockText).join(" ") };
}
