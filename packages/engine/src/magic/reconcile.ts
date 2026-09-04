import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import type { Dnd5eDocument } from "../dnd5e/document.js";
import type { RawEdit } from "../selection/selection.js";
import { isSpellcastingExtension } from "../content/parser.js";
import { multiclassSlotProgression } from "../statistics/calculator.js";
import { spellInfo, canonicalSourceRank } from "./spelllist.js";
import { applySpellRiders, damageWithBonus } from "./spell-riders.js";
import { featureSpellCasters } from "./feature-casters.js";
import { grantedCasterAbility, GRANTED_CASTER_KEY, GRANTED_CASTER_NAME } from "./dto.js";
import type { MagicAdditionalSpell, MagicCasterBlock, MagicSpellEntry, MagicState } from "./state.js";

/**
 * Magic reconciliation + companion/attack-option projections.
 *
 * `reconcileMagic` re-derives the magic region state from the character's
 * spell rules after registration-changing operations and plans a region edit
 * when the serialized block no longer matches (delevel, selection changes).
 */

export interface CompanionAbilityDto {
  name: string;
  score: number;
  modifier: number;
}

export interface CompanionFeatureDto {
  id: string;
  name: string;
  type: string;
  /** The feature's rules text, flattened from its content description. */
  description: string;
}

export interface CompanionDto {
  elementId: string | null;
  name: string;
  build: string;
  size: string;
  creatureType: string;
  alignment: string;
  challenge: string;
  proficiency: number;
  armorClass: number;
  armorClassText: string;
  maxHp: number;
  hitPointsText: string;
  initiative: number;
  speed: number;
  speedFly: number;
  speedClimb: number;
  speedSwim: number;
  speedBurrow: number;
  speedText: string;
  attackBonus: number;
  damageBonus: number;
  senses: string;
  languages: string;
  skills: string;
  savingThrows: string;
  damageVulnerabilities: string;
  damageResistances: string;
  damageImmunities: string;
  conditionVulnerabilities: string;
  conditionResistances: string;
  conditionImmunities: string;
  abilities: CompanionAbilityDto[];
  traits: CompanionFeatureDto[];
  actions: CompanionFeatureDto[];
  reactions: CompanionFeatureDto[];
  source: string;
  /** The creature's own name ("Owl"), independent of a user-given name. */
  kind: string;
  /** The feature that granted the companion ("Find Familiar"), when known. */
  owner: string;
  /** Base64 portrait bytes, empty when the companion has none. */
  portrait: string;
}

