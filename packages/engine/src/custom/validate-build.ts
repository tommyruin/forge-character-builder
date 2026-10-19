/**
 * Validation of the character options a pack holds: species, subspecies, class,
 * subclass, background and companion. Every problem names the field it is about
 * (`features[2].draft.blocks[0].target`), like the other drafts', and compilation
 * only ever sees a draft that passed.
 *
 * A feature authored inside one of these (a class feature, a racial trait, a
 * background feature) is a full feature draft, so it is checked by the feature
 * validator, with the value columns of its owner in reach.
 */

import {
  COMPANION_STAT_TARGETS,
  CREATURE_SIZES,
  CUSTOM_ABILITIES,
  CUSTOM_BUILD_TEMPLATES,
  HIT_DICE,
  PERSONALITY_LIST_NAMES,
  SPEED_MODES,
  type CustomAbility,
  type ScaleValue,
} from "@forge-cb/api";
import { requirementIssues } from "./conditions.js";
import { scaleIssues } from "./trackers.js";
import { spellcastingIssues } from "./spellcasting.js";
import { blocksIssues, customDraftIssues, headIssues, tagIssues, valueIssues, type CustomDraftIssue } from "./validate.js";

const ELEMENT_ID = /^ID_[A-Z0-9_]+$/;
const ANY_ELEMENT_ID = /^ID_[A-Za-z0-9_-]+$/;
const ENTRY_ID = /^[A-Za-z0-9]{1,40}$/;
const CLASS_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]*$/;
const TAG_SAFE = /^[^,&|()!\s<>"][^,&|()!<>"]*$/;
const SAFE_LINE = /^[^<>&]*$/;
const CHALLENGE = /^(?:\d{1,2}|\d{1,2}\/\d{1,2})$/;
const HEIGHT_BASE = /^\d+'\d+"?$/;
const WEIGHT_BASE = /^\d+\s*lb\.?$/;
const DICE_OR_NUMBER = /^(?:\d+|\d+d\d+)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isName = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= max;

export const MAX_FEATURES = 60;
export const MAX_CHOICES = 40;

type Owner = "class" | "subclass" | "species" | "background";

function prefixed(prefix: string, issues: readonly CustomDraftIssue[]): CustomDraftIssue[] {
  return issues.map((issue) => ({ ...issue, path: issue.path === "" ? prefix : `${prefix}.${issue.path}` }));
}

const scaleMap = (scales: unknown): Map<string, ScaleValue> => {
  const map = new Map<string, ScaleValue>();
  if (Array.isArray(scales)) {
    for (const scale of scales as unknown[]) if (isRecord(scale) && typeof scale.id === "string") map.set(scale.id, scale as unknown as ScaleValue);
  }
  return map;
};

/** Which feature template and `showsUnder` a feature inside each owner carries. */
const FEATURE_TEMPLATE: Readonly<Record<Owner, { template: string[]; showsUnder: string[] }>> = {
  class: { template: ["classFeature", "feature", "boon", "curse", "transformation"], showsUnder: ["class"] },
  subclass: { template: ["classFeature", "feature", "boon", "curse", "transformation"], showsUnder: ["class"] },
  species: { template: ["racialTrait", "feature", "boon", "curse", "transformation"], showsUnder: ["race"] },
  background: { template: ["feature", "boon", "curse", "transformation"], showsUnder: ["other", "race", "class", "feats"] },
};

/**
 * A feature authored inside an owner: the feature validator's problems, under
 * `prefix`. The owner's scale values count as the feature's own for the values
 * its modifiers read.
 */
