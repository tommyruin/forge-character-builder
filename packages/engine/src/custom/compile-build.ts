/**
 * The compilers for the options a character is built from: species, subspecies,
 * class, subclass, background and companion.
 *
 * Each draft compiles to several ordinary elements in the shapes the bundled
 * rules use, so leveling, selection, spellcasting, the sheet and the exports read
 * them like book content:
 *
 *  - a Class holds its rules (starting proficiencies, a grant per feature and
 *    level, choices), a `<multiclass>` block and its features are sibling
 *    `Class Feature` elements; the ability score improvements are the engine's
 *    "Improvement Option (Class N)" selects; the subclass pick is a select of
 *    type Archetype answering to a tag;
 *  - a Subclass is an Archetype that answers to that tag and grants Archetype
 *    Features;
 *  - a species is a Race whose size, speed, senses and languages are grants and
 *    base statistics; a subspecies is a Sub Race or Race Variant answering to the
 *    species' tag;
 *  - a Background grants its Background Feature and offers its personality lists
 *    as `List` selects under the names the sheet reads;
 *  - a Companion is its stat block as setters and `companion:*` statistics, with
 *    traits, actions and reactions as child elements.
 *
 * The first element of the output is the draft's own, so anything that wants the
 * element a draft stands for reads the first one. Ids of the elements a draft
 * generates are the draft's id plus a suffix, so they stay stable across edits.
 */

import type {
  BackgroundList,
  CompanionEntry,
  CustomBackgroundDraft,
  CustomBlock,
  CustomBuildDraft,
  CustomClassDraft,
  CustomCompanionDraft,
  CustomDraft,
  CustomSpeciesDraft,
  CustomSubclassDraft,
  CustomSubspeciesDraft,
  CustomValue,
  ExtraSpeed,
  LineageFields,
  ProgressionFeature,
  ProgressionFields,
  ScaleValue,
} from "@forge-cb/api";
import { compileRequirements, describeRequirements } from "./conditions.js";
import {
  type CompileOptions,
  choiceRule,
  compileValidated,
  grantRule,
  modifierRules,
  scaleRules,
  statLine,
  valueText,
} from "./compile.js";
import { CUSTOM_SOURCE_NAME } from "./schema.js";
import { compileSpellcasting, firstCastingLevel } from "./spellcasting.js";
import { attributes, escapeAttribute, escapeText, paragraphs } from "./xml-text.js";

const ASI_IDS: Readonly<Record<string, string>> = {
  strength: "ID_INTERNAL_ASI_STRENGTH",
  dexterity: "ID_INTERNAL_ASI_DEXTERITY",
  constitution: "ID_INTERNAL_ASI_CONSTITUTION",
  intelligence: "ID_INTERNAL_ASI_INTELLIGENCE",
  wisdom: "ID_INTERNAL_ASI_WISDOM",
  charisma: "ID_INTERNAL_ASI_CHARISMA",
};

/** Present on a character whose background grants the ability increase (2024): a species' own increases switch off. */
const BACKGROUND_ASI = "ID_INTERNAL_GRANTS_BACKGROUND_ASI";

