/**
 * The form-to-element compiler: a validated draft becomes an ordinary
 * `<element>` the parser, library, statistics, selection engine and sheet
 * already understand. Nothing downstream knows custom content exists.
 *
 * Block to rule mapping (design section 4):
 *   modifier -> `<stat name value bonus maximum level equipped requirements condition alt>`
 *   grant    -> `<grant type id|name level requirements spellcasting prepared>`
 *   choice   -> `<select type name number level requirements supports optional spellcasting>`
 *   sheet    -> `<sheet alt action usage><description level>`
 *   tags     -> `<supports>`; requirements tree -> `<requirements>` and `<prerequisite>`
 */

import { engineError } from "../errors.js";
import { SHEET_ACTION_OPTIONS, elementTypeFor, modifierTarget } from "./catalogue.js";
import { compileFilter, compileRequirements, describeRequirements } from "./conditions.js";
import {
  CUSTOM_SOURCE_NAME,
  isCustomItemDraft,
  isCustomSpellDraft,
  type ChoiceBlock,
  type CustomBlock,
  type CustomDraft,
  type CustomEntryDraft,
  type CustomItemDraft,
  type CustomSpellDraft,
  type CustomValue,
  type GrantBlock,
  type ModifierBlock,
  type ModifierGates,
} from "./schema.js";
import { customEntryIssues } from "./validate.js";

export interface CompileOptions {
  /**
   * The element id to emit. Defaults to the draft's own id, which is the
   * stable id the element keeps for life; override it only to build a copy.
   */
  id?: string;
  /**
   * The source name the element carries. The engine matches sources by name,
   * so a pack passes its own name here; characters' own entries use "Custom".
   */
  source?: string;
}

const ABILITY_TITLE: Record<string, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

