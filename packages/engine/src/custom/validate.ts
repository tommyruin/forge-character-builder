/**
 * Draft validation. A draft arrives as JSON from a form, a character file or a
 * synced store, so every field is checked here and every problem names the
 * field it is about (`blocks[2].value`) rather than a generic "invalid draft".
 * Compilation only ever sees a draft that passed.
 */

import { engineError } from "../errors.js";
import {
  CUSTOM_GRANT_TYPES,
  CUSTOM_EQUIPPED_VALUES,
  CUSTOM_TEMPLATE_OPTIONS,
  modifierTarget,
  valueReference,
} from "./catalogue.js";
import { filterIssues, requirementIssues, type ConditionIssue } from "./conditions.js";
import { scaleIssues, scalesById, trackerIssues } from "./trackers.js";
import {
  CUSTOM_ABILITIES,
  CUSTOM_DRAFT_SCHEMA_VERSION,
  CUSTOM_ITEM_TEMPLATES,
  CUSTOM_OTHER_TYPE,
  CUSTOM_RULESETS,
  CUSTOM_SPELL_TEMPLATE,
  CUSTOM_TEMPLATES,
  DAMAGE_TYPES,
  ITEM_RARITIES,
  SHEET_ACTIONS,
  SHOWS_UNDER,
  SPELL_ROLLS,
  SPELL_SCHOOLS,
  WEAPON_PROPERTY_IDS,
  WORN_SLOTS,
  type CustomAbility,
  type CustomDraft,
  type CustomEntryDraft,
  type CustomItemDraft,
  type CustomSpellDraft,
  type ScaleValue,
} from "./schema.js";

export interface CustomDraftIssue {
  /** The field the problem is about, from the draft root (`blocks[0].target`). */
  path: string;
  message: string;
}

/** Element types a grant or choice may name, beyond the catalogue's menu. */
const TARGET_TYPES: ReadonlySet<string> = new Set([...CUSTOM_GRANT_TYPES, CUSTOM_OTHER_TYPE]);
const CHOICE_TYPES: ReadonlySet<string> = new Set([...TARGET_TYPES, "List"]);

const ELEMENT_ID = /^ID_[A-Z0-9_]+$/;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BUCKET = /^[a-z0-9][a-z0-9 _-]{0,39}$/;
const WORDS = /^[A-Za-z0-9][A-Za-z0-9 ]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isName = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= max;

export const MAX_BLOCKS = 100;

function withPrefix(prefix: string, issues: readonly ConditionIssue[]): CustomDraftIssue[] {
  return issues.map((issue) => ({
    path: issue.path === "" ? prefix : `${prefix}.${issue.path}`,
    message: issue.message,
  }));
}

/** The scale values a block's value may name: the draft's own, by id. */
type Scales = ReadonlyMap<string, ScaleValue>;

function valueIssues(value: unknown, path: string, scales: Scales, numberOnly = false): CustomDraftIssue[] {
  if (!isRecord(value)) return [{ path, message: "give a number or pick a value to use" }];
  if (value.kind === "number") {
    return isWholeNumber(value.value) && value.value >= -1000 && value.value <= 1000
      ? []
      : [{ path: `${path}.value`, message: "the value is a whole number from -1000 to 1000" }];
  }
  if (numberOnly) return [{ path, message: "this target takes a plain number" }];
  if (value.kind === "reference") {
    return typeof value.ref === "string" && valueReference(value.ref) !== undefined
      ? []
      : [{ path: `${path}.ref`, message: "pick a value from the menu" }];
  }
  if (value.kind === "classLevel") {
    return typeof value.className === "string" && WORDS.test(value.className)
      ? []
      : [{ path: `${path}.className`, message: "name the class whose level is used" }];
  }
  if (value.kind === "scale") {
    const scale = typeof value.scale === "string" ? scales.get(value.scale) : undefined;
    return scale !== undefined && scale.kind === "number"
      ? []
      : [{ path: `${path}.scale`, message: "pick one of this entry's scale values that is a count" }];
  }
  return [{ path, message: "give a number or pick a value to use" }];
}

