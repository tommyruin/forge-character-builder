/**
 * The two condition trees a draft uses, compiled to the engine's own
 * expression syntaxes:
 *
 * - requirement trees (B4) become the `requirements` expression that
 *   `selection/expr.ts` evaluates, and
 * - filter trees (B3) become the `supports` expression that
 *   `selection/selection.ts` (`evaluateSupportsExpression`) evaluates.
 *
 * Authors build trees from menus; neither syntax is ever typed. The
 * requirement output is checked with the same `requirementsSyntaxError` the
 * raw-XML editor uses, so a draft cannot compile to an expression the engine
 * would silently read as "not met".
 */

import { requirementsSyntaxError } from "../selection/expr.js";
import { modifierTarget, valueReference, weaponFilterTag } from "./catalogue.js";
import { CUSTOM_ABILITIES, type CustomAbility, type FilterNode, type RequirementNode } from "./schema.js";

/** The deepest a tree may nest; far beyond any form, and a guard against hostile JSON. */
export const MAX_CONDITION_DEPTH = 8;

const ELEMENT_ID = /^ID_[A-Za-z0-9_-]+$/;
const WORDS = /^[A-Za-z0-9][A-Za-z0-9 ]*$/;

const ABILITY_ABBREVIATION: Record<CustomAbility, string> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

const ABILITY_NAME: Record<CustomAbility, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