export function embeddedFeatureIssues(draft: unknown, prefix: string, owner: Owner, ownerScales: readonly ScaleValue[]): CustomDraftIssue[] {
  if (!isRecord(draft)) return [{ path: prefix, message: "a feature must be an object" }];
  const own = Array.isArray(draft.scales) ? (draft.scales as ScaleValue[]) : [];
  const issues = prefixed(prefix, customDraftIssues({ ...draft, scales: own.length === 0 && ownerScales.length === 0 ? undefined : [...ownerScales, ...own] }));
  const allowed = FEATURE_TEMPLATE[owner];
  if (typeof draft.template === "string" && !allowed.template.includes(draft.template)) {
    issues.push({ path: `${prefix}.template`, message: "this feature has a kind a table cannot hold" });
  }
  if (typeof draft.showsUnder === "string" && !allowed.showsUnder.includes(draft.showsUnder)) {
    issues.push({ path: `${prefix}.showsUnder`, message: `a feature here shows under ${allowed.showsUnder.join(" or ")}` });
  }
  return issues;
}

function featuresIssues(features: unknown, owner: Owner, ownerScales: readonly ScaleValue[], ownerId: unknown): CustomDraftIssue[] {
  if (!Array.isArray(features)) return [{ path: "features", message: "features must be a list" }];
  if (features.length > MAX_FEATURES) return [{ path: "features", message: `a table holds at most ${MAX_FEATURES} features` }];
  const issues: CustomDraftIssue[] = [];
  const ids = new Set<string>([typeof ownerId === "string" ? ownerId : ""]);
  features.forEach((entry: unknown, index: number) => {
    const at = `features[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path: at, message: "a feature entry must be an object" });
      return;
    }
    if (!(isWholeNumber(entry.level) && entry.level >= 1 && entry.level <= 20)) {
      issues.push({ path: `${at}.level`, message: "a feature's level is a whole number from 1 to 20" });
    }
    issues.push(...embeddedFeatureIssues(entry.draft, `${at}.draft`, owner, ownerScales));
    const id = isRecord(entry.draft) ? entry.draft.id : undefined;
    if (typeof id === "string") {
      if (ids.has(id)) issues.push({ path: `${at}.draft.id`, message: "two features share an id" });
      ids.add(id);
    }
  });
  return issues;
}

/** The choices a table offers: choice blocks only, each at a level. */
function tableChoiceIssues(choices: unknown, scales: ReadonlyMap<string, ScaleValue>): CustomDraftIssue[] {
  if (!Array.isArray(choices)) return [{ path: "choices", message: "choices must be a list" }];
  if (choices.length > MAX_CHOICES) return [{ path: "choices", message: `a table offers at most ${MAX_CHOICES} choices` }];
  const issues = blocksIssues(choices, scales).map((issue) => ({ ...issue, path: issue.path.replace(/^blocks/, "choices") }));
  choices.forEach((choice: unknown, index: number) => {
    if (isRecord(choice) && choice.kind !== "choice") issues.push({ path: `choices[${index}].kind`, message: "a table offers choices; other effects go under 'What it does'" });
  });
  return issues;
}

/** The table fields every progression draft shares. */
function progressionIssues(draft: Record<string, unknown>, owner: Owner): CustomDraftIssue[] {
  const issues: CustomDraftIssue[] = [];
  const scalesList = Array.isArray(draft.scales) ? (draft.scales as ScaleValue[]) : [];
  issues.push(...scaleIssues(draft.scales));
  const scales = scaleMap(draft.scales);
  issues.push(...featuresIssues(draft.features, owner, scalesList, draft.id));
  issues.push(...tableChoiceIssues(draft.choices, scales));
  issues.push(...blocksIssues(draft.blocks, scales));
  return issues;
}

function idLabelIssues(list: unknown, path: string, max: number): CustomDraftIssue[] {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > max) return [{ path, message: `this is a list of at most ${max}` }];
  const issues: CustomDraftIssue[] = [];
  const seen = new Set<string>();
  list.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !ANY_ELEMENT_ID.test(entry.id)) {
      issues.push({ path: `${path}[${index}].id`, message: "pick the element from the list" });
    } else if (seen.has(entry.id)) {
      issues.push({ path: `${path}[${index}].id`, message: "each one is listed once" });
    } else {
      seen.add(entry.id);
    }
  });
  return issues;
}

function speedsIssues(speeds: unknown, path: string): CustomDraftIssue[] {
  if (speeds === undefined) return [];
  if (!Array.isArray(speeds) || speeds.length > SPEED_MODES.length) return [{ path, message: "other speeds are a list of fly, swim, climb and burrow" }];
  const issues: CustomDraftIssue[] = [];
  const modes = new Set<string>();
  speeds.forEach((entry: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isRecord(entry) || !SPEED_MODES.includes(entry.mode as never)) {
      issues.push({ path: `${at}.mode`, message: "pick fly, swim, climb or burrow" });
    } else if (modes.has(entry.mode as string)) {
      issues.push({ path: `${at}.mode`, message: "each kind of speed is listed once" });
    } else {
      modes.add(entry.mode as string);
    }
    if (!isRecord(entry) || !(isWholeNumber(entry.feet) && entry.feet >= 5 && entry.feet <= 300)) {
      issues.push({ path: `${at}.feet`, message: "a speed is a whole number of feet from 5 to 300" });
    }
  });
  return issues;
}

function appearanceIssues(appearance: unknown): CustomDraftIssue[] {
  if (appearance === undefined) return [];
  if (!isRecord(appearance)) return [{ path: "appearance", message: "appearance must be an object" }];
  const issues: CustomDraftIssue[] = [];
  if (appearance.names !== undefined) {
    if (!isRecord(appearance.names)) issues.push({ path: "appearance.names", message: "names must be an object" });
    else {
      for (const [key, value] of Object.entries(appearance.names)) {
        if (!["male", "female", "child", "family"].includes(key)) issues.push({ path: `appearance.names.${key}`, message: "names are male, female, child or family" });
        else if (!isText(value, 4000) || /[<>&]/.test(value as string)) issues.push({ path: `appearance.names.${key}`, message: "a name list is comma-separated names without < > or &" });
      }
    }
  }
  if (appearance.namesFormat !== undefined && !(isText(appearance.namesFormat, 80) && /^[^<>&]*$/.test(appearance.namesFormat))) {
    issues.push({ path: "appearance.namesFormat", message: "the name format is text like {{name}} {{family}}" });
  }
  for (const [field, base] of [["height", HEIGHT_BASE], ["weight", WEIGHT_BASE]] as const) {
    const value = appearance[field];
    if (value === undefined) continue;
    if (!isRecord(value) || typeof value.base !== "string" || !base.test(value.base.trim())) {
      issues.push({ path: `appearance.${field}.base`, message: field === "height" ? `write a height like 4'6"` : "write a weight like 90 lb." });
    }
    if (!isRecord(value) || typeof value.modifier !== "string" || !DICE_OR_NUMBER.test(value.modifier.trim())) {
      issues.push({ path: `appearance.${field}.modifier`, message: "write dice like 2d10, or a number" });
    }
  }
  return issues;
}

function lineageIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues: CustomDraftIssue[] = [];
  issues.push(...idLabelIssues(draft.vision, "vision", 6));
  if (draft.languages !== undefined) {
    const languages = draft.languages;
    if (!isRecord(languages)) issues.push({ path: "languages", message: "languages must be an object" });
    else {
      issues.push(...idLabelIssues(languages.grants, "languages.grants", 12));
      if (!(isWholeNumber(languages.choices) && languages.choices >= 0 && languages.choices <= 10)) {
        issues.push({ path: "languages.choices", message: "how many languages the player picks is a whole number from 0 to 10" });
      }
      if (languages.from !== undefined && languages.from !== "standard" && languages.from !== "any") {
        issues.push({ path: "languages.from", message: "the picks come from the common languages or any language" });
      }
    }
  }
  if (draft.abilityBonuses !== undefined) {
    const bonuses = draft.abilityBonuses;
    if (!Array.isArray(bonuses) || bonuses.length > 6) issues.push({ path: "abilityBonuses", message: "ability increases are a list of at most 6" });
    else {
      const seen = new Set<string>();
      bonuses.forEach((entry: unknown, index: number) => {
        const at = `abilityBonuses[${index}]`;
        if (!isRecord(entry) || !CUSTOM_ABILITIES.includes(entry.ability as CustomAbility)) issues.push({ path: `${at}.ability`, message: "pick one of the six abilities" });
        else if (seen.has(entry.ability as string)) issues.push({ path: `${at}.ability`, message: "each ability is listed once" });
        else seen.add(entry.ability as string);
        if (!isRecord(entry) || !(isWholeNumber(entry.amount) && entry.amount !== 0 && entry.amount >= -4 && entry.amount <= 4)) {
          issues.push({ path: `${at}.amount`, message: "an increase is a whole number from -4 to 4, not 0" });
        }
      });
    }
  }
  if (draft.abilityChoice !== undefined) {
    const choice = draft.abilityChoice;
    if (!isRecord(choice) || !(isWholeNumber(choice.picks) && choice.picks >= 1 && choice.picks <= 6)) {
      issues.push({ path: "abilityChoice.picks", message: "how many points the player assigns is a whole number from 1 to 6" });
    } else if (choice.from !== undefined) {
      const from = choice.from;
      if (!Array.isArray(from) || from.length === 0 || from.some((ability) => !CUSTOM_ABILITIES.includes(ability as CustomAbility)) || new Set(from).size !== from.length) {
        issues.push({ path: "abilityChoice.from", message: "pick each ability at most once" });
      }
    }
  }
  issues.push(...speedsIssues(draft.speeds, "speeds"));
  issues.push(...appearanceIssues(draft.appearance));
  return issues;
}

