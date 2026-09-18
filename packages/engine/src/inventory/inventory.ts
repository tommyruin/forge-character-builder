/**
 * Inventory operations: DTO construction and .dnd5e document edit planning.
 *
 * The rules this surface implements:
 *  - adding a weapon/armor auto-equips it at its first equip location when
 *    the slot is free (a two-handed weapon occupies both hands); adding a
 *    magic item with an explicit baseElementId (or a name-valued weapon/armor
 *    setter) adorns it onto the base; an unbased magic item is not equippable.
 *  - equipping vacates the slot's occupants; unequipping also drops
 *    attunement; the attune endpoint accepts non-attunable items (no count
 *    change) and rejects attuning beyond the computed "attunement:max"
 *    statistic (base 3, raised by content stat rules).
 *  - an equipped or attuned weapon/armor record registers its base into the
 *    <sum> (the base element, its grants, and the adorner's id), armor items
 *    additionally register into the <elements> tree, and registered-count
 *    increments by one, or by two when the record is adorned. What the adorner
 *    or a worn slotless item GRANTS is a registration of its own, planned in
 *    `item-registration.ts`; only a worn slotless item moves the count there.
 *  - extracting a pack removes it and adds its <extract> contents as new
 *    items; non-extractable items are rejected.
 */

import { randomUuid } from "../platform.js";
import { getAttr, childElements, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { engineError } from "../errors.js";
import { escapeXml } from "../selection/selection.js";
import { elementById, type ElementLibrary } from "../content/library.js";
import { isContentAllowedForCharacter } from "../content/access.js";
import type { ParsedElement, Rule, Setter } from "../content/parser.js";
import type { CharacterState, Coinage, InventoryItemState } from "../character/state.js";
import { equipmentMetadata, isPhysicalEquipment, type EquipmentAttunementDto } from "../content/equipment/categories.js";

export interface InventoryItemDto {
  identifier: string;
  itemId: string;
  /**
   * The element to show for this record: the adorner (Staff of Power) when
   * adorned, else the base item. Inventory description lookups must use this
   * — the base of an adorned record is the plain physical item (Quarterstaff).
   */
  displayElementId: string;
  /** The record's free-text notes from the details card. */
  notes: string;
  name: string;
  type: string;
  amount: number;
  isEquippable: boolean;
  isEquipped: boolean;
  equippedLocation: string | null;
  /** The storage container name it is stowed in, or null when carried. */
  storage: string | null;
  isAttunable: boolean;
  isAttuned: boolean;
  displayPrice: string;
  source: string;
  equipLocations: string[];
  weight: string | null;
  category: string | null;
  isPhysicalEquipment: boolean;
  description: string;
  rarity: string | null;
  attunement: EquipmentAttunementDto;
  isExtractable: boolean;
  extractableContents: Array<{ itemId: string; name: string; amount: number }>;
  /**
   * True when an attack row already exists for this record. Equipping a weapon
   * creates one automatically; this is what tells the Equipment tab whether a
   * never-equipped weapon can still be offered as an attack.
   */
  hasAttackRow: boolean;
}

export interface InventoryDto {
  items: InventoryItemDto[];
  coins: Coinage;
  equipmentWeight: number;
  attunedItemCount: number;
  maxAttunedItemCount: number;
  /** The two storage container names (`state.storages`, editable). */
  storages: string[];
}

export interface ItemBaseOptionsDto {
  slot: string | null;
  options: Array<{ id: string; name: string }>;
}

export interface AddItemOptions {
  itemId: string;
  amount?: number;
  baseElementId?: string | null;
}

export interface RawEdit {
  start: number;
  end: number;
  replacement: string;
}

/** Equip location keys -> the display name stored in the document. */
export const LOCATION_DISPLAY: Record<string, string> = {
  primary: "Primary Hand",
  secondary: "Secondary Hand",
  armor: "Armor",
  "primary-twohanded": "Two-Handed",
};

/**
 * The equip key of a slotless item that is worn rather than held. It occupies
 * no slot, so the document records it as a bare `<equipped>true</equipped>`
 * with no location attribute — the form saved files use for a worn cloak.
 */
export const WORN_LOCATION = "worn";

const DISPLAY_LOCATION: Record<string, string> = {
  "Primary Hand": "primary",
  "Secondary Hand": "secondary",
  Armor: "armor",
  "Two-Handed": "primary-twohanded",
};

const setterValue = (element: ParsedElement | undefined, name: string): string | undefined =>
  element?.setters.find((s) => s.name === name)?.value;

/** The equip location keys of an item's effective element (its base). */
export function equipLocationsFor(element: ParsedElement | undefined): string[] {
  if (!element) return [];
  const slot = setterValue(element, "slot") ?? "";
  if (element.identity.type === "Weapon") {
    if (slot === "twohand") return ["primary-twohanded"];
    return ["primary", "secondary"];
  }
  if (element.identity.type === "Armor") {
    if (slot.includes("secondary")) return ["secondary"];
    return ["armor"];
  }
  return [];
}

/** The magic-item base slot setter ("weapon" or "armor"), when present. */
function baseSlotSetter(element: ParsedElement | undefined): Setter | undefined {
  if (!element) return undefined;
  return element.setters.find((s) => s.name === "weapon" || s.name === "armor");
}

/** Parses a corpus weight text ("3 lb.", "1/4 lb.", "½ lb.", "5 lb. (full)") to pounds. */
export function parseWeight(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === "" || value.trim() === "—") return 0;
  const text = value.trim().replace(/\s*lb\.?.*$/, "").trim();
  const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  if (FRACTIONS[text] !== undefined) return FRACTIONS[text]!;
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator > 0) return numerator / denominator;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface ItemWeight {
  pounds: number;
  excluded: boolean;
}

/**
 * The weight of a `<set name="weight">` setter: its `lb` attribute is the
 * authoritative numeric value (the corpus keeps display text like "5 oz."
 * that a text parse cannot recover); the display text is a fallback only
 * for setters without `lb`. `excludeEncumbrance="true"` (towed vehicles)
 * marks the weight as not contributing to carried weight.
 */
function weightFromSetter(setter: Setter | undefined): ItemWeight | null {
  if (!setter) return null;
  const lb = setter.attrs?.lb;
  const pounds = lb !== undefined ? Number(lb) : parseWeight(setter.value);
  return {
    pounds: Number.isFinite(pounds) ? pounds : 0,
    excluded: setter.attrs?.excludeEncumbrance === "true",
  };
}