const ordinal = (level: number): string => {
  const mod100 = level % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${level}th`;
  return `${level}${["th", "st", "nd", "rd"][level % 10] ?? "th"}`;
};

function element(
  pairs: ReadonlyArray<readonly [string, string | number | undefined]>,
  children: readonly string[],
): string {
  const open = `<element${attributes(pairs)}>`;
  return [open, ...children.map((line) => `  ${line}`), "</element>"].join("\n");
}

function setters(...entries: Array<string | undefined>): string | undefined {
  const lines = entries.filter((entry): entry is string => entry !== undefined && entry !== "");
  return lines.length === 0 ? undefined : `<setters>${lines.join("")}</setters>`;
}

function set(name: string, value: string | number, extra: ReadonlyArray<readonly [string, string | undefined]> = []): string {
  return `<set${attributes([["name", name], ...extra])}>${escapeText(String(value))}</set>`;
}

const rulesetSetter = (draft: { ruleset?: string }): string | undefined =>
  draft.ruleset === undefined ? undefined : `<set name="ruleset">${draft.ruleset}</set>`;

/** `<div element>` references to a list of elements, so the compendium page shows what an option grants. */
const references = (ids: readonly string[]): string => ids.map((id) => `<div element="${escapeAttribute(id)}" />`).join("");

function blockRulesText(blocks: readonly CustomBlock[], scales: readonly ScaleValue[], extraRequirement?: string): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "modifier") out.push(...modifierRules(block, scales));
    else if (block.kind === "grant") out.push(grantRule(block, extraRequirement));
    else out.push(choiceRule(block, extraRequirement));
  }
  return out;
}

/** The feature elements of a table, in table order, and their grants by level. */
function featureElements(
  features: readonly ProgressionFeature[],
  elementType: string,
  options: { source: string; extraScales: readonly ScaleValue[] },
): string[] {
  return features.map((entry) =>
    compileValidated(entry.draft as CustomDraft, {
      id: entry.draft.id,
      source: options.source,
      elementType,
      extraScales: options.extraScales,
    }),
  );
}

interface LeveledRule {
  level: number;
  xml: string;
}

/** Rules sorted by the level they begin at (stable, so authors' order is kept within a level). */
function inLevelOrder(rules: readonly LeveledRule[]): string[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => left.rule.level - right.rule.level || left.index - right.index)
    .map(({ rule }) => rule.xml);
}

const featureGrants = (type: string, features: readonly ProgressionFeature[], omitLevelOne: boolean): LeveledRule[] =>
  features.map((entry) => ({
    level: entry.level,
    xml: `<grant${attributes([["type", type], ["id", entry.draft.id], ["level", omitLevelOne && entry.level <= 1 ? undefined : entry.level]])} />`,
  }));

// ---- species and subspecies ----------------------------------------------------------

function lineageRules(draft: LineageFields, label: string, ruleset: string | undefined): string[] {
  const rules: string[] = [];
  // Increases that a 2024 background supplies replace the species' own; a 2024
  // species therefore writes none.
  if (ruleset !== "2024") {
    const gate: Array<readonly [string, string]> = [["requirements", `!${BACKGROUND_ASI}`]];
    for (const bonus of draft.abilityBonuses ?? []) rules.push(statLine(bonus.ability, String(bonus.amount), gate));
    const choice = draft.abilityChoice;
    if (choice !== undefined) {
      const from = choice.from ?? (Object.keys(ASI_IDS) as Array<keyof typeof ASI_IDS>);
      rules.push(
        `<select${attributes([
          ["type", "Ability Score Improvement"],
          ["name", `Ability Score Increase (${label})`],
          ["number", choice.picks > 1 ? choice.picks : undefined],
          ["supports", from.map((ability) => ASI_IDS[ability]).join("||")],
          ["requirements", `!${BACKGROUND_ASI}`],
        ])} />`,
      );
    }
  }
  return rules;
}

function languageAndSenseRules(draft: LineageFields, label: string): string[] {
  const rules: string[] = [];
  for (const vision of draft.vision ?? []) rules.push(`<grant type="Vision" id="${escapeAttribute(vision.id)}" />`);
  const languages = draft.languages;
  if (languages !== undefined) {
    for (const language of languages.grants) rules.push(`<grant type="Language" id="${escapeAttribute(language.id)}" />`);
    if (languages.choices > 0) {
      rules.push(
        `<select${attributes([
          ["type", "Language"],
          ["name", `Language (${label})`],
          ["supports", languages.from === "any" ? "Standard||Exotic" : "Standard"],
          ["number", languages.choices > 1 ? languages.choices : undefined],
        ])} />`,
      );
    }
  }
  return rules;
}

function speedRules(speeds: readonly ExtraSpeed[] | undefined): string[] {
  return (speeds ?? []).map((speed) => statLine(`innate speed:${speed.mode}`, String(speed.feet), [["bonus", "base"]]));
}

/** The appearance setters the suggestions read: name lists, name format, height and weight bases. */
function appearanceSetters(draft: LineageFields): string[] {
  const appearance = draft.appearance;
  if (appearance === undefined) return [];
  const out: string[] = [];
  for (const [kind, list] of Object.entries(appearance.names ?? {})) {
    if (list.trim() !== "") out.push(set("names", list.trim(), [["type", kind]]));
  }
  if (appearance.namesFormat?.trim()) out.push(set("names-format", appearance.namesFormat.trim()));
  if (appearance.height) out.push(set("height", appearance.height.base.trim(), [["modifier", appearance.height.modifier.trim()]]));
  if (appearance.weight) out.push(set("weight", appearance.weight.base.trim(), [["modifier", appearance.weight.modifier.trim()]]));
  return out;
}

function tableRules(draft: ProgressionFields): { rules: LeveledRule[]; leading: string[] } {
  // Value columns first: a feature or a block that reads one resolves against it.
  const leading = scaleRules(draft.scales);
  const rules: LeveledRule[] = draft.choices.map((choice) => ({ level: choice.level ?? 1, xml: choiceRule(choice) }));
  return { rules, leading };
}

function compileSpecies(draft: CustomSpeciesDraft, id: string, source: string): string {
  const name = draft.name.trim();
  const featureXml = featureElements(draft.features, "Racial Trait", { source, extraScales: draft.scales });
  const { rules: choiceRules, leading } = tableRules(draft);
  const rules: string[] = [...leading];
  rules.push(...lineageRules(draft, name, draft.ruleset));
  rules.push(`<grant type="Size" id="ID_SIZE_${draft.size.toUpperCase()}" />`);
  rules.push(statLine("innate speed", String(draft.speed), [["bonus", "base"]]));
  rules.push(...speedRules(draft.speeds));
  rules.push(...languageAndSenseRules(draft, name));
  rules.push(...blockRulesText(draft.blocks, draft.scales));
  const offer = draft.subspecies;
  if (offer !== undefined) {
    rules.push(
      `<select${attributes([
        ["type", offer.kind],
        ["name", offer.label?.trim() || `${name} ${offer.kind === "Sub Race" ? "Subrace" : "Variant"}`],
        ["supports", offer.tag?.trim() || name],
        ["optional", offer.optional === true || (offer.kind === "Race Variant" && offer.optional !== false) ? "true" : undefined],
      ])} />`,
    );
  }
  rules.push(...inLevelOrder([...choiceRules, ...featureGrants("Racial Trait", draft.features, true)]));
  const children = [
    `<description>${paragraphs(draft.description)}${references(draft.features.map((entry) => entry.draft.id))}</description>`,
    '<sheet display="false" />',
    setters(rulesetSetter(draft), ...appearanceSetters(draft)),
    rules.length > 0 ? `<rules>${rules.join("")}</rules>` : undefined,
  ].filter((line): line is string => line !== undefined);
  return [element([["name", name], ["type", "Race"], ["source", source], ["id", id]], children), ...featureXml].join("\n");
}

function compileSubspecies(draft: CustomSubspeciesDraft, id: string, source: string): string {
  const name = draft.name.trim();
  const featureXml = featureElements(draft.features, "Racial Trait", { source, extraScales: draft.scales });
  const { rules: choiceRules, leading } = tableRules(draft);
  const rules: string[] = [...leading];
  rules.push(...lineageRules(draft, name, draft.ruleset));
  if (draft.speedBonus !== undefined && draft.speedBonus !== 0) rules.push(statLine("innate speed", String(draft.speedBonus), []));
  rules.push(...speedRules(draft.speeds));
  rules.push(...languageAndSenseRules(draft, name));
  rules.push(...blockRulesText(draft.blocks, draft.scales));
  rules.push(...inLevelOrder([...choiceRules, ...featureGrants("Racial Trait", draft.features, true)]));
  const children = [
    `<supports>${escapeText(draft.parent.tag.trim())}</supports>`,
    `<description>${paragraphs(draft.description)}${references(draft.features.map((entry) => entry.draft.id))}</description>`,
    '<sheet display="false" />',
    setters(rulesetSetter(draft), ...appearanceSetters(draft)),
    rules.length > 0 ? `<rules>${rules.join("")}</rules>` : undefined,
  ].filter((line): line is string => line !== undefined);
  return [element([["name", name], ["type", draft.kind], ["source", source], ["id", id]], children), ...featureXml].join("\n");
}

// ---- class and subclass ----------------------------------------------------------------

/** The tag subclasses answer to: the class' own label for the pick, else "<class> Subclass". */
export function subclassTagOf(draft: Pick<CustomClassDraft, "name" | "subclass">): string {
  return draft.subclass?.label?.trim() || `${draft.name.trim()} Subclass`;
}

function spellcastingFeature(
  id: string,
  type: "Class Feature" | "Archetype Feature",
  source: string,
  spellcasting: NonNullable<CustomClassDraft["spellcasting"]>,
  ownerName: string,
  className: string,
): { xml: string; level: number } {
  const compiled = compileSpellcasting(spellcasting, ownerName, className);
  const xml = element(
    [["name", "Spellcasting"], ["type", type], ["source", source], ["id", `${id}_SPELLCASTING`]],
    [
      `<description><p>${escapeText(compiled.sheetText)}</p></description>`,
      `<sheet display="false"><description>${escapeText(compiled.sheetText)}</description></sheet>`,
      compiled.block,
      `<rules>${compiled.rules.join("")}</rules>`,
    ],
  );
  return { xml, level: firstCastingLevel(spellcasting) };
}

function asiFeature(id: string, source: string, className: string, levels: readonly number[]): string {
  const sorted = [...levels].sort((left, right) => left - right);
  const rules = sorted.map(
    (level) =>
      `<select${attributes([
        ["type", "Class Feature"],
        ["name", `Improvement Option (${className} ${level})`],
        ["supports", `Improvement Option,${className},${level}`],
        ["level", level],
      ])} />`,
  );
  const list = sorted.map(ordinal).join(", ");
  return element(
    [["name", "Ability Score Improvement"], ["type", "Class Feature"], ["source", source], ["id", `${id}_ASI`]],
    [
      '<compendium display="false" />',
      `<description><p>At ${list} level, you can increase one ability score of your choice by 2, or you can increase two ability scores of your choice by 1, or take a feat. As normal, you can't increase an ability score above 20 using this feature.</p></description>`,
      '<sheet display="false" />',
      `<rules>${rules.join("")}</rules>`,
    ],
  );
}