function parentIssues(parent: unknown, what: string): CustomDraftIssue[] {
  if (!isRecord(parent)) return [{ path: "parent", message: `pick the ${what} this belongs to` }];
  const issues: CustomDraftIssue[] = [];
  if (typeof parent.id !== "string" || !ANY_ELEMENT_ID.test(parent.id)) issues.push({ path: "parent.id", message: `pick the ${what} this belongs to` });
  if (!isName(parent.name, 120)) issues.push({ path: "parent.name", message: `name the ${what}` });
  if (!(typeof parent.tag === "string" && TAG_SAFE.test(parent.tag.trim()))) {
    issues.push({ path: "parent.tag", message: `the ${what}'s pick list needs a tag without , & | ( ) or !` });
  }
  return issues;
}

function startingIssues(blocks: unknown, path: string, scales: ReadonlyMap<string, ScaleValue>): CustomDraftIssue[] {
  if (!Array.isArray(blocks)) return [{ path, message: `${path} must be a list` }];
  const issues = blocksIssues(blocks, scales).map((issue) => ({ ...issue, path: issue.path.replace(/^blocks/, path) }));
  blocks.forEach((block: unknown, index: number) => {
    if (isRecord(block) && block.kind === "modifier") {
      issues.push({ path: `${path}[${index}].kind`, message: "this holds proficiencies and picks; bonuses go under 'What it does'" });
    }
  });
  return issues;
}

// ---- the six kinds ----------------------------------------------------------------

