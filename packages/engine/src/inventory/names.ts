/**
 * What an inventory record is called.
 *
 * A record has up to three names: the physical base it is built on
 * (`Scimitar`), the name its rules give it (an adorner's own name, or its
 * `name-format` laid over the base, `Longsword +1`), and the name the player
 * gave this one record. The player's name wins everywhere a record is printed,
 * and changes nothing about what the record is: lookups, rules and attack math
 * keep using the element ids.
 */

import { elementById, type ElementLibrary } from "../content/library.js";

interface NamedRecord {
  itemId: string;
  adorners: string[];
  /** The record's own name from `<details><name>`; blank when it has none. */
  detailsName?: string;
  /** The `<item name>` the file stored when the record was made. */
  name: string;
}

/** The longest custom name and notes a record stores. */
export const MAX_ITEM_NAME = 120;
export const MAX_ITEM_NOTES = 2000;

/** The player's name for this record, or "" when it has none. */
export function customNameOf(item: { detailsName?: string }): string {
  return (item.detailsName ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The name the record's rules give it: the base's name, or for an adorned
 * record the adorner's `name-format` over the base (`{{parent}}`,
 * `{{enhancement}}`), else the adorner's own name.
 */
export function ruleName(library: ElementLibrary, item: NamedRecord): string {
  const base = elementById(library, item.itemId);
  let name = base?.identity.name ?? item.name;
  if (item.adorners.length > 0) {
    const adorner = elementById(library, item.adorners[0]!);
    if (adorner !== undefined) {
      const format = adorner.setters.find((setter) => setter.name === "name-format")?.value;
      const enhancement = adorner.setters.find((setter) => setter.name === "enhancement")?.value;
      name = format
        ? format.replace("{{parent}}", base?.identity.name ?? item.name).replace("{{enhancement}}", enhancement ?? "")
        : adorner.identity.name;
    }
  }
  return name.replace(/\s+/g, " ").trim();
}

/** The name a record prints: the player's, else the rules'. */
export function recordDisplayName(library: ElementLibrary, item: NamedRecord): string {
  return customNameOf(item) || ruleName(library, item);
}