/**
 * The element whose weight setter governs an inventory item: an adorner
 * (magic-item overlay) with its own weight setter replaces the base item's
 * weight entirely; otherwise the base item's weight applies.
 */
function weightElementOf(library: ElementLibrary, item: InventoryItemState): ParsedElement | undefined {
  const adorner = item.adorners.length > 0 ? elementById(library, item.adorners[0]!) : undefined;
  if (adorner?.setters.some((s) => s.name === "weight")) return adorner;
  return baseElementOf(library, item);
}

/** An inventory item's own weight (its content-authored weight setter, stack-multiplied). */
export function itemWeightPounds(library: ElementLibrary, item: InventoryItemState): number {
  const element = weightElementOf(library, item);
  const weight = weightFromSetter(element?.setters.find((s) => s.name === "weight"));
  if (weight === null || weight.excluded) return 0;
  const stackable = setterValue(element, "stackable")?.trim().toLowerCase() === "true";
  return weight.pounds * (stackable ? item.amount : 1);
}

/**
 * An inventory item's weight contribution to carried encumbrance: a stowed
 * item (assigned to a storage container) is not on the character's person,
 * so it contributes nothing to what they carry.
 */
function itemEncumbrance(library: ElementLibrary, item: InventoryItemState): number {
  if (item.storage) return 0;
  return itemWeightPounds(library, item);
}

/** Carried coins weigh in at fifty per pound, every denomination alike. */
function coinWeightPounds(coins: CharacterState["coins"]): number {
  return (coins.copper + coins.silver + coins.electrum + coins.gold + coins.platinum) / 50;
}

const PRICE_CURRENCY: Record<string, string> = { cp: "cp", sp: "sp", ep: "ep", gp: "gp", pp: "pp" };

/** The display price text ("15 gp") or "—" for items without a cost setter. */
function displayPrice(element: ParsedElement | undefined): string {
  const cost = element?.setters.find((s) => s.name === "cost");
  if (!cost) return "—";
  const currency = PRICE_CURRENCY[String(cost.attrs?.currency ?? "")] ?? "";
  return `${cost.value} ${currency}`.trim();
}

/** The resolved base element of an inventory item (its adorner target). */
function baseElementOf(library: ElementLibrary, item: InventoryItemState): ParsedElement | undefined {
  return elementById(library, item.itemId);
}

/** The element whose rules apply to an item (the adorner when adorned). */
function effectiveElement(library: ElementLibrary, item: { itemId: string; adorners: string[] }): ParsedElement | undefined {
  if (item.adorners.length > 0) {
    const adorner = elementById(library, item.adorners[0]!);
    if (adorner) return adorner;
  }
  return elementById(library, item.itemId);
}

function isAttunableElement(element: ParsedElement | undefined): boolean {
  return setterValue(element, "attunement") === "true";
}

/**
 * A slotless item that is put to use by wearing it: real equipment with no
 * equip location of its own (a cloak, a ring, goggles, a tattoo). A magic
 * overlay still waiting for its base weapon or armour is excluded — it is not
 * usable until based — and so is a stackable consumable, which is spent
 * rather than worn.
 */
export function isWearableElement(element: ParsedElement | undefined): boolean {
  if (!element) return false;
  if (element.identity.type === "Weapon" || element.identity.type === "Armor") return false;
  if (!isPhysicalEquipment(element)) return false;
  if (isAdornerElement(element)) return false;
  return setterValue(element, "stackable")?.trim().toLowerCase() !== "true";
}

/**
 * True when the element is a magic overlay laid over a base weapon or armour
 * rather than an item in its own right: its `weapon`/`armor` setter names what
 * it can adorn. An adorned record is counted by its base registration, so an
 * adorner's own subtree never moves the registered count again.
 */
export function isAdornerElement(element: ParsedElement | undefined): boolean {
  return baseSlotSetter(element) !== undefined;
}

/**
 * The element whose own benefits an inventory record carries, as opposed to
 * the physical base it is built on: the adorner of an adorned record, or the
 * item itself when it is worn in its own right. Records with neither (a plain
 * weapon, a stack of torches, an unbased magic item) have nothing of their own
 * to register.
 */
export function contentElementOf(
  library: ElementLibrary,
  item: { itemId: string; adorners: string[] },
): ParsedElement | undefined {
  if (item.adorners.length > 0) return elementById(library, item.adorners[0]!);
  const element = elementById(library, item.itemId);
  return isWearableElement(element) ? element : undefined;
}

/**
 * Whether an inventory item currently conveys its benefits. A weapon or
 * armour must be equipped, and an attunement-requiring one must also be
 * attuned: attunement alone does not activate an item that is not in use, and
 * an attunement-requiring item in hand stays inert until attuned. A slotless
 * item (no equip location — a cloak, boots, a ring) has no hand or armour
 * slot to fill, so attunement alone activates it. A slotless item that needs
 * no attunement has only the act of wearing it to tell use from carriage --
 * except for the corpus's control records, which are switches rather than
 * gear and are on as soon as the character holds one. A stowed item
 * (assigned to a storage container) is off the character's person and is
 * always inert, regardless of its equipped/attuned flags.
 */
export function itemBenefitsActive(
  library: ElementLibrary,
  item: { itemId: string; adorners: string[]; equipped: boolean; attuned: boolean; storage?: string },
): boolean {
  if (item.storage) return false;
  const base = elementById(library, item.itemId);
  const attunable = isAttunableElement(effectiveElement(library, item));
  if (equipLocationsFor(base).length > 0) return item.equipped && (item.attuned || !attunable);
  if (attunable) return item.attuned;
  return isWearableElement(base) ? item.equipped : true;
}

/** The extract block contents of an item's effective element. */
function extractOf(library: ElementLibrary, item: InventoryItemState): Array<{ itemId: string; name: string; amount: number }> {
  const element = effectiveElement(library, item);
  const entries = element?.extract ?? [];
  return entries.map((entry) => ({
    itemId: entry.id,
    name: library.byId.get(entry.id)?.identity.name ?? "",
    amount: entry.amount,
  }));
}

/** The slots occupied by an equipped item (two-handed occupies both hands). */
function occupiedSlots(item: InventoryItemState): string[] {
  const key = DISPLAY_LOCATION[item.location ?? ""] ?? "";
  if (key === "primary-twohanded") return ["primary", "secondary"];
  return key === "" ? [] : [key];
}