export function customSpeciesDraftIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues = headIssues(draft, ELEMENT_ID, true);
  if (draft.template !== "species") issues.push({ path: "template", message: "a species has the template 'species'" });
  if (!CREATURE_SIZES.includes(draft.size as never)) issues.push({ path: "size", message: "pick a size from Tiny to Gargantuan" });
  if (!(isWholeNumber(draft.speed) && draft.speed >= 0 && draft.speed <= 300)) {
    issues.push({ path: "speed", message: "walking speed is a whole number of feet from 0 to 300" });
  }
  if (draft.subspecies !== undefined) {
    const offer = draft.subspecies;
    if (!isRecord(offer) || (offer.kind !== "Sub Race" && offer.kind !== "Race Variant")) {
      issues.push({ path: "subspecies.kind", message: "pick a subrace or a variant" });
    } else {
      if (offer.tag !== undefined && !(typeof offer.tag === "string" && TAG_SAFE.test(offer.tag.trim()))) {
        issues.push({ path: "subspecies.tag", message: "the tag cannot be empty or contain , & | ( ) or !" });
      }
      if (offer.label !== undefined && !isName(offer.label, 80)) issues.push({ path: "subspecies.label", message: "the pick's name is text of at most 80 characters" });
      if (offer.optional !== undefined && typeof offer.optional !== "boolean") issues.push({ path: "subspecies.optional", message: "optional is on or off" });
      if (offer.tag === undefined && typeof draft.name === "string" && !TAG_SAFE.test(draft.name.trim())) {
        issues.push({ path: "subspecies.tag", message: "the species' name cannot be the tag; name one without , & | ( ) or !" });
      }
    }
  }
  issues.push(...lineageIssues(draft));
  issues.push(...progressionIssues(draft, "species"));
  return issues;
}

export function customSubspeciesDraftIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues = headIssues(draft, ELEMENT_ID, true);
  if (draft.template !== "subspecies") issues.push({ path: "template", message: "a subspecies has the template 'subspecies'" });
  if (draft.kind !== "Sub Race" && draft.kind !== "Race Variant") issues.push({ path: "kind", message: "pick a subrace or a variant" });
  issues.push(...parentIssues(draft.parent, "species"));
  if (draft.speedBonus !== undefined && !(isWholeNumber(draft.speedBonus) && draft.speedBonus >= -30 && draft.speedBonus <= 60)) {
    issues.push({ path: "speedBonus", message: "the speed change is a whole number of feet from -30 to 60" });
  }
  issues.push(...lineageIssues(draft));
  issues.push(...progressionIssues(draft, "species"));
  return issues;
}

export function customClassDraftIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues = headIssues(draft, ELEMENT_ID, true);
  if (draft.template !== "class") issues.push({ path: "template", message: "a class has the template 'class'" });
  if (typeof draft.name === "string" && !CLASS_NAME.test(draft.name.trim())) {
    issues.push({ path: "name", message: "a class name is letters, digits and spaces; its level is read by name" });
  }
  if (!HIT_DICE.includes(draft.hitDie as never)) issues.push({ path: "hitDie", message: "pick d6, d8, d10 or d12" });
  if (draft.short !== undefined && !isText(draft.short, 200)) issues.push({ path: "short", message: "the one-line summary is at most 200 characters" });
  const scales = scaleMap(draft.scales);
  issues.push(...startingIssues(draft.starting, "starting", scales));
  if (draft.subclass !== undefined) {
    const subclass = draft.subclass;
    if (!isRecord(subclass) || !(isWholeNumber(subclass.level) && subclass.level >= 1 && subclass.level <= 20)) {
      issues.push({ path: "subclass.level", message: "the subclass level is a whole number from 1 to 20" });
    }
    if (isRecord(subclass) && subclass.label !== undefined && !(typeof subclass.label === "string" && TAG_SAFE.test(subclass.label.trim()) && subclass.label.length <= 60)) {
      issues.push({ path: "subclass.label", message: "name the pick without , & | ( ) or !" });
    }
  }
  const asi = draft.asiLevels;
  if (!Array.isArray(asi) || asi.length > 10 || asi.some((level) => !(isWholeNumber(level) && level >= 1 && level <= 20)) || new Set(asi).size !== asi.length) {
    issues.push({ path: "asiLevels", message: "ability score levels are different whole numbers from 1 to 20" });
  }
  if (draft.spellcasting !== undefined) issues.push(...spellcastingIssues(draft.spellcasting, "spellcasting"));
  if (draft.multiclass !== undefined) {
    const multiclass = draft.multiclass;
    if (!isRecord(multiclass)) issues.push({ path: "multiclass", message: "multiclass settings must be an object" });
    else {
      if (multiclass.requirements !== undefined) {
        issues.push(...prefixed("multiclass.requirements", requirementIssues(multiclass.requirements)));
      }
      if (multiclass.summary !== undefined && !(isText(multiclass.summary, 300) && SAFE_LINE.test(multiclass.summary))) {
        issues.push({ path: "multiclass.summary", message: "the proficiencies line is at most 300 characters without < > or &" });
      }
      issues.push(...startingIssues(multiclass.blocks, "multiclass.blocks", scales));
    }
  }
  issues.push(...progressionIssues(draft, "class"));
  return issues;
}

