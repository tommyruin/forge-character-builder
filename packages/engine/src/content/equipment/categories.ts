import type { PackExtras, ParsedElement } from "../parser.js";

export interface EquipmentCategoryDto {
  key: string;
  label: string;
  elementType: string | null;
  itemCategory: string | null;
  equipSetter: string | null;
}

export interface EquipmentAttunementDto {
  required: boolean;
  addition: string | null;
}

export interface EquipmentMetadataDto {
  description: string;
  rarity: string | null;
  attunement: EquipmentAttunementDto;
}

const PREFERRED_ORDER = [
  "Adventuring Gear",
  "Treasure",
  "Trade Goods",
  "Equipment Packs",
  "Tools",
  "Musical Instruments",
  "Mounts & Vehicles",
  "Weapons",
  "Ammunition",
  "Armor",
  "Magic Weapons",
  "Magic Armor",
  "Spellcasting Focus",
  "Wondrous Items",
  "Staffs",
  "Rods",
  "Wands",
  "Rings",
  "Potions",
  "Poison",
  "Scrolls",
];

const CONTROL_CATEGORIES = new Set([
  "optional class features",
  "supernatural gifts",
]);

function setter(element: ParsedElement | undefined, name: string): ParsedElement["setters"][number] | undefined {
  const requested = name.toLocaleLowerCase();
  return element?.setters.find((candidate) => candidate.name.toLocaleLowerCase() === requested);
}

function setterValue(element: ParsedElement, name: string): string | undefined {
  return setter(element, name)?.value;
}

