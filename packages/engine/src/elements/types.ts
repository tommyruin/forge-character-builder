/**
 * Element model — derived from the public content grammar.
 *
 * The corpus (third-party/elements/*) is the source of truth for this shape:
 * every element is `<element name="" type="" source="" id="">` with optional
 * `<description>`, `<rules>`, `<setters>`, `<sheet>`, `<supports>`,
 * `<requirements>`, `<select>`, `<grant>`, `<stat>` blocks.
 *
 * This file fixes the core record shape that the parser, the content library,
 * and the character model are all built against.
 */

export interface ElementReference {
  id: string;
  name?: string;
  type?: string;
}

/** Root-level identity of a parsed element. */
export interface ElementIdentity {
  id: string;
  name: string;
  type: string;
  source: string;
}

/** Raw parsed element (pre-resolution). */
export interface ParsedElement {
  identity: ElementIdentity;
  /** Optional display name override (alternateName on the sheet). */
  alternateName?: string;
  descriptionXml?: string;
  /** Which file declared this element (path under the corpus). */
  declaredBy: string;
}

export type ElementType = string;

/** The six ability scores, canonical order. */
export type AbilityKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

export const ABILITY_KEYS: readonly AbilityKey[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;