export function customSubclassDraftIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues = headIssues(draft, ELEMENT_ID, true);
  if (draft.template !== "subclass") issues.push({ path: "template", message: "a subclass has the template 'subclass'" });
  issues.push(...parentIssues(draft.parent, "class"));
  if (draft.spells !== undefined && draft.spellcasting !== undefined) {
    issues.push({ path: "spellcasting", message: "a subclass adds to its class' spells or casts on its own, not both" });
  }
  if (draft.spells !== undefined) {
    const spells = draft.spells;
    if (!isRecord(spells)) issues.push({ path: "spells", message: "spells must be an object" });
    else {
      if (!(typeof spells.caster === "string" && CLASS_NAME.test(spells.caster))) {
        issues.push({ path: "spells.caster", message: "name the class' spellcasting feature the spells join" });
      }
      const always = spells.alwaysPrepared;
      if (!Array.isArray(always) || always.length > 40) issues.push({ path: "spells.alwaysPrepared", message: "always-prepared spells are a list of at most 40" });
      else {
        always.forEach((entry: unknown, index: number) => {
          const at = `spells.alwaysPrepared[${index}]`;
          if (!isRecord(entry) || !(isWholeNumber(entry.level) && entry.level >= 1 && entry.level <= 20)) issues.push({ path: `${at}.level`, message: "the class level is a whole number from 1 to 20" });
          if (!isRecord(entry) || !isRecord(entry.spell) || typeof entry.spell.id !== "string" || !ANY_ELEMENT_ID.test(entry.spell.id)) {
            issues.push({ path: `${at}.spell`, message: "pick the spell" });
          }
        });
      }
      issues.push(...idLabelIssues(spells.addToList, "spells.addToList", 40));
      if (spells.listTag !== undefined && !(typeof spells.listTag === "string" && TAG_SAFE.test(spells.listTag.trim()))) {
        issues.push({ path: "spells.listTag", message: "the list tag cannot be empty or contain , & | ( ) or !" });
      }
    }
  }
  if (draft.spellcasting !== undefined) issues.push(...spellcastingIssues(draft.spellcasting, "spellcasting"));
  issues.push(...progressionIssues(draft, "subclass"));
  return issues;
}

