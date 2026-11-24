/**
 * The sheet's "Saving Throw Notes" box: a compact list of what the character
 * itself has Advantage on, read from the text of the features and species
 * traits the sheet prints ("Adv: Charmed, Frightened, Concentration").
 *
 * The note states rules on someone's sheet, so the reader is deliberately
 * strict and leaves out whatever it cannot state correctly:
 *
 * - The subject must be "you" ("You have Advantage on ...", "..., and you gain
 *   advantage on ...") or a sentence that opens on "Advantage on ...". Another
 *   creature's benefit, a shared one ("you and your allies") and Disadvantage
 *   never match.
 * - Everything after "saving throws" must be a scope this module can name. A
 *   narrower one ("... on that spell", "... forced by Fiends") is left out
 *   rather than printed as if it always applied.
 * - A benefit tied to Rage says so ("Str (Rage)"). One tied to any other
 *   temporary state (a timed form, a carried token, "for the duration") is
 *   left out: the box is too small to state the condition.
 *
 * This module has no engine dependencies.
 */

/** A printed feature or trait: its title and its description as the sheet prints it. */
export interface SaveNoteSource {
  readonly title: string;
  readonly text: string;
}

const ABILITY_TERMS: Readonly<Record<string, string>> = {
  strength: "Str",
  dexterity: "Dex",
  constitution: "Con",
  intelligence: "Int",
  wisdom: "Wis",
  charisma: "Cha",
};
const ABILITY = Object.keys(ABILITY_TERMS).join("|");
const ABILITY_LIST = `(?:${ABILITY})(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)(?:${ABILITY}))*`;

/** What a save can be against, most specific wording first. */
const TARGETS: readonly (readonly [RegExp, string])[] = ([
  ["spells and other magical effects", "Magic"],
  ["spells cast by creatures within 5 feet of you", "Spells (5 ft)"],
  ["plants that are magically created or manipulated to impede movement(?:,\\s+such\\s+(?:as\\s+)?those\\s+created\\s+by\\s+the\\s+entangle\\s+spell)?", "Magic plants"],
  ["spells", "Spells"],
  ["magic", "Magic"],
  ["illusions", "Illusions"],
  ["(?:any\\s+)?disease", "Disease"],
  ["poisoned", "Poisoned"],
  ["poison", "Poison"],
  ["blinded", "Blinded"],
  ["charmed", "Charmed"],
  ["deafened", "Deafened"],
  ["frightened", "Frightened"],
  ["grappled", "Grappled"],
  ["paraly[sz]ed", "Paralysed"],
  ["petrified", "Petrified"],
  ["restrained", "Restrained"],
  ["stunned", "Stunned"],
  ["put to sleep", "Sleep"],
  ["moved", "Moved"],
  ["knocked prone", "Prone"],
] as const).map(([pattern, term]) => [new RegExp(`^(?:(?:being|becoming|the)\\s+)*${pattern.replaceAll(" ", "\\s+")}\\b`, "i"), term] as const);

/** The printed order: abilities, then conditions, then everything else. */
const TERM_ORDER: readonly string[] = [
  "Str", "Dex", "Con", "Int", "Wis", "Cha",
  "Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Paralysed", "Petrified",
  "Poisoned", "Prone", "Restrained", "Sleep", "Stunned",
  "Concentration", "Death", "Poison", "Disease", "Magic", "Spells", "Illusions", "Magic plants",
  "Traps", "Moved", "Falling off mount",
];
/** An ability save limited to one source ("Int/Wis/Cha vs Magic") sorts after the plain abilities. */
const SCOPED_ABILITY_RANK = 5.5;

