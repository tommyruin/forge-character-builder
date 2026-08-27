/**
 * Corpus element parser.
 *
 * Maps the public content grammar (third-party/elements/testdata — the corpus
 * IS the spec) into typed element records. Blocks that drive engine behavior
 * (setters, rules: grant/stat/select, supports, requirements, prerequisite)
 * are parsed; description content is retained for later rendering.
 */

import { childElements, parseXml, serializeXml, textContent, type XmlNode } from "./xml.js";
import type { ElementIdentity } from "../elements/types.js";

export interface Setter {
  name: string;
  /** Text content of the <set> element (the corpus encodes values as text). */
  value: string;
  /** Additional attributes (e.g. currency="cp" bulk="5", or target/field). */
  attrs?: Record<string, string>;
}

export type Rule =
  | GrantRule
  | StatRule
  | SelectRule
  | AppendRule
  | RequireRule
  | { kind: "other"; name: string; attrs: Record<string, string> };

export interface GrantRule {
  kind: "grant";
  type?: string;
  name?: string;
  id?: string;
  level?: number;
  supports?: string;
  requirements?: string;
  /** Spell grants with `prepared="true"` (always-prepared caster spells). */
  prepared?: boolean;
  /** Spell-grant spellcasting target (the caster name). */
  spellcasting?: string;
}

export interface StatRule {
  kind: "stat";
  name: string;
  value?: string;
  bonus?: string;
  group?: string;
  requirements?: string;
  entry?: string;
  type?: string;
  /** Class level at which the rule starts applying (corpus spell-slot tables). */
  level?: number;
  /** Equipment-gating expression (e.g. "[armor:any]", "![armor:heavy]"). */
  equipped?: string;
  /** Alternate display text (sheet AC displays, e.g. "Unarmored Defense (Barbarian)"). */
  alt?: string;
  /**
   * `inline="true"`: the rule carries a text value for `{{...}}` sheet tokens
   * (the dragonborn ancestry damage type) instead of a numeric contribution.
   */
  inline?: boolean;
  /**
   * Situational gate ("while raging", …): the rule describes a circumstance,
   * not a permanent statistic, and must stay out of unconditional totals.
   */
  condition?: string;
}

export interface SelectRule {
  kind: "select";
  type: string;
  name?: string;
  id?: string;
  number?: number;
  expand?: boolean;
  default?: string;
  supports?: string;
  level?: number;
  optional?: boolean;
  requirements?: string;
  /** The spellcasting list name for $(spellcasting:list) expansions. */
  spellcasting?: string;
  /** Inline choices carried by `<select type="List">` rules. */
  items?: SelectListItem[];
}

export interface SelectListItem {
  id: string;
  text: string;
}

export interface AppendRule {
  kind: "append";
  type?: string;
  name?: string;
  id?: string;
  level?: number;
  supports?: string;
}

export interface RequireRule {
  kind: "require";
  type?: string;
  name?: string;
  id?: string;
  level?: number;
  supports?: string;
}

/** The <multiclass> block of a class element (multiclass variant definition). */
export interface MulticlassBlock {
  /** The variant element id (e.g. ID_WOTC_PHB_MULTICLASS_ROGUE). */
  id: string;
  prerequisite?: string;
  /** Requirement expression gating the multiclass option (flip-marker aware). */
  requirements?: string;
  setters: Setter[];
  rules: Rule[];
}

/** The `<spellcasting>` block of a spellcasting feature element. */
export interface SpellcastingBlock {
  name: string;
  ability?: string;
  prepare?: boolean;
  /** `allowReplace="true"`: one known spell may be swapped on level-up. */
  allowReplace?: boolean;
  /** The `<list>` tag name (e.g. "Wizard"). */
  list?: string;
  /** `known="true"` on the list (full-list caster semantics). */
  listKnown?: boolean;
  /** `<extend>` spell ids added to the spell list (dragonmark traits). */
  extend: string[];
  /** `all="true"` on the block: the extension applies to every caster. */
  all?: boolean;
  /**
   * `extend="true"` on the block: a spell-list extension (subclass expanded
   * lists). Extensions add to an existing caster's list and never create a
   * caster of their own.
   */
  extension?: boolean;
}

/**
 * True when the spellcasting block extends an existing caster's spell list
 * rather than defining a caster of its own. Snapshots ingested before the
 * `extension` flag existed fall back to the block shape: extensions carry
 * neither a casting ability nor a base list.
 */