export function customBackgroundDraftIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues = headIssues(draft, ELEMENT_ID, true);
  if (draft.template !== "background") issues.push({ path: "template", message: "a background has the template 'background'" });
  const scales = new Map<string, ScaleValue>();
  issues.push(...startingIssues(draft.starting, "starting", scales));
  const equipment = draft.equipment;
  if (!Array.isArray(equipment) || equipment.length > 30 || equipment.some((line) => !(isName(line, 200) && SAFE_LINE.test(line as string)))) {
    issues.push({ path: "equipment", message: "equipment is up to 30 lines of text without < > or &" });
  }
  if (draft.feature !== undefined) issues.push(...embeddedFeatureIssues(draft.feature, "feature", "background", []));
  const lists = draft.lists;
  if (!Array.isArray(lists) || lists.length > PERSONALITY_LIST_NAMES.length) {
    issues.push({ path: "lists", message: "a background has at most one list each of traits, ideals, bonds and flaws" });
  } else {
    const names = new Set<string>();
    lists.forEach((list: unknown, index: number) => {
      const at = `lists[${index}]`;
      if (!isRecord(list) || !PERSONALITY_LIST_NAMES.includes(list.name as never)) {
        issues.push({ path: `${at}.name`, message: "a list is Personality Trait, Ideal, Bond or Flaw: the sheet reads those names" });
      } else if (names.has(list.name as string)) {
        issues.push({ path: `${at}.name`, message: "each list is made once" });
      } else {
        names.add(list.name as string);
      }
      if (!isRecord(list) || !(isWholeNumber(list.count) && list.count >= 1 && list.count <= 4)) {
        issues.push({ path: `${at}.count`, message: "how many the player picks is a whole number from 1 to 4" });
      }
      const items = isRecord(list) ? list.items : undefined;
      if (!Array.isArray(items) || items.length === 0 || items.length > 50 || items.some((item) => !isName(item, 400))) {
        issues.push({ path: `${at}.items`, message: "list from 1 to 50 entries, each non-empty text" });
      } else if (isRecord(list) && typeof list.count === "number" && list.count > items.length) {
        issues.push({ path: `${at}.count`, message: "the player cannot pick more than the list holds" });
      }
    });
  }
  if (draft.abilityChoice !== undefined) {
    const choice = draft.abilityChoice;
    if (!Array.isArray(choice) || choice.length !== 3 || choice.some((ability) => !CUSTOM_ABILITIES.includes(ability as CustomAbility)) || new Set(choice).size !== 3) {
      issues.push({ path: "abilityChoice", message: "pick three different abilities" });
    }
  }
  if (draft.originFeat !== undefined && !(isRecord(draft.originFeat) && typeof draft.originFeat.id === "string" && ANY_ELEMENT_ID.test(draft.originFeat.id))) {
    issues.push({ path: "originFeat", message: "pick the origin feat" });
  }
  issues.push(...blocksIssues(draft.blocks, scales));
  return issues;
}

function entriesIssues(entries: unknown, path: string, ids: Set<string>): CustomDraftIssue[] {
  if (!Array.isArray(entries)) return [{ path, message: `${path} must be a list` }];
  if (entries.length > 20) return [{ path, message: `${path} hold at most 20 entries` }];
  const issues: CustomDraftIssue[] = [];
  entries.forEach((entry: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path: at, message: "an entry must be an object" });
      return;
    }
    if (typeof entry.id !== "string" || !ENTRY_ID.test(entry.id)) issues.push({ path: `${at}.id`, message: "every entry needs a stable id" });
    else if (ids.has(entry.id.toUpperCase())) issues.push({ path: `${at}.id`, message: "two entries share an id" });
    else ids.add(entry.id.toUpperCase());
    if (!isName(entry.name, 80)) issues.push({ path: `${at}.name`, message: "name the entry (at most 80 characters)" });
    if (!isText(entry.text, 5000)) issues.push({ path: `${at}.text`, message: "the text is at most 5000 characters" });
  });
  return issues;
}