function normalizedText(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function normalizeItemCategory(category: string | undefined): string {
  const value = normalizedText(category);
  return value.toLocaleLowerCase() === "spell scrolls" ? "Scrolls" : value;
}

export function matchesItemCategory(element: ParsedElement, requestedCategory: string): boolean {
  const requested = normalizeItemCategory(requestedCategory);
  if (requested === "") return true;
  const category = normalizeItemCategory(setterValue(element, "category"));
  const fallback = category !== ""
    ? category
    : element.identity.type === "Magic Item"
      ? "Wondrous Items"
      : element.identity.type === "Item"
        ? "Adventuring Gear"
        : "";
  return fallback.toLocaleLowerCase() === requested.toLocaleLowerCase();
}

export function matchesEquipSetter(element: ParsedElement, requestedSetter: string): boolean {
  const requested = normalizedText(requestedSetter).toLocaleLowerCase();
  if (requested === "") return true;
  return element.setters.some((setter) =>
    setter.name.toLocaleLowerCase() === requested || setter.value.trim().toLocaleLowerCase() === requested,
  );
}

const ADJUSTMENT_GRANT_TYPES = new Set([
  "ability score improvement",
  "feat",
  "language",
  "proficiency",
  "spell",
]);

/**
 * An empty Item category is the content convention for non-physical adjustment
 * records. Grant rules provide a second semantic guard for proxies that carry
 * a category through an imported or generated payload.
 */
function isAdjustmentProxy(element: ParsedElement, category: string): boolean {
  if (element.identity.type !== "Item") return false;
  if (category === "") return true;
  return element.rules.some((rule) =>
    rule.kind === "grant" && rule.type !== undefined && ADJUSTMENT_GRANT_TYPES.has(rule.type.trim().toLocaleLowerCase()),
  );
}

export function isPhysicalEquipment(element: ParsedElement): boolean {
  if (element.identity.type === "Weapon" || element.identity.type === "Armor") return true;
  if (element.identity.type !== "Item" && element.identity.type !== "Magic Item") return false;

  const hidden = setterValue(element, "inventory-hidden");
  if (hidden === undefined || (hidden.trim() !== "" && hidden.toLocaleLowerCase() !== "true")) {
    const category = normalizeItemCategory(setterValue(element, "category"));
    if (category.toLocaleLowerCase().startsWith("additional ")) return false;
    if (CONTROL_CATEGORIES.has(category.toLocaleLowerCase())) return false;
    if (isAdjustmentProxy(element, category.toLocaleLowerCase())) return false;
    return true;
  }
  return false;
}

function nonEmptyDescription(description: string | undefined): string | null {
  if (description === undefined) return null;
  const text = description.replace(/<[^>]*>/g, "").replace(/&(?:nbsp|#160);/gi, " ").trim();
  return text === "" ? null : description;
}

function escapeDescriptionText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Resolves a supported element id, used to name and explain weapon properties. */
export type ElementResolver = (id: string) => ParsedElement | undefined;

/** A `<span class="feature">` run-in label, the corpus convention for stat lines. */
function statLine(label: string, value: string): string {
  return `<p class="stat-line"><span class="feature">${escapeDescriptionText(label)}. </span>${escapeDescriptionText(value)}</p>`;
}

/**
 * Puts a run-in label inside the prose's opening paragraph. Wrapping the prose
 * in another `<p>` would nest paragraphs, which parsers split back apart into a
 * stray label line followed by unlabelled text.
 */
function labelledProse(label: string, prose: string): string {
  const runIn = `<span class="feature">${escapeDescriptionText(label)}. </span>`;
  const opening = /^\s*<p(\s[^>]*)?>/i.exec(prose);
  // `entry` marks the paragraph as starting a new labelled entry, so it keeps
  // the flush left edge a heading needs instead of the continuation indent
  // that consecutive body paragraphs take.
  if (opening === null) return `<p class="entry">${runIn}${prose}</p>`;
  const attrs = opening[1] ?? "";
  const existing = /class\s*=\s*"([^"]*)"/i.exec(attrs);
  const openTag = existing === null
    ? `<p class="entry"${attrs}>`
    : `<p${attrs.replace(existing[0], `class="${existing[1]} entry"`)}>`;
  return `${openTag}${runIn}${prose.slice(opening[0].length)}`;
}

function trimmedSetter(element: ParsedElement, name: string): string {
  return setterValue(element, name)?.trim() ?? "";
}

/**
 * Groups the stat lines in their own container. Consecutive paragraphs in a
 * description take the book's continuation indent; a stat block is a list, so
 * it opts out as a unit and keeps the following prose flush as well.
 */
function statBlock(lines: string[]): string {
  return lines.length === 0 ? "" : `<div class="stat-block">${lines.join("")}</div>`;
}

/**
 * The weapon properties an element supports, in the order the content declares
 * them. Only ids the resolver knows are returned, so an unresolved or homebrew
 * reference is skipped rather than guessed at from its id.
 */
function weaponProperties(element: ParsedElement, resolve: ElementResolver | undefined): ParsedElement[] {
  if (resolve === undefined) return [];
  const properties: ParsedElement[] = [];
  for (const id of element.supports) {
    const supported = resolve(id);
    if (supported?.identity.type === "Weapon Property") properties.push(supported);
  }
  return properties;
}

function weaponStatLines(element: ParsedElement, resolve: ElementResolver | undefined): string {
  const lines: string[] = [];
  const damage = setter(element, "damage");
  const damageValue = damage?.value.trim() ?? "";
  if (damageValue !== "") {
    const damageType = damage?.attrs?.type?.trim() ?? "";
    lines.push(statLine("Damage", damageType === "" ? damageValue : `${damageValue} ${damageType}`));
  }

  const range = trimmedSetter(element, "range");
  if (range !== "") lines.push(statLine("Range", range));

  // Versatile carries its two-handed damage in parentheses, the notation the
  // rules use. It is published as a setter, so it is named even when the
  // property elements themselves are not resolvable.
  const versatile = trimmedSetter(element, "versatile");
  const properties = weaponProperties(element, resolve);
  const labels = properties.map((property) =>
    versatile !== "" && property.identity.name.toLocaleLowerCase() === "versatile"
      ? `${property.identity.name} (${versatile})`
      : property.identity.name,
  );
  if (versatile !== "" && !labels.some((label) => label.toLocaleLowerCase().startsWith("versatile"))) {
    labels.push(`Versatile (${versatile})`);
  }
  if (labels.length > 0) lines.push(statLine("Properties", labels.join(", ")));

  const block = statBlock(lines);

  // The SRD authors every base weapon with an empty description, so the prose
  // of the properties it supports is the only explanation of how it behaves.
  const explanations: string[] = [];
  for (const property of properties) {
    const prose = nonEmptyDescription(property.descriptionXml);
    if (prose === null) continue;
    explanations.push(labelledProse(property.identity.name, prose));
  }
  return `${block}${explanations.join("")}`;
}

function armorStatLines(element: ParsedElement): string {
  const lines: string[] = [];
  const armorClass = trimmedSetter(element, "armorClass");
  if (armorClass !== "") lines.push(statLine("Armor Class", armorClass));

  const category = trimmedSetter(element, "armor");
  if (category !== "") lines.push(statLine("Category", `${category} armor`));

  const strength = trimmedSetter(element, "strength");
  if (strength !== "") lines.push(statLine("Strength", strength));

  const stealth = trimmedSetter(element, "stealth");
  if (stealth !== "") lines.push(statLine("Stealth", stealth));
  return statBlock(lines);
}

/**
 * The generated stat lines for a weapon or armour element, or an empty string
 * for anything else. Weapons and armour publish the facts a player needs
 * through setters; the corpus renders those in its own tables, so nothing
 * reaches a description panel unless it is composed here.
 */
export function equipmentStatBlock(
  element: ParsedElement | undefined,
  resolve?: ElementResolver,
): string {
  if (element === undefined) return "";
  if (element.identity.type === "Weapon") return weaponStatLines(element, resolve);
  if (element.identity.type === "Armor") return armorStatLines(element);
  return "";
}

/**
 * Returns the public description for an equipment element: its generated stat
 * block followed by whatever prose the content authored. The two are composed
 * rather than alternatives — SRD weapons carry stats with no prose, and SRD
 * armour carries prose with no stats, so choosing one would always drop half
 * of what the reader needs.
 */
export function publicEquipmentDescription(
  element: ParsedElement | undefined,
  resolve?: ElementResolver,
  authoredDescription?: string,
): string {
  if (element === undefined) return "";
  const authored = nonEmptyDescription(authoredDescription ?? element.descriptionXml) ?? "";
  return `${equipmentStatBlock(element, resolve)}${packExtrasNote(authored, element.extras, resolve)}`;
}

/** Joins names as "a, b and c". */
function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function escapeNoteText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Replaces the pack prose's "Note: this pack doesn't include ..." paragraph
 * with the extraction behaviour the engine now implements, derived from the
 * reviewed <extras>. The note belongs to the book's bookkeeping, so it has to
 * agree with what Extract grants — also for uploaded and homebrew packs that
 * override the shipped element without updating the prose.
 */
function packExtrasNote(description: string, extras: PackExtras | undefined, resolve?: ElementResolver): string {
  if (extras === undefined || description === "") return description;
  const clauses: string[] = [];
  const granted = [
    ...extras.items.map((entry) => resolve?.(entry.id)?.identity.name ?? entry.id),
    ...(extras.gold > 0 ? [`${extras.gold} GP`] : []),
  ];
  if (granted.length > 0) clauses.push(`grants ${formatList(granted)}`);
  const choices = extras.choices.map((choice) => choice.label).filter(Boolean);
  if (choices.length > 0) clauses.push(`offers a choice of ${formatList(choices)}`);
  if (clauses.length === 0) return description;
  const body = escapeNoteText(`Extracting this pack also ${clauses.join(", and ")}.`);
  const note = `<p><b>Note:</b> ${body}</p>`;
  const replaced = description.replace(/<p><b>Note:<\/b>[\s\S]*?<\/p>/, note);
  return replaced === description ? `${description}${note}` : replaced;
}

export function equipmentMetadata(
  element: ParsedElement | undefined,
  resolve?: ElementResolver,
): EquipmentMetadataDto {
  const attunement = setter(element, "attunement");
  return {
    description: publicEquipmentDescription(element, resolve),
    rarity: element === undefined ? null : setterValue(element, "rarity")?.trim() || null,
    attunement: {
      required: attunement?.value.trim().toLocaleLowerCase() === "true",
      addition: attunement?.attrs?.addition?.trim() || null,
    },
  };
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function categoryFor(element: ParsedElement): EquipmentCategoryDto {
  const { type } = element.identity;
  if (type === "Weapon") {
    return { key: "weapons", label: "Weapons", elementType: "Weapon", itemCategory: null, equipSetter: null };
  }
  if (type === "Armor") {
    return { key: "armor", label: "Armor", elementType: "Armor", itemCategory: null, equipSetter: null };
  }

  const rawCategory = normalizeItemCategory(setterValue(element, "category"));
  const category = rawCategory || (type === "Magic Item" ? "Wondrous Items" : "Adventuring Gear");
  const baseSetter = type === "Magic Item"
    ? element.setters.find((setter) => {
      const name = setter.name.toLocaleLowerCase();
      return name === "weapon" || name === "armor";
    })?.name.toLocaleLowerCase() ?? null
    : null;
  if (baseSetter === "weapon") {
    return { key: "magic-weapons", label: "Magic Weapons", elementType: type, itemCategory: null, equipSetter: baseSetter };
  }
  if (baseSetter === "armor") {
    return { key: "magic-armor", label: "Magic Armor", elementType: type, itemCategory: null, equipSetter: baseSetter };
  }
  return {
    key: slug(`${type}-${category}`),
    label: category,
    elementType: type,
    itemCategory: category,
    equipSetter: null,
  };
}

function mergeCategories(definitions: EquipmentCategoryDto[]): EquipmentCategoryDto {
  const labels = [...new Set(definitions.map((definition) => definition.label))];
  const elementTypes = [...new Set(definitions.map((definition) => definition.elementType).filter(Boolean))];
  const itemCategories = [...new Set(definitions.map((definition) => definition.itemCategory).filter(Boolean))];
  const equipSetters = [...new Set(definitions.map((definition) => definition.equipSetter).filter(Boolean))];
  return {
    key: slug(labels[0] ?? "equipment"),
    label: labels[0] ?? "Equipment",
    elementType: elementTypes.length === 1 ? elementTypes[0]! : null,
    itemCategory: definitions.every((definition) => definition.itemCategory !== null) && itemCategories.length === 1
      ? itemCategories[0]!
      : null,
    equipSetter: definitions.every((definition) => definition.equipSetter !== null) && equipSetters.length === 1
      ? equipSetters[0]!
      : null,
  };
}

export function buildEquipmentCategories(elements: Iterable<ParsedElement>): EquipmentCategoryDto[] {
  const byLabel = new Map<string, EquipmentCategoryDto[]>();
  for (const element of elements) {
    if (!isPhysicalEquipment(element)) continue;
    const category = categoryFor(element);
    const identity = category.label.toLocaleLowerCase();
    const definitions = byLabel.get(identity) ?? [];
    if (!definitions.some((definition) =>
      definition.key === category.key &&
      definition.elementType === category.elementType &&
      definition.itemCategory === category.itemCategory &&
      definition.equipSetter === category.equipSetter,
    )) definitions.push(category);
    byLabel.set(identity, definitions);
  }

  return [...byLabel.values()]
    .map((definitions) => definitions.length === 1 ? definitions[0]! : mergeCategories(definitions))
    .sort((left, right) => {
      const leftIndex = PREFERRED_ORDER.findIndex((label) => label.toLocaleLowerCase() === left.label.toLocaleLowerCase());
      const rightIndex = PREFERRED_ORDER.findIndex((label) => label.toLocaleLowerCase() === right.label.toLocaleLowerCase());
      const leftRank = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const rightRank = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const labelOrder = left.label.localeCompare(right.label, "en", { sensitivity: "base" });
      return labelOrder !== 0
        ? labelOrder
        : (left.elementType ?? "").localeCompare(right.elementType ?? "", "en", { sensitivity: "base" });
    });
}