export function isSpellcastingExtension(block: SpellcastingBlock): boolean {
  if (block.extension !== undefined) return block.extension;
  return block.ability === undefined && block.list === undefined;
}

/** One entry of an <extract> block: an item id with a content amount. */
export interface ExtractEntry {
  id: string;
  amount: number;
}

/**
 * One <description> child of a <sheet> block. Sheets may carry several
 * descriptions gated by character level; the sheet picks the one with the
 * highest level attribute not exceeding the character level (missing level
 * applies at every level).
 */
export interface SheetDescription {
  /** Level gate (missing = applies at all levels). */
  level?: number;
  /** Usage shown in the feature parenthetical when the sheet has none. */
  usage?: string;
  /** Action shown in the parenthetical (1 corpus case on a description). */
  action?: string;
  /** Re-serialized inner XML (italics etc. preserved for rendering). */
  descriptionXml: string;
  /** Decoded text content (entities resolved, {{stat}} substitutions kept). */
  text: string;
}

/**
 * One <sheet> block of an element: the character-sheet presentation of the
 * feature. Multiple blocks per element are preserved in declaration order;
 * `display` keeps the tri-state (missing vs false vs true) because a missing
 * attribute is observable on the sheet (elements without a sheet entry are
 * not displayed at all).
 */
export interface ParsedSheetEntry {
  display?: boolean;
  action?: string;
  usage?: string;
  /** Alternate display name rendered in the parenthetical. */
  alt?: string;
  /** Alternate sheet name (background-feature titles). */
  name?: string;
  descriptions: SheetDescription[];
}

export interface ParsedElement {
  identity: ElementIdentity;
  /** Inner XML of the <description> block (re-serialized). */
  descriptionXml?: string;
  /** Inner XML of the <rules> block (re-serialized). */
  rulesXml?: string;
  setters: Setter[];
  rules: Rule[];
  supports: string[];
  requirements?: string;
  prerequisite?: string;
  /** <compendium display="false" /> hides the element from the compendium. */
  compendiumHidden: boolean;
  /** The <multiclass> variant block, when the element is a class. */
  multiclass?: MulticlassBlock;
  /** The <spellcasting> block, when the element is a spellcasting feature. */
  spellcasting?: SpellcastingBlock;
  /** The <extract> block of an item element (its contents, e.g. packs). */
  extract?: ExtractEntry[];
  /** The <sheet> blocks: character-sheet presentation (declaration order). */
  sheets: ParsedSheetEntry[];
  /** Nested <element> definitions (registered when the parent is registered). */
  children: ParsedElement[];
  /** Corpus-relative file path that declared this element. */
  declaredBy: string;
}