const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function leadingNumber(text: string): number {
  const match = /^\s*(\d+)/.exec(text);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function setterText(element: { setters: { name: string; value: string }[] }, name: string): string {
  return element.setters.find((setter) => setter.name === name)?.value ?? "";
}

/** Flattens a content description to the plain rules text a sheet can lay out. */
function descriptionText(xml: string | undefined): string {
  if (xml === undefined) return "";
  return xml
    .replace(/<\/(?:p|div|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function featureDtos(library: ElementLibrary, ids: string[]): CompanionFeatureDto[] {
  const features: CompanionFeatureDto[] = [];
  for (const id of ids) {
    const element = library.byId.get(id);
    if (element === undefined) continue;
    features.push({
      id,
      name: element.identity.name,
      type: element.identity.type,
      description: descriptionText(element.descriptionXml),
    });
  }
  return features;
}

/**
 * A creature's own proficiency bonus follows its challenge rating. Content may
 * override it (an artificer's Steel Defender uses its creator's bonus), which
 * is why the statistic wins when a rule sets one.
 */
function challengeProficiency(challenge: string): number {
  const rating = /^\s*1\s*\/\s*\d+/.test(challenge) ? 0 : Number.parseFloat(challenge);
  const value = Number.isFinite(rating) ? rating : 0;
  return 2 + Math.max(0, Math.ceil((value - 4) / 4));
}

/** The name of the rule that registered the companion, e.g. "Find Familiar". */
function companionOwner(state: CharacterState, elementId: string): string {
  let owner = "";
  const walk = (nodes: CharacterState["elements"]): void => {
    for (const node of nodes) {
      if (owner === "" && node.type === "Companion" && (node.registered ?? "") === elementId) {
        owner = node.name;
      }
      walk(node.children);
    }
  };
  walk(state.elements);
  return owner;
}

/** The companion projection (pinned Steel Defender shape). */
export function buildCompanionDto(
  state: CharacterState,
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
): CompanionDto | null {
  const element = state.sum.elements.find((candidate) => candidate.type === "Companion");
  if (element === undefined) return null;
  const definition = library.byId.get(element.id);
  if (definition === undefined) return null;

  const size = setterText(definition, "size");
  const creatureType = setterText(definition, "type");
  const alignment = setterText(definition, "alignment");
  const armorClassText = setterText(definition, "ac");
  const hitPointsText = setterText(definition, "hp");
  const speedText = setterText(definition, "speed");
  const abilityScore = (name: string): number => {
    const setter = definition.setters.find((candidate) => candidate.name === name.toLowerCase());
    const score = Number.parseInt(setter?.value ?? "", 10);
    return Number.isFinite(score) ? score : (state.companion.attributes[name.toLowerCase() as keyof typeof state.companion.attributes] ?? 0);
  };
  const abilities: CompanionAbilityDto[] = ABILITIES.map((name) => ({
    name,
    score: abilityScore(name),
    modifier: abilityModifier(abilityScore(name)),
  }));
  const splitIds = (text: string): string[] => text.split(",").map((id) => id.trim()).filter((id) => id !== "");

  const statAc = statistics["companion:ac"] ?? 0;
  const statSpeed = statistics["companion:speed"] ?? 0;

  return {
    elementId: element.id,
    name: state.companion.name !== "" ? state.companion.name : definition.identity.name,
    build: `${size} ${creatureType.toLowerCase()}, ${alignment}`.replace(/,\s*$/, ""),
    size,
    creatureType,
    alignment,
    challenge: setterText(definition, "challenge"),
    proficiency:
      statistics["companion:proficiency"] ??
      challengeProficiency(setterText(definition, "challenge")),
    armorClass: statAc > 0 ? statAc : leadingNumber(armorClassText),
    armorClassText,
    maxHp: statistics["companion:hp:max"] ?? 0,
    hitPointsText,
    initiative: (statistics["companion:dexterity:modifier"] ?? 0) +
      (statistics["companion:initiative"] ?? 0) +
      (statistics["companion:initiative:misc"] ?? 0),
    speed: statSpeed > 0 ? statSpeed : leadingNumber(speedText),
    speedFly: statistics["companion:speed:fly"] ?? 0,
    speedClimb: statistics["companion:speed:climb"] ?? 0,
    speedSwim: statistics["companion:speed:swim"] ?? 0,
    speedBurrow: statistics["companion:speed:burrow"] ?? 0,
    speedText,
    attackBonus: statistics["companion:attack"] ?? 0,
    damageBonus: statistics["companion:damage"] ?? 0,
    senses: setterText(definition, "senses"),
    languages: setterText(definition, "languages"),
    skills: setterText(definition, "skills"),
    savingThrows: setterText(definition, "saves"),
    damageVulnerabilities: setterText(definition, "vulnerabilities"),
    damageResistances: setterText(definition, "resistances"),
    damageImmunities: setterText(definition, "immunities"),
    conditionVulnerabilities: setterText(definition, "conditionVulnerabilities"),
    conditionResistances: setterText(definition, "conditionResistances"),
    conditionImmunities: setterText(definition, "conditionImmunities"),
    abilities,
    traits: featureDtos(library, splitIds(setterText(definition, "traits"))),
    actions: featureDtos(library, splitIds(setterText(definition, "actions"))),
    reactions: featureDtos(library, splitIds(setterText(definition, "reactions"))),
    source: definition.identity.source,
    kind: definition.identity.name,
    owner: companionOwner(state, element.id),
    portrait: state.portrait.companion,
  };
}

export interface MagicAttackCasterOptionDto {
  identifier: string;
  name: string;
  ability: string;
  attackModifier: number;
  computation: {
    attackBonusContributions: { label: string; value: number }[];
    appliedModifiers: { id: string; name: string; field: string; effect: string }[];
    sourceNotes: string[];
    attackCount: number;
    isPerHit: boolean;
  };
}

export interface MagicAttackSpellOptionDto {
  casterIdentifier: string;
  casterName: string;
  spellId: string;
  spellName: string;
  level: number;
  range: string;
  bonus: string;
  damage: string;
  description: string;
  warning: string | null;
  beamCount: number;
  computation: MagicAttackCasterOptionDto["computation"];
}

export interface MagicAttackOptionsDto {
  casters: MagicAttackCasterOptionDto[];
  spells: MagicAttackSpellOptionDto[];
}

const ABILITY_ABBR: Readonly<Record<string, string>> = {
  Strength: "STR",
  Dexterity: "DEX",
  Constitution: "CON",
  Intelligence: "INT",
  Wisdom: "WIS",
  Charisma: "CHA",
};

/** Ray-count words for the source-note phrasing (e.g. spells reading "three rays"). */
const RAY_COUNT_WORDS: Record<number, string> = {
  1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
};

/** The inverse of RAY_COUNT_WORDS, for reading counts back out of spell text. */
const COUNT_WORD_VALUES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function textOf(descriptionXml: string | undefined): string {
  if (descriptionXml === undefined) return "";
  return descriptionXml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The highest damage die a cantrip upgrade has unlocked at `level`.
 *
 * Every tier lives in one sentence, and the printings word it differently: 2014 reads
 * "when you reach 5th level (2d10), 11th level (3d10)", 2024 reads "when you reach
 * levels 5 (2d10), 11 (3d10)". Anchor on the upgrade clause once, then read tiers out of
 * that clause alone so an unrelated "3rd level (2d6)" elsewhere cannot pose as a tier.
 */
function scaledDamageDice(text: string, dice: string, level: number): string {
  const anchor = /increases by \d+d\d+ when you reach/.exec(text);
  if (anchor === null) return dice;
  const rest = text.slice(anchor.index + anchor[0].length);
  const stop = rest.indexOf(".");
  const clause = stop === -1 ? rest : rest.slice(0, stop);
  const tiers = /(\d+)(?:st|nd|rd|th)?(?: level)?\s*\((\d+d\d+)\)/g;
  let scaled = dice;
  let bestLevel = -1;
  for (const match of clause.matchAll(tiers)) {
    const at = Number.parseInt(match[1]!, 10);
    if (at <= level && at > bestLevel) {
      bestLevel = at;
      scaled = match[2]!;
    }
  }
  return scaled;
}

/**
 * The beam count a character-level cantrip upgrade has unlocked (Eldritch Blast).
 * Covers both printings: "two beams at 5th level" and "two beams at level 5".
 */
function scaledBeamCount(text: string, level: number): number {
  const tiers =
    /(one|two|three|four|five|six|seven|eight|nine|ten) beams? at (?:level )?(\d+)(?:st|nd|rd|th)?(?: level)?/g;
  let count = 1;
  let bestLevel = -1;
  for (const match of text.matchAll(tiers)) {
    const at = Number.parseInt(match[2]!, 10);
    if (at <= level && at > bestLevel) {
      bestLevel = at;
      count = COUNT_WORD_VALUES[match[1]!] ?? 1;
    }
  }
  return count;
}

/** The sentence "Make a ranged spell attack" in every printing's casing and count. */
const SPELL_ATTACK_GATE = /\bmake (?:a|one|up to \w+) (?:ranged|melee) spell attacks?\b/i;

/** The word count of a spell's projectiles, tolerant of adjectives between count and noun. */
const PROJECTILE_COUNT =
  /\byou (?:create|hurl) (one|two|three|four|five|six|seven|eight|nine|ten)(?: [\w-]+,?){0,6}? (rays?|beams?|darts?)\b/i;

/**
 * Upcast projectiles: "one additional ray for each spell slot level above 2".
 * A clause may sit between the noun and "for each" ("one more dart, and the
 * royalty component increases by 1 gp, for each slot level above 1st").
 */
const PROJECTILE_UPCAST =
  /\bone (?:additional|more) (ray|beam|dart|missile)[^.]{0,80}?\bfor (?:each|every) (?:spell )?slot level above (\d+)(?:st|nd|rd|th)?/i;

/** Upcast damage: "the damage increases by 1d6 for each slot level above 1st". */
const DAMAGE_UPCAST = /\bincreases by (\d+d\d+) for (?:each|every) (?:spell )?slot level above (\d+)(?:st|nd|rd|th)?/i;

/** Any dice-plus-type damage clause, for spotting secondary damage sentences. */
const DAMAGE_CLAUSE = /\b\d+d\d+(?: ?\+ ?\d+d\d+)?(?: (?:[\w-]+ )?[\w-]+)? damage\b/gi;

const ordinal = (value: number): string => {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
};

interface PrimaryDamage {
  dice: string;
  type: string;
  /** The matched span, so the same clause is not re-reported as secondary damage. */
  start: number;
  end: number;
  addsSpellcastingModifier: boolean;
}

/**
 * The per-hit damage clause. The printings phrase the subject many ways ("the
 * target takes", "it takes", "a missile deals", "takes Fire damage equal to"),
 * so the shapes are matched independently and the earliest wins.
 */
function primaryDamage(text: string): PrimaryDamage | null {
  const candidates: PrimaryDamage[] = [];
  const equalTo = /\btakes ((?:[\w-]+ )?[\w-]+) damage equal to (\d+d\d+)( (?:\+|plus) your spellcasting ability modifier)?/i.exec(text);
  if (equalTo !== null) {
    candidates.push({
      dice: equalTo[2]!,
      type: equalTo[1]!,
      start: equalTo.index,
      end: equalTo.index + equalTo[0].length,
      addsSpellcastingModifier: equalTo[3] !== undefined,
    });
  }
  const takes = /\btakes (\d+d\d+(?: ?\+ ?\d+d\d+)?)(?: ((?:[\w-]+ )?[\w-]+))? damage\b/i.exec(text);
  if (takes !== null) {
    const after = text.slice(takes.index + takes[0].length);
    const chosen = /^ of (?:the type you cho(?:o)?se|the chosen type)/i.test(after);
    candidates.push({
      dice: takes[1]!.replace(/\s+/g, ""),
      type: takes[2] ?? (chosen ? "(chosen type)" : ""),
      start: takes.index,
      end: takes.index + takes[0].length,
      addsSpellcastingModifier: false,
    });
  }
  const deals = /\bdeals (\d+d\d+) ((?:[\w-]+ )?[\w-]+) damage\b/i.exec(text);
  if (deals !== null) {
    candidates.push({
      dice: deals[1]!,
      type: deals[2]!,
      start: deals.index,
      end: deals.index + deals[0].length,
      addsSpellcastingModifier: false,
    });
  }
  candidates.sort((left, right) => left.start - right.start);
  return candidates[0] ?? null;
}

/** The sentence containing `index`, trimmed to its full stop. */
function sentenceAt(text: string, index: number): string {
  const before = text.lastIndexOf(". ", index);
  const start = before === -1 ? 0 : before + 2;
  const after = text.indexOf(".", index);
  const end = after === -1 ? text.length : after + 1;
  return text.slice(start, end).trim();
}

/** Damage clauses outside the primary hit, each quoted once as a note. */
function secondaryDamageNotes(text: string, primary: PrimaryDamage | null): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DAMAGE_CLAUSE)) {
    const index = match.index ?? 0;
    if (primary !== null && index >= primary.start && index < primary.end) continue;
    const sentence = sentenceAt(text, index);
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    notes.push(`Also in the description: ${sentence}`);
  }
  return notes;
}

export interface SpellAttackParse {
  /** Per-hit damage, e.g. "1d10 fire"; "" when the description has no damage roll. */
  damage: string;
  beamCount: number;
  beamUnit: "beams" | "rays" | "darts" | "attacks";
  /** True when the text adds the caster's spellcasting ability modifier to the damage. */
  addsSpellcastingModifier: boolean;
  /** Decisions the player has to make (upcasting, a missing damage roll). */
  warning: string | null;
  /** Secondary damage sentences, quoted so they stay visible without being applied. */
  notes: string[];
}

/** Parses attack-roll spell data from the spell description (pinned). */
export function parseSpellAttack(descriptionXml: string | undefined, level: number): SpellAttackParse | null {
  const text = textOf(descriptionXml);
  if (!SPELL_ATTACK_GATE.test(text)) return null;
  const primary = primaryDamage(text);
  let damage = "";
  if (primary !== null) {
    const dice = /^\d+d\d+$/.test(primary.dice) ? scaledDamageDice(text, primary.dice, level) : primary.dice;
    damage = primary.type === "" ? dice : `${dice} ${primary.type}`;
  }
  // Slot-driven rays (Scorching Ray) and level-driven beams (Eldritch Blast) are
  // separate rules: take whichever is higher so neither can lower the other.
  const projectiles = PROJECTILE_COUNT.exec(text);
  const rayCount = projectiles ? COUNT_WORD_VALUES[projectiles[1]!.toLowerCase()] ?? 1 : 1;
  const rayUnit = projectiles ? `${projectiles[2]!.toLowerCase().replace(/s$/, "")}s` as "rays" | "beams" | "darts" : "attacks";
  const beams = scaledBeamCount(text, level);
  const beamCount = Math.max(rayCount, beams, 1);
  const beamUnit = beams > rayCount ? "beams" : rayCount > 1 ? rayUnit : "attacks";
  const warnings: string[] = [];
  const upcastProjectiles = PROJECTILE_UPCAST.exec(text);
  if (rayCount > 1 && upcastProjectiles !== null) {
    warnings.push(
      `Higher-level slots create one additional ${upcastProjectiles[1]!.toLowerCase()} per slot level above ${ordinal(Number.parseInt(upcastProjectiles[2]!, 10))}.`,
    );
  }
  const upcastDamage = DAMAGE_UPCAST.exec(text);
  if (upcastDamage !== null) {
    warnings.push(`Higher-level slots add ${upcastDamage[1]} per slot level above ${ordinal(Number.parseInt(upcastDamage[2]!, 10))}.`);
  }
  if (damage === "") warnings.push("No damage roll was found in the description; check the spell text.");
  return {
    damage,
    beamCount,
    beamUnit,
    addsSpellcastingModifier: primary?.addsSpellcastingModifier ?? false,
    warning: warnings.length === 0 ? null : warnings.join(" "),
    notes: secondaryDamageNotes(text, primary),
  };
}


/**
 * The magic attack-option rows: casters and their attack-roll spells.
 * Spell attacks are parsed from the spell descriptions.
 */
export function buildMagicAttackOptions(
  state: CharacterState,
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
  casterIds: ReadonlyMap<string, string>,
): MagicAttackOptionsDto {
  const magic = state.magic;
  const casters: MagicAttackCasterOptionDto[] = [];
  const spells: MagicAttackSpellOptionDto[] = [];
  // Feature spells (Magic Initiate's Fire Bolt) exist without a `<magic>`
  // region, so they are collected before the early return.
  const featureCasters = featureSpellCasters(state, library);
  if (magic === null && featureCasters.length === 0) return { casters, spells };

  const proficiency = statistics["proficiency"] ?? 0;
  const abilityModifier = (ability: string): number => {
    const key = `${ability.toLowerCase()}:modifier`;
    return statistics[key] ?? 0;
  };
  const registered = new Set(state.sum.elements.map((entry) => entry.id));
  const nameOf = (id: string): string | undefined => library.byId.get(id)?.identity.name;

  // Caster blocks and feature casters project the same attack rows; only the
  // attack modifier differs (a feature caster has no per-caster statistics).
  const sources: { identifier: string; name: string; ability: string; attackModifier: number; spellIds: string[] }[] = [];
  for (const block of magic?.casters ?? []) {
    const abbr = ABILITY_ABBR[block.ability] ?? block.ability;
    sources.push({
      identifier: casterIds.get(block.name) ?? block.name,
      name: block.name,
      ability: block.ability,
      attackModifier:
        statistics[`spellcasting:attack:${abbr.toLowerCase()}`] ?? proficiency + abilityModifier(block.ability),
      spellIds: [...new Set([...block.cantrips, ...block.spells].map((spell) => spell.id))],
    });
  }
  for (const feature of featureCasters) {
    sources.push({
      identifier: casterIds.get(feature.key) ?? feature.key,
      name: feature.name,
      ability: feature.ability,
      attackModifier: proficiency + abilityModifier(feature.ability),
      spellIds: [...new Set([...feature.cantripIds, ...feature.spellIds])],
    });
  }
  // DM grants ride on the first caster block when there is one; with none they
  // stand as their own source, so a granted attack cantrip is still offered as
  // an attack option (the spellcasting DTO projects the matching block).
  if (magic !== null && magic.casters.length === 0 && magic.additional.length > 0) {
    const ability = grantedCasterAbility(statistics);
    sources.push({
      identifier: casterIds.get(GRANTED_CASTER_KEY) ?? GRANTED_CASTER_KEY,
      name: GRANTED_CASTER_NAME,
      ability,
      attackModifier: proficiency + abilityModifier(ability),
      spellIds: [...new Set(magic.additional.map((spell) => spell.id))],
    });
  }

  for (const block of sources) {
    const abbr = ABILITY_ABBR[block.ability] ?? block.ability;
    const attackModifier = block.attackModifier;
    casters.push({
      identifier: block.identifier,
      name: block.name,
      ability: block.ability,
      attackModifier,
      computation: {
        attackBonusContributions: [
          { label: block.ability, value: abilityModifier(block.ability) },
          { label: "Proficiency", value: proficiency },
        ],
        appliedModifiers: [],
        sourceNotes: [],
        attackCount: 1,
        isPerHit: true,
      },
    });
    for (const id of block.spellIds) {
      const element = library.byId.get(id);
      if (element === undefined || element.identity.type !== "Spell") continue;
      const attack = parseSpellAttack(element.descriptionXml, state.level);
      if (attack === null) continue;
      const info = spellInfo(library, id);
      if (info === null) continue;
      const damage = attack.addsSpellcastingModifier
        ? damageWithBonus(attack.damage, abilityModifier(block.ability))
        : attack.damage;
      const sourceNotes: string[] = [];
      if (attack.beamCount > 1) {
        const word = RAY_COUNT_WORDS[attack.beamCount] ?? String(attack.beamCount);
        sourceNotes.push(`${attack.beamCount} ${attack.beamUnit}; damage is shown per hit.`);
        if (attack.warning !== null && attack.warning.includes("one additional")) {
          const unit = attack.beamUnit.replace(/s$/, "");
          sourceNotes.push(`Base casting creates ${word} ${attack.beamUnit}; higher-level slots add one ${unit} per slot level.`);
        }
      }
      if (attack.addsSpellcastingModifier) {
        sourceNotes.push(`${block.ability} modifier added to the damage, as the description says.`);
      }
      const riders = applySpellRiders({
        spellId: id,
        level: info.level,
        school: info.school,
        casterName: block.name,
        range: setterText(element, "range"),
        damage,
        beamCount: attack.beamCount,
        registered,
        statistics,
        nameOf,
      });
      sourceNotes.push(...riders.sourceNotes, ...attack.notes);
      spells.push({
        casterIdentifier: block.identifier,
        casterName: block.name,
        spellId: id,
        spellName: info.name,
        level: info.level,
        range: riders.range,
        bonus: `+${attackModifier} ${abbr} vs AC`,
        damage: riders.damage,
        description: textOf(element.descriptionXml),
        warning: attack.warning,
        beamCount: attack.beamCount,
        computation: {
          attackBonusContributions: [
            { label: block.ability, value: abilityModifier(block.ability) },
            { label: "Proficiency", value: proficiency },
          ],
          appliedModifiers: riders.appliedModifiers,
          sourceNotes,
          attackCount: attack.beamCount,
          isPerHit: true,
        },
      });
    }
  }
  spells.sort((left, right) => {
    const byLevel = left.level - right.level;
    if (byLevel !== 0) return byLevel;
    return canonicalSourceRank(
      library.byId.get(left.spellId)?.identity.source ?? "",
    ) - canonicalSourceRank(library.byId.get(right.spellId)?.identity.source ?? "");
  });
  return { casters, spells };
}

export interface ReconcileResult {
  edits: RawEdit[];
  changed: boolean;
}

/**
 * Collects the character's spell-rule selections per caster: the Spell
 * wrappers registered under each spellcasting feature (cantrips vs others).
 */
export function spellRuleSelections(
  state: CharacterState,
  library: ElementLibrary,
): Map<string, { cantrips: string[]; spells: string[] }> {
  const perCaster = new Map<string, { cantrips: string[]; spells: string[] }>();
  const walk = (nodes: { id: string; name?: string; registered?: string | null; requiredLevel?: number; type?: string; children: { id: string }[] }[], feature: string | null): void => {
    for (const node of nodes) {
      const element = library.byId.get(node.id);
      const nextFeature = element?.spellcasting !== undefined ? element.spellcasting.name : feature;
      const isCantripRule = node.type === "Spell" && (node.name ?? "").startsWith("Cantrip");
      const isSpellRule = node.type === "Spell" && node.requiredLevel !== undefined;
      if (nextFeature !== null && isSpellRule && node.registered !== undefined && node.registered !== null && node.registered !== "") {
        const entry = perCaster.get(nextFeature) ?? { cantrips: [], spells: [] };
        const selected = isCantripRule ? entry.cantrips : entry.spells;
        if (!selected.includes(node.registered)) selected.push(node.registered);
        perCaster.set(nextFeature, entry);
      }
      walk(node.children as never, nextFeature);
    }
  };
  walk(state.elements as never, null);
  return perCaster;
}

/**
 * Re-derives the caster blocks from the character's spell rules. The engine
 * keeps imported raw magic authoritative; this planner only fires when the
 * document has no magic region yet (a fresh build) or the derived caster set
 * (names, ability, attack/dc, slots, or spell ids) no longer matches.
 * Caster blocks are created for every registered non-extension spellcasting
 * feature (empty until the character's spell rules carry selections); blocks
 * whose feature is no longer registered are pruned along with their spells.
 */
export function reconcileMagic(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
): ReconcileResult {
  const magicNode = document.root.build.magic;
  const existing = state.magic;
  const existingCasters = existing?.casters ?? [];

  const selections = spellRuleSelections(state, library);
  const features = spellcastingFeatures(state, library);
  // No live casters and none serialized: nothing to reconcile. When the
  // document still carries caster blocks for features that are no longer
  // registered (a class change removed the caster), fall through so the
  // stale blocks — including their prepared spells — are pruned.
  if (features.length === 0 && existingCasters.length === 0) return { edits: [], changed: false };

  const combined = multiclassSlotProgression(state, library).size >= 2;
  const combinedLevel = combined ? Math.min(20, Math.max(0, statistics["multiclass:spellcasting:level"] ?? 0)) : 0;
  const blocks = buildCasterBlocks(state, library, statistics, selections, features, existing, combined);

  const same = (left: MagicCasterBlock, right: MagicCasterBlock): boolean => {
    if (left.name !== right.name || left.ability !== right.ability) return false;
    if (left.attack !== right.attack || left.dc !== right.dc) return false;
    for (let level = 1; level <= 9; level++) {
      if ((left.slots[`s${level}`] ?? "0") !== (right.slots[`s${level}`] ?? "0")) return false;
    }
    const leftIds = [...left.cantrips, ...left.spells].map((spell) => spell.id).join(",");
    const rightIds = [...right.cantrips, ...right.spells].map((spell) => spell.id).join(",");
    return leftIds === rightIds;
  };
  if (
    magicNode !== null &&
    !magicNode.selfClosing &&
    existing !== null &&
    existing.multiclass === combined &&
    (existing.level ?? "0") === (combined ? String(combinedLevel) : existing.level ?? "0") &&
    blocks.length === existingCasters.length &&
    blocks.every((block, index) => same(block, existingCasters[index]!))
  ) {
    return { edits: [], changed: false };
  }

  // The `<additional>` block (DM-granted spells) is part of the magic region
  // and survives a caster rewrite verbatim.
  const lines = blocks.map(casterBlockLines);
  if (existing !== null && existing.additional.length > 0) {
    lines.push(renderAdditionalBlock(existing.additional));
  }
  const magicOpen = combined ? `<magic multiclass="true" level="${combinedLevel}">` : `<magic>`;
  const rendered = lines.length === 0 ? `\t\t<magic />` : `\t\t${magicOpen}\n${lines.join("\n")}\n\t\t</magic>`;
  const end = document.raw.indexOf("</build>");
  const edits: RawEdit[] = magicNode === null
    ? [{ start: end, end, replacement: `${rendered}\n\t</build>` }]
    : [{ start: magicNode.start, end: magicNode.end, replacement: rendered }];
  return { edits, changed: true };
}

function buildCasterBlocks(
  state: CharacterState,
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
  selections: Map<string, { cantrips: string[]; spells: string[] }>,
  features: { id: string; spellcasting: { name: string; ability?: string } }[],
  existing: MagicState | null,
  combined: boolean,
): MagicCasterBlock[] {
  const blocks: MagicCasterBlock[] = [];
  const byName = new Map<string, { cantrips: string[]; spells: string[] }>();
  for (const [casterName, picked] of selections) byName.set(casterName, picked);
  for (const feature of features) {
    const picked = byName.get(feature.spellcasting.name) ?? { cantrips: [], spells: [] };
    const casterName = feature.spellcasting.name;
    const ability = feature.spellcasting.ability ?? "Intelligence";
    const abbr = ABILITY_ABBR[ability] ?? ability.toUpperCase();
    const attack = statistics[`spellcasting:attack:${abbr.toLowerCase()}`] ?? 0;
    const dc = statistics[`spellcasting:dc:${abbr.toLowerCase()}`] ?? 0;
    // Combined multiclass casters (two or more slot-progression classes)
    // share the combined slot table; Pact Magic always keeps its own slots.
    const useCombined = combined && !feature.id.toUpperCase().includes("PACT_MAGIC");
    const slots: Record<string, string> = {};
    for (let level = 1; level <= 9; level++) {
      const key = useCombined
        ? `multiclass:spellcasting:slot:${level}`
        : `${casterName.toLowerCase()}:spellcasting:slots:${level}`;
      slots[`s${level}`] = String(statistics[key] ?? 0);
    }
    const prior = existing?.casters.find((caster) => caster.name === casterName);
    const priorByLevel = new Map<string, MagicSpellEntry>();
    if (prior !== undefined) {
      for (const spell of [...prior.cantrips, ...prior.spells]) priorByLevel.set(spell.id, spell);
    }
    const entry = (id: string, known: boolean): MagicSpellEntry => {
      const info = spellInfo(library, id);
      const previous = priorByLevel.get(id);
      return {
        name: info?.name ?? id,
        level: info !== null ? String(info.level) : previous?.level ?? "0",
        id,
        prepared: previous?.prepared ?? false,
        alwaysPrepared: previous?.alwaysPrepared ?? known,
        known: previous?.known ?? known,
      };
    };
    blocks.push({
      name: casterName,
      ability,
      attack: String(attack),
      dc: String(dc),
      source: feature.id,
      slots,
      cantrips: picked.cantrips.map((id) => entry(id, false)),
      spells: picked.spells.map((id) => entry(id, true)),
    });
  }
  return blocks;
}

/**
 * The registered spellcasting features (library elements with a spellcasting
 * block). Spell-list extensions (subclass expanded lists, dragonmark traits)
 * never define a caster of their own, and a spellcasting name owns exactly
 * one caster: the first registered feature wins, giving one section per name.
 */
function spellcastingFeatures(
  state: CharacterState,
  library: ElementLibrary,
): { id: string; spellcasting: { name: string; ability?: string } }[] {
  const features: { id: string; spellcasting: { name: string; ability?: string } }[] = [];
  const seenNames = new Set<string>();
  const walk = (nodes: { id: string; children: { id: string }[] }[]): void => {
    for (const node of nodes) {
      const element = library.byId.get(node.id);
      const block = element?.spellcasting;
      if (block !== undefined && !isSpellcastingExtension(block) && !seenNames.has(block.name)) {
        seenNames.add(block.name);
        features.push({ id: node.id, spellcasting: block });
      }
      walk(node.children as never);
    }
  };
  walk(state.elements as never);
  return features;
}

/** Appends an additional-spell entry line inside the `<additional>` block. */
export function additionalSpellLine(spell: MagicAdditionalSpell): string {
  return `\t\t\t\t<spell name="${spell.name}" level="${spell.level}" id="${spell.id}" source="${spell.source}" />`;
}

export function renderAdditionalBlock(additional: MagicAdditionalSpell[]): string {
  if (additional.length === 0) return "\t\t\t<additional />";
  return `\t\t\t<additional>\n${additional.map(additionalSpellLine).join("\n")}\n\t\t\t</additional>`;
}

export function casterBlockLines(block: MagicCasterBlock): string {
  const attrs = [`name="${block.name}"`, `ability="${block.ability}"`, `attack="${block.attack}"`, `dc="${block.dc}"`, `source="${block.source}"`];
  const slots = Object.entries(block.slots)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  const spellLine = (spell: MagicSpellEntry): string => {
    const parts = [`name="${spell.name}"`, `level="${spell.level}"`, `id="${spell.id}"`];
    if (spell.prepared) parts.push(`prepared="true"`);
    if (spell.alwaysPrepared) parts.push(`always-prepared="true"`);
    if (spell.known) parts.push(`known="true"`);
    return parts.join(" ");
  };
  const cantrips = block.cantrips.length === 0
    ? "\t\t\t\t<cantrips />"
    : `\t\t\t\t<cantrips>\n${block.cantrips.map((spell) => `${INDENT}<spell ${spellLine(spell)} />`).join("\n")}\n\t\t\t\t</cantrips>`;
  const spells = block.spells.length === 0
    ? "\t\t\t\t<spells />"
    : `\t\t\t\t<spells>\n${block.spells.map((spell) => `${INDENT}<spell ${spellLine(spell)} />`).join("\n")}\n\t\t\t\t</spells>`;
  return `\t\t\t<spellcasting ${attrs.join(" ")}>\n\t\t\t\t<slots ${slots} />\n${cantrips}\n${spells}\n\t\t\t</spellcasting>`;
}

const INDENT = "\t\t\t\t\t";