export function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Plain text as `<p>` paragraphs; blank lines separate them. */
function paragraphs(text: string): string {
  const value = text.trim();
  if (value === "") return "";
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeText(paragraph.replace(/\s*\n\s*/g, " ").trim())}</p>`)
    .join("");
}

function attributes(pairs: ReadonlyArray<readonly [string, string | number | undefined]>): string {
  return pairs
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join("");
}

function valueText(value: CustomValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value);
    case "reference":
      return `${value.negate === true ? "-" : ""}${value.ref}`;
    case "classLevel":
      return `${value.negate === true ? "-" : ""}level:${value.className.toLowerCase()}`;
  }
}

function equippedExpression(gates: ModifierGates | undefined): string | undefined {
  const list = gates?.equipped ?? [];
  if (list.length === 0) return undefined;
  return list.map((gate) => `${gate.negate === true ? "!" : ""}[${gate.slot}:${gate.value.toLowerCase()}]`).join(",");
}

/** The attributes every rule of a gated modifier shares. */
function gateAttributes(gates: ModifierGates | undefined): Array<readonly [string, string | number | undefined]> {
  const requirements = gates?.requirements === undefined ? "" : compileRequirements(gates.requirements);
  return [
    ["level", gates?.level],
    ["equipped", equippedExpression(gates)],
    ["requirements", requirements],
    ["condition", gates?.switch?.trim()],
  ];
}

function statLine(
  name: string,
  value: string,
  extra: Array<readonly [string, string | number | undefined]>,
): string {
  return `<stat${attributes([["name", name], ["value", value], ...extra])} />`;
}

function modifierRules(block: ModifierBlock): string[] {
  const target = modifierTarget(block.target)!;
  const gates = gateAttributes(block.gates);
  const alt: Array<readonly [string, string | undefined]> = [["alt", block.label?.trim()]];
  const bucket = block.mode === "bestOf" ? (block.bucket ?? target.defaultBucket) : undefined;

  if (target.id === "ac:calculation") {
    // A calculation is the engine's own pattern: helper keys accumulate the
    // formula, and the `calculation` bucket keeps the best candidate against
    // the armor and unarmored chains. The helper key is private to this block.
    const key = `ac:custom ${block.id.toLowerCase().replaceAll(/[^a-z0-9]/g, "")}`;
    const lines = [statLine(key, valueText(block.value), gates)];
    for (const ability of block.addAbilities ?? []) lines.push(statLine(key, `${ability}:modifier`, gates));
    lines.push(statLine("ac:calculation", key, [["bonus", "calculation"], ...gates, ...alt]));
    return lines;
  }

  let name = block.target;
  let bonus: string | undefined = bucket;
  if (block.mode === "setBase") {
    bonus = "base";
    // An ability's "set" is its own key; the plain key adds to the score.
    if (target.group === "Ability scores") name = `${block.target}:score:set`;
  }
  return [
    statLine(name, valueText(block.value), [
      ["maximum", block.cap === undefined ? undefined : valueText(block.cap)],
      ["bonus", bonus],
      ...gates,
      ...alt,
    ]),
  ];
}

function grantRule(block: GrantBlock): string {
  const target = block.target;
  const spell = block.spell;
  return `<grant${attributes([
    ["type", target.type],
    ["id", target.by === "id" ? target.id : undefined],
    ["name", target.by === "name" ? target.name : undefined],
    ["level", block.level],
    ["requirements", block.requirements === undefined ? "" : compileRequirements(block.requirements)],
    ["spellcasting", spell?.caster],
    ["prepared", spell?.prepared === true ? "true" : undefined],
  ])} />`;
}

function choiceRule(block: ChoiceBlock): string {
  const attrs = attributes([
    ["type", block.type],
    ["name", block.name.trim()],
    ["number", block.count > 1 ? block.count : undefined],
    ["level", block.level],
    ["requirements", block.requirements === undefined ? "" : compileRequirements(block.requirements)],
    ["supports", compileFilter(block.supports)],
    ["optional", block.optional === true ? "true" : undefined],
    ["spellcasting", block.caster],
  ]);
  if (block.items === undefined) return `<select${attrs} />`;
  const items = block.items.map((item, index) => `<item id="${index + 1}">${escapeText(item.trim())}</item>`);
  return `<select${attrs}>${items.join("")}</select>`;
}

/** The sheet block: B6. Always emitted, because an element without one prints nowhere. */
function sheetBlock(draft: CustomDraft, usageFromSpells: string | undefined): string {
  const sheet = draft.sheet ?? {};
  if (sheet.show === false) return `<sheet display="false" />`;
  const action = SHEET_ACTION_OPTIONS.find((option) => option.id === (sheet.action ?? "none"))!.text;
  const usage = sheet.usage?.trim() || usageFromSpells;
  const text = sheet.text?.trim() ? sheet.text.trim() : draft.description.trim().replace(/\s*\n+\s*/g, " ");
  const descriptions = [`<description>${escapeText(text)}</description>`];
  for (const tier of [...(sheet.tiers ?? [])].sort((left, right) => left.level - right.level)) {
    descriptions.push(`<description level="${tier.level}">${escapeText(tier.text.trim())}</description>`);
  }
  return `<sheet${attributes([["alt", sheet.title?.trim()], ["action", action], ["usage", usage]])}>${descriptions.join("")}</sheet>`;
}

/**
 * The element XML for a draft. Throws an `invalid-argument` error naming the
 * first problem (all of them are in `details.issues`) when the draft is
 * invalid.
 */
export function compileCustomElement(draft: CustomEntryDraft, options: CompileOptions = {}): string {
  const issues = customEntryIssues(draft);
  if (issues.length > 0) {
    throw engineError(
      "invalid-argument",
      `cannot compile '${draft.name}': ${issues[0]!.path === "" ? "" : `${issues[0]!.path}: `}${issues[0]!.message}`,
      { issues },
    );
  }
  try {
    if (isCustomSpellDraft(draft)) return compileValidatedSpell(draft, options);
    return isCustomItemDraft(draft) ? compileValidatedItem(draft, options) : compileValidated(draft, options);
  } catch (cause) {
    // A draft that passed validation but still cannot be written (an expression
    // the engine's own syntax check refuses) is the author's to fix, like any other.
    throw engineError("invalid-argument", `cannot compile '${draft.name}': ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function compileValidated(draft: CustomDraft, options: CompileOptions): string {
  const id = options.id ?? draft.id;
  const source = options.source ?? CUSTOM_SOURCE_NAME;
  const rules: string[] = [];
  let castAbility: string | undefined;
  let spellUsage: string | undefined;
  for (const block of draft.blocks) {
    if (block.kind === "modifier") rules.push(...modifierRules(block));
    else if (block.kind === "grant") {
      rules.push(grantRule(block));
      castAbility ??= block.spell?.castAbility;
      spellUsage ??= block.spell?.usage?.trim() || undefined;
    } else {
      rules.push(choiceRule(block));
      castAbility ??= block.castAbility;
    }
  }

  const children: string[] = [];
  const tags = (draft.tags ?? []).map((tag) => tag.trim());
  if (tags.length > 0) children.push(`<supports>${escapeText(tags.join(", "))}</supports>`);
  const requirements = compileRequirements(draft.requirements);
  if (requirements !== "") {
    children.push(`<prerequisite>${escapeText(describeRequirements(draft.requirements))}</prerequisite>`);
    children.push(`<requirements>${escapeText(requirements)}</requirements>`);
  }
  children.push(`<description>${paragraphs(draft.description)}</description>`);
  children.push(sheetBlock(draft, spellUsage));

  const setters: string[] = [];
  if (draft.ruleset !== undefined) setters.push(`<set name="ruleset">${draft.ruleset}</set>`);
  if (castAbility !== undefined) setters.push(`<set name="spellcasting ability">${ABILITY_TITLE[castAbility]}</set>`);
  if (setters.length > 0) children.push(`<setters>${setters.join("")}</setters>`);
  if (rules.length > 0) children.push(`<rules>${rules.join("")}</rules>`);

  const open = `<element${attributes([
    ["name", draft.name.trim()],
    ["type", elementTypeFor(draft.showsUnder)],
    ["source", source],
    ["id", id],
  ])}>`;
  return [open, ...children.map((line) => `  ${line}`), "</element>"].join("\n");
}

