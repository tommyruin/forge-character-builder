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
/**
 * What an item with several headed uses may run to so that every use keeps its
 * key clause. Past it the item prints by name alone.
 */
export const USES_BUDGET = 520;

export interface ItemNote {
  /** Escaped `<p>` markup for the column; empty when the item prints by name alone. */
  html: string;
  /** The same text without markup. */
  text: string;
}

interface Unit {
  text: string;
  score: number;
  /** Opens by leaning on the sentence before it; weighed down only as a use's key clause. */
  lean?: boolean;
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
/** List lines that add to a use but are not one ("Craft: <items>"). */
const OPTIONAL_FIELDS = new Set(["craft"]);
/** An opening that leans on the sentence before it ("That duration ..."): poor on its own. */
const ANAPHORA = /^(?:That|This|These|Those|It|Its|They|Such)\b/;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z“‘("])/;
/** "as detailed below": a pointer to text the note does not carry. */
const DANGLING = /\b(?:detailed|described|listed|shown|given|explained)\s+(?:below|above)\b/i;
const HEADING = /^\s*<(strong|b)>\s*<(em|i)>([\s\S]*?)<\/\2>\s*<\/\1>([\s\S]*)$/i;

export function escapeHtml(value: string): string {
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

function proseBlock(markup: string, first: boolean, compact: boolean): Block | null {
  const match = HEADING.exec(markup);
  const heading = match === null ? "" : plainDescriptionText(match[3]).replace(/\.$/, "");
  if (SKILL_HEADING.test(heading)) return null;
  const body = plainDescriptionText(match === null ? markup : match[4]);
  if (!compact && heading !== "" && body.length <= WHOLE_PARAGRAPH && !DANGLING.test(body)) {
    return body === "" ? null : { heading, units: [{ text: body, score: rulesCueScore(body) }], field: false };
  }
  const units = sentences(body)
    .filter((part) => !DANGLING.test(part))
    .map((part, index) => ({
      text: part,
      // What the item is for reads well when there is room, and not before a rule.
      score: (DM_ASIDE.test(part) ? 0 : rulesCueScore(part)) + (first && index === 0 && part.length >= MIN_PURPOSE ? 0.5 : 0),
      lean: index > 0 && ANAPHORA.test(part),
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

function parse(xml: string, compact: boolean): Block[] {
  const source = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class="reference"[^>]*>[\s\S]*?<\/div>/gi, "");
  const blocks: Block[] = [];
  for (const match of source.matchAll(/<(p|ul|table)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const kind = match[1]!.toLowerCase();
    const inner = match[2]!;
    if (kind === "p") {
      const block = proseBlock(inner, blocks.length === 0, compact);
      if (block !== null) blocks.push(block);
    } else if (kind === "table") {
      const block = tableBlock(inner);
      if (block !== null) blocks.push(block);
    } else {
      for (const item of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const labelled = /^\s*<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>([\s\S]*)$/i.exec(item[1]!);
        const block = labelled === null
          ? proseBlock(item[1]!, blocks.length === 0, compact)
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

/** The unit that carries a block: the highest-ranked, the shorter of equals. */
function keyUnit(block: Block): Unit {
  const worth = (unit: Unit): number => unit.score - (unit.lean === true ? 1.5 : 0);
  return block.units.reduce((best, unit) =>
    worth(unit) > worth(best) || (worth(unit) === worth(best) && unit.text.length < best.text.length) ? unit : best,
  );
}

/**
 * The units a note cannot leave out: the key clause of every headed use (an
 * indented rule paragraph with its run-in heading), every list line but
 * "Craft", and every DC table. Dropping one drops a way of using the item.
 */
function mandatoryUnits(blocks: readonly Block[]): Set<Unit> {
  const required = new Set<Unit>();
  for (const block of blocks) {
    if (block.field) {
      if (!OPTIONAL_FIELDS.has(block.heading.toLowerCase())) required.add(block.units[0]!);
    } else if (block.heading !== "") {
      required.add(keyUnit(block));
    }
  }
  return required;
}

/**
 * The note for one item description, in the description's own order. Null when
 * the description says nothing; an empty note (the item prints by name alone)
 * when what it must say cannot be shortened to fit.
 *
 * Every headed use keeps its key clause, whatever else goes, up to
 * {@link USES_BUDGET}; a use is never dropped to make the budget (a heading
 * paragraph is split into sentences before giving up). Beyond those, the
 * highest-ranked sentences fill {@link NOTE_BUDGET}, each paragraph's best
 * first, so every paragraph gets a say before any gets a second sentence.
 * Passages with no rules cue are flavour and only stand in when there is
 * nothing else.
 */
export function itemNote(xml: string | undefined, budget = NOTE_BUDGET): ItemNote | null {
  const whole = parse(xml ?? "", false);
  if (whole.length === 0) return null;
  let blocks = whole;
  let required = mandatoryUnits(blocks);
  const length = (kept: ReadonlySet<Unit>): number =>
    noteLength(blocks.map((block) => ({ ...block, units: block.units.filter((unit) => kept.has(unit)) })));
  if (length(required) > USES_BUDGET) {
    // Cut headed paragraphs down to their key sentence before giving up.
    blocks = parse(xml ?? "", true);
    required = mandatoryUnits(blocks);
    if (length(required) > USES_BUDGET) return { html: "", text: "" };
  }
  const all = blocks.flatMap((block) => block.units);
  const anchors = new Set(
    blocks.filter((block) => !required.has(block.units[0]!) || block.units.length > 1).map(keyUnit),
  );
  const ranked = all
    .filter((unit) => unit.score > 0 && !required.has(unit))
    .sort((a, b) => Number(anchors.has(b)) - Number(anchors.has(a)) || b.score - a.score);
  const kept = new Set<Unit>(required);
  for (const unit of ranked) {
    kept.add(unit);
    if (length(kept) > Math.max(budget, length(required))) kept.delete(unit);
  }
  if (kept.size === 0) {
    if (ranked.length > 0) return { html: "", text: "" };
    kept.add(all[0]!);
    if (length(kept) > budget) return { html: "", text: "" };
  }
  const shown = blocks
    .map((block) => ({ ...block, units: block.units.filter((unit) => kept.has(unit)) }))
    .filter((block) => block.units.length > 0);
  return { html: shown.map(blockHtml).join(""), text: shown.map(blockText).join(" ") };
}