export function customCompanionDraftIssues(draft: Record<string, unknown>): CustomDraftIssue[] {
  const issues = headIssues(draft, ELEMENT_ID, true);
  if (draft.template !== "companion") issues.push({ path: "template", message: "a companion has the template 'companion'" });
  issues.push(...tagIssues(draft.tags));
  if (!CREATURE_SIZES.includes(draft.size as never)) issues.push({ path: "size", message: "pick a size from Tiny to Gargantuan" });
  for (const field of ["creatureType", "alignment"] as const) {
    if (!(isName(draft[field], 60) && SAFE_LINE.test(draft[field] as string))) issues.push({ path: field, message: `${field === "creatureType" ? "the creature type" : "the alignment"} is short text` });
  }
  if (!(typeof draft.challenge === "string" && CHALLENGE.test(draft.challenge.trim()))) issues.push({ path: "challenge", message: "write the challenge like 0, 1/2 or 3" });
  if (!(isWholeNumber(draft.armorClass) && draft.armorClass >= 0 && draft.armorClass <= 40)) issues.push({ path: "armorClass", message: "armor class is a whole number from 0 to 40" });
  if (!(isWholeNumber(draft.hitPoints) && draft.hitPoints >= 0 && draft.hitPoints <= 9999)) issues.push({ path: "hitPoints", message: "hit points are a whole number from 0 to 9999" });
  if (draft.hitPointsText !== undefined && !(isText(draft.hitPointsText, 40) && SAFE_LINE.test(draft.hitPointsText))) {
    issues.push({ path: "hitPointsText", message: "the printed hit points are short text like 19 (3d8+6)" });
  }
  if (!(isWholeNumber(draft.speed) && draft.speed >= 0 && draft.speed <= 300)) issues.push({ path: "speed", message: "walking speed is a whole number of feet from 0 to 300" });
  issues.push(...speedsIssues(draft.speeds, "speeds"));
  const abilities = draft.abilities;
  if (!isRecord(abilities)) issues.push({ path: "abilities", message: "give the six ability scores" });
  else {
    for (const ability of CUSTOM_ABILITIES) {
      const score = abilities[ability];
      if (!(isWholeNumber(score) && score >= 1 && score <= 30)) issues.push({ path: `abilities.${ability}`, message: "an ability score is a whole number from 1 to 30" });
    }
  }
  for (const field of ["senses", "languages", "skills", "saves", "resistances", "immunities", "vulnerabilities", "conditionImmunities"] as const) {
    if (draft[field] !== undefined && !(isText(draft[field], 300) && SAFE_LINE.test(draft[field] as string))) {
      issues.push({ path: field, message: "this is text of at most 300 characters without < > or &" });
    }
  }
  const ids = new Set<string>();
  for (const field of ["traits", "actions", "reactions"] as const) issues.push(...entriesIssues(draft[field], field, ids));
  const stats = draft.stats;
  if (!Array.isArray(stats) || stats.length > 12) issues.push({ path: "stats", message: "companion statistics are a list of at most 12" });
  else {
    const seen = new Set<string>();
    stats.forEach((stat: unknown, index: number) => {
      const at = `stats[${index}]`;
      if (!isRecord(stat)) {
        issues.push({ path: at, message: "a statistic must be an object" });
        return;
      }
      if (typeof stat.id !== "string" || !ENTRY_ID.test(stat.id)) issues.push({ path: `${at}.id`, message: "every statistic needs a stable id" });
      else if (seen.has(stat.id)) issues.push({ path: `${at}.id`, message: "two statistics share an id" });
      else seen.add(stat.id);
      if (!COMPANION_STAT_TARGETS.includes(stat.target as never)) issues.push({ path: `${at}.target`, message: "pick the statistic from the menu" });
      if (stat.mode !== "add" && stat.mode !== "set") issues.push({ path: `${at}.mode`, message: "a statistic is added to or set" });
      else if (stat.mode === "set" && stat.target !== "companion:hp:max") {
        issues.push({ path: `${at}.mode`, message: "only the hit point maximum is set; the others are added" });
      }
      issues.push(...valueIssues(stat.value, `${at}.value`, new Map()));
    });
  }
  return issues;
}

/** Every problem in a character option draft, each naming its field. An empty list means the draft compiles. */
export function customBuildDraftIssues(draft: unknown): CustomDraftIssue[] {
  if (!isRecord(draft)) return [{ path: "", message: "a draft must be an object" }];
  switch (draft.template) {
    case "species":
      return customSpeciesDraftIssues(draft);
    case "subspecies":
      return customSubspeciesDraftIssues(draft);
    case "class":
      return customClassDraftIssues(draft);
    case "subclass":
      return customSubclassDraftIssues(draft);
    case "background":
      return customBackgroundDraftIssues(draft);
    case "companion":
      return customCompanionDraftIssues(draft);
    default:
      return [{ path: "template", message: `pick one of ${CUSTOM_BUILD_TEMPLATES.join(", ")}` }];
  }
}