/** The rules a list of blocks compiles to, and the casting ability its spells share. */
function blockRules(blocks: readonly CustomBlock[]): { rules: string[]; castAbility: string | undefined } {
  const rules: string[] = [];
  let castAbility: string | undefined;
  for (const block of blocks) {
    if (block.kind === "modifier") rules.push(...modifierRules(block));
    else if (block.kind === "grant") {
      rules.push(grantRule(block));
      castAbility ??= block.spell?.castAbility;
    } else {
      rules.push(choiceRule(block));
      castAbility ??= block.castAbility;
    }
  }
  return { rules, castAbility };
}

/** `<set name="damage" type="…">` style setter. */
function setter(name: string, value: string | number, extra: Array<readonly [string, string | undefined]> = []): string {
  return `<set${attributes([["name", name], ...extra])}>${escapeText(String(value))}</set>`;
}

const ITEM_CATEGORY: Record<CustomItemDraft["template"], string> = {
  weapon: "Magic Weapons",
  armor: "Magic Armor",
  worn: "Wondrous Items",
  gear: "Adventuring Gear",
};

/** A number as pounds or coins would be written: no trailing zeros. */
const plainNumber = (value: number): string => String(Math.round(value * 1000) / 1000);

/**
 * An item draft: a weapon or armor draft is a Magic Item laid over its base
 * (`weapon` / `armor` setter naming the base by element id), a worn draft is a
 * Magic Item worn on its own, a gear draft is an Item. Everything the engine
 * reads about an item is an ordinary setter or rule, so inventory, equipping,
 * attunement, attack rows and the sheet treat it like any book item.
 */
