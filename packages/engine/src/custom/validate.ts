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
import {
  CUSTOM_ABILITIES,
  CUSTOM_DRAFT_SCHEMA_VERSION,
  CUSTOM_OTHER_TYPE,
  CUSTOM_RULESETS,
  CUSTOM_TEMPLATES,
  SHEET_ACTIONS,
  SHOWS_UNDER,
  type CustomAbility,
  type CustomDraft,
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

function valueIssues(value: unknown, path: string, numberOnly = false): CustomDraftIssue[] {
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
  return [{ path, message: "give a number or pick a value to use" }];
}

function modifierIssues(block: Record<string, unknown>, path: string): CustomDraftIssue[] {
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
  issues.push(...valueIssues(block.value, `${path}.value`, calculation));
  if (block.cap !== undefined) {
    if (calculation) issues.push({ path: `${path}.cap`, message: "an armor class calculation has no maximum" });
    else issues.push(...valueIssues(block.cap, `${path}.cap`));
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
  if (gates.switch !== undefined && !(isName(gates.switch, 40) && !/[<>&"]/.test(gates.switch))) {
    issues.push({ path: `${path}.switch`, message: "a switch needs a short name without < > & or quotes" });
  }
  return issues;
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

  if (!Array.isArray(draft.blocks)) {
    issues.push({ path: "blocks", message: "blocks must be a list" });
    return issues;
  }
  if (draft.blocks.length > MAX_BLOCKS) issues.push({ path: "blocks", message: `a draft holds at most ${MAX_BLOCKS} blocks` });
  const ids = new Set<string>();
  const abilities = new Set<string>();
  const usages = new Set<string>();
  draft.blocks.forEach((raw: unknown, index: number) => {
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
    if (raw.kind === "modifier") issues.push(...modifierIssues(raw, path));
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