function compileClass(draft: CustomClassDraft, id: string, source: string): string {
  const name = draft.name.trim();
  const featureXml = featureElements(draft.features, "Class Feature", { source, extraScales: draft.scales });
  const multiId = draft.multiclass === undefined ? undefined : `${id}_MULTICLASS`;
  const notMulticlass = multiId === undefined ? undefined : `!${multiId}`;

  const { rules: choiceRules, leading } = tableRules(draft);
  const rules: string[] = [...leading];
  rules.push(...blockRulesText(draft.starting, draft.scales, notMulticlass));
  rules.push(...blockRulesText(draft.blocks, draft.scales));

  const generated: string[] = [];
  const grants: LeveledRule[] = [...choiceRules, ...featureGrants("Class Feature", draft.features, false)];
  const generatedIds: string[] = [];
  if (draft.spellcasting !== undefined) {
    const feature = spellcastingFeature(id, "Class Feature", source, draft.spellcasting, name, name);
    generated.push(feature.xml);
    generatedIds.push(`${id}_SPELLCASTING`);
    grants.push({ level: feature.level, xml: `<grant type="Class Feature" id="${id}_SPELLCASTING" level="${feature.level}" />` });
  }
  if (draft.subclass !== undefined) {
    const label = subclassTagOf(draft);
    generated.push(
      element(
        [["name", label], ["type", "Class Feature"], ["source", source], ["id", `${id}_SUBCLASS`]],
        [
          `<description><p>At ${ordinal(draft.subclass.level)} level, you choose a ${escapeText(label)}.</p></description>`,
          '<sheet display="false" />',
          `<rules><select type="Archetype" name="${escapeAttribute(label)}" supports="${escapeAttribute(label)}" /></rules>`,
        ],
      ),
    );
    generatedIds.push(`${id}_SUBCLASS`);
    grants.push({ level: draft.subclass.level, xml: `<grant type="Class Feature" id="${id}_SUBCLASS" level="${draft.subclass.level}" />` });
  }
  if (draft.asiLevels.length > 0) {
    generated.push(asiFeature(id, source, name, draft.asiLevels));
    generatedIds.push(`${id}_ASI`);
    const first = Math.min(...draft.asiLevels);
    grants.push({ level: first, xml: `<grant type="Class Feature" id="${id}_ASI" level="${first}" />` });
  }
  rules.push(...inLevelOrder(grants));

  let multiclass: string | undefined;
  if (draft.multiclass !== undefined && multiId !== undefined) {
    const block = draft.multiclass;
    const expression = block.requirements === undefined ? "" : compileRequirements(block.requirements);
    const lines = [
      block.requirements === undefined ? undefined : `<prerequisite>${escapeText(describeRequirements(block.requirements))}</prerequisite>`,
      expression === "" ? undefined : `<requirements>${escapeText(`(${expression})||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER`)}</requirements>`,
      `<setters>${set("multiclass proficiencies", block.summary?.trim() || "—")}</setters>`,
      `<rules><grant type="Grants" id="ID_INTERNAL_GRANT_MULTICLASS" />${blockRulesText(block.blocks, draft.scales).join("")}</rules>`,
    ].filter((line): line is string => line !== undefined);
    multiclass = `<multiclass id="${multiId}">${lines.join("")}</multiclass>`;
  }

  const order = [...draft.features.map((entry) => entry.draft.id), ...generatedIds];
  const children = [
    `<description>${paragraphs(draft.description)}${references(order)}</description>`,
    '<sheet display="false" />',
    setters(set("short", draft.short?.trim() || `A ${name} class.`), set("hd", `d${draft.hitDie}`), rulesetSetter(draft)),
    rules.length > 0 ? `<rules>${rules.join("")}</rules>` : undefined,
    multiclass,
  ].filter((line): line is string => line !== undefined);
  return [element([["name", name], ["type", "Class"], ["source", source], ["id", id]], children), ...generated, ...featureXml].join("\n");
}