function compileValidatedItem(draft: CustomItemDraft, options: CompileOptions): string {
  const id = options.id ?? draft.id;
  const source = options.source ?? CUSTOM_SOURCE_NAME;
  const { rules, castAbility } = blockRules(draft.blocks);
  const setters: string[] = [];
  const isGear = draft.template === "gear";
  const slotWord = draft.template === "armor" ? "armor" : "weapon";

  setters.push(setter("category", draft.template === "worn" && draft.slot === "ring" ? "Rings" : ITEM_CATEGORY[draft.template]));
  if (draft.template === "weapon") {
    setters.push(setter("type", "Weapon", [["addition", draft.base!.name]]));
  } else if (draft.template === "armor") {
    setters.push(setter("type", "Armor", [["addition", draft.base!.name]]));
    // Body armor has a slot; a shield is held and has none.
    if (draft.base!.shield !== true) setters.push(setter("slot", "body"));
  } else if (draft.template === "worn") {
    setters.push(setter("type", draft.slot === "ring" ? "Ring" : "Wondrous Item"));
    setters.push(setter("slot", draft.slot!));
  }
  if (draft.rarity !== undefined) setters.push(setter("rarity", draft.rarity));
  if (draft.attunement === true) setters.push(setter("attunement", "true"));
  if (draft.template === "weapon" || draft.template === "armor") setters.push(setter(slotWord, draft.base!.id));
  if (draft.template === "weapon") {
    if ((draft.bonus ?? 0) > 0) setters.push(setter("enhancement", draft.bonus!));
    const weapon = draft.weapon ?? {};
    for (const term of weapon.extraDamage ?? []) setters.push(setter("extra damage", term.dice, [["type", term.type]]));
    if (weapon.attackAbility !== undefined) setters.push(setter("attack ability", ABILITY_TITLE[weapon.attackAbility]!));
    if (weapon.damage !== undefined) setters.push(setter("damage", weapon.damage.dice, [["type", weapon.damage.type]]));
    if (weapon.versatile !== undefined) setters.push(setter("versatile", weapon.versatile));
    if (weapon.range !== undefined) setters.push(setter("range", weapon.range));
    if (weapon.properties !== undefined) setters.push(setter("weapon properties", weapon.properties.join(", ")));
  }
  if (draft.template === "armor" && (draft.bonus ?? 0) > 0) {
    // The armor class bonus is the corpus's own enhancement rule: shields add to
    // the shield bonus, body armor to the armored total, and equal bonuses do not stack.
    const key = draft.base!.shield === true ? "ac:shield" : "ac:armored:enhancement";
    rules.unshift(statLine(key, String(draft.bonus), [["bonus", "enhancement"]]));
  }
  if (draft.weight !== undefined) {
    const pounds = plainNumber(draft.weight);
    setters.push(setter("weight", `${pounds} lb.`, [["lb", pounds]]));
  }
  if (draft.cost !== undefined) setters.push(setter("cost", plainNumber(draft.cost.amount), [["currency", draft.cost.currency]]));
  if (isGear && draft.stackable === true) setters.push(setter("stackable", "true"));
  if (castAbility !== undefined) setters.push(setter("spellcasting ability", ABILITY_TITLE[castAbility]!));
  if (draft.ruleset !== undefined) setters.push(setter("ruleset", draft.ruleset));

  const uses = draft.uses?.trim();
  const description = `${paragraphs(draft.description)}${uses ? `<p>Uses: ${escapeText(uses)}</p>` : ""}`;
  const children = [`<description>${description}</description>`, `<setters>${setters.join("")}</setters>`];
  if (rules.length > 0) children.push(`<rules>${rules.join("")}</rules>`);
  const open = `<element${attributes([
    ["name", draft.name.trim()],
    ["type", isGear ? "Item" : "Magic Item"],
    ["source", source],
    ["id", id],
  ])}>`;
  return [open, ...children.map((line) => `  ${line}`), "</element>"].join("\n");
}

const SPELL_ROLL_WORDS = {
  attackRanged: "ranged attack",
  attackMelee: "melee attack",
  save: "saving throw",
  none: "none",
} as const;