export interface ConditionIssue {
  /** Where in the tree the problem is, relative to the tree's own root (`items[1].min`). */
  path: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function groupOp(value: unknown): value is "all" | "any" | "none" {
  return value === "all" || value === "any" || value === "none";
}

// ---- requirements (B4) ------------------------------------------------------

export function requirementIssues(node: unknown, path = "", depth = 0): ConditionIssue[] {
  const at = (field: string): string => (path === "" ? field : `${path}.${field}`);
  if (!isRecord(node)) return [{ path, message: "a requirement must be an object" }];
  if (depth > MAX_CONDITION_DEPTH) return [{ path, message: `requirements nest deeper than ${MAX_CONDITION_DEPTH} levels` }];
  switch (node.kind) {
    case "group": {
      if (!groupOp(node.op)) return [{ path: at("op"), message: "a group is ALL OF, ANY OF or NONE OF" }];
      if (!Array.isArray(node.items)) return [{ path: at("items"), message: "a group needs a list of conditions" }];
      if (node.items.length === 0) return [{ path: at("items"), message: "a group needs at least one condition" }];
      return node.items.flatMap((item, index) => requirementIssues(item, at(`items[${index}]`), depth + 1));
    }
    case "element":
      return typeof node.id === "string" && ELEMENT_ID.test(node.id)
        ? []
        : [{ path: at("id"), message: "pick the element or optional rule this condition names" }];
    case "elementType":
      return typeof node.type === "string" && WORDS.test(node.type)
        ? []
        : [{ path: at("type"), message: "pick the element type this condition names" }];
    case "ability":
      return [
        ...(CUSTOM_ABILITIES.includes(node.ability as CustomAbility)
          ? []
          : [{ path: at("ability"), message: "pick one of the six abilities" }]),
        ...(isWholeNumber(node.min) && node.min >= 1 && node.min <= 30
          ? []
          : [{ path: at("min"), message: "an ability minimum is a whole number from 1 to 30" }]),
      ];
    case "level":
      return isWholeNumber(node.min) && node.min >= 1 && node.min <= 20
        ? []
        : [{ path: at("min"), message: "a level minimum is a whole number from 1 to 20" }];
    case "classLevel":
      return [
        ...(typeof node.className === "string" && WORDS.test(node.className)
          ? []
          : [{ path: at("className"), message: "name the class this condition counts levels in" }]),
        ...(isWholeNumber(node.min) && node.min >= 1 && node.min <= 20
          ? []
          : [{ path: at("min"), message: "a class level minimum is a whole number from 1 to 20" }]),
      ];
    case "stat":
      return [
        ...(typeof node.key === "string" && (modifierTarget(node.key) !== undefined || valueReference(node.key) !== undefined)
          ? []
          : [{ path: at("key"), message: "pick a statistic from the menu" }]),
        ...(isWholeNumber(node.min) ? [] : [{ path: at("min"), message: "a statistic minimum is a whole number" }]),
      ];
    default:
      return [{ path, message: "unknown requirement kind" }];
  }
}

function requirementAtom(node: RequirementNode): string {
  switch (node.kind) {
    case "element":
      return `${node.negate === true ? "!" : ""}${node.id}`;
    case "elementType":
      return `[type:${node.type}]`;
    case "ability":
      return `[${ABILITY_ABBREVIATION[node.ability]}:${node.min}]`;
    case "level":
      return `[level:${node.min}]`;
    case "classLevel":
      return `[level:${node.className.toLowerCase()}:${node.min}]`;
    case "stat":
      return `[${node.key}:${node.min}]`;
    case "group":
      return "";
  }
}

function compileRequirementNode(node: RequirementNode, nested: boolean): string {
  if (node.kind !== "group") return requirementAtom(node);
  const parts = node.items.map((item) => compileRequirementNode(item, true)).filter((part) => part !== "");
  if (parts.length === 0) return "";
  const joined = parts.join(node.op === "any" ? "||" : ",");
  if (node.op === "none") return `!(${parts.join("||")})`;
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

/**
 * The requirements expression for a tree, or "" for none. Throws when the
 * tree is malformed; callers validate with `requirementIssues` first.
 */
export function compileRequirements(node: RequirementNode | undefined): string {
  if (node === undefined) return "";
  const expression = compileRequirementNode(node, false);
  const syntax = requirementsSyntaxError(expression);
  if (syntax !== null) throw new Error(`requirements are not a valid expression (${syntax})`);
  return expression;
}

/** A plain-language reading of a requirement tree, for the summary line and the picker. */
export function describeRequirements(node: RequirementNode | undefined): string {
  if (node === undefined) return "";
  const describe = (current: RequirementNode): string => {
    switch (current.kind) {
      case "element":
        return `${current.negate === true ? "Without" : "Has"} ${current.label ?? current.id}`;
      case "elementType":
        return `Has a ${current.type}`;
      case "ability":
        return `${ABILITY_NAME[current.ability]} ${current.min} or higher`;
      case "level":
        return `Character level ${current.min} or higher`;
      case "classLevel":
        return `${current.className} level ${current.min} or higher`;
      case "stat":
        return `${current.label ?? modifierTarget(current.key)?.label ?? valueReference(current.key)?.label ?? current.key} ${current.min} or higher`;
      case "group": {
        const parts = current.items.map(describe).filter((part) => part !== "");
        if (parts.length <= 1 && current.op !== "none") return parts[0] ?? "";
        if (current.op === "all") return parts.join("; ");
        return `${current.op === "any" ? "Any of" : "None of"}: ${parts.join(", ")}`;
      }
    }
  };
  return describe(node);
}

// ---- filters (B3) -----------------------------------------------------------

/** A tag must survive the supports tokenizer: no separators, groups or negation. */
const FILTER_TAG = /^[^,&|()!\s][^,&|()!]*$/;

export function filterIssues(node: unknown, path = "", depth = 0): ConditionIssue[] {
  const at = (field: string): string => (path === "" ? field : `${path}.${field}`);
  if (!isRecord(node)) return [{ path, message: "a filter must be an object" }];
  if (depth > MAX_CONDITION_DEPTH) return [{ path, message: `filters nest deeper than ${MAX_CONDITION_DEPTH} levels` }];
  switch (node.kind) {
    case "group": {
      if (!groupOp(node.op)) return [{ path: at("op"), message: "a filter group is ALL OF, ANY OF or NONE OF" }];
      if (!Array.isArray(node.items)) return [{ path: at("items"), message: "a filter group needs a list of filters" }];
      if (node.items.length === 0) return [{ path: at("items"), message: "a filter group needs at least one filter" }];
      return node.items.flatMap((item, index) => filterIssues(item, at(`items[${index}]`), depth + 1));
    }
    case "tag":
    case "school":
    case "id":
      return typeof node.value === "string" && FILTER_TAG.test(node.value.trim())
        ? []
        : [{ path: at("value"), message: "a filter tag cannot be empty or contain , & | ( ) or !" }];
    case "level":
      return isWholeNumber(node.value) && node.value >= 0 && node.value <= 9
        ? []
        : [{ path: at("value"), message: "a spell level filter is a whole number from 0 to 9" }];
    default:
      return [{ path, message: "unknown filter kind" }];
  }
}

/** NOT of a filter, pushed to the leaves (the expression only negates single tags). */
function negateFilter(node: FilterNode): FilterNode {
  switch (node.kind) {
    case "group":
      if (node.op === "none") return { kind: "group", op: "any", items: node.items };
      return { kind: "group", op: node.op === "all" ? "any" : "all", items: node.items.map(negateFilter) };
    default:
      return { kind: "tag", value: `!${filterLeaf(node)}` };
  }
}

function filterLeaf(node: FilterNode): string {
  if (node.kind === "level") return String(node.value);
  if (node.kind === "group") return "";
  return node.value.trim();
}

function compileFilterNode(node: FilterNode, nested: boolean): string {
  if (node.kind === "group") {
    if (node.op === "none") {
      return compileFilterNode({ kind: "group", op: "all", items: node.items.map(negateFilter) }, nested);
    }
    const parts = node.items.map((item) => compileFilterNode(item, true)).filter((part) => part !== "");
    if (parts.length === 0) return "";
    const joined = parts.join(node.op === "any" ? "||" : ",");
    return nested && parts.length > 1 ? `(${joined})` : joined;
  }
  if (node.kind === "tag" && node.value.startsWith("!")) return node.value;
  return filterLeaf(node);
}

/** The `supports` expression for a filter tree, or "" for none. */
export function compileFilter(node: FilterNode | undefined): string {
  return node === undefined ? "" : compileFilterNode(node, false);
}

/** A plain-language reading of a filter tree. */
export function describeFilter(node: FilterNode | undefined): string {
  if (node === undefined) return "";
  const describe = (current: FilterNode): string => {
    if (current.kind === "group") {
      const parts = current.items.map(describe).filter((part) => part !== "");
      if (parts.length === 1 && current.op !== "none") return parts[0]!;
      const word = current.op === "all" ? "all of" : current.op === "any" ? "any of" : "none of";
      return `${word} ${parts.join(", ")}`;
    }
    if (current.kind === "level") return current.value === 0 ? "cantrips" : `level ${current.value}`;
    return weaponFilterTag(current.value.trim())?.label ?? current.value.trim();
  };
  return describe(node);
}