function compileSubclass(draft: CustomSubclassDraft, id: string, source: string): string {
  const name = draft.name.trim();
  const featureXml = featureElements(draft.features, "Archetype Feature", { source, extraScales: draft.scales });
  const { rules: choiceRules, leading } = tableRules(draft);
  const rules: string[] = [...leading];
  rules.push(...blockRulesText(draft.blocks, draft.scales));

  const generated: string[] = [];
  const grants: LeveledRule[] = [...choiceRules, ...featureGrants("Archetype Feature", draft.features, false)];
  const appends: string[] = [];
  const spells = draft.spells;
  if (spells !== undefined) {
    for (const entry of spells.alwaysPrepared) {
      grants.push({
        level: entry.level,
        xml: `<grant${attributes([["type", "Spell"], ["id", entry.spell.id], ["level", entry.level], ["spellcasting", spells.caster], ["prepared", "true"]])} />`,
      });
    }
    const tag = spells.listTag?.trim() || draft.parent.name.trim();
    for (const spell of spells.addToList) {
      appends.push(`<append id="${escapeAttribute(spell.id)}"><supports>${escapeText(tag)}</supports></append>`);
    }
  }
  const featureIds = draft.features.map((entry) => entry.draft.id);
  if (draft.spellcasting !== undefined) {
    const feature = spellcastingFeature(id, "Archetype Feature", source, draft.spellcasting, name, draft.parent.name.trim());
    generated.push(feature.xml);
    featureIds.push(`${id}_SPELLCASTING`);
    grants.push({ level: feature.level, xml: `<grant type="Archetype Feature" id="${id}_SPELLCASTING" level="${feature.level}" />` });
  }
  rules.push(...inLevelOrder(grants));

  const children = [
    `<supports>${escapeText(draft.parent.tag.trim())}</supports>`,
    `<description>${paragraphs(draft.description)}${references(featureIds)}</description>`,
    '<sheet display="false" />',
    setters(rulesetSetter(draft)),
    rules.length > 0 ? `<rules>${rules.join("")}</rules>` : undefined,
  ].filter((line): line is string => line !== undefined);
  return [element([["name", name], ["type", "Archetype"], ["source", source], ["id", id]], children), ...generated, ...featureXml, ...appends].join("\n");
}