function numberAttr(node: XmlNode, name: string): number | undefined {
  const value = node.attrs[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Boolean attributes parse case-insensitively with surrounding whitespace
// tolerated; anything else (including "1" and "0") is false.
function booleanAttr(node: XmlNode, name: string): boolean | undefined {
  const value = node.attrs[name];
  if (value === undefined) return undefined;
  return value.trim().toLowerCase() === "true";
}

function parseRule(node: XmlNode): Rule {
  const kind = node.name;
  switch (kind) {
    case "grant":
      return {
        kind,
        type: node.attrs.type,
        name: node.attrs.name,
        id: node.attrs.id,
        level: numberAttr(node, "level"),
        supports: node.attrs.supports,
        requirements: node.attrs.requirements,
        prepared: booleanAttr(node, "prepared"),
        spellcasting: node.attrs.spellcasting,
      };
    case "stat":
      return {
        kind,
        name: node.attrs.name ?? "",
        value: node.attrs.value,
        bonus: node.attrs.bonus,
        group: node.attrs.group,
        requirements: node.attrs.requirements,
        entry: node.attrs.entry,
        type: node.attrs.type,
        level: numberAttr(node, "level"),
        equipped: node.attrs.equipped,
        alt: node.attrs.alt,
        inline: booleanAttr(node, "inline"),
        condition: node.attrs.condition,
      };
    case "select":
      {
        const items = childElements(node, "item")
          .map((item) => ({ id: item.attrs.id ?? "", text: textContent(item) }))
          .filter((item) => item.id !== "");
        return {
        kind,
        type: node.attrs.type ?? "",
        name: node.attrs.name,
        id: node.attrs.id,
        number: numberAttr(node, "number"),
        expand: booleanAttr(node, "expand"),
        default: node.attrs.default,
        supports: node.attrs.supports,
        level: numberAttr(node, "level"),
        optional: booleanAttr(node, "optional"),
        requirements: node.attrs.requirements,
        spellcasting: node.attrs.spellcasting,
        ...(items.length > 0 ? { items } : {}),
        };
      }
    case "append":
      return {
        kind,
        type: node.attrs.type,
        name: node.attrs.name,
        id: node.attrs.id,
        level: numberAttr(node, "level"),
        supports: node.attrs.supports,
      };
    case "require":
      return {
        kind,
        type: node.attrs.type,
        name: node.attrs.name,
        id: node.attrs.id,
        level: numberAttr(node, "level"),
        supports: node.attrs.supports,
      };
    default:
      return { kind: "other", name: kind, attrs: { ...node.attrs } };
  }
}

export function parseElement(node: XmlNode, declaredBy: string): ParsedElement {
  const identity: ElementIdentity = {
    id: node.attrs.id ?? "",
    name: node.attrs.name ?? "",
    type: node.attrs.type ?? "",
    source: node.attrs.source ?? "",
  };

  const setters: Setter[] = [];
  const rules: Rule[] = [];
  const supports: string[] = [];
  const children: ParsedElement[] = [];
  let descriptionXml: string | undefined;
  let rulesXml: string | undefined;
  let requirements: string | undefined;
  let prerequisite: string | undefined;
  let compendiumHidden = false;
  let multiclass: MulticlassBlock | undefined;
  let extract: ExtractEntry[] | undefined;
  let spellcasting: SpellcastingBlock | undefined;
  const sheets: ParsedSheetEntry[] = [];

  for (const child of childElements(node)) {
    switch (child.name) {
      case "description":
        descriptionXml = serializeXmlChildren(child);
        break;
      case "rules":
        rulesXml = serializeXmlChildren(child);
        for (const ruleNode of childElements(child)) {
          rules.push(parseRule(ruleNode));
        }
        break;
      case "multiclass":
        multiclass = parseMulticlass(child);
        break;
      case "extract":
        extract = childElements(child, "item").map((itemNode) => ({
          id: textContent(itemNode),
          amount: numberAttr(itemNode, "amount") ?? 1,
        }));
        break;
      case "spellcasting": {
        const listNode = childElements(child, "list")[0];
        const extend = childElements(child, "extend").map((extendNode) => textContent(extendNode));
        spellcasting = {
          name: child.attrs.name ?? "",
          ability: child.attrs.ability,
          prepare: booleanAttr(child, "prepare"),
          allowReplace: booleanAttr(child, "allowReplace"),
          list: listNode ? textContent(listNode) : undefined,
          listKnown: listNode ? booleanAttr(listNode, "known") : undefined,
          extend,
          all: booleanAttr(child, "all"),
          extension: booleanAttr(child, "extend"),
        };
        break;
      }
      case "sheet": {
        const descriptions: SheetDescription[] = [];
        for (const descriptionNode of childElements(child, "description")) {
          descriptions.push({
            level: numberAttr(descriptionNode, "level"),
            usage: descriptionNode.attrs.usage,
            action: descriptionNode.attrs.action,
            descriptionXml: serializeXmlChildren(descriptionNode),
            text: textContent(descriptionNode),
          });
        }
        const displayAttr = child.attrs.display;
        sheets.push({
          display: displayAttr === undefined ? undefined : displayAttr.trim().toLowerCase() === "true",
          action: child.attrs.action,
          usage: child.attrs.usage,
          alt: child.attrs.alt,
          name: child.attrs.name,
          descriptions,
        });
        break;
      }
      case "setters":
        for (const setNode of childElements(child, "set")) {
          const { name, value: _value, ...extra } = setNode.attrs;
          const setter: Setter = {
            name: name ?? "",
            value: textContent(setNode),
          };
          const extras = Object.entries(extra);
          if (extras.length > 0) setter.attrs = Object.fromEntries(extras);
          setters.push(setter);
        }
        break;
      case "supports": {
        // The corpus spells support tags either as child elements with
        // id/type attributes or as comma-separated text ("Dwarf", or
        // "Light Armor, ID_INTERNAL_ARMOR_GROUP_LIGHT").
        const childTags = childElements(child);
        if (childTags.length === 0) {
          for (const tag of textContent(child).split(",")) {
            const trimmed = tag.trim();
            if (trimmed !== "") supports.push(trimmed);
          }
        } else {
          for (const supportNode of childTags) {
            if (supportNode.attrs.id) supports.push(supportNode.attrs.id);
            else if (supportNode.attrs.type) supports.push(supportNode.attrs.type);
          }
        }
        break;
      }
      case "requirements":
        requirements = textContent(child) || child.attrs.id || child.attrs.name;
        break;
      case "prerequisite":
        prerequisite = textContent(child) || child.attrs.name;
        break;
      case "compendium":
        compendiumHidden = child.attrs.display === "false";
        break;
      case "element":
        children.push(parseElement(child, declaredBy));
        break;
      default:
        break;
    }
  }

  return {
    identity,
    descriptionXml,
    rulesXml,
    setters,
    rules,
    supports,
    requirements,
    prerequisite,
    compendiumHidden,
    multiclass,
    extract,
    spellcasting,
    sheets,
    children,
    declaredBy,
  };
}

function parseMulticlass(node: XmlNode): MulticlassBlock {
  const setters: Setter[] = [];
  const rules: Rule[] = [];
  let prerequisite: string | undefined;
  let requirements: string | undefined;
  for (const child of childElements(node)) {
    switch (child.name) {
      case "prerequisite":
        prerequisite = textContent(child) || child.attrs.name;
        break;
      case "requirements":
        requirements = textContent(child) || child.attrs.id || child.attrs.name;
        break;
      case "setters":
        for (const setNode of childElements(child, "set")) {
          const { name, value: _value, ...extra } = setNode.attrs;
          const setter: Setter = {
            name: name ?? "",
            value: textContent(setNode),
          };
          const extras = Object.entries(extra);
          if (extras.length > 0) setter.attrs = Object.fromEntries(extras);
          setters.push(setter);
        }
        break;
      case "rules":
        for (const ruleNode of childElements(child)) {
          rules.push(parseRule(ruleNode));
        }
        break;
      default:
        break;
    }
  }
  return {
    id: node.attrs.id ?? "",
    prerequisite,
    requirements,
    setters,
    rules,
  };
}

function serializeXmlChildren(node: XmlNode): string {
  return node.children
    .map((child) => (child.kind === "raw" ? child.raw : serializeXml(child.node)))
    .join("");
}

/** Parse all top-level <element> definitions from one corpus file. */
export function parseElementsFile(source: string, declaredBy: string): ParsedElement[] {
  const doc = parseXml(source);
  const root = childElements(doc, "elements")[0] ?? doc;
  const elements: ParsedElement[] = [];
  for (const node of childElements(root, "element")) {
    elements.push(parseElement(node, declaredBy));
  }
  return elements;
}

/** One top-level <append id="..."> block (merges rules/supports into a target element). */
export interface AppendBlock {
  id: string;
  rules: Rule[];
  supports: string[];
}

/** Parse all top-level <append> blocks from one corpus file. */
export function parseAppendsFile(source: string, _declaredBy: string): AppendBlock[] {
  const doc = parseXml(source);
  const root = childElements(doc, "elements")[0] ?? doc;
  const appends: AppendBlock[] = [];
  for (const node of childElements(root, "append")) {
    const id = node.attrs.id ?? "";
    if (id === "") continue;
    const rules: Rule[] = [];
    const supports: string[] = [];
    for (const child of childElements(node)) {
      switch (child.name) {
        case "rules":
          for (const ruleNode of childElements(child)) {
            rules.push(parseRule(ruleNode));
          }
          break;
        case "supports": {
          const childTags = childElements(child);
          if (childTags.length === 0) {
            for (const tag of textContent(child).split(",")) {
              const trimmed = tag.trim();
              if (trimmed !== "") supports.push(trimmed);
            }
          } else {
            for (const supportNode of childTags) {
              if (supportNode.attrs.id) supports.push(supportNode.attrs.id);
              else if (supportNode.attrs.type) supports.push(supportNode.attrs.type);
            }
          }
          break;
        }
        default:
          break;
      }
    }
    appends.push({ id, rules, supports });
  }
  return appends;
}