const SAVE = new RegExp(`^(?:(death)\\s+)?(?:(${ABILITY_LIST})\\s+)?(?:saving\\s+throws?|saves?)\\b`, "i");
/** "Strength checks and ...", "Strength-based ability checks and ...", "Wisdom (Insight) checks and on ...". */
const CHECKS = new RegExp(`^(${ABILITY_LIST})(?:-based)?(\\s*\\([^)]*\\))?(?:\\s+ability)?\\s+checks?\\s+and\\s+(?:on\\s+)?`, "i");
const CONCENTRATION = /^\s+(?:that\s+)?(?:you\s+make\s+|made\s+)?to\s+maintain\s+(?:your\s+)?concentration(?:\s+on\s+a\s+spell)?(?:\s+when\s+you\s+take\s+damage)?\b/i;
const SEEN_EFFECTS = /^\s+against\s+effects\s+that\s+you\s+can\s+see(?:,\s+such\s+as\s+traps\s+and\s+spells)?/i;
const UNLESS_INCAPACITATED = /^\s+unless\s+you\s+have\s+the\s+incapacitated\s+condition\b/i;
const TRAPS = /^\s+(?:you\s+make\s+|made\s+)?to\s+avoid\s+or\s+resist\s+traps\b/i;
const MOUNT = /^\s+(?:you\s+make\s+|made\s+)?to\s+avoid\s+falling\s+off\s+(?:a|your)\s+mount\b/i;
const TARGET_LEAD = /^\s+(?:(?:that\s+)?you\s+make\s+|made\s+)?(?:to\s+avoid\s+or\s+end|to\s+avoid|against)\s+/i;
const TARGET_SEPARATOR = /^(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)(?:against\s+)?/i;
const AFTER_TARGET = /^(?:\s*$|\s*[.!?,;]|\s+(?:and|or|conditions?|on\s+yourself)\b)/i;
const CONDITION_WORD = /^\s+conditions?\b(?:\s+on\s+yourself)?/i;
const ON_YOURSELF = /^\s+on\s+yourself\b/i;
/** What may follow a benefit: the sentence's end, or a new clause. */
const CLAUSE_END = /^\s*(?:[.!?]?\s*$|[,;]\s*(?:and|but)\s|and\s+you\b)/i;