/** The equipped items occupying the given slot key. */
function occupants(state: CharacterState, key: string): InventoryItemState[] {
  const out: InventoryItemState[] = [];
  for (const item of state.items) {
    if (!item.equipped) continue;
    const slots = occupiedSlots(item);
    if (slots.includes(key)) out.push(item);
  }
  return out;
}

/** True when the slot key is free (no occupant). */
function isSlotFree(state: CharacterState, key: string): boolean {
  const keys = key === "primary-twohanded" ? ["primary", "secondary"] : [key];
  return keys.every((k) => occupants(state, k).length === 0);
}

/** The element of an item's base (for the sum registration type). */
function sumEntryType(library: ElementLibrary, id: string): string {
  return library.byId.get(id)?.identity.type ?? "";
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** The inventory DTO (pinned shape). */
export function buildInventoryDto(
  state: CharacterState,
  library: ElementLibrary,
  maxAttunedItemCount = 3,
): InventoryDto {
  const items = state.items.map((item) => {
    const base = baseElementOf(library, item);
    const element = effectiveElement(library, item);
    const displayElement = element ?? base;
    const metadata = equipmentMetadata(displayElement, (id) => library.byId.get(id));
    // A slotless item fills no slot, so it offers the one "worn" action
    // instead of the hand/armour choices a weapon or armour offers.
    const slots = equipLocationsFor(base);
    const locations = slots.length > 0 ? slots : isWearableElement(base) ? [WORN_LOCATION] : [];
    const equipped = item.equipped;
    return {
      identifier: item.identifier,
      itemId: item.itemId,
      displayElementId: displayElement?.identity.id ?? item.itemId,
      notes: item.notes ?? "",
      name: displayElement?.identity.name ?? item.name,
      type: base?.identity.type ?? "",
      amount: item.amount,
      isEquippable: locations.length > 0,
      isEquipped: equipped,
      equippedLocation: equipped ? (item.location ?? null) : null,
      storage: item.storage ?? null,
      isAttunable: isAttunableElement(displayElement),
      isAttuned: item.attuned,
      displayPrice: displayPrice(base),
      source: base?.identity.source ?? "",
      equipLocations: locations,
      weight: setterValue(base, "weight") ?? null,
      category: setterValue(base, "category") ?? null,
      isPhysicalEquipment: base !== undefined && isPhysicalEquipment(base),
      description: metadata.description,
      rarity: metadata.rarity,
      attunement: metadata.attunement,
      isExtractable: (base?.extract ?? []).length > 0 || (element?.extract ?? []).length > 0,
      extractableContents: extractOf(library, item),
      hasAttackRow: state.attacks.some((row) => row.identifier === item.identifier),
    };
  });
  const equipmentWeight =
    state.items.reduce((sum, item) => sum + itemEncumbrance(library, item), 0) + coinWeightPounds(state.coins);
  const attunedItemCount = state.items.filter(
    (item) => isAttunableElement(effectiveElement(library, item)) && item.attuned,
  ).length;
  return {
    items,
    coins: { ...state.coins },
    equipmentWeight,
    attunedItemCount,
    maxAttunedItemCount,
    storages: [...state.storages],
  };
}

/** The base-item options of a magic item (its weapon/armor setter targets). */
export function itemBaseOptions(library: ElementLibrary, itemId: string, state?: CharacterState): ItemBaseOptionsDto {
  const element = elementById(library, itemId);
  const setter = baseSlotSetter(element);
  if (!element || !setter) return { slot: null, options: [] };
  const candidates = (library.byType.get(setter.name === "weapon" ? "Weapon" : "Armor") ?? [])
    .filter((candidate) => state === undefined || isContentAllowedForCharacter(state, library, candidate));
  const value = setter.value;
  const matched = /[|,]/.test(value) || value.includes("ID_")
    ? candidates.filter((candidate) => matchesBaseSupports(value, candidate))
    : candidates.find(
        (candidate) =>
          candidate.identity.id !== element.identity.id &&
          candidate.identity.name.toLowerCase() === value.toLowerCase(),
      );
  const seen = new Set<string>();
  const options = (Array.isArray(matched) ? matched : matched ? [matched] : [])
    .filter((candidate) => {
      const key = candidate.identity.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((candidate) => ({ id: candidate.identity.id, name: candidate.identity.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { slot: setter.name, options };
}

/** Support-expression matching for base setters ("A||B" groups, "," tags). */
function matchesBaseSupports(expression: string, candidate: ParsedElement): boolean {
  const have = new Set(candidate.supports.map((tag) => tag.trim()));
  return expression
    .split("|")
    .map((group) => group.trim())
    .filter((group) => group !== "")
    .some((group) => group.split(",").map((tag) => tag.trim()).every((tag) => have.has(tag)));
}

// ---------------------------------------------------------------------------
// Edit planning
// ---------------------------------------------------------------------------

/** The node text of an item in the equipment section (observed layout). */
function renderItemNode(item: {
  identifier: string;
  name: string;
  id: string;
  amount: number;
  equippedLocation: string | null;
  attuned: boolean;
  adorner: { name: string; id: string } | null;
  detailsName: string;
  notes: string;
  /** The storage container to stow the new record in (absent means carried). */
  storage?: string | null;
  /** Observed details-card opts; new records default to a full-sheet card. */
  card?: boolean;
  sidebar?: boolean;
}): string {
  const lines: string[] = [];
  lines.push(
    `<item identifier="${item.identifier}" name="${escapeXml(item.name)}" id="${escapeXml(item.id)}"` +
      (item.amount > 1 ? ` amount="${item.amount}"` : "") +
      (item.sidebar ? ` sidebar="true"` : "") +
      ">",
  );
  if (item.equippedLocation !== null) {
    lines.push(`\t\t\t\t<equipped location="${escapeXml(item.equippedLocation)}">true</equipped>`);
  }
  if (item.attuned) {
    lines.push("\t\t\t\t<attunement>true</attunement>");
  }
  if (item.storage) {
    lines.push(`\t\t\t\t<storage><location>${escapeXml(item.storage)}</location></storage>`);
  }
  if (item.adorner) {
    lines.push("\t\t\t\t<items>");
    lines.push(`\t\t\t\t\t<adorner name="${escapeXml(item.adorner.name)}" id="${escapeXml(item.adorner.id)}" />`);
    lines.push("\t\t\t\t</items>");
  }
  lines.push(`\t\t\t\t<details${item.card === false ? "" : ' card="true"'}>`);
  lines.push("\t\t\t\t\t<name>");
  if (item.detailsName !== "") lines.push(escapeXml(item.detailsName));
  lines.push("\t\t\t\t\t</name>");
  lines.push("\t\t\t\t\t<notes>");
  if (item.notes !== "") lines.push(escapeXml(item.notes));
  lines.push("\t\t\t\t\t</notes>");
  lines.push("\t\t\t\t</details>");
  lines.push("\t\t\t</item>");
  return lines.join("\r\n");
}

function equipmentNode(document: Dnd5eDocument): Dnd5eNode {
  const node = document.root.build.equipment?.node;
  if (!node) throw engineError("not-found", "equipment section not found");
  return node;
}

function appendItemEdit(document: Dnd5eDocument, itemNode: string): RawEdit {
  const node = equipmentNode(document);
  const at = node.closeStart ?? node.end;
  return { start: at, end: at, replacement: `\r\n\t\t\t${itemNode}` };
}

function removeNodeEdit(raw: string, node: Dnd5eNode): RawEdit {
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start -= 1;
  if (start > 0 && raw[start - 1] === "\r") start -= 1;
  return { start, end: node.end, replacement: "" };
}

function attrValueRange(raw: string, node: Dnd5eNode, name: string): { start: number; end: number } | null {
  const openEnd = node.openEnd;
  const open = raw.slice(node.start, openEnd);
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(open);
  if (!match) return null;
  return { start: node.start + match.index + match[0].indexOf('"') + 1, end: node.start + match.index + match[0].length - 1 };
}

/**
 * Sum entries of a base registration: the base, its own grants, and the
 * adorner's id in the order saved files carry them. The adorner's *grants*
 * are not here — those belong to the adorner's own registration, which the
 * item-registration sweep writes after this entry once the record is actually
 * conveying its benefits.
 */
function sumEntriesFor(
  library: ElementLibrary,
  base: ParsedElement,
  adornerId: string | null,
): Array<{ type: string; id: string }> {
  const entries: Array<{ type: string; id: string }> = [];
  entries.push({ type: base.identity.type, id: base.identity.id });
  for (const rule of base.rules) {
    if (rule.kind === "grant" && rule.id !== undefined && rule.id !== "") {
      entries.push({ type: sumEntryType(library, rule.id), id: rule.id });
    }
  }
  if (adornerId !== null && adornerId !== "") {
    entries.push({ type: sumEntryType(library, adornerId), id: adornerId });
  }
  return entries;
}

function treeEntriesFor(
  library: ElementLibrary,
  base: ParsedElement,
): Array<{ type: string; name: string; id: string; children: Array<{ type: string; name: string; id: string }> }> {
  const children = base.rules
    .filter((rule): rule is Extract<Rule, { kind: "grant"; id?: string }> => rule.kind === "grant" && rule.id !== undefined && rule.id !== "")
    .map((rule) => {
      const child = library.byId.get(rule.id!);
      return { type: child?.identity.type ?? "Grants", name: child?.identity.name ?? "", id: rule.id! };
    });
  return [{ type: base.identity.type, name: base.identity.name, id: base.identity.id, children }];
}

/** Edits that insert sum entries after the last Level entry (observed position). */
function planSumInsertEdits(document: Dnd5eDocument, entries: Array<{ type: string; id: string }>): RawEdit[] {
  return planSumReplaceInsertEdits(document, null, entries);
}

/** Replaces the sum with `current` (or the document's) plus inserted entries. */
function planSumReplaceInsertEdits(
  document: Dnd5eDocument,
  current: Array<{ type: string; id: string }> | null,
  entries: Array<{ type: string; id: string }>,
): RawEdit[] {
  const sumView = document.root.build.sum;
  if (!sumView) return [];
  const sumNode = sumView.node;
  const base = current ?? sumView.elements().map((e) => ({ type: e.type ?? "", id: e.id ?? "" }));
  let insertAt = -1;
  base.forEach((entry, index) => {
    if (entry.type === "Level") insertAt = index;
  });
  while (insertAt + 1 < base.length && base[insertAt + 1]!.type !== "Class" && base[insertAt + 1]!.type !== "Multiclass") {
    insertAt++;
  }
  const all = [...base.slice(0, insertAt + 1), ...entries, ...base.slice(insertAt + 1)];
  const inner = `\r\n${all.map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`).join("\r\n")}\r\n\t\t`;
  const edits: RawEdit[] = [{ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner }];
  const count = attrValueRange(document.raw, sumNode, "element-count");
  if (count) edits.push({ start: count.start, end: count.end, replacement: String(all.length) });
  return edits;
}

/** Edits that replace the sum entries and update the element-count. */
function planSumReplaceEdits(document: Dnd5eDocument, remaining: Array<{ type: string; id: string }>): RawEdit[] {
  const sumView = document.root.build.sum;
  if (!sumView) return [];
  const sumNode = sumView.node;
  const inner = `\r\n${remaining.map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`).join("\r\n")}\r\n\t\t`;
  const edits: RawEdit[] = [{ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner }];
  const count = attrValueRange(document.raw, sumNode, "element-count");
  if (count) edits.push({ start: count.start, end: count.end, replacement: String(remaining.length) });
  return edits;
}

/**
 * The registered-count delta of a base registration. A record counts once for
 * itself and once more when it is adorned: saved characters tally an adorned
 * weapon as two registrations from the moment the base is registered, whether
 * or not the adorner is yet conveying anything.
 */
function countDeltaOf(adorners: readonly string[]): number {
  return adorners.length > 0 ? 2 : 1;
}

/**
 * The sum entries left after removing one instance of each id a registration
 * contributed. Two records can share a base or a grant id (a pair of
 * longswords, two items granting the same resistance); dropping every match
 * would unregister the other record's copy along with this one's.
 */
function sumWithoutOneInstanceEach(
  document: Dnd5eDocument,
  removed: Array<{ type: string; id: string }>,
): Array<{ type: string; id: string }> {
  const budget = new Map<string, number>();
  for (const entry of removed) budget.set(entry.id, (budget.get(entry.id) ?? 0) + 1);
  return (document.root.build.sum?.elements() ?? [])
    .map((entry) => ({ type: entry.type ?? "", id: entry.id ?? "" }))
    .filter((entry) => {
      const left = budget.get(entry.id) ?? 0;
      if (left === 0) return true;
      budget.set(entry.id, left - 1);
      return false;
    });
}

/**
 * True when another inventory record still holds a registration on the same
 * base element. The elements tree carries one node per element id, so the
 * node belongs to every record that shares that base and may only be removed
 * once the last of them unregisters.
 */
function baseSharedWithOtherRecord(
  library: ElementLibrary,
  state: CharacterState,
  item: InventoryItemState,
): boolean {
  return state.items.some(
    (other) =>
      other.identifier !== item.identifier &&
      other.itemId === item.itemId &&
      baseRegistrationPresent(library, other),
  );
}

/**
 * True when the record's physical base is a Weapon or Armor, the only kind
 * the equip/attune planners register. Slotless items carry no base of their
 * own and are left entirely to the item-registration sweep.
 */
function hasSlotBase(library: ElementLibrary, item: { itemId: string }): boolean {
  return equipLocationsFor(elementById(library, item.itemId)).length > 0;
}

/**
 * Whether the record's base registration is in the document right now. Only a
 * Weapon/Armor record carries one, and only while the item is on the
 * character (stowing takes it away) and either equipped or attuned. Planners
 * consult this rather than the flags alone so a registration is never written
 * twice or removed twice.
 */
export function baseRegistrationPresent(
  library: ElementLibrary,
  item: { itemId: string; equipped: boolean; attuned: boolean; storage?: string },
): boolean {
  if (item.storage) return false;
  if (!hasSlotBase(library, item)) return false;
  return item.equipped || item.attuned;
}

/** Edits that update the elements registered-count by a delta. */
function planRegisteredCountEdit(document: Dnd5eDocument, state: CharacterState, delta: number): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return [];
  const value = state.registeredCount + delta;
  const range = attrValueRange(document.raw, elementsNode, "registered-count");
  return range ? [{ start: range.start, end: range.end, replacement: String(value) }] : [];
}

/** Edits that append an armor item's element node into the elements tree. */
function planTreeAppendEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  base: ParsedElement,
): RawEdit[] {
  if (base.identity.type !== "Armor") return [];
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return [];
  const existing = childElements(elementsNode, "element").find((node) => getAttr(node, "id") === base.identity.id);
  if (existing) return [];
  const [entry] = treeEntriesFor(library, base);
  if (!entry) return [];
  const children = entry.children
    .map((child) => `\t\t\t\t<element type="${escapeXml(child.type)}" name="${escapeXml(child.name)}" id="${escapeXml(child.id)}" />`)
    .join("\r\n");
  const open = `<element type="${escapeXml(entry.type)}" name="${escapeXml(entry.name)}" id="${escapeXml(entry.id)}"`;
  const nodeText = children === "" ? `${open} />` : `${open}>\r\n${children}\r\n\t\t\t</element>`;
  const at = elementsNode.closeStart ?? elementsNode.end;
  return [{ start: at, end: at, replacement: `\r\n\t\t\t${nodeText}` }];
}

/** Edits that remove an armor item's element node from the elements tree. */
function planTreeRemoveEdits(document: Dnd5eDocument, id: string): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return [];
  const node = childElements(elementsNode, "element").find((n) => getAttr(n, "id") === id);
  if (!node) return [];
  return [removeNodeEdit(document.raw, node)];
}

/** The item document node of an inventory item. */
function itemNodeOf(document: Dnd5eDocument, identifier: string): Dnd5eNode {
  const node = equipmentNode(document);
  const item = childElements(node, "item").find((n) => getAttr(n, "identifier") === identifier);
  if (!item) throw engineError("not-found", `inventory item '${identifier}' not found`);
  return item;
}

const indentOf = (raw: string, node: Dnd5eNode): string => {
  let lineStart = node.start;
  while (lineStart > 0 && (raw[lineStart - 1] === "\t" || raw[lineStart - 1] === " ")) lineStart--;
  return raw.slice(lineStart, node.start);
};

/** The element name of a child node xml snippet ("<equipped ...>" -> equipped). */
const childName = (childXml: string): string => childXml.match(/^<([^\s>]+)/)?.[1] ?? "";

/**
 * Adds, removes, or replaces a child node of an item (equipped/attunement/
 * storage). `insertSkip` names siblings to insert past (land after) for
 * "add": a caller planning a same-batch removal of those siblings passes
 * them here so the new child's insertion point falls outside the sibling's
 * (whitespace-trimmed) removal range -- applyRawEdits applies raw offsets
 * computed against the same unedited document, so an insertion point inside
 * another edit's removed range corrupts the result.
 */
function planItemChildEdit(
  document: Dnd5eDocument,
  identifier: string,
  childXml: string,
  mode: "add" | "remove" | "replace",
  insertSkip: readonly string[] = [],
): RawEdit[] {
  const node = itemNodeOf(document, identifier);
  const raw = document.raw;
  const children = childElements(node);
  const existing = children.find((child) => child.name === childName(childXml));
  if (mode === "remove") {
    if (!existing) return [];
    return [removeNodeEdit(raw, existing)];
  }
  if (existing) {
    if (mode === "replace") {
      return [{ start: existing.start, end: existing.end, replacement: childXml }];
    }
    return [];
  }
  const skip = new Set(insertSkip);
  const target = children.find((child) => !skip.has(child.name));
  const insertAt = target ? target.start : (node.closeStart ?? node.openEnd);
  const pad = indentOf(raw, node) + "\t";
  return [{ start: insertAt, end: insertAt, replacement: `\r\n${pad}${childXml}` }];
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface AddItemPlan {
  edits: RawEdit[];
  identifier: string;
  baseId: string;
  adornerId: string | null;
  equippedLocation: string | null;
  amount: number;
  registers: boolean;
  /** True when the add grew an existing carried stack instead of appending. */
  merged: boolean;
}

/** The auto-equip decision for a newly added item (first free location). */
function autoEquipLocation(state: CharacterState, locations: string[]): string | null {
  if (locations.length === 0) return null;
  const first = locations[0]!;
  return isSlotFree(state, first) ? first : null;
}

/**
 * The record that can absorb another copy of the same item: an identical plain
 * stack (no adorners), stowed in the same place, not equipped or attuned, and
 * authored as stackable so an amount change keeps carried weight honest. A
 * record whose state an amount cannot share -- equipped, attuned, attunable
 * (each attunement is one record's bond), adorned -- is deliberately never a
 * merge target.
 */
function mergeTargetFor(
  state: CharacterState,
  library: ElementLibrary,
  itemId: string,
  storage: string | null,
  excludeIdentifier: string | null,
): InventoryItemState | undefined {
  return state.items.find((item) => {
    if (item.identifier === excludeIdentifier) return false;
    if (item.itemId !== itemId) return false;
    if (item.adorners.length > 0) return false;
    if (item.equipped || item.attuned) return false;
    if (isAttunableElement(effectiveElement(library, item))) return false;
    if ((item.storage ?? null) !== storage) return false;
    return setterValue(baseElementOf(library, item), "stackable")?.trim().toLowerCase() === "true";
  });
}

/**
 * Plans adding an item. Resolves the base (explicit baseElementId, or the
 * magic item's single-name weapon/armor setter), decides the auto-equip,
 * and returns the edits plus the new item's identity.
 */
export function planAddItemEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  options: AddItemOptions,
): AddItemPlan {
  const element = library.byId.get(options.itemId);
  if (!element) throw engineError("not-found", `item '${options.itemId}' not found`);
  const amount = options.amount ?? 1;
  let base = element;
  let adornerId: string | null = null;
  if (options.baseElementId) {
    const given = library.byId.get(options.baseElementId);
    if (!given) throw engineError("not-found", `base item '${options.baseElementId}' not found`);
    base = given;
    adornerId = element.identity.id;
  } else {
    const setter = baseSlotSetter(element);
    if (setter && !/[|,]/.test(setter.value)) {
      const candidates = library.byType.get(setter.name === "weapon" ? "Weapon" : "Armor") ?? [];
      const match = candidates.find((candidate) => candidate.identity.name.toLowerCase() === setter.value.toLowerCase());
      if (match) {
        base = match;
        adornerId = element.identity.id;
      }
    }
  }
  const identifier = randomUuid();
  const locations = equipLocationsFor(base);
  const equippedKey = autoEquipLocation(state, locations);
  const equippedLocation = equippedKey === null ? null : LOCATION_DISPLAY[equippedKey]!;
  // A carried copy joins an identical carried stack; a copy that auto-equips
  // stays its own row because the equipped state -- and the attack row that
  // follows it -- belongs to that record alone.
  if (equippedLocation === null && adornerId === null) {
    const target = mergeTargetFor(state, library, base.identity.id, null, null);
    if (target) {
      return {
        edits: planSetItemAmountEdits(document, target.identifier, target.amount + amount),
        identifier: target.identifier,
        baseId: base.identity.id,
        adornerId: null,
        equippedLocation: null,
        amount: target.amount + amount,
        registers: false,
        merged: true,
      };
    }
  }
  const adorner = adornerId !== null ? library.byId.get(adornerId) : undefined;
  const node = renderItemNode({
    identifier,
    name: base.identity.name,
    id: base.identity.id,
    amount,
    equippedLocation,
    attuned: false,
    adorner: adorner ? { name: adorner.identity.name, id: adorner.identity.id } : null,
    detailsName: "",
    notes: "",
  });
  const edits: RawEdit[] = [appendItemEdit(document, node)];
  const registers = equippedLocation !== null;
  if (registers) {
    edits.push(...planSumInsertEdits(document, sumEntriesFor(library, base, adornerId)));
    edits.push(...planTreeAppendEdits(document, state, library, base));
    edits.push(...planRegisteredCountEdit(document, state, countDeltaOf(adornerId === null ? [] : [adornerId])));
  }
  return { edits, identifier, baseId: base.identity.id, adornerId, equippedLocation, amount, registers, merged: false };
}

/**
 * Plans dropping a control record from the equipment section, node only.
 *
 * Control items (the corpus's on/off switches) are never equipped or attuned
 * in the engine's own writes, so removing the record cannot strand a sum
 * entry the way removing worn gear would. The caller owns whatever
 * registration the element also carries in the elements tree.
 */
export function planRemoveControlRecordEdits(document: Dnd5eDocument, identifier: string): RawEdit[] {
  return [removeNodeEdit(document.raw, itemNodeOf(document, identifier))];
}

/** Plans removing an item (partial amounts decrement; zero removes). */
export function planRemoveItemEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  identifier: string,
  amount?: number,
): RawEdit[] {
  const item = state.items.find((i) => i.identifier === identifier);
  if (!item) throw engineError("not-found", `inventory item '${identifier}' not found`);
  const node = itemNodeOf(document, identifier);
  const raw = document.raw;
  const removeAmount = amount ?? item.amount;
  if (removeAmount < item.amount) {
    const range = attrValueRange(raw, node, "amount");
    if (range) return [{ start: range.start, end: range.end, replacement: String(item.amount - removeAmount) }];
    return [];
  }
  const edits: RawEdit[] = [removeNodeEdit(raw, node)];
  if (baseRegistrationPresent(library, item)) {
    const base = baseElementOf(library, item);
    if (base) {
      const removed = sumEntriesFor(library, base, item.adorners[0] ?? null);
      edits.push(...planSumReplaceEdits(document, sumWithoutOneInstanceEach(document, removed)));
      if (!baseSharedWithOtherRecord(library, state, item)) edits.push(...planTreeRemoveEdits(document, item.itemId));
      edits.push(...planRegisteredCountEdit(document, state, -countDeltaOf(item.adorners)));
    }
  }
  return edits;
}

/**
 * The raw range of an item's `amount` attribute including the whitespace
 * before it, for removing the attribute whole.
 */
function amountAttrRemovalRange(raw: string, node: Dnd5eNode): { start: number; end: number } | null {
  const open = raw.slice(node.start, node.openEnd);
  const match = /\s+amount="[^"]*"/.exec(open);
  if (!match) return null;
  return { start: node.start + match.index, end: node.start + match.index + match[0].length };
}