// ---- background ---------------------------------------------------------------------------

function listRule(list: BackgroundList): string {
  return choiceRule({
    kind: "choice",
    id: "list",
    type: "List",
    name: list.name,
    count: list.count,
    items: list.items,
  });
}

function compileBackground(draft: CustomBackgroundDraft, id: string, source: string): string {
  const name = draft.name.trim();
  const rules: string[] = [];
  rules.push(...blockRulesText(draft.starting, []));
  if (draft.originFeat !== undefined) rules.push(`<grant type="Feat" id="${escapeAttribute(draft.originFeat.id)}" />`);
  if (draft.abilityChoice !== undefined) {
    // The player assigns three points among the three abilities; the grant is
    // what switches a species' own increases off.
    rules.push(`<grant type="Grants" id="${BACKGROUND_ASI}" />`);
    rules.push(
      `<select${attributes([
        ["type", "Ability Score Improvement"],
        ["name", `Background Ability Score Improvement (${name})`],
        ["number", 3],
        ["supports", draft.abilityChoice.map((ability) => ASI_IDS[ability]).join("||")],
      ])} />`,
    );
  }
  const featureXml: string[] = [];
  if (draft.feature !== undefined) {
    featureXml.push(compileValidated(draft.feature, { id: draft.feature.id, source, elementType: "Background Feature" }));
    rules.push(`<grant type="Background Feature" id="${escapeAttribute(draft.feature.id)}" />`);
  }
  rules.push(...blockRulesText(draft.blocks, []));
  for (const list of draft.lists) rules.push(listRule(list));

  const equipment = draft.equipment.map((line) => line.trim()).filter((line) => line !== "");
  const summary =
    equipment.length === 0
      ? ""
      : `<ul class="unstyled"><li><strong>Equipment:</strong> ${equipment.map(escapeText).join("; ")}</li></ul>`;
  const children = [
    `<description>${paragraphs(draft.description)}${summary}${draft.feature === undefined ? "" : references([draft.feature.id])}</description>`,
    setters(rulesetSetter(draft)),
    rules.length > 0 ? `<rules>${rules.join("")}</rules>` : undefined,
  ].filter((line): line is string => line !== undefined);
  return [element([["name", name], ["type", "Background"], ["source", source], ["id", id]], children), ...featureXml].join("\n");
}

