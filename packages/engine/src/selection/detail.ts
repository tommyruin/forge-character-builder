/**
 * GetCharacter detail projection — the client-facing view of a character,
 * mirroring the pinned character detail contract. Statistics fields
 * (armorClass, initiative, speed, proficiency) come from the statistics
 * calculator.
 */

import { randomUuid } from "../platform.js";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";
import { evaluateRequirements } from "./expr.js";
import { computeStatistics } from "../statistics/calculator.js";
import {
  ENGINE_INTERNAL_ELEMENTS,
  allocatesAbilityScores,
  selectionRuleGroupKey,
  hasAvailableSelectionOptions,
  selectRuleFor,
  selectionListItemForPath,
  type SelectionRule,
} from "./selection.js";
import { buildLoadIssues, type LoadIssueDto } from "../character/options.js";

export interface AbilityBonusSource {
  source: string;
  value: number;
}

export interface AbilityDetail {
  name: string;
  abbreviation: string;
  baseScore: number;
  additionalScore: number;
  finalScore: number;
  modifier: number;
  additionalSummary: string;
  bonusSources: AbilityBonusSource[];
}

export interface RegisteredElementInfo {
  id: string;
  type: string;
  name: string;
  source: string;
}

export interface SelectionRuleDetail {
  identifier: string;
  name: string;
  type: string;
  requiredLevel: number;
  isList: boolean;
  isOptional: boolean;
  hasAvailableOptions: boolean;
  selectionCount: number;
  hasSelection: boolean;
  selectedElementIds: (string | null)[];
  selectedElementNames: (string | null)[];
  wasInvalidated: boolean;
  previousElementId: string | null;
  previousElementName: string | null;
  spellcastingName: string | null;
  /** Resolving the rule raises an ability score, so clients group it with
   *  ability score improvements wherever the source authored the choice. */
  allocatesAbilityScores: boolean;
}

export interface CharacterDetail {
  id: string;
  name: string;
  playerName: string;
  race: string;
  class: string;
  background: string;
  level: number;
  experience: number;
  armorClass: number;
  initiative: number;
  speed: number;
  proficiency: number;
  gender: string;
  age: string;
  height: string;
  weight: string;
  eyes: string;
  skin: string;
  hair: string;
  backstory: string;
  additionalFeatures: string;
  allies: string;
  organisationName: string;
  notes1: string;
  notes2: string;
  abilities: AbilityDetail[];
  /** The document's ability generation method (0 Roll3D6, 1 Roll4D6DiscardLowest,
   *  2 Array, 3 Points), persisted so the editor reopens on the same mode. */
  generationOption: number;
  /** Point-buy points left after the base scores; negative when over budget. */
  availablePoints: number;
  registeredElements: RegisteredElementInfo[];
  selectionRules: SelectionRuleDetail[];
  loadIssues: LoadIssueDto[];
  loadWarning: string | null;
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
  rulesetMode: string;
  /** The statistics dictionary computed during this detail build, so a
   *  mutation response answers the follow-up statistics query for free. */
  statistics: Record<string, number> | null;
}

const selectionAvailabilityCache = new WeakMap<ElementLibrary, Map<string, boolean>>();

const ABILITIES: Array<{ key: string; name: string; abbreviation: string }> = [
  { key: "strength", name: "Strength", abbreviation: "Str" },
  { key: "dexterity", name: "Dexterity", abbreviation: "Dex" },
  { key: "constitution", name: "Constitution", abbreviation: "Con" },
  { key: "intelligence", name: "Intelligence", abbreviation: "Int" },
  { key: "wisdom", name: "Wisdom", abbreviation: "Wis" },
  { key: "charisma", name: "Charisma", abbreviation: "Cha" },
];

const ABILITY_BY_STAT: Record<string, string> = {
  strength: "strength",
  str: "strength",
  dexterity: "dexterity",
  dex: "dexterity",
  constitution: "constitution",
  con: "constitution",
  intelligence: "intelligence",
  int: "intelligence",
  wisdom: "wisdom",
  wis: "wisdom",
  charisma: "charisma",
  cha: "charisma",
};

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level (standard 5e table). */
function proficiencyBonus(level: number): number {
  return Math.floor((level + 7) / 4);
}

