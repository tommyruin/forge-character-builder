/**
 * Item significance: how much an item's own text matters at the table, and so
 * whether it earns a card (or a note) on the printed sheet.
 *
 *  - `magic`: a magic item, by element type, by a magic category (Wondrous
 *    Items, Rings, Potions, ...) or by carrying a rarity;
 *  - `tool`: tools, poisons, spellcasting foci and musical instruments, whose
 *    use the player has to look up;
 *  - `useful-gear`: adventuring gear (or explosives) whose description reads
 *    as rules — an action to use, a DC, damage, a saving throw;
 *  - `trivial`: everything else, including packs (their contents are what is
 *    used), mounts and vehicles, ammunition, plain weapons and armour (the
 *    attack table and armour class already carry them) and items with no
 *    description at all.
 *
 * The classification reads only the element itself, so it is the same for the
 * bundled baseline, the corpus and uploaded homebrew.
 */

import { elementById, type ElementLibrary } from "../library.js";
import type { ParsedElement } from "../parser.js";
import { normalizeItemCategory } from "./categories.js";

export type ItemSignificance = "magic" | "tool" | "useful-gear" | "trivial";

const MAGIC_CATEGORIES = new Set([
  "magic weapons",
  "magic armor",
  "wondrous items",
  "rings",
  "potions",
  "wands",
  "rods",
  "staffs",
  "scrolls",
]);

const TOOL_CATEGORIES = new Set(["tools", "poison", "spellcasting focus", "musical instruments"]);

/** Gear categories whose items are classified by what their description says. */
const GEAR_CATEGORIES = new Set(["adventuring gear", "explosives"]);

/**
 * Phrases that only appear when a description tells the player how to use the
 * item in play. Plain flavour ("Rations consist of dry foods ...") has none.
 */
const RULES_TEXT =
  /\b(?:bonus action|action|DC|saving throws?|damage|checks?|advantage|disadvantage|hit points?|difficult terrain|restrained|attack rolls?)\b/;

function setterValue(element: ParsedElement, name: string): string {
  const requested = name.toLocaleLowerCase();
  return element.setters.find((setter) => setter.name.toLocaleLowerCase() === requested)?.value.trim() ?? "";
}

/** A description's readable text: markup dropped, common entities decoded, whitespace collapsed. */
export function plainDescriptionText(xml: string | undefined): string {
  return (xml ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The significance of one item element (the adorner, for an adorned record). */
export function itemSignificance(element: ParsedElement | undefined): ItemSignificance {
  if (element === undefined) return "trivial";
  const type = element.identity.type;
  const category = normalizeItemCategory(setterValue(element, "category")).toLocaleLowerCase();
  if (type === "Magic Item" || MAGIC_CATEGORIES.has(category) || setterValue(element, "rarity") !== "") return "magic";
  if (type !== "Item") return "trivial";
  if (TOOL_CATEGORIES.has(category)) return "tool";
  // An uncategorised item is adventuring gear, the convention the equipment
  // catalogue already follows.
  if (category !== "" && !GEAR_CATEGORIES.has(category)) return "trivial";
  return RULES_TEXT.test(plainDescriptionText(element.descriptionXml)) ? "useful-gear" : "trivial";
}

/**
 * The significance of an inventory record: its adorner when adorned (a
 * +1 Longsword is a magic item, not a longsword), else its own item.
 */
export function inventoryItemSignificance(
  library: ElementLibrary,
  item: { itemId: string; adorners: readonly string[] },
): ItemSignificance {
  const adorner = item.adorners.length > 0 ? elementById(library, item.adorners[0]!) : undefined;
  return itemSignificance(adorner ?? elementById(library, item.itemId));
}

/** True for the items that earn a card when the player wants only the ones that matter. */
export function isSignificantItem(significance: ItemSignificance): boolean {
  return significance !== "trivial";
}