// ---- companion ----------------------------------------------------------------------------

const ENTRY_TYPES = { traits: "Companion Trait", actions: "Companion Action", reactions: "Companion Reaction" } as const;

const entryId = (id: string, kind: keyof typeof ENTRY_TYPES, entry: CompanionEntry): string =>
  `${id}_${kind.slice(0, -1).toUpperCase()}_${entry.id.toUpperCase()}`;

function companionValue(value: CustomValue): string {
  return valueText(value, []);
}

function compileCompanion(draft: CustomCompanionDraft, id: string, source: string): string {
  const name = draft.name.trim();
  const speedText = [`${draft.speed} ft.`, ...(draft.speeds ?? []).map((speed) => `${speed.mode} ${speed.feet} ft.`)].join(", ");
  const abilityLines = (["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const).map((ability) =>
    set(ability, draft.abilities[ability]),
  );
  const optional = (key: string, value: string | undefined): string | undefined =>
    value === undefined || value.trim() === "" ? undefined : set(key, value.trim());
  const ids = (kind: keyof typeof ENTRY_TYPES): string | undefined =>
    draft[kind].length === 0 ? undefined : set(kind, draft[kind].map((entry) => entryId(id, kind, entry)).join(","));

  const lines = [
    ...abilityLines,
    set("ac", draft.armorClass),
    set("hp", draft.hitPointsText?.trim() || draft.hitPoints),
    set("speed", speedText),
    set("languages", draft.languages?.trim() || "—"),
    optional("skills", draft.skills),
    optional("saves", draft.saves),
    optional("senses", draft.senses),
    optional("resistances", draft.resistances),
    optional("immunities", draft.immunities),
    optional("vulnerabilities", draft.vulnerabilities),
    optional("conditionImmunities", draft.conditionImmunities),
    set("type", draft.creatureType.trim()),
    set("size", draft.size),
    set("alignment", draft.alignment.trim()),
    set("challenge", draft.challenge.trim()),
    ids("traits"),
    ids("actions"),
    ids("reactions"),
    rulesetSetter(draft),
  ];

  const rules: string[] = [];
  rules.push(statLine("companion:ac", String(draft.armorClass), []));
  if (draft.hitPoints > 0) rules.push(statLine("companion:hp:max", String(draft.hitPoints), [["bonus", "base"]]));
  rules.push(statLine("companion:speed", String(draft.speed), [["bonus", "base"]]));
  for (const speed of draft.speeds ?? []) rules.push(statLine(`companion:speed:${speed.mode}`, String(speed.feet), [["bonus", "base"]]));
  for (const stat of draft.stats) {
    rules.push(statLine(stat.target, companionValue(stat.value), stat.mode === "set" ? [["bonus", "base"]] : []));
  }

  const tags = (draft.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== "");
  const children = [
    tags.length > 0 ? `<supports>${escapeText(tags.join(", "))}</supports>` : undefined,
    draft.description.trim() === "" ? "<description />" : `<description>${paragraphs(draft.description)}</description>`,
    setters(...lines),
    `<rules>${rules.join("")}</rules>`,
  ].filter((line): line is string => line !== undefined);

  const entries = (["traits", "actions", "reactions"] as const).flatMap((kind) =>
    draft[kind].map((entry) => {
      const text = entry.text.trim().replace(/\s*\n+\s*/g, " ");
      return element(
        [["name", entry.name.trim()], ["type", ENTRY_TYPES[kind]], ["source", source], ["id", entryId(id, kind, entry)]],
        [`<description>${paragraphs(entry.text)}</description>`, `<sheet><description>${escapeText(text)}</description></sheet>`],
      );
    }),
  );
  return [element([["name", name], ["type", "Companion"], ["source", source], ["id", id]], children), ...entries].join("\n");
}

// ---- entry ---------------------------------------------------------------------------------

/** The elements a character option draft compiles to, as XML; the draft's own element comes first. */
export function compileBuildDraft(draft: CustomBuildDraft, options: CompileOptions): string {
  const id = options.id ?? draft.id;
  const source = options.source ?? CUSTOM_SOURCE_NAME;
  switch (draft.template) {
    case "species":
      return compileSpecies(draft, id, source);
    case "subspecies":
      return compileSubspecies(draft, id, source);
    case "class":
      return compileClass(draft, id, source);
    case "subclass":
      return compileSubclass(draft, id, source);
    case "background":
      return compileBackground(draft, id, source);
    case "companion":
      return compileCompanion(draft, id, source);
  }
}

/** The ids of every element a compiled draft defines, its own first; an unfinished draft defines none. */
export function compiledElementIds(xml: string): string[] {
  return [...xml.matchAll(/<element\b[^>]*?\bid="([^"]+)"/g)].map((match) => match[1]!);
}