/**
 * Plans setting a stored record's amount. The document omits `amount` at 1
 * (see `renderItemNode`), so raising it inserts or replaces the attribute and
 * lowering it back to 1 removes the attribute again. Amount is presentation
 * only: registrations, attunement and equip state do not change with it.
 */
export function planSetItemAmountEdits(document: Dnd5eDocument, identifier: string, amount: number): RawEdit[] {
  if (!Number.isInteger(amount) || amount < 1) {
    throw engineError("invalid-argument", `invalid item amount '${amount}'`);
  }
  const node = itemNodeOf(document, identifier);
  const raw = document.raw;
  const range = attrValueRange(raw, node, "amount");
  if (amount > 1) {
    if (range) return [{ start: range.start, end: range.end, replacement: String(amount) }];
    const insertAt = node.selfClosing ? node.openEnd - 2 : node.openEnd - 1;
    return [{ start: insertAt, end: insertAt, replacement: ` amount="${amount}"` }];
  }
  const removal = amountAttrRemovalRange(raw, node);
  return removal ? [{ start: removal.start, end: removal.end, replacement: "" }] : [];
}

/** Plans equipping/unequipping an item at a location key ("none" unequips). */
export function planEquipItemEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  identifier: string,
  location: string,
): RawEdit[] {
  const item = state.items.find((i) => i.identifier === identifier);
  if (!item) throw engineError("not-found", `inventory item '${identifier}' not found`);
  const base = baseElementOf(library, item);
  if (!base) throw engineError("not-found", `item '${item.itemId}' not found`);
  const edits: RawEdit[] = [];
  const removedEntries: Array<{ type: string; id: string }> = [];
  const appendedEntries: Array<{ type: string; id: string }> = [];
  let countDelta = 0;
  const unregister = (target: InventoryItemState): void => {
    if (!baseRegistrationPresent(library, target)) return;
    const targetBase = baseElementOf(library, target);
    if (targetBase) {
      removedEntries.push(...sumEntriesFor(library, targetBase, target.adorners[0] ?? null));
      if (!baseSharedWithOtherRecord(library, state, target)) edits.push(...planTreeRemoveEdits(document, target.itemId));
      countDelta -= countDeltaOf(target.adorners);
    }
  };
  if (location === "none") {
    if (item.equipped || item.attuned) {
      edits.push(...planItemChildEdit(document, identifier, "<equipped>true</equipped>", "remove"));
      edits.push(...planItemChildEdit(document, identifier, "<attunement>true</attunement>", "remove"));
      unregister(item);
    }
  } else if (location === WORN_LOCATION) {
    if (equipLocationsFor(base).length > 0 || !isWearableElement(base)) {
      throw engineError("invalid-argument", `item '${item.itemId}' cannot be worn`);
    }
    // Single location principle: wearing an item clears its storage assignment.
    if (item.storage) {
      edits.push(...planItemChildEdit(document, identifier, "<storage>", "remove"));
    }
    // A worn slotless item evicts nothing and registers no base; the
    // item-registration sweep picks up its own benefits.
    if (!item.equipped) {
      edits.push(...planItemChildEdit(document, identifier, "<equipped>true</equipped>", "add", ["storage"]));
    }
  } else {
    const display = LOCATION_DISPLAY[location];
    if (!display) throw engineError("invalid-argument", `unknown equip location '${location}'`);
    // Single location principle: equipping an item clears its storage assignment.
    if (item.storage) {
      edits.push(...planItemChildEdit(document, identifier, "<storage>", "remove"));
    }
    const vacateKeys = location === "primary-twohanded" ? ["primary", "secondary"] : [location];
    for (const key of vacateKeys) {
      for (const other of occupants(state, key)) {
        if (other.identifier === identifier) continue;
        edits.push(...planItemChildEdit(document, other.identifier, "<equipped>true</equipped>", "remove"));
        edits.push(...planItemChildEdit(document, other.identifier, "<attunement>true</attunement>", "remove"));
        unregister(other);
      }
    }
    if (!(item.equipped && item.location === display)) {
      if (item.equipped) {
        edits.push(...planItemChildEdit(document, identifier, `<equipped location="${escapeXml(display)}">true</equipped>`, "replace"));
      } else {
        edits.push(...planItemChildEdit(document, identifier, `<equipped location="${escapeXml(display)}">true</equipped>`, "add", ["storage"]));
        // An attuned item already carries its base registration; equipping
        // it must not write a second copy.
        if (hasSlotBase(library, item) && !baseRegistrationPresent(library, item)) {
          appendedEntries.push(...sumEntriesFor(library, base, item.adorners[0] ?? null));
          edits.push(...planTreeAppendEdits(document, state, library, base));
          countDelta += countDeltaOf(item.adorners);
        }
      }
    }
  }
  if (removedEntries.length > 0 || appendedEntries.length > 0) {
    edits.push(
      ...planSumReplaceInsertEdits(document, sumWithoutOneInstanceEach(document, removedEntries), appendedEntries),
    );
  }
  if (countDelta !== 0) edits.push(...planRegisteredCountEdit(document, state, countDelta));
  return edits;
}

