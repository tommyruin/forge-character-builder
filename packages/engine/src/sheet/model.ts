/**
 * Pure character-sheet model.
 *
 * Content selection is separated from PDF serialization: this module builds
 * an ordered, typed projection of the character sheet (pages/sections/
 * rows) from the character state, the content library, and the existing DTO
 * builders (statistics calculator, attacks, inventory, spellcasting). The
 * canonical manifest serialization is what the sheet tests compare.
 *
 * Values come from the final computed state, never from simplified
 * recomputations. Section titles are the canonical template names; the PDF
 * writer draws them as section headings.
 */

import type { CharacterState } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import type { ParsedElement, ParsedSheetEntry, SheetDescription } from "../content/parser.js";
import { computeInlineValues, computeStatistics, type StatisticsValues } from "../statistics/calculator.js";
import { buildAttacksDto } from "../attacks/attacks.js";
import { buildInventoryDto, itemBenefitsActive, itemWeightPounds, type InventoryItemDto } from "../inventory/inventory.js";
import { isPhysicalEquipment } from "../content/equipment/categories.js";
import { createRegistrationContext } from "../selection/selection.js";
import { evaluateRequirements } from "../selection/expr.js";
import {
  buildSpellcastingDto,
  type SpellcasterDto,
  type KnownSpellDto,
  type SpellResourceDto,
} from "../magic/dto.js";
import { buildCompanionDto, type CompanionDto, type CompanionFeatureDto } from "../magic/reconcile.js";
import { spellInfo } from "../magic/spelllist.js";
import { buildProgression } from "../progression/progression.js";
import {
  canonicalInventoryRuns,
  descriptionCardRuns,
  inventoryRuns,
  resolveSpellCardOrigin,
  type DescriptionCard,
  type LayoutRun,
} from "./card-layout.js";

export type SheetMode = "lite" | "full";

export type SheetRow =
  /** An ordered token sequence (the canonical comparison unit). */
  | { kind: "tokens"; tokens: readonly string[] }
  /** One or more wrapped text paragraphs (feature descriptions etc.). */
  | { kind: "lines"; lines: readonly string[] };

export interface SheetSection {
  title: string;
  rows: readonly SheetRow[];
  /** Render-only ordering/formatting projection; canonical extraction still uses rows. */
  renderRows?: readonly SheetRow[];
  /** PDF-positioned projection used only by canonical extraction. */
  positionedRuns?: readonly LayoutRun[];
  /** Legacy plain-layout projection retained for semantic extraction. */
  canonicalRuns?: readonly LayoutRun[];
}

export type SheetTemplateKind =
  | "details"
  | "background"
  | "companion"
  | "equipment"
  | "spell-list"
  | "spell-cards"
  | "item-cards"
  | "generic";

export interface SheetSpellListSection {
  level: number;
  slots: number;
  spells: readonly {
    name: string;
    prepared: boolean;
    alwaysPrepared: boolean;
  }[];
}

export interface SheetSpellcasterLayout {
  name: string;
  ability: string;
  attackBonus: string;
  saveDc: string;
  prepareCount: string;
  resource: SpellResourceDto;
  sections: readonly SheetSpellListSection[];
}

export interface SheetPage {
  /** 1-based page number. */
  page: number;
  templateKind: SheetTemplateKind;
  sections: readonly SheetSection[];
  spellcasting?: readonly SheetSpellcasterLayout[];
}

export interface CharacterSheetModel {
  characterId: string;
  mode: SheetMode;
  pageCount: number;
  pages: readonly SheetPage[];
  /** Values for the real 5e AcroForm template, kept separate from the canonical projection. */
  formValues?: Readonly<Record<string, string>>;
  /**
   * Base64 image data keyed by the template's own image-field name. The model
   * crosses a worker boundary by structured clone, so images ride as strings
   * rather than binary handles.
   */
  images?: Readonly<Record<string, string>>;
}

/**
 * The pages a reader can do without. Each flag defaults to `true`; setting one
 * to `false` drops that page from the build (and, with it, the work of laying
 * it out). The remaining pages renumber 1..n, so a sheet without spell cards
 * has no gap in its page numbers.
 *
 * `background` is the appearance/portrait page. `notes`, `spellCards` and
 * `itemCards` only ever appear in the full sheet anyway; excluding one in lite
 * mode is a no-op.
 */
export interface SheetPageInclusions {
  background?: boolean;
  notes?: boolean;
  spellCards?: boolean;
  itemCards?: boolean;
}

export interface BuildSheetOptions {
  mode: SheetMode;
  /**
   * Also compute the plain-layout canonical run projection used by extraction
   * tooling. Production sheet builds skip it; it doubles card layout work and
   * nothing in the PDF writer consumes it.
   */
  canonical?: boolean;
  /** Optional pages to leave out. Absent or `true` keeps the page. */
  include?: SheetPageInclusions;
}

const ABILITY_KEYS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
const ABILITY_NAMES: Record<string, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};
const ABILITY_ABBREV: Record<string, string> = {
  strength: "Str",
  dexterity: "Dex",
  constitution: "Con",
  intelligence: "Int",
  wisdom: "Wis",
  charisma: "Cha",
};

const SKILLS: ReadonlyArray<{ name: string; ability: (typeof ABILITY_KEYS)[number] }> = [
  { name: "Acrobatics", ability: "dexterity" },
  { name: "Animal Handling", ability: "wisdom" },
  { name: "Arcana", ability: "intelligence" },
  { name: "Athletics", ability: "strength" },
  { name: "Deception", ability: "charisma" },
  { name: "History", ability: "intelligence" },
  { name: "Insight", ability: "wisdom" },
  { name: "Intimidation", ability: "charisma" },
  { name: "Investigation", ability: "intelligence" },
  { name: "Medicine", ability: "wisdom" },
  { name: "Nature", ability: "intelligence" },
  { name: "Perception", ability: "wisdom" },
  { name: "Performance", ability: "charisma" },
  { name: "Persuasion", ability: "charisma" },
  { name: "Religion", ability: "intelligence" },
  { name: "Sleight of Hand", ability: "dexterity" },
  { name: "Stealth", ability: "dexterity" },
  { name: "Survival", ability: "wisdom" },
];

const PROFICIENCY_MARK = "♊";
const PREPARED_MARK = "✝";

/** Number of proficiency glyphs represented by a contribution.  Proficiency
 * contributions are normally either zero, one proficiency bonus, or two
 * proficiency bonuses (expertise).  Keep a nonzero contribution visible even
 * when a caller has omitted the proficiency-bonus statistic. */
function proficiencyMarkerCount(contribution: number, proficiencyBonus: number): number {
  if (!Number.isFinite(contribution) || contribution <= 0) return 0;
  if (!Number.isFinite(proficiencyBonus) || proficiencyBonus <= 0) return 1;
  return Math.max(1, Math.ceil(contribution / proficiencyBonus));
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * {{stat}} substitutions resolve against the final statistics values first,
 * then against the inline (text-valued) statistics — the chosen draconic
 * ancestry's damage type substitutes as its text, not a number. Unresolved
 * tokens stay verbatim.
 */
export function substitute(
  text: string,
  values: StatisticsValues,
  inline?: Readonly<Record<string, string>>,
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value)) return `${value}`;
    const inlineValue = inline?.[key.toLowerCase()];
    if (inlineValue !== undefined) return inlineValue;
    return match;
  });
}

/** The description applying at `level`: highest level attr <= level, tie: last. */
export function sheetDescriptionAtLevel(
  sheet: ParsedSheetEntry,
  level: number,
): SheetDescription | undefined {
  let best: SheetDescription | undefined;
  for (const description of sheet.descriptions) {
    const gate = description.level ?? 0;
    if (gate > level) continue;
    if (best === undefined || (description.level ?? 0) >= (best.level ?? 0)) best = description;
  }
  return best;
}

/** The feature parenthetical: non-empty parts of action/alt/usage joined with em dashes. */
function featureParenthetical(sheet: ParsedSheetEntry, description: SheetDescription | undefined): string {
  const parts: string[] = [];
  if (sheet.action !== undefined && sheet.action !== "") parts.push(sheet.action);
  const usage = sheet.usage ?? description?.usage;
  if (usage !== undefined && usage !== "") parts.push(usage);
  return parts.join("—");
}

/** A feature title with its parenthetical and description, sheet style. */
export function featureLine(title: string, parenthetical: string | null, description: string): string {
  const head = parenthetical === null ? `${title}.` : `${title} (${parenthetical}).`;
  const body = description.trim();
  return body === "" ? head : `${head} ${body}`;
}

interface TreeElement {
  type: string;
  name: string;
  id: string;
  requiredLevel?: number;
  registered?: string;
  children: TreeElement[];
}

function treeNodes(elements: readonly TreeElement[]): TreeElement[] {
  const out: TreeElement[] = [];
  const walk = (nodes: readonly TreeElement[]): void => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(elements);
  return out;
}

/** The registered element ids of the character (wrappers + tree nodes). */
function registeredIds(state: CharacterState): Set<string> {
  const ids = new Set<string>();
  for (const node of treeNodes(state.elements)) {
    if (node.registered !== undefined && node.registered !== "") ids.add(node.registered);
    if (node.id !== undefined && node.id !== "") ids.add(node.id);
  }
  for (const sum of state.sum.elements) ids.add(sum.id);
  return ids;
}

export function buildCharacterSheetModel(
  state: CharacterState,
  library: ElementLibrary,
  options: BuildSheetOptions,
): CharacterSheetModel {
  const values = computeStatistics(state, library);
  const inline = computeInlineValues(state, library);
  // Absent means included: a caller that says nothing gets the whole sheet.
  const wants = (page: keyof SheetPageInclusions): boolean => options.include?.[page] !== false;
  const pages: SheetPage[] = [];
  pages.push(buildPage1(state, library, values, inline));
  if (wants("background")) pages.push(buildPage2(state, library));
  const companion = buildCompanionDto(state, library, values);
  if (companion !== null) pages.push(buildCompanionPage(companion, pages.length + 1));
  pages.push(buildInventoryPage(state, library, values, options.canonical === true));
  if (options.mode === "full" && wants("notes") && notesFitDedicatedPage(state)) {
    pages.push(buildNotesPage(state));
  }
  const spellcasters = buildSpellcastingDto(state, library, values, state.magicCasterIds);
  if (spellcasters.length > 0) {
    pages.push(...buildSpellListPages(state, library, spellcasters));
  }
  if (options.mode === "full" && wants("spellCards")) {
    pages.push(...buildSpellDescriptionPages(state, library, spellcasters, options.canonical === true));
  }
  if (options.mode === "full" && wants("itemCards")) {
    const itemPage = buildItemDescriptionPage(state, library, options.canonical === true);
    if (itemPage !== null) pages.push(itemPage);
  }
  // The page builders each carry their own idea of where they sit (the
  // companion and card pages count, the fixed ones hardcode). Renumbering here
  // is what keeps the numbers contiguous once a page is left out.
  const numbered: SheetPage[] = pages.map((page, index) => ({ ...page, page: index + 1 }));
  const formValues = {
    ...buildFormValues(state, library, values, spellcasters, inline),
    ...(companion !== null ? companionFormValues(companion) : {}),
  };
  // The templates' portrait frames are image buttons; an absent portrait must
  // leave its key out entirely so the writer draws nothing.
  const images: Record<string, string> = {};
  if (state.portrait.base64 !== "") images["background_portrait_image"] = state.portrait.base64;
  if (companion !== null && companion.portrait !== "") {
    images["companion_portrait_image"] = companion.portrait;
  }
  return {
    characterId: state.id,
    mode: options.mode,
    pageCount: numbered.length,
    pages: numbered,
    formValues,
    images,
  };
}

/**
 * One list entry per spell name and level. A spell can reach a caster's known
 * list more than once (two content sources, or a class list alongside an
 * always-prepared grant); the prepared entry wins so its mark survives.
 */