const BENEFIT = /\byou(?:\s+also)?\s+(?:have|gain)\s+advantage\s+on\s+/gi;
const OPENING_BENEFIT = /^advantage\s+on\s+/i;
const CONNECTIVE = /^(?:in addition|additionally|also|furthermore|moreover),?$/i;
const COORDINATED_CLAUSE = /^you\s+(?:have|gain)\b.*\band$/i;
const RAGE_STATE = /\bwhile\s+(?:you(?:'re|’re|\s+are)\s+)?raging\b|\buntil\s+your\s+rage\s+ends\b|\bin\s+your\s+rage\b/i;
const TEMPORARY_STATE = /\b(?:while|when|whenever|if|until|during|for\s+(?:\d+|one|the\s+duration|up\s+to)|minutes?|hours?|rounds?|last|lasts)\b/i;

function abilityTerms(list: string | undefined): string[] {
  return (list?.match(new RegExp(ABILITY, "gi")) ?? []).map((name) => ABILITY_TERMS[name.toLowerCase()]!);
}

/** The save target opening `text`, if a list could carry on or end straight after it. */
function readTarget(text: string): { term: string; rest: string } | null {
  for (const [pattern, term] of TARGETS) {
    const hit = pattern.exec(text);
    if (hit === null) continue;
    const rest = text.slice(hit[0].length);
    // "..., and magic can't put you to sleep" opens a new clause on a target's word.
    return AFTER_TARGET.test(rest) ? { term, rest } : null;
  }
  return null;
}

/** A list of save targets from the start of `text` ("being charmed, frightened, or stunned"). */
function readTargets(text: string): { terms: string[]; rest: string } | null {
  const first = readTarget(text);
  if (first === null) return null;
  const terms = [first.term];
  let rest = first.rest;
  for (;;) {
    const separator = TARGET_SEPARATOR.exec(rest);
    if (separator === null) return { terms, rest };
    const next = readTarget(rest.slice(separator[0].length));
    if (next === null) return { terms, rest };
    terms.push(next.term);
    rest = next.rest;
  }
}

/** The compact terms of what follows "advantage on", or null when its scope cannot be stated. */
function readBenefit(object: string): string[] | null {
  let text = object.replace(/^(?:all|any)\s+/i, "");
  let carried: string[] = [];
  const checks = CHECKS.exec(text);
  if (checks !== null) {
    if (checks[2] === undefined) carried = abilityTerms(checks[1]);
    text = text.slice(checks[0].length);
  }
  const save = SAVE.exec(text);
  if (save === null) return null;
  const named = abilityTerms(save[2]);
  const abilities = named.length > 0 ? named : carried;
  const death = save[1] !== undefined;
  let rest = text.slice(save[0].length);
  let terms: string[] | null = null;
  const take = (pattern: RegExp): boolean => {
    const hit = pattern.exec(rest);
    if (hit === null) return false;
    rest = rest.slice(hit[0].length);
    return true;
  };
  if (death) {
    terms = abilities.length > 0 ? null : ["Death"];
    if (terms === null) return null;
  } else if (take(CONCENTRATION)) {
    terms = ["Concentration"];
  } else if (take(SEEN_EFFECTS)) {
    if (abilities.length === 0) return null;
    terms = abilities.map((ability) => `${ability} (seen)`);
  } else if (take(UNLESS_INCAPACITATED)) {
    if (abilities.length === 0) return null;
    terms = abilities;
  } else if (take(TRAPS)) {
    terms = ["Traps"];
  } else if (take(MOUNT)) {
    terms = ["Falling off mount"];
  } else if (take(TARGET_LEAD)) {
    const targets = readTargets(rest);
    if (targets === null) return null;
    rest = targets.rest;
    if (!take(CONDITION_WORD)) take(ON_YOURSELF);
    terms = abilities.length === 0
      ? targets.terms
      : targets.terms.map((target) => `${abilities.join("/")} vs ${target}`);
  } else {
    if (abilities.length === 0) return null;
    terms = abilities;
  }
  return CLAUSE_END.test(rest) ? terms : null;
}

/** The note's terms for one printed feature, in the order its text states them. */
export function saveAdvantageTerms(source: SaveNoteSource): string[] {
  const rageFeature = /^(?:level\s+\d+:\s*)?rage$/i.test(source.title.trim());
  const terms: string[] = [];
  let leadIn = "";
  for (const rawLine of source.text.split(/[\r\n]+|\s+•\s+/)) {
    const line = rawLine.trim().replace(/^[•*]\s*/, "");
    if (line === "") continue;
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const hits: { at: number; object: string }[] = [];
      const opening = OPENING_BENEFIT.exec(sentence);
      if (opening !== null) hits.push({ at: 0, object: sentence.slice(opening[0].length) });
      for (const hit of sentence.matchAll(BENEFIT)) {
        hits.push({ at: hit.index, object: sentence.slice(hit.index + hit[0].length) });
      }
      for (const { at, object } of hits) {
        const before = sentence.slice(0, at).trim();
        const scope = `${leadIn} ${before}`;
        const raging = rageFeature || RAGE_STATE.test(scope);
        if (!raging) {
          if (TEMPORARY_STATE.test(scope)) continue;
          if (before !== "" && !CONNECTIVE.test(before) && !COORDINATED_CLAUSE.test(before)) continue;
        }
        const read = readBenefit(object);
        if (read === null) continue;
        terms.push(...(raging ? read.map((term) => `${term} (Rage)`) : read));
      }
    }
    if (line.endsWith(":")) leadIn = line;
  }
  return terms;
}

function termRank(term: string): number {
  if (term.includes(" vs ")) return SCOPED_ABILITY_RANK;
  const index = TERM_ORDER.indexOf(baseTerm(term));
  return index === -1 ? TERM_ORDER.length : index;
}

/** A term without its qualifier: "Str (Rage)" is "Str". */
function baseTerm(term: string): string {
  return term.replace(/\s+\([^)]*\)$/, "");
}

/** Whether a broader term in the note already says what `term` says. */
function isCovered(term: string, all: ReadonlySet<string>): boolean {
  const base = baseTerm(term);
  if (base !== term && all.has(base)) return true;
  if (base === "Poisoned" && all.has("Poison")) return true;
  return base === "Spells" && all.has("Magic");
}

/** The whole "Saving Throw Notes" text, or "" when nothing printed grants Advantage on a save. */
export function savingThrowNote(sources: readonly SaveNoteSource[]): string {
  const all = new Set(sources.flatMap(saveAdvantageTerms));
  const terms = [...all]
    .filter((term) => !isCovered(term, all))
    .sort((a, b) => termRank(a) - termRank(b) || a.localeCompare(b));
  return terms.length === 0 ? "" : `Adv: ${terms.join(", ")}`;
}