/**
 * Plans assigning/clearing an item's storage container (a vehicle/cargo slot
 * named in `state.storages`). `storage` null or "" carries the item on the
 * character again. `amount` moves part of a stack: the moved units split into
 * a plain record (or join an identical stack already there) while the source
 * keeps the remainder and its own state. Single location principle: stowing an
 * equipped item unequips it (equipping a stowed item likewise clears its
 * storage; see `planEquipItemEdits`). Attunement is a magical bond, not
 * physical possession, so it persists through stowage -- but a stowed item
 * conveys nothing, so its registration goes with it and comes back when the
 * item is taken out and put to use again.
 */
export function planSetItemStorageEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  identifier: string,
  storage: string | null,
  /** Units to move; omitted moves the whole record (the historical behavior). */
  amount?: number,
): RawEdit[] {
  const item = state.items.find((i) => i.identifier === identifier);
  if (!item) throw engineError("not-found", `inventory item '${identifier}' not found`);
  const next = storage ?? "";
  const current = item.storage ?? "";
  if (next === current) return [];
  const moveAmount = amount ?? item.amount;
  if (!Number.isInteger(moveAmount) || moveAmount < 1 || moveAmount > item.amount) {
    throw engineError("invalid-argument", `invalid storage amount '${amount}'`);
  }
  if (moveAmount === item.amount) {
    // Moving the whole record onto an identical free stack consolidates the
    // two rows; an attuned source keeps its bond, so it moves on its own.
    if (!item.attuned) {
      const target = mergeTargetFor(state, library, item.itemId, next === "" ? null : next, identifier);
      if (target) {
        return [
          ...planRemoveItemEdits(state, document, library, identifier),
          ...planSetItemAmountEdits(document, target.identifier, target.amount + item.amount),
        ];
      }
    }
    return planWholeStorageEdits(state, document, library, item, next, current);
  }
  return planSplitStorageEdits(state, document, library, item, next, moveAmount);
}