/** The structured-mechanics setters of a spell (`magic/structured-spell.ts` reads them). */
function spellMechanicsSetters(draft: CustomSpellDraft): string[] {
  const mechanics = draft.mechanics;
  if (mechanics === undefined) return [];
  const out = [setter("spell roll", SPELL_ROLL_WORDS[mechanics.roll])];
  if (mechanics.roll === "save") {
    out.push(setter("spell save", ABILITY_TITLE[mechanics.saveAbility!]!));
    if (mechanics.halfOnSave === true) out.push(setter("spell save success", "half"));
  }
  for (const term of mechanics.damage ?? []) out.push(setter("spell damage", term.dice, [["type", term.type]]));
  if (mechanics.healing !== undefined) out.push(setter("spell healing", mechanics.healing));
  if (mechanics.addsModifier === true) out.push(setter("spell modifier", "true"));
  const scaling = mechanics.scaling;
  if (scaling?.kind === "cantrip") {
    for (const tier of [...scaling.tiers].sort((left, right) => left.level - right.level)) {
      out.push(setter("spell cantrip scaling", tier.dice, [["level", String(tier.level)]]));
    }
  } else if (scaling?.kind === "slot") {
    out.push(setter("spell slot scaling", scaling.dice));
  }
  return out;
}

/** The tags a book spell of this shape carries beside its class lists. */
function spellTags(draft: CustomSpellDraft): string[] {
  const mechanics = draft.mechanics;
  if (mechanics === undefined) return [];
  const tags: string[] = [];
  if (mechanics.roll === "attackRanged") tags.push("Spell Attack", "Ranged");
  else if (mechanics.roll === "attackMelee") tags.push("Spell Attack", "Melee");
  else if (mechanics.roll === "save") tags.push("Spell Saving Throw");
  if (mechanics.healing !== undefined) tags.push("Healing Spell");
  return tags;
}

/**
 * A spell draft: a Spell element with the setters every book spell carries,
 * its class lists and shape tags as `supports`, and the structured mechanics
 * as `spell …` setters. The element is Aurora-shaped: a tool that does not know
 * the structured setters reads the rest as it reads any spell.
 */
function compileValidatedSpell(draft: CustomSpellDraft, options: CompileOptions): string {
  const id = options.id ?? draft.id;
  const source = options.source ?? CUSTOM_SOURCE_NAME;
  const components = draft.components;
  const tags = [...(draft.classes ?? []).map((name) => name.trim()), ...spellTags(draft)];

  const descriptions = [paragraphs(draft.description)];
  const higher = draft.higherLevels?.trim();
  if (higher) descriptions.push(`<p class="indent">At Higher Levels. ${escapeText(higher.replace(/\s*\n\s*/g, " "))}</p>`);

  const setters = [
    setter("level", draft.level),
    setter("school", draft.school),
    setter("time", draft.castingTime.trim()),
    setter("duration", draft.duration.trim()),
    setter("range", draft.range.trim()),
    setter("hasVerbalComponent", String(components.verbal === true)),
    setter("hasSomaticComponent", String(components.somatic === true)),
    setter("hasMaterialComponent", String(components.material === true)),
    components.material === true && components.materialText?.trim()
      ? setter("materialComponent", components.materialText.trim())
      : "<set name=\"materialComponent\" />",
    setter("isConcentration", String(draft.concentration === true)),
    setter("isRitual", String(draft.ritual === true)),
    ...(draft.ruleset === undefined ? [] : [setter("ruleset", draft.ruleset)]),
    ...spellMechanicsSetters(draft),
  ];

  const children = [
    ...(tags.length > 0 ? [`<supports>${escapeText(tags.join(", "))}</supports>`] : []),
    `<description>${descriptions.join("")}</description>`,
    `<setters>${setters.join("")}</setters>`,
  ];
  const open = `<element${attributes([
    ["name", draft.name.trim()],
    ["type", "Spell"],
    ["source", source],
    ["id", id],
  ])}>`;
  return [open, ...children.map((line) => `  ${line}`), "</element>"].join("\n");
}

/** One content file holding every draft; the engine ingests it like any pack. */
export function compileCustomPack(drafts: readonly CustomEntryDraft[], options: Pick<CompileOptions, "source"> = {}): string {
  const elements = drafts.map((draft) =>
    compileCustomElement(draft, options.source === undefined ? {} : { source: options.source }),
  );
  return [
    '<?xml version="1.0" encoding="utf-8" ?>',
    "<elements>",
    ...elements.map((element) => element.split("\n").map((line) => `  ${line}`).join("\n")),
    "</elements>",
    "",
  ].join("\n");
}