function uniqueSpellNames(spells: readonly KnownSpellDto[]): KnownSpellDto[] {
  const byKey = new Map<string, KnownSpellDto>();
  for (const spell of spells) {
    const key = `${spell.level}:${spell.name.trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, spell);
      continue;
    }
    const existingRank = (existing.isAlwaysPrepared ? 2 : 0) + (existing.isPrepared ? 1 : 0);
    const rank = (spell.isAlwaysPrepared ? 2 : 0) + (spell.isPrepared ? 1 : 0);
    if (rank > existingRank) byKey.set(key, spell);
  }
  return [...byKey.values()];
}

/**
 * The background feature's text: the character file's own copy when it has
 * one, otherwise the registered feature element's description, so a file
 * saved without the prose still prints it.
 */
function backgroundFeatureDescription(state: CharacterState, library: ElementLibrary): string {
  if (state.backgroundFeature.description.trim() !== "") return state.backgroundFeature.description;
  const registered = state.elements.find((element) => element.type === "Background Feature");
  if (registered === undefined) return "";
  return stripXml(library.byId.get(registered.id)?.descriptionXml ?? "");
}

function buildFormValues(
  state: CharacterState,
  library: ElementLibrary,
  values: StatisticsValues,
  spellcasters: readonly SpellcasterDto[],
  inline?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  const set = (name: string, value: string | number | undefined): void => {
    if (value === undefined) return;
    fields[name] = `${value}`;
  };
  const score = (ability: (typeof ABILITY_KEYS)[number]): number =>
    values[`${ability}:score`] ?? state.abilities[ability];
  const modifier = (ability: (typeof ABILITY_KEYS)[number]): number =>
    values[`${ability}:modifier`] ?? Math.floor((score(ability) - 10) / 2);
  const save = (ability: (typeof ABILITY_KEYS)[number]): number =>
    modifier(ability) +
    (values[`${ability}:save`] ?? 0) +
    (values[`${ability}:save:proficiency`] ?? 0) +
    (values[`${ability}:save:misc`] ?? 0);
  const skillValue = (skill: (typeof SKILLS)[number]): number => {
    const key = skill.name.toLowerCase();
    return (values[`${skill.ability}:modifier`] ?? 0) +
      (values[key] ?? 0) +
      (values[`${key}:proficiency`] ?? 0) +
      (values[`${key}:misc`] ?? 0);
  };

  const alignmentDeity = alignmentDeityNames(state, library);
  const className = classDisplay(state, library);
  set("ClassLevel", className === "" ? `${state.level}` : `${className} ${state.level}`);
  set("Background", state.background);
  set("PlayerName", state.playerName);
  set("CharacterName", state.name);
  set("Race ", state.race);
  set("Alignment", alignmentDeity.alignment);
  set("XP", state.experience);
  set("STR", score("strength"));
  set("DEX", score("dexterity"));
  set("CON", score("constitution"));
  set("INT", score("intelligence"));
  set("WIS", score("wisdom"));
  set("CHA", score("charisma"));
  set("STRmod", signed(modifier("strength")));
  set("DEXmod ", signed(modifier("dexterity")));
  set("CONmod", signed(modifier("constitution")));
  set("INTmod", signed(modifier("intelligence")));
  set("WISmod", signed(modifier("wisdom")));
  set("CHamod", signed(modifier("charisma")));
  set("ProfBonus", signed(values.proficiency ?? 0));
  set("AC", values.ac ?? values["ac:calculation"] ?? 0);
  set("Initiative", signed(values.initiative ?? 0));
  set("Speed", values.speed ?? 0);
  set("HPMax", values.hp ?? 0);
  set("HPCurrent", values.hp ?? 0);
  set("HPTemp", values["hp:temp"] ?? 0);
  set("Passive", 10 + (values["wisdom:modifier"] ?? 0) + (values.perception ?? 0) +
    (values["perception:proficiency"] ?? 0) + (values["perception:misc"] ?? 0));

  const classBuildLabel = classDisplayWithArchetypes(state, library);
  set("details_build", `Level ${state.level}${state.race === "" ? "" : ` ${state.race}`}${classBuildLabel === "" ? "" : ` ${classBuildLabel}`}`);
  set("details_xp", state.experience);
  set("details_character_name", state.name);
  set("details_background", state.background);
  set("details_alignment", alignmentDeity.alignment);
  set("details_player", state.playerName);
  set("details_deity", alignmentDeity.deity);
  set("details_armor_class", values.ac ?? values["ac:calculation"] ?? 0);
  set("details_proficiency_bonus", signed(values.proficiency ?? 0));
  set("details_hp_max", values.hp ?? 0);
  set("details_hp_current", "");
  set("details_hp_temp", (values["hp:temp"] ?? 0) > 0 ? values["hp:temp"] : "");
  set("details_speed_walking", `${values.speed ?? 0}ft.`);
  // Walking speed always prints; the special movement modes stay blank unless
  // the character actually has them — a sheet full of "0ft." is noise.
  const specialSpeed = (value: number | undefined): string => ((value ?? 0) > 0 ? `${value}ft.` : "");
  set("details_speed_fly", specialSpeed(values["speed:fly"]));
  set("details_speed_climb", specialSpeed(values["speed:climb"]));
  set("details_speed_swim", specialSpeed(values["speed:swim"]));
  set("details_vision", visionNames(state, library).join(", "));
  // The computed defences first, then an imported file's own hand-written
  // <defenses><conditional> text: nothing in this app writes that text, so it
  // is the importing player's note and outlives what the engine can derive.
  set("details_resistances", [...defenceLines(state, library, values, inline), ...state.conditional].join("\n"));
  set("details_initiative", signed(values.initiative ?? 0));
  const attacksPerAction = Math.max(1, values["extra attack:count"] ?? 1);
  set("details_encounter_box", `${attacksPerAction} ${attacksPerAction === 1 ? "Attack" : "Attacks"} / Attack Action`);
  set("details_coinage_cp", state.coins.copper);
  set("details_coinage_sp", state.coins.silver);
  set("details_coinage_ep", state.coins.electrum);
  set("details_coinage_gp", state.coins.gold);
  set("details_coinage_pp", state.coins.platinum);

  const hitDice = hitDiceDisplay(state, library);
  const hitDiceMatch = /^(\d+)(.*)$/.exec(hitDice);
  set("HDTotal", hitDiceMatch?.[1] ?? "");
  set("HD", hitDiceMatch?.[2] ?? hitDice);
  set("details_hd", hitDice);
  const saveFields: Record<(typeof ABILITY_KEYS)[number], string> = {
    strength: "ST Strength",
    dexterity: "ST Dexterity",
    constitution: "ST Constitution",
    intelligence: "ST Intelligence",
    wisdom: "ST Wisdom",
    charisma: "ST Charisma",
  };
  for (const ability of ABILITY_KEYS) {
    set(saveFields[ability], signed(save(ability)));
    const short = ability.slice(0, 3);
    set(`details_${short}_score`, score(ability));
    set(`details_${short}_modifier`, signed(modifier(ability)));
    set(`details_${short}_save_total`, signed(save(ability)));
    if ((values[`${ability}:save:proficiency`] ?? 0) !== 0) {
      set(`details_${short}_save_proficiency`, "true");
    }
  }

  const skillFields: Record<string, string> = {
    Acrobatics: "Acrobatics",
    "Animal Handling": "Animal",
    Athletics: "Athletics",
    Deception: "Deception ",
    History: "History ",
    Insight: "Insight",
    Intimidation: "Intimidation",
    Investigation: "Investigation ",
    Arcana: "Arcana",
    Nature: "Nature",
    Perception: "Perception ",
    Performance: "Performance",
    Medicine: "Medicine",
    Religion: "Religion",
    Stealth: "Stealth ",
    Persuasion: "Persuasion",
    "Sleight of Hand": "SleightofHand",
    Survival: "Survival",
  };
  for (const skill of SKILLS) {
    set(skillFields[skill.name]!, signed(skillValue(skill)));
    const key = skill.name.toLowerCase().replaceAll(" ", "");
    set(`details_${key}_total`, signed(skillValue(skill)));
    const contribution = values[`${skill.name.toLowerCase()}:proficiency`] ?? 0;
    const markerCount = proficiencyMarkerCount(contribution, values.proficiency ?? 0);
    if (markerCount >= 1) set(`details_${key}_proficiency`, "true");
    if (markerCount >= 2) set(`details_${key}_expertise`, "true");
  }
  set("details_passive_perception_total", fields.Passive);

  const inventory = buildInventoryDto(state, library, values["attunement:max"] ?? 3);
  set("CP", state.coins.copper);
  set("SP", state.coins.silver);
  set("EP", state.coins.electrum);
  set("GP", state.coins.gold);
  set("PP", state.coins.platinum);
  const equipment = inventory.items
    .filter((item, index) => !isHiddenInventoryItem(state.items[index], library))
    .map((item) => `${item.name}${item.amount > 1 ? ` x${item.amount}` : ""}`)
    .join("\n");
  set("Equipment", [state.equipmentNote, equipment].filter((text) => text.trim() !== "").join("\n"));
  const equippedArmor = state.items.find((item) => item.equipped && (item.location ?? "").toLowerCase() === "armor");
  const equippedShield = state.items.find((item) =>
    item.equipped &&
    (item.location ?? "").toLowerCase() === "secondary hand" &&
    library.byId.get(item.itemId)?.identity.type === "Armor"
  );
  // Unarmored characters still show their working calculation ("Unarmored (11)",
  // or the class alt like "Unarmored Defense (Barbarian)") instead of a blank box.
  set(
    "details_equipped_armor",
    equippedArmor?.name ?? `${unarmoredAlt(state, library) ?? "Unarmored"} (${values["ac:calculation"] ?? 0})`,
  );
  set("details_equipped_shield", equippedShield?.name ?? "");
  // Bonus-AC sources outside the base calculation (a held Staff of Power, a
  // ring of protection) list beneath the shield box with their contribution.
  set("details_armor_conditional", acContributionLines(state, library, values).join("\n"));
  const stealthDisadvantage = [equippedArmor, equippedShield].some((item) => {
    if (item === undefined) return false;
    const element = library.byId.get(item.itemId);
    return element?.setters.find((setter) => setter.name === "stealth")?.value.toLowerCase() === "disadvantage";
  });
  if (stealthDisadvantage) set("details_armor_stealth_disadvantage", "true");
  set("details_equipment_weight", inventory.equipmentWeight > 0 ? `${Math.round(inventory.equipmentWeight * 10) / 10}` : "");
  const collected = collectFeatures(state, library, values, inline);
  set("Features and Traits", [
    ...collected.racial.flatMap((row) => row.kind === "tokens" ? row.tokens.join(" ") : row.lines.join("\n")),
    ...collected.features.flatMap((row) => row.kind === "tokens" ? row.tokens.join(" ") : row.lines.join("\n")),
    state.additionalFeatures,
  ].filter((text) => text.trim() !== "").join("\n"));
  set("PersonalityTraits ", state.backgroundTraits.traits);
  set("Ideals", state.backgroundTraits.ideals);
  set("Bonds", state.backgroundTraits.bonds);
  set("Flaws", state.backgroundTraits.flaws);
  set("AttacksSpellcasting", state.attacksDescription);

  set("CharacterName 2", state.name);
  set("Age", state.appearance.age);
  set("Height", state.appearance.height);
  set("Weight", state.appearance.weight);
  set("Eyes", state.appearance.eyes);
  set("Skin", state.appearance.skin);
  set("Hair", state.appearance.hair);
  set("Allies", state.organization.allies);
  set("FactionName", state.organization.name);
  set("Backstory", state.backstory);
  const backgroundFeatureText = backgroundFeatureDescription(state, library);
  set("Feat+Traits", [state.backgroundFeature.name, backgroundFeatureText, state.additionalFeatures]
    .filter((text) => text.trim() !== "").join("\n"));
  set("Treasure", state.treasureNote);

  set("background_gender", state.gender);
  set("background_age", state.appearance.age);
  set("background_height", state.appearance.height);
  set("background_weight", state.appearance.weight);
  set("background_character_name", state.name);
  set("background_eyes", state.appearance.eyes);
  set("background_skin", state.appearance.skin);
  set("background_hair", state.appearance.hair);
  set("background_allies", state.organization.allies);
  set("background_organization_name", state.organization.name);
  set("background_traits", state.backgroundTraits.traits);
  set("background_ideals", state.backgroundTraits.ideals);
  set("background_bonds", state.backgroundTraits.bonds);
  set("background_flaws", state.backgroundTraits.flaws);
  set("background_feature_name", state.backgroundFeature.name);
  set("background_feature", backgroundFeatureText);
  set("background_trinket", state.backgroundTraits.trinket);
  set("background_story", state.backstory);
  set("background_additional_features", state.additionalFeatures);

  set("equipment_page_coins_cp", state.coins.copper);
  set("equipment_page_coins_sp", state.coins.silver);
  set("equipment_page_coins_ep", state.coins.electrum);
  set("equipment_page_coins_gp", state.coins.gold);
  set("equipment_page_coins_pp", state.coins.platinum);
  set("equipment_page_weight_carried", inventory.equipmentWeight > 0 ? `${Math.round(inventory.equipmentWeight * 10) / 10} lb` : "");
  set("equipment_page_weight_capacity", `${score("strength") * 15} lb`);
  set("equipment_page_weight_drag", `${score("strength") * 30} lb`);
  set("equipment_page_attunement_current", inventory.attunedItemCount);
  set("equipment_page_attunement_max", inventory.maxAttunedItemCount);
  set("equipment_page_vehicle_1_name", state.storages[0] ?? "");
  set("equipment_page_vehicle_2_name", state.storages[1] ?? "");
  set("equipment_page_additional_treasure", state.treasureNote);
  set("equipment_page_quest_items", state.quest);
  // Equipment tables: adventuring gear (40 rows), magic items (20 rows), and
  // valuables (10 rows — the Treasure category: gems, art objects). Magic and
  // valuable overflow continues in the gear table under a labeled separator
  // row instead of being silently dropped at the table cap.
  const GEAR_ROWS = 40;
  const MAGIC_ROWS = 20;
  const VALUABLE_ROWS = 10;
  interface EquipmentRow { name: string; count: number | string; weight: string }
  const gearRowsOut: EquipmentRow[] = [];
  const magicRowsOut: EquipmentRow[] = [];
  const valuableRowsOut: EquipmentRow[] = [];
  inventory.items.forEach((item, index) => {
    if (isHiddenInventoryItem(state.items[index], library)) return;
    const record = state.items[index]!;
    const displayName = itemDisplayName(record, library);
    const row: EquipmentRow = {
      name: item.isEquipped ? `[${displayName}]` : displayName,
      count: item.amount,
      weight: item.weight?.replace(/\s*lbs?\.?.*$/i, "").trim() || "—",
    };
    if (isMagicItem(record, library)) magicRowsOut.push(row);
    else if (itemCategory(record, library) === "Treasure") valuableRowsOut.push(row);
    else gearRowsOut.push(row);
  });
  const spillIntoGear = (label: string, rows: EquipmentRow[]): void => {
    if (rows.length === 0 || gearRowsOut.length >= GEAR_ROWS) return;
    gearRowsOut.push({ name: label, count: "", weight: "" });
    gearRowsOut.push(...rows);
  };
  spillIntoGear("MAGIC ITEMS — CONTINUED", magicRowsOut.splice(MAGIC_ROWS));
  spillIntoGear("VALUABLES — CONTINUED", valuableRowsOut.splice(VALUABLE_ROWS));
  const fillTable = (prefix: string, rows: EquipmentRow[]): void => {
    rows.forEach((row, slot) => {
      set(`${prefix}_name.${slot}`, row.name);
      set(`${prefix}_count.${slot}`, row.count);
      set(`${prefix}_weight.${slot}`, row.weight);
    });
  };
  fillTable("equipment_page_gear", gearRowsOut);
  fillTable("equipment_page_magic_gear", magicRowsOut);
  fillTable("equipment_page_valuable", valuableRowsOut);
  // Cargo rows for the two vehicle/container storage slots: the items stowed
  // in each (state.items whose storage matches that container's name), up to
  // the sheet's 10-row cap. Weight uses the item's own encumbrance logic
  // WITHOUT the stowed-exclusion (the row shows what the item itself weighs).
  const CARGO_ROWS = 10;
  state.storages.slice(0, 2).forEach((containerName, index) => {
    if (containerName === "") return; // an unnamed container can't own stowed items
    const cargoRows: EquipmentRow[] = state.items
      .filter((record) => (record.storage ?? "") === containerName && !isHiddenInventoryItem(record, library))
      .slice(0, CARGO_ROWS)
      .map((record) => ({
        name: itemDisplayName(record, library),
        count: record.amount,
        weight: `${Math.round(itemWeightPounds(library, record) * 10) / 10}`,
      }));
    fillTable(`equipment_page_vehicle_${index + 1}_cargo`, cargoRows);
  });
  // Attuned items describe themselves in the magic-items panel automatically;
  // the authored sidebar flag still forces any other item in.
  const sidebars = state.items.flatMap((item) => {
    if (!item.sidebar && !item.attuned) return [];
    if (isHiddenInventoryItem(item, library)) return [];
    const element = effectiveItemElement(item, library);
    const description = stripXml(element?.descriptionXml ?? "");
    return description === "" ? [] : [`${itemDisplayName(item, library)}. ${description}`];
  });
  set("equipment_page_magic_items", sidebars.join("\n\n"));

  const seenSheetAttackIds = new Set<string>();
  const sheetAttacks = buildAttacksDto(state, library)
    .filter((entry) => entry.isDisplayed)
    .filter((entry) => {
      if (seenSheetAttackIds.has(entry.id)) return false;
      seenSheetAttackIds.add(entry.id);
      return true;
    })
    .slice(0, 4);
  for (const [index, attack] of sheetAttacks.entries()) {
    const number = index === 0 ? "" : ` ${index + 1}`;
    // The document's attack/damage attributes are whatever was current when the
    // row was last written and go stale on a level-up or an ability change. The
    // resolved row is the live value: it keeps a user's pinned string (a manual
    // row, or a spell field listed in overriddenFields) and otherwise re-derives.
    set(`Wpn Name${number}`, attack.name);
    set(`Wpn${index + 1} AtkBonus${index === 0 ? "" : " "}`, attack.bonus);
    set(`Wpn${index + 1} Damage${index === 0 ? "" : " "}`, attack.damage);
    const row = index + 1;
    set(`details_attack${row}_weapon`, attack.name);
    set(`details_attack${row}_range`, attack.range);
    set(`details_attack${row}_attack`, attack.bonus);
    set(`details_attack${row}_damage`, attack.damage);
    set(`details_attack${row}_description`, attack.description);
  }
  set("details_attack_description", state.attacksDescription);

  // The details page carries one spellcasting block, which belongs to the
  // character's class caster; a feature caster only fills it when there is no
  // class caster at all.
  const caster = spellcasters.find((entry) => entry.kind === "class") ?? spellcasters[0];
  if (caster !== undefined) {
    set("Spellcasting Class 2", caster.name);
    set("SpellcastingAbility 2", caster.ability);
    set("SpellSaveDC  2", caster.saveDc);
    set("SpellAtkBonus 2", signed(caster.attackModifier));
    for (let level = 1; level <= 9; level += 1) {
      set(`SlotsTotal ${18 + level}`, caster.slotsPerLevel[level - 1] ?? 0);
      set(`SlotsRemaining ${18 + level}`, caster.slotsPerLevel[level - 1] ?? 0);
    }
    caster.knownSpells.slice(0, 120).forEach((spell, index) => set(`Spells ${1014 + index}`, spell.name));
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Page 1
// ---------------------------------------------------------------------------

/**
 * The display-worthy class entries: internal multiclass markers, entries a
 * pending multiclass selection has not yet named, and zero-level remnants
 * never render — a single-class character must not pick up multiclass
 * formatting from them.
 */
function displayClasses(
  state: CharacterState,
  library: ElementLibrary,
): ReturnType<typeof buildProgression>["classes"] {
  return buildProgression(state, library).classes.filter(
    (entry) =>
      !entry.classId.startsWith("ID_INTERNAL_MULTICLASS") &&
      entry.classId !== "" &&
      entry.className !== "" &&
      entry.level > 0,
  );
}

function classDisplay(state: CharacterState, library: ElementLibrary): string {
  const classes = displayClasses(state, library);
  const multiclass = classes.length > 1;
  const archetypes = archetypeNames(state, library);
  const parts: string[] = [];
  const main = classes.find((entry) => !entry.isMulticlass) ?? classes[0];
  if (main !== undefined) {
    // The archetype joins the main class display only when the character has
    // a single archetype selection (observed: multiclassed casters
    // with several archetypes show none).
    const archetype = archetypes.size === 1 ? [...archetypes.values()][0] : undefined;
    const display =
      archetype !== undefined && archetype !== "" ? `${main.className}, ${archetype}` : main.className;
    parts.push(multiclass ? `${display} (${main.level})` : display);
    for (const entry of classes) {
      if (entry === main) continue;
      parts.push(`${entry.className} (${entry.level})`);
    }
  }
  return parts.join(" / ");
}

function classDisplayWithArchetypes(state: CharacterState, library: ElementLibrary): string {
  const classes = displayClasses(state, library);
  const archetypes = archetypeNames(state, library);
  const byClass = classArchetypes(state);
  return classes.map((entry) => {
    const archetypeId = byClass.get(entry.classId);
    const archetype = archetypeId === undefined ? undefined : archetypes.get(archetypeId);
    const name = archetype === undefined || archetype === "" ? entry.className : `${entry.className}, ${archetype}`;
    return classes.length > 1 ? `${name} (${entry.level})` : name;
  }).join(" / ");
}

function buildPage1(
  state: CharacterState,
  library: ElementLibrary,
  values: StatisticsValues,
  inline?: Readonly<Record<string, string>>,
): SheetPage {
  const sections: SheetSection[] = [];

  const classPart = classDisplay(state, library);
  const topTokens: string[] = ["Level", `${state.level}`];
  if (state.race !== "") topTokens.push(state.race);
  if (classPart !== "") topTokens.push(...classPart.split(/\s+/));
  topTokens.push(`${state.experience}`);
  topTokens.push(state.name);
  if (state.background !== "") topTokens.push(state.background);
  const alignmentDeity = alignmentDeityNames(state, library);
  if (alignmentDeity.alignment !== "") topTokens.push(...alignmentDeity.alignment.split(/\s+/));
  if (alignmentDeity.deity !== "") topTokens.push(...alignmentDeity.deity.split(/\s+/));
  if (state.playerName !== "") topTokens.push(state.playerName);
  sections.push({ title: "top", rows: [{ kind: "tokens", tokens: topTokens }] });

  const abilityRows: SheetRow[] = [];
  for (const key of ABILITY_KEYS) {
    const score = values[`${key}:score`] ?? state.abilities[key];
    const modifier = values[`${key}:modifier`] ?? Math.floor((score - 10) / 2);
    const saveValue =
      modifier +
      (values[`${key}:save`] ?? 0) +
      (values[`${key}:save:proficiency`] ?? 0) +
      (values[`${key}:save:misc`] ?? 0);
    const proficient = (values[`${key}:save:proficiency`] ?? 0) !== 0;
    const row: string[] = [`${score}`];
    if (proficient) row.push(PROFICIENCY_MARK);
    row.push(signed(saveValue), ABILITY_NAMES[key]!, signed(modifier));
    abilityRows.push({ kind: "tokens", tokens: row });
  }
  abilityRows.push({ kind: "tokens", tokens: [signed(values["proficiency"] ?? 0)] });
  sections.push({ title: "abilities", rows: abilityRows });

  const skillRows: SheetRow[] = [];
  const proficiencyBonus = values["proficiency"] ?? 0;
  for (const skill of SKILLS) {
    const key = skill.name.toLowerCase();
    const modifier = values[`${skill.ability}:modifier`] ?? 0;
    const value =
      modifier + (values[key] ?? 0) + (values[`${key}:proficiency`] ?? 0) + (values[`${key}:misc`] ?? 0);
    const row: string[] = [];
    row.push(...Array.from(
      { length: proficiencyMarkerCount(values[`${key}:proficiency`] ?? 0, proficiencyBonus) },
      () => PROFICIENCY_MARK,
    ));
    row.push(signed(value), ...skill.name.split(/\s+/), `(${ABILITY_ABBREV[skill.ability]})`);
    skillRows.push({ kind: "tokens", tokens: row });
  }
  const passive =
    10 +
    (values["wisdom:modifier"] ?? 0) +
    (values["perception"] ?? 0) +
    (values["perception:proficiency"] ?? 0) +
    (values["perception:misc"] ?? 0);
  sections.push({ title: "skills", rows: skillRows });

  sections.push({
    title: "passive-perception",
    rows: [{ kind: "tokens", tokens: [`${passive}`] }],
  });
  const hpTokens: string[] = [`${values["hp"] ?? 0}`];
  const dice = hitDiceDisplay(state, library);
  if (dice !== "") hpTokens.push(dice);
  if ((values["hp:temp"] ?? 0) > 0) hpTokens.push(`${values["hp:temp"]}`);
  sections.push({ title: "hp", rows: [{ kind: "tokens", tokens: hpTokens }] });

  sections.push({ title: "ac", rows: [{ kind: "tokens", tokens: acTokens(state, library, values) }] });

  const speedTokens: string[] = [];
  for (const key of ["speed", "speed:fly", "speed:climb", "speed:swim"]) {
    speedTokens.push(`${values[key] ?? 0}ft.`);
  }
  sections.push({ title: "speed", rows: [{ kind: "tokens", tokens: speedTokens }] });
  sections.push({ title: "vision", rows: [{ kind: "tokens", tokens: visionNames(state, library) }] });

  // The same lines the Resistances box prints, so the canonical projection
  // and the drawn sheet can never disagree about what a character resists.
  const conditionTokens: string[] = [];
  for (const line of [...defenceLines(state, library, values, inline), ...state.conditional]) {
    for (const word of line.split(/\s+/)) {
      if (word !== "") conditionTokens.push(word);
    }
  }
  sections.push({ title: "conditions", rows: [{ kind: "tokens", tokens: conditionTokens }] });

  const extraAttacks = values["extra attack:count"] ?? 1;
  const attackCount = Math.max(1, extraAttacks);
  sections.push({
    title: "initiative",
    rows: [
      {
        kind: "tokens",
        tokens: [
          `${attackCount}`,
          attackCount === 1 ? "Attack" : "Attacks",
          "/",
          "Attack",
          "Action",
          signed(values["initiative"] ?? 0),
        ],
      },
    ],
  });

  const attackRows: SheetRow[] = [];
  // The resolved row already carries pinned strings where the user set them and
  // live values everywhere else; the stored attributes are a stale snapshot.
  for (const attack of buildAttacksDto(state, library)) {
    if (!attack.isDisplayed) continue;
    attackRows.push({
      kind: "tokens",
      tokens: [...attack.name.split(/\s+/), attack.range, ...attack.bonus.split(/\s+/), ...attack.damage.split(/\s+/)],
    });
    if (attack.description !== "") {
      attackRows.push({ kind: "tokens", tokens: attack.description.split(/\s+/) });
    }
  }
  const collected = collectFeatures(state, library, values, inline);
  sections.push({ title: "racial-traits", rows: collected.racial });
  sections.push({ title: "attacks", rows: attackRows });
  sections.push({
    title: "features",
    rows: [...collected.senses, ...collected.features],
    renderRows: collected.orderedFeatures,
  });

  const proficiency = buildProficiencySection(state, library);
  sections.push({ title: "proficiencies", rows: proficiency.proficiencyRows });
  sections.push({ title: "languages", rows: proficiency.languageRows });

  return { page: 1, templateKind: "details", sections };
}

function hitDiceDisplay(state: CharacterState, library: ElementLibrary): string {
  const progression = buildProgression(state, library);
  const classes = progression.classes.filter(
    (entry) => !entry.classId.startsWith("ID_INTERNAL_MULTICLASS"),
  );
  if (classes.length === 0) return "";
  // Same-die classes combine their levels ( "6d8" for 4+1+1 d8s).
  const byDie = new Map<string, number>();
  for (const entry of classes) {
    byDie.set(entry.hitDie, (byDie.get(entry.hitDie) ?? 0) + entry.level);
  }
  return [...byDie.entries()].map(([die, count]) => `${count}${die}`).join("/");
}

function acTokens(state: CharacterState, library: ElementLibrary, values: StatisticsValues): string[] {
  const tokens: string[] = [];
  const armor = state.items.find((item) => item.equipped && (item.location === "Armor" || item.location === "armor"));
  const acCalculation = values["ac:calculation"] ?? 0;
  const acTotal = values["ac"] ?? acCalculation;

  if (armor !== undefined) {
    tokens.push(...armor.name.split(/\s+/));
  } else {
    const alt = unarmoredAlt(state, library);
    tokens.push(...(alt ?? "Unarmored").split(/\s+/));
    tokens.push(`(${acCalculation})`);
  }
  tokens.push(`${acTotal}`);

  const shield = state.items.find((item) => item.equipped && (item.location === "Secondary Hand" || item.location === "secondary"));
  if (shield !== undefined) {
    tokens.push(...shield.name.split(/\s+/));
  }
  const misc = values["ac:misc"] ?? 0;
  const miscAlt = acMiscAlt(state, library);
  if (misc !== 0 && miscAlt !== null) {
    tokens.push(...miscAlt.split(/\s+/), `(${misc})`);
  }
  return tokens;
}

/** The damage-defence groups, in the order the Resistances box prints them. */
const DEFENCE_GROUPS: readonly { readonly name: string; readonly label: string }[] = [
  { name: "Resistance", label: "Resistances" },
  { name: "Immunity", label: "Immunities" },
  { name: "Vulnerability", label: "Vulnerabilities" },
];

/** A defence Condition's name: the group it belongs to and the damage type. */
const DEFENCE_NAME = /^(Resistance|Immunity|Vulnerability)\s+\((.+)\)$/;

/**
 * The computed lines of the Resistances box.
 *
 * A character's defences are registered Condition elements, put there by a
 * race, a class feature or an item whose benefits are active. A Condition
 * carrying sheet text prints that text: the element's own words are the only
 * statement of what it does. One without sheet text is known only by its
 * name, so the three damage-defence groups gather onto a line each —
 * "Resistances: Acid, Fire" rather than a line per type, because the box is
 * a few lines tall and a character can hold half a dozen defences — and any
 * other parenthesised name keeps the conditional display form. Types sort
 * alphabetically so the same set of sources always prints the same line, and
 * a group nothing registered is left out rather than printed empty.
 */
function defenceLines(
  state: CharacterState,
  library: ElementLibrary,
  values: StatisticsValues,
  inline?: Readonly<Record<string, string>>,
): string[] {
  const grouped = new Map<string, Set<string>>();
  const described: string[] = [];
  const seen = new Set<string>();
  for (const id of registeredIds(state)) {
    const element = library.byId.get(id);
    if (element === undefined || element.identity.type !== "Condition") continue;
    let hasSheetText = false;
    for (const sheet of element.sheets) {
      if (sheet.display === false) continue;
      const description = sheetDescriptionAtLevel(sheet, state.level);
      if (description === undefined) continue;
      const text = substitute(description.text, values, inline).trim();
      if (text === "") continue;
      hasSheetText = true;
      if (seen.has(text)) continue;
      seen.add(text);
      described.push(text);
    }
    // Sheet text supersedes the name: an element that says what it does has
    // already said it, and its name would repeat the same benefit.
    if (hasSheetText) continue;
    const match = DEFENCE_NAME.exec(element.identity.name);
    if (match !== null) {
      const types = grouped.get(match[1]!) ?? new Set<string>();
      // Two sources of the same resistance are one entry: the sheet states
      // what the character has, not how many items grant it.
      types.add(match[2]!);
      grouped.set(match[1]!, types);
      continue;
    }
    const display = conditionDisplayName(element.identity.name);
    if (display === null || seen.has(display)) continue;
    seen.add(display);
    described.push(display);
  }
  const lines: string[] = [];
  for (const group of DEFENCE_GROUPS) {
    const types = grouped.get(group.name);
    if (types === undefined || types.size === 0) continue;
    lines.push(`${group.label}: ${[...types].sort().join(", ")}`);
  }
  lines.push(...described);
  return lines;
}

/** "Resistance (Poison)" -> "Resistances. Poison" (conditional sheet display). */
function conditionDisplayName(name: string): string | null {
  const match = /^(.+?)\s+\((.+)\)$/.exec(name);
  if (match === null) return null;
  const type = match[1]!;
  const plural = type.endsWith("y") ? `${type.slice(0, -1)}ies` : `${type}s`;
  return `${plural}. ${match[2]}`;
}

function alignmentDeityNames(state: CharacterState, library: ElementLibrary): { alignment: string; deity: string } {
  let alignment = "";
  let deity = "";
  for (const node of treeNodes(state.elements)) {
    const registeredOrId = node.registered ?? node.id;
    if (node.type === "Alignment" && registeredOrId !== "" && registeredOrId !== undefined) {
      const element = library.byId.get(registeredOrId);
      if (element !== undefined) alignment = element.identity.name;
    }
    if (node.type === "Deity" && registeredOrId !== "" && registeredOrId !== undefined) {
      const element = library.byId.get(registeredOrId);
      if (element !== undefined) deity = element.identity.name;
    }
  }
  return { alignment, deity };
}

function visionNames(state: CharacterState, library: ElementLibrary): string[] {
  const names: string[] = [];
  for (const node of treeNodes(state.elements)) {
    if (node.type === "Vision" && node.id !== "" && node.id !== undefined) {
      const element = library.byId.get(node.id);
      if (element !== undefined && !names.includes(element.identity.name)) {
        names.push(element.identity.name);
      }
    }
  }
  return names;
}

/**
 * Bonus-AC sources outside the base calculation, one "Name (bonus)" line per
 * source: active items (equipped or attuned, adorners included) first, then
 * registered features with an ac:misc rule. Condition-gated rules stay out —
 * they are circumstances, not always-on armor class.
 */
function acContributionLines(state: CharacterState, library: ElementLibrary, values: StatisticsValues): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const addFromElement = (elementId: string, fallbackName?: string): void => {
    if (elementId === "" || seen.has(elementId)) return;
    seen.add(elementId);
    const element = library.byId.get(elementId);
    if (element === undefined) return;
    let total = 0;
    let alt: string | undefined;
    for (const rule of element.rules) {
      if (rule.kind !== "stat" || rule.name !== "ac:misc") continue;
      if (rule.condition !== undefined && rule.condition.trim() !== "") continue;
      if (rule.value === undefined) continue;
      const literal = Number(rule.value);
      total += Number.isFinite(literal) ? literal : values[rule.value] ?? 0;
      if (rule.alt !== undefined) alt = rule.alt;
    }
    // A group summing to zero or less is dropped from the AC total, so it
    // never earns a contribution line either.
    if (total <= 0) return;
    lines.push(`${alt ?? fallbackName ?? element.identity.name} (${total})`);
  };
  const linkedActive = new Map<string, boolean>();
  for (const item of state.items) {
    const active = itemBenefitsActive(library, item);
    for (const linkedId of [item.itemId, ...item.adorners]) {
      if (linkedId === "") continue;
      linkedActive.set(linkedId, (linkedActive.get(linkedId) ?? false) || active);
    }
  }
  for (const item of state.items) {
    if (!itemBenefitsActive(library, item)) continue;
    for (const activeId of [item.itemId, ...item.adorners]) {
      addFromElement(activeId, itemDisplayName(item, library));
    }
  }
  for (const id of registeredIds(state)) {
    // Item elements reachable through sum/tree registrations stay out unless
    // an owning record conveys benefits right now.
    if (linkedActive.get(id) === false) continue;
    addFromElement(id);
  }
  return lines;
}

function acMiscAlt(state: CharacterState, library: ElementLibrary): string | null {
  const ids = registeredIds(state);
  for (const id of ids) {
    const element = library.byId.get(id);
    if (element === undefined) continue;
    for (const rule of element.rules) {
      if (rule.kind !== "stat" || rule.name !== "ac:misc" || rule.alt === undefined) continue;
      return rule.alt;
    }
  }
  return null;
}

function unarmoredAlt(state: CharacterState, library: ElementLibrary): string | null {
  const ids = registeredIds(state);
  for (const id of ids) {
    const element = library.byId.get(id);
    if (element === undefined) continue;
    for (const rule of element.rules) {
      if (rule.kind !== "stat" || rule.name !== "ac:calculation") continue;
      if (rule.alt !== undefined) return rule.alt;
    }
  }
  return null;
}

interface CollectedFeature {
  class: "senses" | "features" | "racial";
  title: string;
  parenthetical: string | null;
  description: string;
}

/**
 * Associates registered ids with the owning class's current level. Class
 * grants are authored against that level, while the character's total level
 * also includes levels in other classes.
 */
function featureClassLevels(state: CharacterState): Map<string, number> {
  const classLevels = new Map<string, number>();
  for (const entry of state.levelHistory) {
    if (entry.isPending) continue;
    classLevels.set(entry.classId, Math.max(classLevels.get(entry.classId) ?? 0, entry.classLevel));
  }

  const levels = new Map<string, number>();
  const walk = (nodes: readonly TreeElement[], inherited?: number): void => {
    for (const node of nodes) {
      let current = inherited;
      if ((node.type === "Class" || node.type === "Multiclass") && node.registered !== undefined) {
        current = classLevels.get(node.registered) ?? inherited;
      }
      if (current !== undefined) {
        if (node.id !== "") levels.set(node.id, current);
        if (node.registered !== undefined && node.registered !== "") levels.set(node.registered, current);
      }
      walk(node.children, current);
    }
  };
  walk(state.elements);
  return levels;
}

/**
 * The ids granted by the character's active control items — inventory records
 * whose element is not physical equipment (`isPhysicalEquipment`). A grant
 * whose own level or requirements do not hold is left out, so an optional
 * class feature carried below its class level stays off the sheet.
 *
 * Grant types are deliberately not filtered here: `classOfElement` decides
 * what belongs in a feature box, so a control item granting a feat surfaces it
 * while one granting a spell or a proficiency does not.
 */
function activeControlGrantIds(state: CharacterState, library: ElementLibrary): string[] {
  const out: string[] = [];
  let ctx: ReturnType<typeof createRegistrationContext> | undefined;
  for (const item of state.items) {
    const element = library.byId.get(item.itemId);
    if (element === undefined || isPhysicalEquipment(element)) continue;
    if (!itemBenefitsActive(library, item)) continue;
    for (const rule of element.rules) {
      if (rule.kind !== "grant" || rule.id === undefined || rule.id === "") continue;
      if (rule.level !== undefined && rule.level > state.level) continue;
      if (rule.requirements !== undefined && rule.requirements.trim() !== "") {
        ctx ??= createRegistrationContext(state, library);
        if (!evaluateRequirements(rule.requirements, ctx)) continue;
      }
      out.push(rule.id);
    }
  }
  return out;
}

/** Ordered feature ids: preserve registration order, then make wrapper
 * dependencies parent-before-child (observed: a selected enemy or
 * terrain follows the feature that explains that selection). */
function featureOrderIds(state: CharacterState, library: ElementLibrary): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const nodes = treeNodes(state.elements);
  const wrapperChildren = new Map<string, string[]>();
  const dependencies = new Map<string, Set<string>>();
  for (const node of nodes) {
    for (const child of node.children) {
      if (child.registered === undefined || child.registered === "") continue;
      const parentId = node.registered ?? node.id;
      const children = wrapperChildren.get(parentId) ?? [];
      children.push(child.registered);
      wrapperChildren.set(parentId, children);
    }
    // Blank-id selection wrappers (for example Ability Score Improvement
    // slots) are bookkeeping nodes, not displayed feature parents. Only an
    // actual registered feature id can impose sheet ordering on its child.
    const parentIds = node.id === undefined || node.id === "" || !node.type.includes("Feature")
      ? []
      : [node.id];
    for (const child of node.children) {
      // Only registered wrapper children are dependency-selected values. Plain
      // child ids are ordinary feature nesting and must keep the sum's order.
      const childId = child.registered;
      if (childId === undefined || childId === "") continue;
      for (const parentId of parentIds) {
        const children = dependencies.get(parentId) ?? new Set<string>();
        children.add(childId);
        dependencies.set(parentId, children);
      }
    }
  }
  // Registers an id, the corpus grant-rule targets it unlocks that the
  // .dnd5e sum does not already list (observed: the Sacred Oath
  // auto-grants the Channel Divinity), and its wrapper-registered children.
  const sumIds = new Set(state.sum.elements.map((entry) => entry.id));
  const classLevels = featureClassLevels(state);
  const addGranted = (id: string, ownerClassLevel?: number): void => {
    if (id === "" || seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const element = library.byId.get(id);
    if (element !== undefined) {
      for (const rule of element.rules) {
        if (rule.kind !== "grant" || rule.id === undefined || rule.id === "") continue;
        const level = ownerClassLevel ?? state.level;
        if (rule.level !== undefined && rule.level > level) continue;
        if (rule.requirements !== undefined && rule.requirements.trim() !== "") continue;
        if (rule.type !== undefined && rule.type !== "Class Feature") continue;
        if (sumIds.has(rule.id)) continue;
        addGranted(rule.id, ownerClassLevel);
      }
    }
  };
  for (const entry of state.sum.elements) {
    addGranted(entry.id, classLevels.get(entry.id));
    for (const childId of wrapperChildren.get(entry.id) ?? []) {
      addGranted(childId, classLevels.get(childId));
    }
  }
  for (const node of nodes) {
    const id = node.registered ?? node.id;
    if (id !== undefined) addGranted(id, classLevels.get(id));
  }
  // Control items are the corpus's on/off switches — the Tasha's optional
  // class features, Supernatural Gifts, the `Additional …` proxies. They live
  // in the equipment section rather than the registered tree, so the features
  // they grant never reach the sum. The statistics calculator already applies
  // an active control item's grants (see the items loop in collectRules); the
  // features box has to agree, or a feature silently affects the numbers while
  // its text is nowhere on the sheet.
  for (const id of activeControlGrantIds(state, library)) addGranted(id);

  // The sum is usually already in dependency order, but imported files and
  // edited snapshots can place a selected child before its parent. Consume
  // newly-ready children before the other ready entries so a wrapper's
  // selected value stays adjacent to the feature that explains it. Entries
  // with no dependency remain in their original stable order.
  const indegree = new Map(order.map((id) => [id, 0]));
  for (const [parent, children] of dependencies) {
    if (!indegree.has(parent)) continue;
    for (const child of children) {
      if (!indegree.has(child) || child === parent) continue;
      indegree.set(child, indegree.get(child)! + 1);
    }
  }
  const ready = order.filter((id) => indegree.get(id) === 0);
  const sorted: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    sorted.push(id);
    const newlyReady: string[] = [];
    for (const child of dependencies.get(id) ?? []) {
      if (!indegree.has(child) || child === id) continue;
      const next = indegree.get(child)! - 1;
      indegree.set(child, next);
      if (next === 0) newlyReady.push(child);
    }
    ready.unshift(...newlyReady);
  }
  // A malformed cyclic wrapper graph must not hide features. Keep its stable
  // source order as a deterministic fallback after the acyclic prefix.
  if (sorted.length !== order.length) {
    const included = new Set(sorted);
    sorted.push(...order.filter((id) => !included.has(id)));
  }
  return sorted;
}

function collectFeatures(
  state: CharacterState,
  library: ElementLibrary,
  values: StatisticsValues,
  inline?: Readonly<Record<string, string>>,
): { senses: SheetRow[]; features: SheetRow[]; racial: SheetRow[]; orderedFeatures: SheetRow[] } {
  const out: CollectedFeature[] = [];
  const seen = new Set<string>();
  const ids = featureOrderIds(state, library);
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const element = library.byId.get(id);
    if (element === undefined) continue;
    const cls = classOfElement(element);
    if (cls === "hidden" || cls === "proficiency" || cls === "language") continue;
    const sheet = element.sheets[0];
    if (sheet === undefined) {
      // Reference renders sheet-less class features name-only ("Fighting Style.")
      // but hides the internal ASI-feat stubs ("Feat (4)").
      if (element.identity.type !== "Class Feature" || element.identity.id.startsWith("ID_INTERNAL_")) continue;
      out.push({ class: cls, title: element.identity.name, parenthetical: null, description: "" });
      continue;
    }
    const description = sheetDescriptionAtLevel(sheet, state.level);
    if (description === undefined) continue;
    const parenthetical = featureParenthetical(sheet, description);
    out.push({
      class: cls,
      title: sheet.alt !== undefined && sheet.alt !== "" ? sheet.alt : element.identity.name,
      parenthetical: parenthetical === "" ? null : substitute(parenthetical, values, inline),
      description: substitute(description.text, values, inline),
    });
  }
  const rows = (filter: (item: CollectedFeature) => boolean): SheetRow[] =>
    out.filter(filter).map((item) => ({
      kind: "lines",
      lines: [featureLine(item.title, item.parenthetical, item.description)],
    }));
  return {
    senses: rows((item) => item.class === "senses"),
    features: rows((item) => item.class === "features"),
    racial: rows((item) => item.class === "racial"),
    orderedFeatures: rows((item) => item.class === "senses" || item.class === "features"),
  };
}

/**
 * Element types whose sheet text belongs in the Features & Traits box. The
 * box is filled from this whitelist — a registered element of any other type
 * (Deity, Alignment, Size, Background, …) never reaches the trait boxes no
 * matter what its sheet node says; a Deity, for example, only feeds the
 * header's deity field.
 */
const FEATURE_BOX_TYPES: ReadonlySet<string> = new Set([
  "Language Feature",
  "Class",
  "Class Feature",
  "Archetype",
  "Archetype Feature",
  "Feat",
  "Feat Feature",
]);

/** Element types whose sheet text belongs in the racial-traits box. */
const RACIAL_BOX_TYPES: ReadonlySet<string> = new Set([
  "Race",
  "Sub Race",
  "Race Variant",
  "Racial Trait",
  "Dragonmark",
]);

function classOfElement(element: ParsedElement): "senses" | "features" | "racial" | "proficiency" | "language" | "hidden" {
  if (element.sheets.length === 0 && element.identity.type !== "Class Feature") return "hidden";
  if (element.sheets.some((sheet) => sheet.display === false)) return "hidden";
  const { type, name } = element.identity;
  // "+1 to one score" entries render through the abilities panel, never as
  // trait lines.
  if (name.startsWith("Ability Score Increase") || name.startsWith("Ability Score Improvement")) return "hidden";
  if (type === "Vision") return "senses";
  if (RACIAL_BOX_TYPES.has(type)) return "racial";
  if (type === "Proficiency") return "proficiency";
  if (type === "Language") return "language";
  return FEATURE_BOX_TYPES.has(type) ? "features" : "hidden";
}

function proficiencyParts(name: string): { category: string; item: string } | null {
  const match = /^(.+?)\s+Proficiency\s+\((.+)\)$/.exec(name);
  if (match === null) return null;
  return { category: match[1]!, item: match[2]! };
}

function languageName(name: string): string {
  const match = /^Language\s+\((.+)\)$/.exec(name);
  return match === null ? name : match[1]!;
}

/** Helvetica AFM glyph widths (1/1000 em) for the profile-column
 * line-wrap estimation. Unknown glyphs fall back to 500. */
const GLYPH_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "=": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 500, b: 556, c: 500, d: 556, e: 500, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 500, p: 556, q: 556, r: 333, s: 389, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "\u2019": 191, "\u2018": 191, "\u201C": 389, "\u201D": 389,
  "\u2013": 500, "\u2014": 1000, "\u00E9": 500, "\u00C6": 1000,
};

/** The page-1 "PROFICIENCIES & LANGUAGES" column: the text box is ~195 units
 * wide at ~9.5pt (geometry: x 410-612 with margins). */
const PROFILE_COLUMN_WIDTH = 195;
const PROFILE_FONT_SIZE = 9.5;

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += GLYPH_WIDTHS[ch] ?? 500;
  return (width * PROFILE_FONT_SIZE) / 1000;
}

/** Greedy word wrap matching the column rendering. */
function wrapColumnLine(text: string): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && textWidth(candidate) > PROFILE_COLUMN_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function buildProficiencySection(
  state: CharacterState,
  library: ElementLibrary,
): { proficiencyRows: SheetRow[]; languageRows: SheetRow[] } {
  const ids = featureOrderIds(state, library);
  const registeredLanguageIds = new Set<string>();
  const classNestedLanguageIds = new Set<string>();
  for (const node of treeNodes(state.elements)) {
    if (node.registered !== undefined && node.registered !== "" && library.byId.get(node.registered)?.identity.type === "Language") {
      registeredLanguageIds.add(node.registered);
    }
    if (node.id !== "" && library.byId.get(node.id)?.identity.type === "Class Feature") {
      for (const child of node.children) {
        if (library.byId.get(child.id)?.identity.type === "Language") classNestedLanguageIds.add(child.id);
      }
    }
  }
  const groups = new Map<string, string[]>();
  const orderedCategories: Array<{ category: string; rank: number }> = [];
  const languages: string[] = [];
  const registeredLanguages: string[] = [];
  const classLanguages: string[] = [];
  const order: string[] = [];
  for (const id of ids) {
    const element = library.byId.get(id);
    if (element === undefined) continue;
    if (element.identity.type === "Language") {
      const name = languageName(element.identity.name);
      const classNested = classNestedLanguageIds.has(id);
      const list = classNested ? classLanguages : registeredLanguageIds.has(id) ? registeredLanguages : languages;
      if (!list.includes(name)) list.push(name);
      if (!order.includes(`lang:${name}`)) order.push(`lang:${name}`);
      continue;
    }
    if (element.identity.type !== "Proficiency") continue;
    if (hasRegisteredProficiencyAncestor(state, library, id)) continue;
    const parts = proficiencyParts(element.identity.name);
    if (parts === null || parts.category === "Saving Throw") continue;
    if (!groups.has(parts.category)) {
      groups.set(parts.category, []);
      const rank = ["Armor", "Weapon", "Tool"].indexOf(parts.category);
      orderedCategories.push({ category: parts.category, rank: rank < 0 ? 99 : rank });
    }
    const list = groups.get(parts.category)!;
    if (!list.includes(parts.item)) {
      list.push(parts.item);
      order.push(`${parts.category}:${parts.item}`);
    }
  }
  void order;
  for (const name of registeredLanguages) {
    if (!languages.includes(name)) languages.push(name);
  }
  for (const name of classLanguages) {
    if (!languages.includes(name)) languages.push(name);
  }
  orderedCategories.sort((a, b) => a.rank - b.rank);
  const fixedCategories = ["Armor", "Weapon", "Tool"];
  const categoryTexts: Array<{ category: string; text: string }> = fixedCategories.map((category) => ({
    category,
    text: `${category} Proficiencies. ${groups.get(category)?.join(", ") ?? "\u2013"}`,
  }));
  for (const entry of orderedCategories) {
    if (fixedCategories.includes(entry.category)) continue;
    categoryTexts.push({
      category: entry.category,
      text: `${entry.category} Proficiencies. ${groups.get(entry.category)!.join(", ")}`,
    });
  }
  const proficiencyRows: SheetRow[] = categoryTexts.map((entry) => ({
    kind: "tokens",
    tokens: entry.text.split(/\s+/),
  }));
  // The languages block renders at the foot of the proficiencies column; the
  // the extraction's y-60 band boundary keeps its first line in the
  // proficiencies section only while the proficiency block stays within five
  // wrapped lines.
  const proficiencyLines = categoryTexts.reduce(
    (sum, entry) => sum + wrapColumnLine(entry.text).length,
    0,
  );
  const languageText = languages.length > 0 ? `Languages. ${languages.join(", ")}` : "Languages. –";
  const languageLines = wrapColumnLine(languageText).map((line) => line.split(/\s+/));
  if (languages.length === 0 || proficiencyLines <= 5) {
    proficiencyRows.push({ kind: "tokens", tokens: languageLines[0]! });
    return {
      proficiencyRows,
      languageRows: languageLines.slice(1).map((tokens) => ({ kind: "tokens", tokens })),
    };
  }
  return {
    proficiencyRows,
    languageRows: languageLines.map((tokens) => ({ kind: "tokens", tokens })),
  };
}

function hasRegisteredProficiencyAncestor(state: CharacterState, library: ElementLibrary, id: string): boolean {
  const registeredProficiencyIds = new Set<string>();
  for (const node of treeNodes(state.elements)) {
    const candidate = node.registered ?? node.id;
    if (candidate === undefined || candidate === "" || candidate === id) continue;
    const element = library.byId.get(candidate);
    if (element !== undefined && element.identity.type === "Proficiency") {
      registeredProficiencyIds.add(candidate);
    }
  }
  if (registeredProficiencyIds.size === 0) return false;
  let found = false;
  const walk = (nodes: readonly TreeElement[], underRegisteredProficiency: boolean): boolean => {
    for (const node of nodes) {
      const ownId = node.registered ?? node.id;
      if (ownId === id) {
        // stop at the first tree occurrence: only a registered proficiency
        // ancestor ABOVE it hides it (the same element id may appear twice,
        // e.g. a race weapon under a racial trait and under a class group).
        found = underRegisteredProficiency;
        return false;
      }
      const next = underRegisteredProficiency || registeredProficiencyIds.has(ownId ?? "");
      if (!walk(node.children, next)) return false;
    }
    return true;
  };
  walk(state.elements, false);
  return found;
}

const NOTES_PAGE_MAX_CHARS = 500;

/** Short note columns fit the dedicated full-sheet notes page. Longer imported
 * note prose follows the existing character-page overflow projection instead
 * of creating a page whose fixed template cannot contain it. */
function notesFitDedicatedPage(state: CharacterState): boolean {
  const notes = [state.notes.left, state.notes.right].filter((note) => note.trim() !== "");
  return notes.length > 0 && notes.every((note) => note.trim().length <= NOTES_PAGE_MAX_CHARS);
}

/** Background feature text is emitted by the sheet writer as one text flow.
 * Its paragraph breaks are not represented by a separating extraction space;
 * retain that boundary behavior while ordinary spaces still delimit tokens. */
function backgroundFeatureTokens(name: string, description: string): string[] {
  const text = `${name}${description === "" ? "" : ` ${description}`}`.trim();
  if (text === "") return [];
  return text.replace(/[\r\n]+/g, "").split(/[ \t]+/).filter((token) => token !== "");
}

function buildPage2(state: CharacterState, library: ElementLibrary): SheetPage {
  const sections: SheetSection[] = [];
  const genderTokens: string[] = [];
  if (state.gender !== "") genderTokens.push(state.gender);
  if (state.appearance.age !== "") genderTokens.push(state.appearance.age);
  if (state.appearance.height !== "") genderTokens.push(...state.appearance.height.split(/\s+/));
  if (state.appearance.weight !== "") genderTokens.push(...state.appearance.weight.split(/\s+/));
  sections.push({ title: "gender", rows: [{ kind: "tokens", tokens: genderTokens }] });
  const nameTokens: string[] = state.name === "" ? [] : state.name.split(/\s+/);
  for (const key of ["eyes", "skin", "hair"] as const) {
    if (state.appearance[key] !== "") nameTokens.push(...state.appearance[key].split(/\s+/));
  }
  sections.push({ title: "name", rows: [{ kind: "tokens", tokens: nameTokens }] });
  sections.push({ title: "eyes-skin-hair", rows: [{ kind: "tokens", tokens: [] }] });
  sections.push({ title: "portrait", rows: [] });
  sections.push({
    title: "backstory",
    rows:
      state.backstory.trim() === ""
        ? []
        : [{ kind: "lines", lines: [state.backstory.trim()] }],
  });
  for (const [title, text] of [
    ["personality-traits", state.backgroundTraits.traits],
    ["ideals", state.backgroundTraits.ideals],
    ["bonds", state.backgroundTraits.bonds],
    ["flaws", state.backgroundTraits.flaws],
  ] as const) {
    sections.push({
      title,
      rows: text.trim() === "" ? [] : [{ kind: "lines", lines: [text.trim()] }],
    });
  }
  const featureTokens = backgroundFeatureTokens(state.backgroundFeature.name, backgroundFeatureDescription(state, library));
  sections.push({ title: "background-feature", rows: [{ kind: "tokens", tokens: featureTokens }] });
  sections.push({
    title: "trinket",
    rows:
      state.backgroundTraits.trinket.trim() === ""
        ? []
        : [{ kind: "lines", lines: [state.backgroundTraits.trinket.trim()] }],
  });
  sections.push({
    title: "additional-features",
    rows:
      state.additionalFeatures.trim() === ""
        ? []
        : [{ kind: "lines", lines: [state.additionalFeatures.trim()] }],
  });
  return { page: 2, templateKind: "background", sections };
}

/**
 * The companion page. The template is an AcroForm like the other pages, so
 * the values ride in the model's shared form-value map under the template's
 * `companion_*` field names; the section rows carry the flowed text (traits,
 * actions, reactions) the form fields cannot size themselves.
 */
function buildCompanionPage(companion: CompanionDto, page: number): SheetPage {
  // Traits and actions are rules text, not a list of labels: each reads
  // "Name. What it does", the way a stat block prints them.
  const featureLines: string[] = [];
  const appendFeatures = (features: readonly CompanionFeatureDto[]): void => {
    for (const feature of features) {
      featureLines.push(
        feature.description === "" ? `${feature.name}.` : `${feature.name}. ${feature.description}`,
      );
    }
  };
  appendFeatures(companion.traits);
  appendFeatures(companion.actions);
  appendFeatures(companion.reactions);

  const statLines: string[] = [];
  for (const [label, text] of [
    ["Skills", companion.skills],
    ["Saving Throws", companion.savingThrows],
    ["Senses", companion.senses],
    ["Languages", companion.languages],
    ["Damage Resistances", companion.damageResistances],
    ["Damage Immunities", companion.damageImmunities],
    ["Damage Vulnerabilities", companion.damageVulnerabilities],
    ["Condition Immunities", companion.conditionImmunities],
  ] as const) {
    if (text.trim() !== "") statLines.push(`${label}. ${text.trim()}`);
  }

  return {
    page,
    templateKind: "companion",
    sections: [
      {
        title: "companion-features",
        rows: featureLines.length === 0 ? [] : [{ kind: "lines", lines: featureLines }],
      },
      {
        title: "companion-statistics",
        rows: statLines.length === 0 ? [] : [{ kind: "lines", lines: statLines }],
      },
    ],
  };
}

/** The companion template's AcroForm values. */
function companionFormValues(companion: CompanionDto): Record<string, string> {
  const fields: Record<string, string> = {
    companion_name: companion.name,
    companion_kind: companion.kind !== "" ? companion.kind : companion.creatureType,
    companion_owner: companion.owner,
    companion_build: companion.build,
    companion_challenge: companion.challenge,
    companion_armor_class: companion.armorClassText || String(companion.armorClass),
    companion_hp_max: String(companion.maxHp),
    companion_hp_current: String(companion.maxHp),
    companion_hd: companion.hitPointsText,
    companion_initiative: signed(companion.initiative),
    companion_proficiency: String(companion.proficiency),
    companion_proficiency_bonus: String(companion.proficiency),
    companion_speed: companion.speedText,
    companion_speed_walking: `${companion.speed}`,
  };
  for (const speed of ["Fly", "Climb", "Swim", "Burrow"] as const) {
    const value = companion[`speed${speed}` as const];
    fields[`companion_speed_${speed.toLowerCase()}`] = value > 0 ? `${value}` : "";
  }
  for (const ability of companion.abilities) {
    const key = ability.name.slice(0, 3).toLowerCase();
    fields[`companion_${key}_score`] = String(ability.score);
    fields[`companion_${key}_modifier`] = signed(ability.modifier);
  }
  return fields;
}

function buildNotesPage(state: CharacterState): SheetPage {
  const rows: SheetRow[] = [];
  for (const note of [state.notes.left, state.notes.right]) {
    if (note.trim() !== "") rows.push({ kind: "lines", lines: [note.trim()] });
  }
  return {
    page: 4,
    templateKind: "generic",
    sections: [{ title: "notes", rows }],
  };
}

// ---------------------------------------------------------------------------
// Page 3: inventory
// ---------------------------------------------------------------------------

function buildInventoryPage(
  state: CharacterState,
  library: ElementLibrary,
  values: StatisticsValues,
  canonical: boolean,
): SheetPage {
  const inventory = buildInventoryDto(state, library, values["attunement:max"] ?? 3);
  const effectiveStrength = values["strength:score"] ?? state.abilities.strength;
  const sections: SheetSection[] = [];
  const rows: SheetRow[] = [];
  const gearRows: SheetRow[] = [];
  const magicRows: SheetRow[] = [];
  const magicFlags = state.items.map((item) => isMagicItem(item, library));
  const gear: InventoryItemDto[] = [];
  const magic: InventoryItemDto[] = [];
  inventory.items.forEach((item, i) => {
    // Proxy items created for additional spells/proficiencies are persisted
    // in the document but are hidden from the inventory table.
    if (isHiddenInventoryItem(state.items[i], library)) return;
    if (magicFlags[i] === true) magic.push(item);
    else {
      const stateItem = state.items[i];
      const type = library.byId.get(item.itemId)?.identity.type;
      const aggregate = stateItem !== undefined && (type === "Weapon" || type === "Armor") && !item.isEquipped && stateItem.adorners.length === 0;
      const existing = aggregate ? gear.find((entry) => entry.itemId === item.itemId && !entry.isEquipped) : undefined;
      if (existing !== undefined) existing.amount += item.amount;
      else gear.push({ ...item });
    }
  });
  for (let i = 0; i < Math.max(gear.length, magic.length); i++) {
    if (i < gear.length) {
      const row = itemRow(gear[i]!, library, state.items[inventory.items.indexOf(gear[i]!)]);
      gearRows.push(row);
      rows.push(row);
    }
    if (i < magic.length) {
      const row = itemRow(magic[i]!, library, state.items[inventory.items.indexOf(magic[i]!)]);
      magicRows.push(row);
      rows.push(row);
    }
  }
  rows.push({
    kind: "tokens",
    tokens: [`${inventory.attunedItemCount}`, "/", `${inventory.maxAttunedItemCount}`],
  });
  rows.push({
    kind: "tokens",
    tokens: [
      `${inventory.coins.copper}`,
      `${inventory.coins.silver}`,
      `${inventory.coins.electrum}`,
      `${inventory.coins.gold}`,
      `${inventory.coins.platinum}`,
    ],
  });
  rows.push({
    kind: "tokens",
    tokens: [
      ...(inventory.equipmentWeight > 0 ? [`${Math.round(inventory.equipmentWeight * 10) / 10}`] : []),
      "lb",
      "/",
      `${effectiveStrength * 15}`,
      "lb",
      `${effectiveStrength * 30}`,
      "lb",
    ],
  });
  const sidebarRows: SheetRow[] = [];
  const sidebars: Array<{ title: string; html: string }> = [];
  for (const item of state.items) {
    // Attuned items describe themselves in the magic-items panel automatically;
    // the authored sidebar flag still forces any other item in.
    if (!item.sidebar && !item.attuned) continue;
    if (isHiddenInventoryItem(item, library)) continue;
    const element = effectiveItemElement(item, library);
    const description = stripXml(element?.descriptionXml ?? "");
    if (element === undefined || description === "") continue;
    sidebars.push({ title: itemDisplayName(item, library), html: element.descriptionXml ?? "" });
    sidebarRows.push({
      kind: "tokens",
      tokens: [...`${itemDisplayName(item, library)}.`.split(/\s+/), ...description.split(/\s+/)],
    });
  }
  const rowTokens = (row: SheetRow): string[] => row.kind === "tokens" ? [...row.tokens] : row.lines.flatMap((line) => line.split(/\s+/));
  const inventoryColumns: readonly [readonly (readonly string[])[], readonly (readonly string[])[]] = [
    gearRows.map(rowTokens),
    magicRows.map(rowTokens),
  ];
  const inventorySummaryRows = rows.slice(gearRows.length + magicRows.length).map(rowTokens);
  sections.push({
    title: "inventory",
    rows: [...sidebarRows, ...rows],
    ...(sidebars.length === 0 ? {} : {
      positionedRuns: inventoryRuns(
        inventoryColumns,
        sidebars,
        inventorySummaryRows,
      ),
      ...(canonical
        ? { canonicalRuns: canonicalInventoryRuns(inventoryColumns, sidebars, inventorySummaryRows) }
        : {}),
    }),
  });
  sections.push({
    title: "treasure",
    rows: state.treasureNote.trim() === "" ? [] : [{ kind: "lines", lines: [state.treasureNote.trim()] }],
  });
  sections.push({ title: "stored-items", rows: [] });
  sections.push({
    title: "quest-trinkets",
    rows: state.quest.trim() === "" ? [] : [{ kind: "lines", lines: [state.quest.trim()] }],
  });
  void values;
  return { page: 3, templateKind: "equipment", sections };
}

/** A magic item (adorned or magic-type base) renders in the sheet's MAGIC
 * ITEMS table; its display name joins the adorner and the base. */
function isMagicItem(item: { itemId: string; adorners: string[] }, library: ElementLibrary): boolean {
  if (item.adorners.length > 0) return true;
  const element = library.byId.get(item.itemId);
  if (element === undefined) return false;
  return element.identity.type === "Magic Item";
}

/**
 * Whether an inventory record is a control item rather than gear, and so has
 * no place on any of the sheet's item surfaces.
 *
 * The corpus uses `type="Item"` elements as on/off switches — the Tasha's
 * optional class features, the `Additional …` grant proxies, Supernatural
 * Gifts — and marks them `inventory-hidden`; the optional class features say
 * so in their own description ("It remains hidden from the inventory on your
 * character sheet"). `isPhysicalEquipment` is the engine's standing test for
 * that distinction and is what the client's equipment tab filters on.
 *
 * An item whose element does not resolve stays visible: an uninstalled content
 * pack must not silently erase the gear a character is carrying. The engine's
 * own synthesized proxies classify as non-physical, but they are matched by id
 * as well so an unresolvable one cannot leak either.
 */
function isHiddenInventoryItem(
  item: CharacterState["items"][number] | undefined,
  library: ElementLibrary,
): boolean {
  if (item === undefined) return false;
  if (item.itemId.includes("INTERNAL_ITEM")) return true;
  const element = library.byId.get(item.itemId);
  return element !== undefined && !isPhysicalEquipment(element);
}

/** The item's authored category setter ("Treasure", "Adventuring Gear", …). */
function itemCategory(item: { itemId: string }, library: ElementLibrary): string {
  const element = library.byId.get(item.itemId);
  return element?.setters.find((setter) => setter.name === "category")?.value ?? "";
}

function effectiveItemElement(
  item: CharacterState["items"][number],
  library: ElementLibrary,
): ParsedElement | undefined {
  if (item.adorners.length > 0) {
    const adorner = library.byId.get(item.adorners[0]!);
    if (adorner !== undefined) return adorner;
  }
  return library.byId.get(item.itemId);
}

function itemDisplayName(item: CharacterState["items"][number], library: ElementLibrary): string {
  let name = library.byId.get(item.itemId)?.identity.name ?? item.name;
  if (item.adorners.length > 0) {
    const adorner = library.byId.get(item.adorners[0]!);
    if (adorner !== undefined) {
      const format = adorner.setters.find((setter) => setter.name === "name-format")?.value;
      const parent = library.byId.get(item.itemId)?.identity.name ?? item.name;
      const enhancement = adorner.setters.find((setter) => setter.name === "enhancement")?.value;
      name = format
        ? format.replace("{{parent}}", parent).replace("{{enhancement}}", enhancement ?? "")
        : adorner.identity.name;
    }
  }
  return name.replace(/\s+/g, " ").trim();
}

function itemRow(
  item: InventoryItemDto,
  library: ElementLibrary,
  stateItem: { adorners: string[] } | undefined,
): SheetRow {
  let name = item.name;
  if (stateItem !== undefined && stateItem.adorners.length > 0) {
    const adorner = library.byId.get(stateItem.adorners[0]!);
    if (adorner !== undefined) {
      const format = adorner.setters.find((s) => s.name === "name-format")?.value;
      const parent = library.byId.get(item.itemId)?.identity.name ?? item.name;
      const enhancement = adorner.setters.find((s) => s.name === "enhancement")?.value;
      name = format
        ? format.replace("{{parent}}", parent).replace("{{enhancement}}", enhancement ?? "")
        : adorner.identity.name;
      name = name.replace(/\s+/g, " ").trim();
    }
  }
  const nameTokens = name.split(/\s+/).filter((token) => token !== "");
  // Equipped items bracket the first word of the name ("[Chain Mail]").
  const tokens = item.isEquipped || item.isAttuned
    ? nameTokens.length === 1
      ? [`[${nameTokens[0]}]`]
      : [`[${nameTokens[0]}`, ...nameTokens.slice(1, -1), `${nameTokens[nameTokens.length - 1]}]`]
    : nameTokens;
  const rawWeight = item.weight?.trim() ?? "";
  const weight = weightNumber(item.weight);
  // The weight column shows the stack total (amount x unit weight).
  const weightTokens = weight > 0
    ? [weightToken(Math.round(weight * item.amount * 100) / 100)]
    : rawWeight === "\u2014" || item.isAttunable
      ? ["\u2014"]
      : [];
  return {
    kind: "tokens",
    tokens: [...tokens, `${item.amount}`, ...weightTokens].filter((token) => token !== ""),
  };
}

function weightToken(weight: number): string {
  return `${weight}`.replace(/^0(?=\.)/, "");
}

function weightNumber(weight: string | null): number {
  if (weight === null || weight.trim() === "" || weight.trim() === "—") return 0;
  const match = /^([\d½¼¾]+(?:\s*\/\s*[\d½¼¾]+)?)/.exec(weight.trim());
  if (match === null) return 0;
  const text = match[1]!;
  const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  if (FRACTIONS[text] !== undefined) return FRACTIONS[text]!;
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction !== null) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : 0;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function weightDisplay(weight: string): string {
  const match = /^([\d½¼¾]+(?:\s*\/\s*[\d½¼¾]+)?)/.exec(weight.trim());
  return match === null ? `${weightNumber(weight)}` : match[1]!.replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Spellcasting pages
// ---------------------------------------------------------------------------

const SPELL_PAGE_TOP_ROWS = 57;
/** The archetype element name per class (for "Druid, Circle of the Stars"). */
/** Registered archetype id -> display name. */
function archetypeNames(state: CharacterState, library: ElementLibrary): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: readonly TreeElement[]): void => {
    for (const node of nodes) {
      if (node.type === "Archetype" && node.registered !== undefined && node.registered !== "") {
        const element = library.byId.get(node.registered);
        map.set(node.registered, element?.identity.name ?? node.name);
      }
      walk(node.children);
    }
  };
  walk(state.elements);
  return map;
}

/** Caster name -> its registered archetype id, via the tree ancestry. */
function classArchetypes(state: CharacterState): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: readonly TreeElement[], classId: string | null): void => {
    for (const node of nodes) {
      const nextClass = node.type === "Class" && node.registered !== undefined && node.registered !== ""
        ? node.registered
        : node.type === "Multiclass" && node.registered !== undefined && node.registered !== ""
          ? node.registered
          : classId;
      if (node.type === "Archetype" && node.registered !== undefined && node.registered !== "" && nextClass !== null) {
        map.set(nextClass, node.registered);
      }
      walk(node.children, nextClass);
    }
  };
  walk(state.elements, null);
  return map;
}

function casterDisplayName(state: CharacterState, library: ElementLibrary, caster: SpellcasterDto): string {
  // A feature caster is already named for its feature ("Magic Initiate
  // (Cleric)"); the single-archetype fallback below would append the
  // character's subclass to it.
  if (caster.kind === "feature") return caster.name;
  const classMap = classArchetypes(state);
  const byClass = new Map<string, string>();
  for (const [classId, archetypeId] of classMap) {
    const classElement = library.byId.get(classId);
    if (classElement !== undefined) byClass.set(classElement.identity.name, archetypeId);
  }
  const archetypes = archetypeNames(state, library);
  const archetypeId = byClass.get(caster.name);
  if (archetypeId !== undefined) {
    const name = archetypes.get(archetypeId);
    if (name !== undefined) return `${caster.name}, ${name}`;
  }
  if (archetypes.size === 1 && state.archetype !== "") {
    return `${caster.name}, ${state.archetype}`;
  }
  return caster.name;
}

const MULTICLASS_SLOTS: readonly (readonly number[])[] = [
  [],
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

function sheetSlots(state: CharacterState, caster: SpellcasterDto): readonly number[] {
  if (state.magic?.multiclass !== true) return caster.slotsPerLevel;
  const block = state.magic.casters.find((entry) => entry.name === caster.name);
  if (block?.source.includes("PACT_MAGIC") === true) return caster.slotsPerLevel;
  const level = Number.parseInt(state.magic.level ?? "0", 10);
  return MULTICLASS_SLOTS[Math.min(Math.max(level, 0), 20)] ?? [];
}

interface SpellGridGeometry {
  bottom: number;
  previousHeight: number;
}

const SPELL_GRID_LABELS: ReadonlyArray<readonly [number, number, number, number]> = [
  [280, 555, 480, 496],
  [280, 555, 712, 728],
  [35, 90, 645, 660],
  [35, 115, 596, 612],
  [35, 115, 380, 396],
  [35, 115, 128, 144],
];

function spellGridCell(index: number, sectionTop: number): { x: number; y: number } {
  if (index < 2) return { x: index === 0 ? 235 : 424, y: sectionTop - 23 };
  const gridIndex = index - 2;
  return {
    x: [46, 235, 424][gridIndex % 3]!,
    y: sectionTop - 35 - Math.floor(gridIndex / 3) * 12,
  };
}

function gridCellIsCanonicalLabel(index: number, sectionTop: number): boolean {
  const cell = spellGridCell(index, sectionTop);
  return SPELL_GRID_LABELS.some(([x0, x1, y0, y1]) =>
    x0 <= cell.x && cell.x < x1 && y0 <= cell.y && cell.y < y1,
  );
}

function advanceSpellGrid(geometry: SpellGridGeometry, spellCount: number): { sectionTop: number; next: SpellGridGeometry } {
  const sectionTop = geometry.bottom - (geometry.previousHeight === 100 ? 10 : 0);
  const middleRows = spellCount > 5 ? Math.ceil((spellCount - 5) / 3) : 0;
  return {
    sectionTop,
    next: { bottom: sectionTop - 48 - middleRows * 12, previousHeight: 24 },
  };
}

function buildSpellListPages(state: CharacterState, library: ElementLibrary, casters: readonly SpellcasterDto[]): SheetPage[] {
  const pages: SheetPage[] = [];
  interface MutableSection {
    title: string;
    rows: SheetRow[];
  }
  let pageSections: MutableSection[] = [];
  let pageSpellcasting: SheetSpellcasterLayout[] = [];
  let row = 0;
  let gridGeometry: SpellGridGeometry = { bottom: 682, previousHeight: 100 };
  const flush = (): void => {
    if (pageSections.length > 0) {
      pages.push({
        page: pages.length + 1,
        templateKind: "spell-list",
        sections: pageSections,
        spellcasting: pageSpellcasting,
      });
      pageSections = [];
      pageSpellcasting = [];
      gridGeometry = { bottom: 682, previousHeight: 100 };
    }
  };
  /** Merged per-page section: caster blocks sharing a page append rows to the
   * same section (canonicalization is per page, not per caster). */
  const section = (title: string): MutableSection => {
    let existing = pageSections.find((s) => s.title === title);
    if (existing === undefined) {
      existing = { title, rows: [] };
      const rank = title === "caster-summary" ? 0
        : title === "caster-name" ? 1
          : title === "cantrips" ? 2
            : title === "spells" ? 3
              : title.startsWith("spells-") ? 3 + Number.parseInt(title.slice(7), 10)
                : Number.POSITIVE_INFINITY;
      const index = pageSections.findIndex((candidate) => {
        const candidateRank = candidate.title === "caster-summary" ? 0
          : candidate.title === "caster-name" ? 1
            : candidate.title === "cantrips" ? 2
              : candidate.title === "spells" ? 3
                : candidate.title.startsWith("spells-") ? 3 + Number.parseInt(candidate.title.slice(7), 10)
                  : Number.POSITIVE_INFINITY;
        return candidateRank > rank;
      });
      if (index === -1) pageSections.push(existing);
      else pageSections.splice(index, 0, existing);
    }
    return existing;
  };
  const levelTokens = (level: {
    prepared: KnownSpellDto[];
    full: KnownSpellDto[];
  }, sectionTop: number): string[] => {
    const prepared = [...level.prepared].sort((a, b) => a.name.localeCompare(b.name));
    const spells = [...prepared, ...level.full];
    const tokens: string[] = [];
    for (let index = 0; index < spells.length; index++) {
      // Fixed template labels remove overlapping PDF cells from the canonical
      // stream; the underlying spell registration is intentionally untouched.
      if (gridCellIsCanonicalLabel(index, sectionTop)) continue;
      const spell = spells[index]!;
      if (index < prepared.length) tokens.push(PREPARED_MARK);
      tokens.push(...spell.name.split(/\s+/));
      if (index < prepared.length && spell.isAlwaysPrepared) tokens.push("(Always", "Prepared)");
      // A feature spell also carries its free-cast allowance ("(1/Long Rest)").
      if (spell.usage !== undefined && spell.usage !== null && spell.usage !== "") {
        tokens.push(...`(${spell.usage})`.split(/\s+/));
      }
    }
    return tokens;
  };
  for (const caster of casters) {
    const name = casterDisplayName(state, library, caster);
    const spells = uniqueSpellNames(caster.knownSpells);
    const slotsPerLevel = casters.length === 1 ? caster.slotsPerLevel : sheetSlots(state, caster);
    const cantrips = spells.filter((spell) => spell.level === 0);
    const levels: Array<{
      level: number;
      slots: number;
      rows: number;
      prepared: KnownSpellDto[];
      full: KnownSpellDto[];
    }> = [];
    for (let level = 1; level <= 9; level++) {
      const slots = slotsPerLevel[level - 1] ?? 0;
      const knownAtLevel = spells.filter((spell) => spell.level === level);
      // A feature caster has no slots of its own (its level-1 spell is cast
      // free once per long rest, or from another caster's slots), so its
      // levels are admitted on known spells alone.
      const slotless = caster.resource.mode === "spellPoints" || caster.kind === "feature";
      if (slots <= 0 && !(slotless && knownAtLevel.length > 0)) continue;
      const prepared = spells.filter(
        (spell) => spell.level === level && (spell.isPrepared || spell.isAlwaysPrepared),
      );
      const full = spells.filter(
        (spell) => spell.level === level && !spell.isPrepared && !spell.isAlwaysPrepared,
      );
      levels.push({ level, slots, rows: Math.ceil((1 + prepared.length + full.length) / 3), prepared, full });
    }
    // A caster without cantrips absorbs its first spell level into the
    // cantrips section (observed: the Paladin's 1st-level spells
    // render under CANTRIPS).
    const absorbFirstLevel = cantrips.length === 0 && levels.length > 0;
    const cantripRows = absorbFirstLevel ? levels[0]!.rows : Math.ceil((1 + cantrips.length) / 3);
    // The spell point reference block (title, level/cost table, footnote)
    // consumes 38pt between the header and the first section.
    const spellPointRows = caster.resource.mode === "spellPoints" ? 38 / 12 : 0;
    const casterHeaderRows = 1 + 2.5 + 1 + 4.5 + cantripRows + 3 + spellPointRows;
    if (row + casterHeaderRows > SPELL_PAGE_TOP_ROWS + 0.001 && pageSections.length > 0) {
      flush();
      row = 0;
    }
    if (pageSections.length > 0) {
      gridGeometry = { bottom: gridGeometry.bottom - 130, previousHeight: 100 };
    }
    const prepareCount = caster.requiresPreparation ? `${caster.prepareCount}` : "N/A";
    // The layout carries only sections actually placed on its page, so the PDF
    // writer never draws a level block the page metrics rejected.
    const emitCasterHeader = (): SheetSpellListSection[] => {
      const sections: SheetSpellListSection[] = [];
      pageSpellcasting.push({
        name,
        ability: caster.ability,
        attackBonus: signed(caster.attackModifier),
        saveDc: `${caster.saveDc}`,
        prepareCount,
        resource: caster.resource,
        sections,
      });
      section("caster-summary").rows.push({
        kind: "tokens",
        tokens: [
          caster.ability,
          `${signed(caster.attackModifier)}`,
          `${caster.saveDc}`,
          prepareCount,
          ...(caster.resource.mode === "spellPoints"
            ? [`${caster.resource.currentPoints}`, "SPELL", "POINTS"]
            : []),
        ],
      });
      row += 1 + 2.5;
      section("caster-name").rows.push({ kind: "tokens", tokens: name.split(/\s+/) });
      row += 1 + 4.5 + spellPointRows;
      return sections;
    };
    const levelSection = (level: {
      level: number;
      slots: number;
      prepared: KnownSpellDto[];
      full: KnownSpellDto[];
    }): SheetSpellListSection => ({
      level: level.level,
      slots: level.slots,
      spells: [...level.prepared, ...level.full].map((spell) => ({
        name: spell.name,
        prepared: spell.isPrepared,
        alwaysPrepared: spell.isAlwaysPrepared,
      })),
    });
    let layoutSections = emitCasterHeader();
    layoutSections.push({
      level: 0,
      slots: 0,
      spells: cantrips.map((spell) => ({
        name: spell.name,
        prepared: spell.isPrepared,
        alwaysPrepared: spell.isAlwaysPrepared,
      })),
    });
    if (absorbFirstLevel) {
      const first = levels.shift()!;
      const grid = advanceSpellGrid(gridGeometry, first.prepared.length + first.full.length);
      gridGeometry = grid.next;
      section("cantrips").rows.push({ kind: "tokens", tokens: levelTokens(first, grid.sectionTop) });
      layoutSections.push(levelSection(first));
    } else {
      if (cantrips.length > 0) gridGeometry = advanceSpellGrid(gridGeometry, cantrips.length).next;
      section("cantrips").rows.push({
        kind: "tokens",
        tokens: cantrips.flatMap((spell) => spell.name.split(/\s+/)),
      });
    }
    row += cantripRows + 3;
    for (const level of levels) {
      if (row + level.rows + 3 > SPELL_PAGE_TOP_ROWS + 0.001 && pageSections.length > 0) {
        // The level block moves whole to a continuation page (it is never
        // split and never dropped); the caster header is stamped again there.
        flush();
        row = 0;
        layoutSections = emitCasterHeader();
      }
      const grid = advanceSpellGrid(gridGeometry, level.prepared.length + level.full.length);
      gridGeometry = grid.next;
      section(`spells-${level.level}`).rows.push({
        kind: "tokens",
        tokens: levelTokens(level, grid.sectionTop),
      });
      layoutSections.push(levelSection(level));
      row += level.rows + 3;
    }
  }
  flush();
  return pages;
}

function buildSpellDescriptionPages(
  state: CharacterState,
  library: ElementLibrary,
  casters: readonly SpellcasterDto[],
  canonical: boolean,
): SheetPage[] {
  // Description cards are a projection of active spell identities, not the
  // complete DTO class lists. Cantrips are active by registration; prepared
  // (or always-prepared) non-cantrips are active for prepared casters, while
  // pact/known casters expose their complete known spell entries.
  const union = new Map<string, SpellDescriptionEntry>();
  const casterByName = new Map(casters.map((caster) => [caster.name, caster]));
  const add = (spell: KnownSpellDto, caster: SpellcasterDto | null, additionalSource?: string): void => {
    const existing = union.get(spell.id);
    if (
      existing === undefined ||
      (existing.caster?.requiresPreparation === true && caster?.requiresPreparation === false) ||
      (existing.caster?.requiresPreparation === caster?.requiresPreparation && spell.isPrepared)
    ) {
      union.set(spell.id, { spell, caster, additionalSource });
    }
  };
  const dtoFor = (caster: SpellcasterDto, id: string): KnownSpellDto | undefined =>
    caster.knownSpells.find((spell) => spell.id === id);
  for (const block of state.magic?.casters ?? []) {
    const caster = casterByName.get(block.name) ?? null;
    if (caster === null) continue;
    for (const raw of block.cantrips) {
      const spell = dtoFor(caster, raw.id) ?? knownSpellFromLibrary(library, raw.id);
      if (spell !== undefined && spell.level === 0) add(spell, caster);
    }
    for (const raw of block.spells) {
      const spell = dtoFor(caster, raw.id) ?? knownSpellFromLibrary(library, raw.id);
      if (spell === undefined) continue;
      if (!caster.requiresPreparation || raw.prepared || raw.alwaysPrepared || spell.isPrepared || spell.isAlwaysPrepared) {
        add(spell, caster);
      }
    }
  }
  // Registered spell identities include always-prepared grants that may not
  // carry a prepared flag in the persisted magic block, and every feature
  // caster's spells — a character can have those with no magic region at all.
  for (const registered of state.sum.elements) {
    if (registered.type !== "Spell") continue;
    for (const caster of casters) {
      const spell = dtoFor(caster, registered.id);
      if (spell !== undefined) {
        add(spell, caster);
        break;
      }
    }
  }
  for (const extra of state.magic?.additional ?? []) {
    const spell = knownSpellFromLibrary(library, extra.id, extra.name, extra.level);
    if (spell !== undefined) add(spell, null, extra.source);
  }
  const entries = [...union.values()].sort(
    (left, right) =>
      left.spell.level - right.spell.level ||
      left.spell.name.localeCompare(right.spell.name) ||
      left.spell.source.localeCompare(right.spell.source),
  );
  const pages: SheetPage[] = [];
  for (let i = 0; i < entries.length; i += 9) {
    const slice = entries.slice(i, i + 9);
    const cards = slice.map((entry) => spellDescriptionCard(state, library, entry));
    const positioned = descriptionCardRuns(cards);
    const canonicalPositioned = canonical ? descriptionCardRuns(cards, { richText: false }) : undefined;
    pages.push({
      page: pages.length + 1,
      templateKind: "spell-cards",
      sections: slice.map((entry, card) => {
        const element = library.byId.get(entry.spell.id);
        const origin = spellOriginLabel(state, entry);
        return {
          title: "spell-description",
          rows: descriptionPageRows(entry.spell, element, origin),
          positionedRuns: positioned.filter((run) => run.card === card),
          ...(canonicalPositioned === undefined
            ? {}
            : { canonicalRuns: canonicalPositioned.filter((run) => run.card === card) }),
        };
      }),
    });
  }
  return pages;
}

interface SpellDescriptionEntry {
  spell: KnownSpellDto;
  caster: SpellcasterDto | null;
  additionalSource?: string;
}

function knownSpellFromLibrary(
  library: ElementLibrary,
  id: string,
  name?: string,
  level?: string,
): KnownSpellDto | undefined {
  const info = spellInfo(library, id);
  if (info === null) return undefined;
  return {
    id: info.id,
    name: name ?? info.name,
    source: info.source,
    isPrepared: false,
    isChosen: true,
    level: level === undefined ? info.level : Number.parseInt(level, 10) || info.level,
    school: info.school,
    isRitual: info.isRitual,
    isConcentration: info.isConcentration,
    isAlwaysPrepared: false,
    castingTime: info.castingTime,
    components: info.components,
    range: info.range,
    duration: info.duration,
    description: info.description,
  };
}

function spellOriginLabel(state: CharacterState, entry: SpellDescriptionEntry): string {
  if (entry.additionalSource !== undefined) return entry.additionalSource;
  if (entry.caster === null) return "Spellcasting";
  // A feature caster's card is filed under the feature that granted it.
  if (entry.caster.kind === "feature") return entry.caster.name;
  const caster = entry.caster.name;
  if (entry.spell.isAlwaysPrepared) {
    const archetype = state.archetype ?? "";
    return resolveSpellCardOrigin({
      caster,
      requiresPreparation: entry.caster.requiresPreparation,
      prepared: entry.spell.isPrepared,
      alwaysPrepared: true,
      alwaysPreparedLabel: archetype.startsWith("Oath") ? `Oath Spells (${caster})` : `Domain Spells (${caster})`,
    });
  }
  return resolveSpellCardOrigin({
    caster,
    requiresPreparation: entry.caster.requiresPreparation,
    prepared: entry.spell.isPrepared,
    alwaysPrepared: false,
    pactMagic: state.magic?.casters.find((block) => block.name === caster)?.source.includes("PACT_MAGIC") === true,
  });
}

function setterValue(element: ParsedElement | undefined, name: string): string {
  return element?.setters.find((setter) => setter.name === name)?.value ?? "";
}

function spellDescriptionCard(state: CharacterState, library: ElementLibrary, entry: SpellDescriptionEntry): DescriptionCard {
  const element = library.byId.get(entry.spell.id);
  const ordinal = ordinalLevel(entry.spell.level);
  const school = entry.spell.level === 0 ? entry.spell.school : entry.spell.school.toLowerCase();
  const ritual = entry.spell.isRitual ? " (ritual)" : "";
  const subtitle = entry.spell.level === 0 ? `${school} Cantrip${ritual}` : `${ordinal}-level ${school}${ritual}`;
  const info = spellInfo(library, entry.spell.id);
  const duration = setterValue(element, "duration");
  const concentration = setterValue(element, "isConcentration") === "true" && duration !== "" && !/^Concentration\b/.test(duration)
    ? `Concentration, up to ${duration}`
    : duration;
  return {
    kind: "spell",
    title: entry.spell.name,
    subtitle,
    metadata: [
      ["CASTING TIME", info?.castingTime ?? entry.spell.castingTime],
      ["RANGE", setterValue(element, "range")],
      ["DURATION", concentration],
      ["COMPONENTS", info?.components ?? ""],
    ],
    body: element?.descriptionXml ?? "",
    footer: spellOriginLabel(state, entry),
    footerRight: entry.spell.source,
  };
}

// ---------------------------------------------------------------------------
function descriptionPageRows(
  spell: KnownSpellDto,
  element: ParsedElement | undefined,
  origin: string,
): SheetRow[] {
  const rows: SheetRow[] = [{ kind: "tokens", tokens: spell.name.split(/\s+/) }];
  const ordinal = ordinalLevel(spell.level);
  const school = spell.level === 0 ? spell.school : spell.school.toLowerCase();
  const ritual = spell.isRitual ? " (ritual)" : "";
  const levelHeading = spell.level === 0 ? `${school} Cantrip${ritual}` : `${ordinal}-level ${school}${ritual}`;
  rows.push({ kind: "tokens", tokens: levelHeading.split(/\s+/) });
  if (element !== undefined) {
    const text = stripXml(element.descriptionXml ?? "");
    rows.push(...wrapDescriptionLines(text).map((line) => ({ kind: "tokens" as const, tokens: line.split(/\s+/) })));
  } else {
    rows.push({ kind: "tokens", tokens: [] });
  }
  rows.push({ kind: "tokens", tokens: [...origin.split(/\s+/), ...spell.source.split(/\s+/)] });
  return rows;
}

function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapDescriptionLines(text: string, width = 13): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += width) lines.push(words.slice(i, i + width).join(" "));
  return lines;
}

function ordinalLevel(level: number): string {
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${level}${suffixes[level] ?? "th"}`;
}

// ---------------------------------------------------------------------------
// Item description page (full only)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

function buildItemDescriptionPage(state: CharacterState, library: ElementLibrary, canonical: boolean): SheetPage | null {
  const items: Array<{ name: string; category: string; description: string; descriptionHtml: string; weight: string; source: string }> = [];
  for (const item of state.items) {
    if (!item.card) continue;
    if (isHiddenInventoryItem(item, library)) continue;
    const base = library.byId.get(item.itemId);
    const element = effectiveItemElement(item, library);
    if (base === undefined || element === undefined) continue;
    const rawDescription = stripXml(element.descriptionXml ?? "");
    const weightSetter = base.setters.find((s) => s.name === "weight")?.value;
    const categorySetter = base.setters.find((s) => s.name === "category")?.value;
    items.push({
      name: itemDisplayName(item, library),
      category: categorySetter ?? "",
      description: rawDescription,
      descriptionHtml: element.descriptionXml ?? "",
      weight: weightSetter ?? "",
      source: element.identity.source,
    });
  }
  if (items.length === 0) return null;
  const cards: DescriptionCard[] = items.map((item) => ({
    kind: "generic",
    title: item.name,
    subtitle: item.category,
    metadata: [],
    body: item.descriptionHtml,
    footer: item.weight,
    footerRight: item.source,
  }));
  const positioned = descriptionCardRuns(cards);
  const canonicalPositioned = canonical ? descriptionCardRuns(cards, { richText: false }) : undefined;
  const sections: SheetSection[] = items.map((item, card) => ({
    title: "item-description",
    positionedRuns: positioned.filter((run) => run.card === card),
    ...(canonicalPositioned === undefined
      ? {}
      : { canonicalRuns: canonicalPositioned.filter((run) => run.card === card) }),
    rows: [
      { kind: "tokens", tokens: item.name.split(/\s+/) },
      { kind: "tokens", tokens: item.category.split(/\s+/) },
      ...(item.description === "" ? [] : wrapDescriptionLines(item.description).map((line) => ({ kind: "tokens" as const, tokens: line.split(/\s+/) }))),
      {
        kind: "tokens",
        tokens: [
          ...(item.weight !== "" ? [weightDisplay(item.weight), "lb."] : []),
          ...item.source.split(/\s+/),
        ],
      },
    ],
  }));
  return { page: 1, templateKind: "item-cards", sections };
}