/** The historical whole-record move: set/clear storage, unequip, unregister. */
function planWholeStorageEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  item: InventoryItemState,
  next: string,
  current: string,
): RawEdit[] {
  const identifier = item.identifier;
  const edits: RawEdit[] = [];
  if (next === "") {
    edits.push(...planItemChildEdit(document, identifier, "<storage>", "remove"));
    return edits;
  }
  edits.push(
    ...planItemChildEdit(
      document,
      identifier,
      `<storage><location>${escapeXml(next)}</location></storage>`,
      current === "" ? "add" : "replace",
      ["equipped", "attunement"],
    ),
  );
  if (item.equipped) {
    edits.push(...planItemChildEdit(document, identifier, "<equipped>true</equipped>", "remove"));
  }
  // A stowed item is off the character's person and conveys nothing, so the
  // base registration goes whether or not the attunement bond survives.
  if (baseRegistrationPresent(library, item)) {
    const base = baseElementOf(library, item);
    if (base) {
      const removed = sumEntriesFor(library, base, item.adorners[0] ?? null);
      edits.push(...planSumReplaceEdits(document, sumWithoutOneInstanceEach(document, removed)));
      if (!baseSharedWithOtherRecord(library, state, item)) edits.push(...planTreeRemoveEdits(document, item.itemId));
      edits.push(...planRegisteredCountEdit(document, state, -countDeltaOf(item.adorners)));
    }
  }
  return edits;
}