/** Best-effort name/source/type for a registered element id from the library. */
function resolveElementInfo(
  id: string,
  type: string,
  state: CharacterState,
  library?: ElementLibrary,
): RegisteredElementInfo {
  const fromLibrary = library?.byId.get(id);
  if (fromLibrary) {
    return {
      id,
      type: fromLibrary.identity.type,
      name: fromLibrary.identity.name,
      source: fromLibrary.identity.source,
    };
  }
  const baked = ENGINE_INTERNAL_ELEMENTS.get(id);
  if (baked) {
    return { id, type: baked.identity.type, name: baked.identity.name, source: baked.identity.source };
  }
  const find = (nodes: CharacterState["elements"]): CharacterState["elements"][number] | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const nested = find(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const node = find(state.elements);
  return { id, type: node?.type ?? type, name: node?.name ?? "", source: "Internal" };
}

function abilityBonuses(state: CharacterState, library?: ElementLibrary): Map<string, AbilityBonusSource[]> {
  const byAbility = new Map<string, AbilityBonusSource[]>();
  const ctx = requirementContextOf(state, library);
  for (const entry of state.sum.elements) {
    const element = library?.byId.get(entry.id);
    if (!element) continue;
    for (const rule of element.rules) {
      if (rule.kind !== "stat") continue;
      const target = ABILITY_BY_STAT[rule.name];
      if (!target) continue;
      const value = Number(rule.value);
      if (!Number.isFinite(value) || value === 0) continue;
      if (!evaluateRequirements(rule.requirements, ctx)) continue;
      const list = byAbility.get(target) ?? [];
      list.push({ source: element.identity.name, value });
      byAbility.set(target, list);
    }
  }
  return byAbility;
}

function requirementContextOf(state: CharacterState, library?: ElementLibrary): {
  hasElement(id: string): boolean;
  ability(name: string): number;
  level: number;
} {
  const registered = new Set(state.sum.elements.map((e) => e.id));
  for (const id of state.options) registered.add(id);
  const scores = state.abilities as unknown as Record<string, number>;
  // Stat-path atoms resolve against the computed statistics, lazily and once
  // per context (mirrors createRegistrationContext).
  let statValues: Record<string, number> | null = null;
  return {
    hasElement: (id) => registered.has(id),
    ability: (name) => {
      const mapped = ABILITY_BY_STAT[name];
      if (mapped !== undefined) return scores[mapped] ?? Number.NaN;
      if (name in scores) return scores[name]!;
      if (!library) return Number.NaN;
      statValues ??= computeStatistics(state, library);
      return name in statValues ? statValues[name]! : Number.NaN;
    },
    level: state.level,
  };
}

function selectionAvailabilityStateKey(state: CharacterState): string {
  const spellcasting = state.spellcasting
    .map((casting) => `${casting.name}:${casting.ability}:${Object.entries(casting.slots).sort().join(",")}`)
    .join(";");
  return [
    state.level,
    state.rulesetMode,
    state.restrictedSources.slice().sort().join(","),
    Object.values(state.abilities).join(","),
    state.sum.elements.map((element) => element.id).join(","),
    [...state.options].sort().join(","),
    state.levelHistory.map((entry) => `${entry.classId}:${entry.classLevel}`).join(","),
    spellcasting,
  ].join("|");
}

/** All selection wrappers in spawn order, grouped by name like the observed
 * behavior. A node's direct wrappers emit before descending (Race, Class,
 * Background, Alignment, Deity first, then the race subtree's wrappers, then
 * the class subtree's). */
function detailSelectionRules(
  state: CharacterState,
  library?: ElementLibrary,
  loadIssues: readonly LoadIssueDto[] = [],
): SelectionRuleDetail[] {
  const rules: SelectionRuleDetail[] = [];
  const ids = state.selectionRuleIds ?? new Map<string, string>();
  // Invalidated selections surface on their rule group; each load issue
  // marks at most one group.
  const invalidations = loadIssues.filter((issue) => issue.kind === "selectionInvalidated");
  const takeInvalidation = (node: RegisteredElement, selectedId: string | null): LoadIssueDto | null => {
    if (selectedId === null) return null;
    const index = invalidations.findIndex(
      (issue) =>
        issue.ruleType === node.type &&
        issue.ruleName === node.name &&
        issue.requiredLevel === (node.requiredLevel ?? null) &&
        issue.previousElementId === selectedId,
    );
    if (index < 0) return null;
    return invalidations.splice(index, 1)[0]!;
  };
  const availableOptionsByGroup = new Map<string, boolean>();
  // The library is refreshed in place, so its revision scopes the shared
  // cache: group keys name authored rules by index within their element.
  const availabilityStateKey = library
    ? `${library.revision ?? 0}|${selectionAvailabilityStateKey(state)}`
    : null;
  const sharedAvailabilityCache = library
    ? (selectionAvailabilityCache.get(library) ?? new Map<string, boolean>())
    : null;
  if (library && !selectionAvailabilityCache.has(library)) {
    selectionAvailabilityCache.set(library, sharedAvailabilityCache!);
  }
  const walk = (nodes: RegisteredElement[], path: number[]): void => {
    let group: SelectionRuleDetail | null = null;
    let currentGroupKey: string | null = null;
    let groupHasEmptySlot = false;
    let groupHasAvailableOptions = false;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const here = [...path, i];
      if (node.requiredLevel !== undefined) {
        const key = here.join(".");
        let identifier = ids.get(key);
        if (!identifier) {
          identifier = randomUuid();
          ids.set(key, identifier);
        }
        const selectedId = (node.registered ?? "") || null;
        const selectedName = selectedId
          ? node.isList
            ? (library ? selectionListItemForPath(state, library, here, selectedId)?.text ?? node.listText ?? null : node.listText ?? null)
            : (library?.byId.get(selectedId)?.identity.name ?? null)
          : null;
        const selectionRule: SelectionRule = {
          identifier,
          type: node.type,
          name: node.name,
          requiredLevel: node.requiredLevel,
          hasSelection: selectedId !== null,
          selectedElementIds: selectedId ? [selectedId] : [],
          path: here,
        };
        // A group is tied to the source select that spawned its wrappers.
        // Ambiguous legacy wrappers stay separate so similar labels cannot
        // merge two different authored choices.
        const wrapperGroupKey = selectionRuleGroupKey(state, library, selectionRule) ?? `unresolved:${key}`;
        const authoredSelect = library ? selectRuleFor(state, library, selectionRule) : undefined;
        const allocates = library ? allocatesAbilityScores(state, library, selectionRule) : false;
        let nodeHasAvailableOptions = true;
        if (selectedId === null && library !== undefined) {
          const cached = availableOptionsByGroup.get(wrapperGroupKey);
          if (cached !== undefined) {
            nodeHasAvailableOptions = cached;
          } else {
            const cacheKey = `${availabilityStateKey}|${wrapperGroupKey}`;
            const shared = sharedAvailabilityCache?.get(cacheKey);
            if (shared !== undefined) {
              nodeHasAvailableOptions = shared;
            } else {
              nodeHasAvailableOptions = hasAvailableSelectionOptions(state, library, selectionRule);
              sharedAvailabilityCache?.set(cacheKey, nodeHasAvailableOptions);
            }
            availableOptionsByGroup.set(wrapperGroupKey, nodeHasAvailableOptions);
          }
        }
        const invalidation = takeInvalidation(node, selectedId);
        if (group && currentGroupKey === wrapperGroupKey) {
          group.selectionCount += 1;
          group.selectedElementIds.push(selectedId);
          group.selectedElementNames.push(selectedName);
          if (invalidation && !group.wasInvalidated) {
            group.wasInvalidated = true;
            group.previousElementId = invalidation.previousElementId;
            group.previousElementName = invalidation.previousElementName;
          }
          // A group reports selected when ANY slot is filled
          // (p5f-0019: the 6-slot spellbook group with one pick reports
          // hasSelection true), not only when every slot is filled.
          group.hasSelection = group.hasSelection || selectedId !== null;
          if (selectedId === null) {
            groupHasAvailableOptions = groupHasEmptySlot
              ? groupHasAvailableOptions || nodeHasAvailableOptions
              : nodeHasAvailableOptions;
            groupHasEmptySlot = true;
          }
          group.hasAvailableOptions = !groupHasEmptySlot || groupHasAvailableOptions;
        } else {
          groupHasEmptySlot = selectedId === null;
          groupHasAvailableOptions = selectedId === null && nodeHasAvailableOptions;
          group = {
            identifier,
            name: node.name,
            type: node.type,
            requiredLevel: node.requiredLevel,
            isList: node.isList === true,
            isOptional: node.type === "Deity" || authoredSelect?.optional === true,
            hasAvailableOptions: !groupHasEmptySlot || groupHasAvailableOptions,
            selectionCount: 1,
            hasSelection: selectedId !== null,
            selectedElementIds: [selectedId],
            selectedElementNames: [selectedName],
            wasInvalidated: invalidation !== null,
            previousElementId: invalidation?.previousElementId ?? null,
            previousElementName: invalidation?.previousElementName ?? null,
            spellcastingName: null,
            allocatesAbilityScores: allocates,
          };
          currentGroupKey = wrapperGroupKey;
          rules.push(group);
        }
      } else {
        group = null;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      walk(nodes[i]!.children, [...path, i]);
    }
  };
  walk(state.elements, []);
  return rules;
}

/** Projects the character state into the client-facing detail view. */
export function buildCharacterDetail(
  state: CharacterState,
  library?: ElementLibrary,
): CharacterDetail {
  const bonuses = abilityBonuses(state, library);
  const abilities: AbilityDetail[] = ABILITIES.map(({ key, name, abbreviation }) => {
    const base = state.abilities[key as keyof CharacterState["abilities"]];
    const sources = bonuses.get(key) ?? [];
    const additional = sources.reduce((sum, source) => sum + source.value, 0);
    const final = base + additional;
    const summary = sources.map((source) => `${source.source} (${source.value})`).join(", ");
    return {
      name,
      abbreviation,
      baseScore: base,
      additionalScore: additional,
      finalScore: final,
      modifier: abilityModifier(final),
      additionalSummary: summary,
      bonusSources: sources,
    };
  });

  const dexModifier = abilityModifier(state.abilities.dexterity);

  const statistics = library ? computeStatistics(state, library) : null;
  const statValue = (key: string, fallback: number): number => statistics?.[key] ?? fallback;
  const loadIssues = library ? buildLoadIssues(state, library) : [];

  return {
    id: state.id,
    name: state.name,
    playerName: state.playerName,
    race: state.race,
    class: state.klass,
    background: state.background,
    level: state.level,
    experience: state.experience,
    armorClass: statValue("ac", 10 + dexModifier),
    initiative: statValue("initiative", dexModifier),
    speed: statValue("speed", 0),
    proficiency: statValue("proficiency", proficiencyBonus(state.level)),
    gender: state.gender,
    age: state.appearance.age,
    height: state.appearance.height,
    weight: state.appearance.weight,
    eyes: state.appearance.eyes,
    skin: state.appearance.skin,
    hair: state.appearance.hair,
    backstory: state.backstory,
    additionalFeatures: state.additionalFeatures,
    allies: state.organization.allies,
    organisationName: state.organization.name,
    notes1: state.notes.left,
    notes2: state.notes.right,
    abilities,
    generationOption: state.generationOption,
    availablePoints: state.availablePoints,
    registeredElements: state.sum.elements.map((entry) =>
      resolveElementInfo(entry.id, entry.type, state, library),
    ),
    selectionRules: detailSelectionRules(state, library, loadIssues),
    loadIssues,
    loadWarning: null,
    personalityTraits: state.backgroundTraits.traits,
    ideals: state.backgroundTraits.ideals,
    bonds: state.backgroundTraits.bonds,
    flaws: state.backgroundTraits.flaws,
    rulesetMode: state.rulesetMode,
    statistics,
  };
}