function modifierIssues(block: Record<string, unknown>, path: string, scales: Scales): CustomDraftIssue[] {
  const issues: CustomDraftIssue[] = [];
  const target = typeof block.target === "string" ? modifierTarget(block.target) : undefined;
  if (target === undefined) {
    issues.push({ path: `${path}.target`, message: "pick what the modifier changes from the menu" });
  } else if (typeof block.mode !== "string" || !target.modes.includes(block.mode as never)) {
    issues.push({
      path: `${path}.mode`,
      message: `${target.label} cannot be changed that way; use ${target.modes.join(" or ")}`,
    });
  }
  if (block.mode === "bestOf" && target !== undefined) {
    const bucket = block.bucket ?? target.defaultBucket;
    if (typeof bucket !== "string" || !BUCKET.test(bucket) || bucket === "base") {
      issues.push({
        path: `${path}.bucket`,
        message: "name the group of bonuses that do not stack (lowercase words, not 'base')",
      });
    }
  } else if (block.bucket !== undefined) {
    issues.push({ path: `${path}.bucket`, message: "a bonus group only applies to Best of" });
  }
  const calculation = target?.id === "ac:calculation";
  issues.push(...valueIssues(block.value, `${path}.value`, scales, calculation));
  if (block.cap !== undefined) {
    if (calculation) issues.push({ path: `${path}.cap`, message: "an armor class calculation has no maximum" });
    else issues.push(...valueIssues(block.cap, `${path}.cap`, scales));
  }
  if (block.addAbilities !== undefined) {
    const list = block.addAbilities;
    if (!calculation) {
      issues.push({ path: `${path}.addAbilities`, message: "only an armor class calculation adds ability modifiers" });
    } else if (
      !Array.isArray(list) ||
      list.some((ability) => !CUSTOM_ABILITIES.includes(ability as CustomAbility)) ||
      new Set(list).size !== list.length
    ) {
      issues.push({ path: `${path}.addAbilities`, message: "pick each ability at most once" });
    }
  }
  if (block.gates !== undefined) issues.push(...gateIssues(block.gates, `${path}.gates`));
  if (block.label !== undefined && !isText(block.label, 80)) {
    issues.push({ path: `${path}.label`, message: "the label is text of at most 80 characters" });
  }
  return issues;
}