/**
 * Moves part of a stack between carried and a container. The moved units join
 * an identical stack in the destination when there is one, else they become a
 * new plain record; the source keeps its remaining amount and any equip or
 * attunement state. Neither side changes registrations: amount does not
 * register, and a split record lands unequipped with the source still owning
 * whatever it conveyed.
 */
function planSplitStorageEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  item: InventoryItemState,
  next: string,
  moveAmount: number,
): RawEdit[] {
  const destination = next === "" ? null : next;
  const target = mergeTargetFor(state, library, item.itemId, destination, item.identifier);
  const edits: RawEdit[] = [];
  if (target) {
    edits.push(...planSetItemAmountEdits(document, target.identifier, target.amount + moveAmount));
  } else {
    const base = baseElementOf(library, item);
    const adornerId = item.adorners[0] ?? null;
    const adorner = adornerId !== null ? elementById(library, adornerId) : undefined;
    const node = renderItemNode({
      identifier: randomUuid(),
      name: base?.identity.name ?? item.name,
      id: item.itemId,
      amount: moveAmount,
      equippedLocation: null,
      attuned: false,
      adorner: adorner ? { name: adorner.identity.name, id: adorner.identity.id } : null,
      detailsName: item.detailsName,
      notes: item.notes,
      storage: destination,
      card: item.card,
      sidebar: item.sidebar,
    });
    edits.push(appendItemEdit(document, node));
  }
  edits.push(...planSetItemAmountEdits(document, item.identifier, item.amount - moveAmount));
  return edits;
}

/** Plans attuning/un-attuning an item (bounded by the computed attunement:max). */
export function planAttuneItemEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  identifier: string,
  attuned: boolean,
  maxAttunedItemCount = 3,
): RawEdit[] {
  const item = state.items.find((i) => i.identifier === identifier);
  if (!item) throw engineError("not-found", `inventory item '${identifier}' not found`);
  const base = baseElementOf(library, item);
  if (!base) throw engineError("not-found", `item '${item.itemId}' not found`);
  const edits: RawEdit[] = [];
  if (attuned && !item.attuned) {
    const attunable = isAttunableElement(effectiveElement(library, item));
    const current = state.items.filter(
      (i) => i.attuned && i.identifier !== identifier && isAttunableElement(effectiveElement(library, i)),
    ).length;
    if (attunable && current >= maxAttunedItemCount) {
      throw engineError("conflict", "Maximum number of attuned items reached.");
    }
    edits.push(...planItemChildEdit(document, identifier, "<attunement>true</attunement>", "add"));
    // A slotless item has no base registration of its own; the
    // item-registration sweep owns everything it contributes.
    if (!item.storage && !item.equipped && hasSlotBase(library, item)) {
      edits.push(...planSumInsertEdits(document, sumEntriesFor(library, base, item.adorners[0] ?? null)));
      edits.push(...planTreeAppendEdits(document, state, library, base));
      edits.push(...planRegisteredCountEdit(document, state, countDeltaOf(item.adorners)));
    }
  } else if (!attuned && item.attuned) {
    edits.push(...planItemChildEdit(document, identifier, "<attunement>true</attunement>", "remove"));
    if (!item.storage && !item.equipped && hasSlotBase(library, item)) {
      const removed = sumEntriesFor(library, base, item.adorners[0] ?? null);
      edits.push(...planSumReplaceEdits(document, sumWithoutOneInstanceEach(document, removed)));
      if (!baseSharedWithOtherRecord(library, state, item)) edits.push(...planTreeRemoveEdits(document, item.itemId));
      edits.push(...planRegisteredCountEdit(document, state, -countDeltaOf(item.adorners)));
    }
  }
  return edits;
}

/** Plans replacing the character's coinage. */
export function planSetCoinsEdits(document: Dnd5eDocument, coins: Coinage): RawEdit[] {
  const currency = document.root.build.input?.currency?.();
  const node = currency?.node;
  if (!node) throw engineError("not-found", "currency section not found");
  const edits: RawEdit[] = [];
  const values: Record<string, number> = {
    copper: coins.copper,
    silver: coins.silver,
    electrum: coins.electrum,
    gold: coins.gold,
    platinum: coins.platinum,
  };
  for (const name of ["copper", "silver", "electrum", "gold", "platinum"]) {
    const child = childElements(node).find((n) => n.name === name);
    if (!child) continue;
    edits.push({ start: child.openEnd, end: child.closeStart ?? child.openEnd, replacement: String(values[name]!) });
  }
  return edits;
}

/** Plans extracting an item's contents (packs): removes it, adds contents. */
export function planExtractItemEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  identifier: string,
): RawEdit[] {
  const item = state.items.find((i) => i.identifier === identifier);
  if (!item) throw engineError("not-found", `inventory item '${identifier}' not found`);
  const element = effectiveElement(library, item);
  const extract = element?.extract ?? [];
  if (extract.length === 0) {
    throw engineError("conflict", `Inventory item '${item.name}' cannot be extracted.`);
  }
  const edits: RawEdit[] = [];
  for (const entry of extract) {
    const content = library.byId.get(entry.id);
    if (!content) continue;
    const node = renderItemNode({
      identifier: randomUuid(),
      name: content.identity.name,
      id: content.identity.id,
      amount: entry.amount,
      equippedLocation: null,
      attuned: false,
      adorner: null,
      detailsName: "",
      notes: "",
    });
    edits.push(appendItemEdit(document, node));
  }
  const node = itemNodeOf(document, identifier);
  edits.push(removeNodeEdit(document.raw, node));
  return edits;
}