function gateIssues(gates: unknown, path: string): CustomDraftIssue[] {
  if (!isRecord(gates)) return [{ path, message: "gates must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (gates.level !== undefined && !(isWholeNumber(gates.level) && gates.level >= 1 && gates.level <= 20)) {
    issues.push({ path: `${path}.level`, message: "a level gate is a whole number from 1 to 20" });
  }
  if (gates.equipped !== undefined) {
    if (!Array.isArray(gates.equipped)) {
      issues.push({ path: `${path}.equipped`, message: "equipment gates are a list" });
    } else {
      gates.equipped.forEach((gate: unknown, index: number) => {
        const at = `${path}.equipped[${index}]`;
        if (!isRecord(gate) || typeof gate.slot !== "string" || !(gate.slot in CUSTOM_EQUIPPED_VALUES)) {
          issues.push({ path: `${at}.slot`, message: "pick armor, shield, main hand or off hand" });
          return;
        }
        const allowed = CUSTOM_EQUIPPED_VALUES[gate.slot]!;
        const weapon = (gate.slot === "primary" || gate.slot === "secondary") && typeof gate.value === "string" && WORDS.test(gate.value);
        if (typeof gate.value !== "string" || !(allowed.includes(gate.value) || weapon)) {
          issues.push({ path: `${at}.value`, message: `pick one of ${allowed.join(", ")}` });
        }
      });
    }
  }
  if (gates.requirements !== undefined) issues.push(...withPrefix(`${path}.requirements`, requirementIssues(gates.requirements)));
  if (gates.switch !== undefined) issues.push(...switchNameIssues(gates.switch, `${path}.switch`));
  return issues;
}

function switchNameIssues(name: unknown, path: string): CustomDraftIssue[] {
  return isName(name, 40) && !/[<>&"]/.test(name)
    ? []
    : [{ path, message: "a switch needs a short name without < > & or quotes" }];
}

function grantIssues(block: Record<string, unknown>, path: string): CustomDraftIssue[] {
  const issues: CustomDraftIssue[] = [];
  const target = block.target;
  let targetType = "";
  if (!isRecord(target)) {
    issues.push({ path: `${path}.target`, message: "pick what is granted" });
  } else {
    targetType = typeof target.type === "string" ? target.type : "";
    if (!TARGET_TYPES.has(targetType)) {
      issues.push({ path: `${path}.target.type`, message: "pick the kind of element that is granted from the menu" });
    }
    if (target.by === "id") {
      if (typeof target.id !== "string" || !/^ID_[A-Za-z0-9_-]+$/.test(target.id)) {
        issues.push({ path: `${path}.target.id`, message: "pick the element that is granted" });
      }
    } else if (target.by === "name") {
      if (!isName(target.name, 120)) issues.push({ path: `${path}.target.name`, message: "name the element that is granted" });
    } else {
      issues.push({ path: `${path}.target.by`, message: "a grant names an element by id or by type and name" });
    }
  }
  if (block.level !== undefined && !(isWholeNumber(block.level) && block.level >= 1 && block.level <= 20)) {
    issues.push({ path: `${path}.level`, message: "a grant level is a whole number from 1 to 20" });
  }
  if (block.requirements !== undefined) issues.push(...withPrefix(`${path}.requirements`, requirementIssues(block.requirements)));
  if (block.switch !== undefined) {
    issues.push(...switchNameIssues(block.switch, `${path}.switch`));
    // A level-gated grant is registered by the leveling planner, which a switch
    // flipping later does not reach; gate it on a requirement instead.
    if (block.level !== undefined) {
      issues.push({ path: `${path}.switch`, message: "a grant is gated by a level or a switch, not both; add the level as a requirement instead" });
    }
  }
  if (block.spell !== undefined) {
    const spell = block.spell;
    if (!isRecord(spell) || targetType !== "Spell") {
      issues.push({ path: `${path}.spell`, message: "spell options only apply to a spell grant" });
    } else {
      if (spell.castAbility !== undefined && !CUSTOM_ABILITIES.includes(spell.castAbility as CustomAbility)) {
        issues.push({ path: `${path}.spell.castAbility`, message: "pick one of the six abilities" });
      }
      if (spell.caster !== undefined && !(typeof spell.caster === "string" && WORDS.test(spell.caster))) {
        issues.push({ path: `${path}.spell.caster`, message: "name the spellcasting feature the spell joins" });
      }
      if (spell.prepared !== undefined && typeof spell.prepared !== "boolean") {
        issues.push({ path: `${path}.spell.prepared`, message: "prepared is on or off" });
      }
      if (spell.prepared === true && spell.caster === undefined) {
        issues.push({ path: `${path}.spell.caster`, message: "an always-prepared spell needs the spellcasting feature that prepares it" });
      }
      if (spell.usage !== undefined && !isText(spell.usage, 60)) {
        issues.push({ path: `${path}.spell.usage`, message: "usage is text of at most 60 characters" });
      }
    }
  }
  return issues;
}

function choiceIssues(block: Record<string, unknown>, path: string): CustomDraftIssue[] {
  const issues: CustomDraftIssue[] = [];
  const type = typeof block.type === "string" ? block.type : "";
  if (!CHOICE_TYPES.has(type)) {
    issues.push({ path: `${path}.type`, message: "pick what the player chooses from the menu" });
  }
  if (!isName(block.name, 80)) issues.push({ path: `${path}.name`, message: "give the choice a name; it groups the picks" });
  if (!(isWholeNumber(block.count) && block.count >= 1 && block.count <= 20)) {
    issues.push({ path: `${path}.count`, message: "how many to pick is a whole number from 1 to 20" });
  }
  if (block.level !== undefined && !(isWholeNumber(block.level) && block.level >= 1 && block.level <= 20)) {
    issues.push({ path: `${path}.level`, message: "a choice level is a whole number from 1 to 20" });
  }
  if (block.requirements !== undefined) issues.push(...withPrefix(`${path}.requirements`, requirementIssues(block.requirements)));
  if (block.supports !== undefined && block.items !== undefined) {
    issues.push({ path: `${path}.items`, message: "a choice offers a filtered list or its own items, not both" });
  }
  if (block.supports !== undefined) issues.push(...withPrefix(`${path}.supports`, filterIssues(block.supports)));
  if (type === "List" || block.items !== undefined) {
    const items = block.items;
    if (type !== "List") {
      issues.push({ path: `${path}.type`, message: "a choice with its own items has the type List" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      issues.push({ path: `${path}.items`, message: "list at least one item to choose from" });
    } else if (items.length > 50 || items.some((item) => !isName(item, 200))) {
      issues.push({ path: `${path}.items`, message: "each item is non-empty text; at most 50 items" });
    }
  }
  if (block.optional !== undefined && typeof block.optional !== "boolean") {
    issues.push({ path: `${path}.optional`, message: "optional is on or off" });
  }
  if (block.castAbility !== undefined || block.caster !== undefined) {
    if (type !== "Spell") {
      issues.push({ path: `${path}.castAbility`, message: "casting options only apply to a spell choice" });
    } else {
      if (block.castAbility !== undefined && !CUSTOM_ABILITIES.includes(block.castAbility as CustomAbility)) {
        issues.push({ path: `${path}.castAbility`, message: "pick one of the six abilities" });
      }
      if (block.caster !== undefined && !(typeof block.caster === "string" && WORDS.test(block.caster))) {
        issues.push({ path: `${path}.caster`, message: "name the spellcasting feature the spells join" });
      }
    }
  }
  return issues;
}

function sheetIssues(sheet: unknown): CustomDraftIssue[] {
  if (!isRecord(sheet)) return [{ path: "sheet", message: "sheet settings must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (sheet.show !== undefined && typeof sheet.show !== "boolean") issues.push({ path: "sheet.show", message: "show is on or off" });
  if (sheet.title !== undefined && !isText(sheet.title, 120)) issues.push({ path: "sheet.title", message: "the sheet title is text of at most 120 characters" });
  if (sheet.action !== undefined && !SHEET_ACTIONS.includes(sheet.action as never)) {
    issues.push({ path: "sheet.action", message: "pick None, Action, Bonus Action, Reaction or Attack" });
  }
  if (sheet.usage !== undefined && !isText(sheet.usage, 60)) issues.push({ path: "sheet.usage", message: "usage is text of at most 60 characters" });
  if (sheet.text !== undefined && !isText(sheet.text, 5000)) issues.push({ path: "sheet.text", message: "the sheet text is at most 5000 characters" });
  if (sheet.tiers !== undefined) {
    if (!Array.isArray(sheet.tiers) || sheet.tiers.length > 20) {
      issues.push({ path: "sheet.tiers", message: "level text is a list of at most 20 entries" });
    } else {
      const levels = new Set<number>();
      sheet.tiers.forEach((tier: unknown, index: number) => {
        const at = `sheet.tiers[${index}]`;
        if (!isRecord(tier) || !(isWholeNumber(tier.level) && tier.level >= 1 && tier.level <= 20)) {
          issues.push({ path: `${at}.level`, message: "a text level is a whole number from 1 to 20" });
        } else if (levels.has(tier.level)) {
          issues.push({ path: `${at}.level`, message: `two texts are set for level ${tier.level}` });
        } else {
          levels.add(tier.level);
        }
        if (!isRecord(tier) || !isText(tier.text, 5000)) issues.push({ path: `${at}.text`, message: "the text is at most 5000 characters" });
      });
    }
  }
  return issues;
}

/**
 * Every problem in a draft, each naming its field. An empty list means the
 * draft compiles.
 */
export function customDraftIssues(draft: unknown): CustomDraftIssue[] {
  if (!isRecord(draft)) return [{ path: "", message: "a draft must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (draft.schemaVersion !== undefined && draft.schemaVersion !== CUSTOM_DRAFT_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `this draft was written by a newer version of the builder (schema ${String(draft.schemaVersion)})`,
    });
  }
  if (typeof draft.id !== "string" || !ELEMENT_ID.test(draft.id)) {
    issues.push({ path: "id", message: "the draft needs the stable element id it was created with" });
  }
  const template = CUSTOM_TEMPLATES.includes(draft.template as never) ? (draft.template as (typeof CUSTOM_TEMPLATES)[number]) : undefined;
  if (template === undefined) issues.push({ path: "template", message: "pick a template" });
  if (!isName(draft.name, 120)) issues.push({ path: "name", message: "give it a name (at most 120 characters)" });
  if (!SHOWS_UNDER.includes(draft.showsUnder as never)) {
    issues.push({ path: "showsUnder", message: "pick where it shows: Race, Class, Feats or Other" });
  } else if (template !== undefined) {
    const allowed = CUSTOM_TEMPLATE_OPTIONS.find((option) => option.id === template)!.showsUnder;
    if (!allowed.includes(draft.showsUnder as never)) {
      issues.push({ path: "showsUnder", message: `this template shows under ${allowed.join(" or ")}` });
    }
  }
  if (typeof draft.description !== "string" || draft.description.length > 20000) {
    issues.push({ path: "description", message: "the description is text of at most 20000 characters" });
  }
  if (draft.cameFrom !== undefined && !isText(draft.cameFrom, 120)) {
    issues.push({ path: "cameFrom", message: "where it came from is text of at most 120 characters" });
  }
  if (draft.ruleset !== undefined && !CUSTOM_RULESETS.includes(draft.ruleset as never)) {
    issues.push({ path: "ruleset", message: "pick both rulesets, 2014 or 2024" });
  }
  if (draft.tags !== undefined) {
    const tags = draft.tags;
    if (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => !isName(tag, 60) || /[,<>&"]/.test(tag as string))) {
      issues.push({ path: "tags", message: "tags are short names without commas, at most 20" });
    }
  }
  if (draft.requirements !== undefined) issues.push(...withPrefix("requirements", requirementIssues(draft.requirements)));
  if (draft.sheet !== undefined) issues.push(...sheetIssues(draft.sheet));

  issues.push(...scaleIssues(draft.scales));
  issues.push(...trackerIssues(draft.trackers, scalesById(draft)));
  issues.push(...blocksIssues(draft.blocks, scalesById(draft)));
  return issues;
}

/**
 * Every problem in a list of blocks (modifiers, grants and choices), shared by
 * feature drafts and item drafts: a list of at most `MAX_BLOCKS` blocks with
 * unique ids, and spells that agree on one cast ability and one allowance.
 */
function blocksIssues(blocks: unknown, scales: Scales): CustomDraftIssue[] {
  const issues: CustomDraftIssue[] = [];
  if (!Array.isArray(blocks)) {
    return [{ path: "blocks", message: "blocks must be a list" }];
  }
  if (blocks.length > MAX_BLOCKS) issues.push({ path: "blocks", message: `a draft holds at most ${MAX_BLOCKS} blocks` });
  const ids = new Set<string>();
  const abilities = new Set<string>();
  const usages = new Set<string>();
  blocks.forEach((raw: unknown, index: number) => {
    const path = `blocks[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path, message: "a block must be an object" });
      return;
    }
    if (typeof raw.id !== "string" || !BLOCK_ID.test(raw.id)) {
      issues.push({ path: `${path}.id`, message: "every block needs a stable id" });
    } else if (ids.has(raw.id)) {
      issues.push({ path: `${path}.id`, message: "two blocks share an id" });
    } else {
      ids.add(raw.id);
    }
    if (raw.kind === "modifier") issues.push(...modifierIssues(raw, path, scales));
    else if (raw.kind === "grant") {
      issues.push(...grantIssues(raw, path));
      const spell = raw.spell;
      if (isRecord(spell)) {
        if (typeof spell.castAbility === "string") abilities.add(spell.castAbility);
        if (typeof spell.usage === "string" && spell.usage.trim() !== "") usages.add(spell.usage.trim());
      }
    } else if (raw.kind === "choice") {
      issues.push(...choiceIssues(raw, path));
      if (typeof raw.castAbility === "string") abilities.add(raw.castAbility);
    } else {
      issues.push({ path: `${path}.kind`, message: "a block is a modifier, a grant or a choice" });
    }
  });
  // A feature that grants spells casts them all with one ability and one
  // free-cast allowance: that is what the spell pages project per feature.
  if (abilities.size > 1) {
    issues.push({ path: "blocks", message: "the spells of one feature are cast with a single ability" });
  }
  if (usages.size > 1) {
    issues.push({ path: "blocks", message: "the spells of one feature share a single free-cast allowance" });
  }
  return issues;
}

/**
 * Reads a draft from JSON. A draft without a `schemaVersion` predates
 * versioning and reads as version 1; a newer version is refused rather than
 * guessed at. Throws an `invalid-argument` error naming every problem.
 */
export function readCustomDraft(raw: unknown): CustomDraft {
  const candidate = isRecord(raw) && raw.schemaVersion === undefined
    ? { ...raw, schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION }
    : raw;
  const issues = customDraftIssues(candidate);
  if (issues.length > 0) {
    throw engineError("invalid-argument", `invalid custom draft: ${issues[0]!.path === "" ? "" : `${issues[0]!.path}: `}${issues[0]!.message}`, { issues });
  }
  return candidate as CustomDraft;
}

// ---- items -------------------------------------------------------------------

const DICE = /^[1-9][0-9]?d[1-9][0-9]{0,2}$/;
const RANGE = /^[0-9]{1,3}(\/[0-9]{1,4})?( ?ft\.?)?$/;
const CURRENCIES = ["cp", "sp", "gp"];

function diceIssues(value: unknown, path: string): CustomDraftIssue[] {
  return typeof value === "string" && DICE.test(value) ? [] : [{ path, message: "write dice like 1d6 or 2d8" }];
}

function damageIssues(value: unknown, path: string): CustomDraftIssue[] {
  if (!isRecord(value)) return [{ path, message: "give the dice and the damage type" }];
  const issues = diceIssues(value.dice, `${path}.dice`);
  if (typeof value.type !== "string" || !DAMAGE_TYPES.includes(value.type as never)) {
    issues.push({ path: `${path}.type`, message: "pick a damage type from the menu" });
  }
  return issues;
}

function weaponIssues(weapon: unknown): CustomDraftIssue[] {
  if (!isRecord(weapon)) return [{ path: "weapon", message: "weapon settings must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (weapon.extraDamage !== undefined) {
    if (!Array.isArray(weapon.extraDamage) || weapon.extraDamage.length > 4) {
      issues.push({ path: "weapon.extraDamage", message: "extra damage is a list of at most 4 dice" });
    } else {
      weapon.extraDamage.forEach((term: unknown, index: number) => {
        issues.push(...damageIssues(term, `weapon.extraDamage[${index}]`));
      });
    }
  }
  if (weapon.attackAbility !== undefined && !CUSTOM_ABILITIES.includes(weapon.attackAbility as CustomAbility)) {
    issues.push({ path: "weapon.attackAbility", message: "pick one of the six abilities" });
  }
  if (weapon.damage !== undefined) issues.push(...damageIssues(weapon.damage, "weapon.damage"));
  if (weapon.versatile !== undefined) issues.push(...diceIssues(weapon.versatile, "weapon.versatile"));
  if (weapon.range !== undefined && !(typeof weapon.range === "string" && RANGE.test(weapon.range))) {
    issues.push({ path: "weapon.range", message: "write a range like 20/60 or 5 ft" });
  }
  if (weapon.properties !== undefined) {
    const list = weapon.properties;
    if (
      !Array.isArray(list) ||
      list.some((id) => !WEAPON_PROPERTY_IDS.includes(id as never)) ||
      new Set(list).size !== list.length
    ) {
      issues.push({ path: "weapon.properties", message: "pick each weapon property at most once from the menu" });
    }
  }
  return issues;
}

/** Every problem in an item draft, each naming its field. An empty list means the draft compiles. */
export function customItemDraftIssues(draft: unknown): CustomDraftIssue[] {
  if (!isRecord(draft)) return [{ path: "", message: "a draft must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (draft.schemaVersion !== undefined && draft.schemaVersion !== CUSTOM_DRAFT_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `this draft was written by a newer version of the builder (schema ${String(draft.schemaVersion)})`,
    });
  }
  if (typeof draft.id !== "string" || !ELEMENT_ID.test(draft.id)) {
    issues.push({ path: "id", message: "the draft needs the stable element id it was created with" });
  }
  const template = CUSTOM_ITEM_TEMPLATES.includes(draft.template as never) ? (draft.template as CustomItemDraft["template"]) : undefined;
  if (template === undefined) issues.push({ path: "template", message: "pick weapon, armor, worn item or plain gear" });
  if (!isName(draft.name, 120)) issues.push({ path: "name", message: "give it a name (at most 120 characters)" });
  if (typeof draft.description !== "string" || draft.description.length > 20000) {
    issues.push({ path: "description", message: "the description is text of at most 20000 characters" });
  }
  if (draft.cameFrom !== undefined && !isText(draft.cameFrom, 120)) {
    issues.push({ path: "cameFrom", message: "where it came from is text of at most 120 characters" });
  }
  if (draft.ruleset !== undefined && !CUSTOM_RULESETS.includes(draft.ruleset as never)) {
    issues.push({ path: "ruleset", message: "pick both rulesets, 2014 or 2024" });
  }

  const onBase = template === "weapon" || template === "armor";
  if (onBase) {
    const base = draft.base;
    if (!isRecord(base) || typeof base.id !== "string" || !/^ID_[A-Za-z0-9_-]+$/.test(base.id)) {
      issues.push({ path: "base", message: template === "weapon" ? "pick the weapon it is made from" : "pick the armor or shield it is made from" });
    } else {
      if (!isName(base.name, 120)) issues.push({ path: "base.name", message: "name the base" });
      if (base.shield !== undefined && (typeof base.shield !== "boolean" || template !== "armor")) {
        issues.push({ path: "base.shield", message: "only an armor base can be a shield" });
      }
    }
    if (draft.bonus !== undefined && !(isWholeNumber(draft.bonus) && draft.bonus >= 0 && draft.bonus <= 10)) {
      issues.push({ path: "bonus", message: "the bonus is a whole number from 0 to 10" });
    }
  } else {
    if (draft.base !== undefined) issues.push({ path: "base", message: "only a weapon or armor sits on a base" });
    if (draft.bonus !== undefined) issues.push({ path: "bonus", message: "only a weapon or armor has a bonus" });
  }
  if (draft.weapon !== undefined) {
    if (template !== "weapon") issues.push({ path: "weapon", message: "weapon settings only apply to a weapon" });
    else issues.push(...weaponIssues(draft.weapon));
  }

  const magic = template !== "gear";
  if (draft.rarity !== undefined && !(magic && ITEM_RARITIES.includes(draft.rarity as never))) {
    issues.push({ path: "rarity", message: magic ? "pick a rarity from the menu" : "plain gear has no rarity" });
  }
  if (draft.attunement !== undefined && !(magic && typeof draft.attunement === "boolean")) {
    issues.push({ path: "attunement", message: magic ? "attunement is on or off" : "plain gear cannot need attunement" });
  }
  if (draft.slot !== undefined && !(template === "worn" && WORN_SLOTS.includes(draft.slot as never))) {
    issues.push({ path: "slot", message: template === "worn" ? "pick where it is worn from the menu" : "only a worn item has a slot" });
  }
  if (template === "worn" && draft.slot === undefined) {
    issues.push({ path: "slot", message: "pick where it is worn" });
  }
  if (draft.uses !== undefined && !isText(draft.uses, 120)) {
    issues.push({ path: "uses", message: "uses is text of at most 120 characters" });
  }
  // A weapon or armor weighs what its base weighs, and is priced as that base.
  if (onBase && (draft.weight !== undefined || draft.cost !== undefined)) {
    issues.push({ path: draft.weight !== undefined ? "weight" : "cost", message: "a weapon or armor keeps its base's weight and price" });
  }
  if (draft.weight !== undefined && !(typeof draft.weight === "number" && Number.isFinite(draft.weight) && draft.weight >= 0 && draft.weight <= 10000)) {
    issues.push({ path: "weight", message: "weight is a number of pounds, 0 or more" });
  }
  if (draft.cost !== undefined) {
    const cost = draft.cost;
    if (!isRecord(cost) || !(typeof cost.amount === "number" && Number.isFinite(cost.amount) && cost.amount >= 0 && cost.amount <= 1_000_000_000)) {
      issues.push({ path: "cost.amount", message: "cost is a number, 0 or more" });
    } else if (typeof cost.currency !== "string" || !CURRENCIES.includes(cost.currency)) {
      issues.push({ path: "cost.currency", message: "pick copper, silver or gold" });
    }
  }
  if (draft.stackable !== undefined && !(template === "gear" && typeof draft.stackable === "boolean")) {
    issues.push({ path: "stackable", message: template === "gear" ? "stackable is on or off" : "only plain gear stacks" });
  }
  // An item's charges are fixed numbers: its text, which no statistic fills in, states them.
  issues.push(...trackerIssues(draft.trackers, new Map(), { literalOnly: true }));
  issues.push(...blocksIssues(draft.blocks, new Map()));
  if (Array.isArray(draft.blocks)) {
    draft.blocks.forEach((block: unknown, index: number) => {
      if (isRecord(block) && block.kind === "choice") {
        issues.push({
          path: `blocks[${index}]`,
          message: "an item cannot offer a choice; grant a custom feature that holds it",
        });
      }
    });
  }
  if (template === "gear" && Array.isArray(draft.blocks) && draft.blocks.length > 0) {
    issues.push({ path: "blocks", message: "plain gear has no rules; use a worn item for effects" });
  }
  return issues;
}

// ---- spells ------------------------------------------------------------------

/** A short phrase in the spell block: casting time, range or duration. */
const SPELL_PHRASE_MAX = 80;
const CLASS_NAME = /^[A-Za-z][A-Za-z '\u2019-]{0,39}$/;
export const MAX_SPELL_DAMAGE_TERMS = 4;
export const MAX_CANTRIP_TIERS = 6;

function spellComponentIssues(components: unknown): CustomDraftIssue[] {
  if (!isRecord(components)) return [{ path: "components", message: "components must be an object" }];
  const issues: CustomDraftIssue[] = [];
  for (const key of ["verbal", "somatic", "material"] as const) {
    if (components[key] !== undefined && typeof components[key] !== "boolean") {
      issues.push({ path: `components.${key}`, message: `${key} is on or off` });
    }
  }
  if (components.materialText !== undefined && !isText(components.materialText, 200)) {
    issues.push({ path: "components.materialText", message: "the material is text of at most 200 characters" });
  }
  return issues;
}

function scalingIssues(scaling: unknown, level: unknown, hasDamage: boolean, hasHealing: boolean): CustomDraftIssue[] {
  const path = "mechanics.scaling";
  if (!isRecord(scaling)) return [{ path, message: "scaling must be an object" }];
  if (scaling.kind === "cantrip") {
    const issues: CustomDraftIssue[] = [];
    if (level !== 0) issues.push({ path, message: "only a cantrip grows with the caster's level; a spell grows with its slot" });
    if (!hasDamage) issues.push({ path, message: "give the spell damage for the tiers to raise" });
    const tiers = scaling.tiers;
    if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > MAX_CANTRIP_TIERS) {
      issues.push({ path: `${path}.tiers`, message: `list from 1 to ${MAX_CANTRIP_TIERS} level tiers` });
      return issues;
    }
    const levels = new Set<number>();
    tiers.forEach((tier: unknown, index: number) => {
      const at = `${path}.tiers[${index}]`;
      if (!isRecord(tier) || !(isWholeNumber(tier.level) && tier.level >= 2 && tier.level <= 20)) {
        issues.push({ path: `${at}.level`, message: "a tier level is a whole number from 2 to 20" });
      } else if (levels.has(tier.level)) {
        issues.push({ path: `${at}.level`, message: `two tiers are set for level ${tier.level}` });
      } else {
        levels.add(tier.level);
      }
      issues.push(...diceIssues(isRecord(tier) ? tier.dice : undefined, `${at}.dice`));
    });
    return issues;
  }
  if (scaling.kind === "slot") {
    const issues: CustomDraftIssue[] = [];
    if (level === 0) issues.push({ path, message: "a cantrip has no slot to raise; give it level tiers instead" });
    if (!hasDamage && !hasHealing) issues.push({ path, message: "give the spell damage or healing for the slot to raise" });
    issues.push(...diceIssues(scaling.dice, `${path}.dice`));
    return issues;
  }
  return [{ path: `${path}.kind`, message: "pick level tiers or slot scaling" }];
}

function mechanicsIssues(mechanics: unknown, level: unknown): CustomDraftIssue[] {
  if (!isRecord(mechanics)) return [{ path: "mechanics", message: "mechanics must be an object" }];
  const issues: CustomDraftIssue[] = [];
  const roll = mechanics.roll;
  if (!SPELL_ROLLS.includes(roll as never)) {
    issues.push({ path: "mechanics.roll", message: "pick none, a ranged or melee spell attack, or a saving throw" });
  }
  if (roll === "save") {
    if (!CUSTOM_ABILITIES.includes(mechanics.saveAbility as CustomAbility)) {
      issues.push({ path: "mechanics.saveAbility", message: "pick the ability the target saves with" });
    }
  } else {
    if (mechanics.saveAbility !== undefined) {
      issues.push({ path: "mechanics.saveAbility", message: "only a saving throw spell names a save" });
    }
    if (mechanics.halfOnSave !== undefined) {
      issues.push({ path: "mechanics.halfOnSave", message: "only a saving throw spell can take half on a success" });
    }
  }
  if (mechanics.halfOnSave !== undefined && typeof mechanics.halfOnSave !== "boolean") {
    issues.push({ path: "mechanics.halfOnSave", message: "half on a success is on or off" });
  }
  let damageCount = 0;
  if (mechanics.damage !== undefined) {
    if (!Array.isArray(mechanics.damage) || mechanics.damage.length > MAX_SPELL_DAMAGE_TERMS) {
      issues.push({ path: "mechanics.damage", message: `damage is a list of at most ${MAX_SPELL_DAMAGE_TERMS} dice` });
    } else {
      damageCount = mechanics.damage.length;
      mechanics.damage.forEach((term: unknown, index: number) => {
        issues.push(...damageIssues(term, `mechanics.damage[${index}]`));
      });
    }
  }
  if (mechanics.healing !== undefined) issues.push(...diceIssues(mechanics.healing, "mechanics.healing"));
  if (mechanics.addsModifier !== undefined && typeof mechanics.addsModifier !== "boolean") {
    issues.push({ path: "mechanics.addsModifier", message: "adding the modifier is on or off" });
  }
  if (mechanics.scaling !== undefined) {
    issues.push(...scalingIssues(mechanics.scaling, level, damageCount > 0, mechanics.healing !== undefined));
  }
  return issues;
}

/** Every problem in a spell draft, each naming its field. An empty list means the draft compiles. */
export function customSpellDraftIssues(draft: unknown): CustomDraftIssue[] {
  if (!isRecord(draft)) return [{ path: "", message: "a draft must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (draft.schemaVersion !== undefined && draft.schemaVersion !== CUSTOM_DRAFT_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `this draft was written by a newer version of the builder (schema ${String(draft.schemaVersion)})`,
    });
  }
  if (typeof draft.id !== "string" || !ELEMENT_ID.test(draft.id)) {
    issues.push({ path: "id", message: "the draft needs the stable element id it was created with" });
  }
  if (draft.template !== CUSTOM_SPELL_TEMPLATE) issues.push({ path: "template", message: "a spell draft has the template 'spell'" });
  if (!isName(draft.name, 120)) issues.push({ path: "name", message: "give it a name (at most 120 characters)" });
  if (typeof draft.description !== "string" || draft.description.length > 20000) {
    issues.push({ path: "description", message: "the description is text of at most 20000 characters" });
  }
  if (draft.higherLevels !== undefined && !isText(draft.higherLevels, 2000)) {
    issues.push({ path: "higherLevels", message: "the higher-level text is at most 2000 characters" });
  }
  if (draft.cameFrom !== undefined && !isText(draft.cameFrom, 120)) {
    issues.push({ path: "cameFrom", message: "where it came from is text of at most 120 characters" });
  }
  if (draft.ruleset !== undefined && !CUSTOM_RULESETS.includes(draft.ruleset as never)) {
    issues.push({ path: "ruleset", message: "pick both rulesets, 2014 or 2024" });
  }
  if (!(isWholeNumber(draft.level) && draft.level >= 0 && draft.level <= 9)) {
    issues.push({ path: "level", message: "a spell level is a whole number from 0 (cantrip) to 9" });
  }
  if (!SPELL_SCHOOLS.includes(draft.school as never)) issues.push({ path: "school", message: "pick a school of magic" });
  for (const key of ["castingTime", "range", "duration"] as const) {
    const label = key === "castingTime" ? "casting time" : key;
    if (!isName(draft[key], SPELL_PHRASE_MAX) || /[<>&"]/.test(draft[key] as string)) {
      issues.push({ path: key, message: `give the ${label} (at most ${SPELL_PHRASE_MAX} characters, without < > & or quotes)` });
    }
  }
  issues.push(...spellComponentIssues(draft.components));
  for (const key of ["concentration", "ritual"] as const) {
    if (draft[key] !== undefined && typeof draft[key] !== "boolean") {
      issues.push({ path: key, message: `${key} is on or off` });
    }
  }
  if (draft.classes !== undefined) {
    const classes = draft.classes;
    if (
      !Array.isArray(classes) ||
      classes.length > 12 ||
      new Set(classes).size !== classes.length ||
      classes.some((name) => typeof name !== "string" || !CLASS_NAME.test(name))
    ) {
      issues.push({ path: "classes", message: "class lists are class names, each once, at most 12" });
    }
  }
  if (draft.mechanics !== undefined) issues.push(...mechanicsIssues(draft.mechanics, draft.level));
  return issues;
}

/** Every problem in whatever a character pack stores: a feature, an item or a spell. */
export function customEntryIssues(draft: unknown): CustomDraftIssue[] {
  if (isRecord(draft) && draft.template === CUSTOM_SPELL_TEMPLATE) return customSpellDraftIssues(draft);
  return isRecord(draft) && CUSTOM_ITEM_TEMPLATES.includes(draft.template as never)
    ? customItemDraftIssues(draft)
    : customDraftIssues(draft);
}

/**
 * Reads a stored entry: a spell or an item draft by its template, anything
 * else as a feature draft. The same version rules as `readCustomDraft` apply.
 */
export function readCustomEntry(raw: unknown): CustomEntryDraft {
  if (isRecord(raw) && raw.template === CUSTOM_SPELL_TEMPLATE) return readCustomSpellDraft(raw);
  if (isRecord(raw) && CUSTOM_ITEM_TEMPLATES.includes(raw.template as never)) return readCustomItemDraft(raw);
  return readCustomDraft(raw);
}

/** Reads a spell draft from JSON; throws an `invalid-argument` error naming every problem. */
export function readCustomSpellDraft(raw: unknown): CustomSpellDraft {
  const candidate = isRecord(raw) && raw.schemaVersion === undefined
    ? { ...raw, schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION }
    : raw;
  const issues = customSpellDraftIssues(candidate);
  if (issues.length > 0) {
    throw engineError("invalid-argument", `invalid custom spell: ${issues[0]!.path === "" ? "" : `${issues[0]!.path}: `}${issues[0]!.message}`, { issues });
  }
  return candidate as CustomSpellDraft;
}

/** Reads an item draft from JSON; throws an `invalid-argument` error naming every problem. */
export function readCustomItemDraft(raw: unknown): CustomItemDraft {
  const candidate = isRecord(raw) && raw.schemaVersion === undefined
    ? { ...raw, schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION }
    : raw;
  const issues = customItemDraftIssues(candidate);
  if (issues.length > 0) {
    throw engineError("invalid-argument", `invalid custom item: ${issues[0]!.path === "" ? "" : `${issues[0]!.path}: `}${issues[0]!.message}`, { issues });
  }
  return candidate as CustomItemDraft;
}
