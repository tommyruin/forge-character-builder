import type {
  KnownSpellDto as ApiKnownSpellDto,
  SpellcasterDto as ApiSpellcasterDto,
  SpellPointCostDto,
  SpellResourceDto,
} from "@forge-cb/api";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import {
  evaluateSupportsExpression,
  highestSlotLevelFromRules,
  isRestrictedForCharacter,
  selectionOptions,
  selectionRuleFor,
  selectionSlotRule,
  spellListExtensions,
} from "../selection/selection.js";
import type { ParsedElement } from "../content/parser.js";
import { engineError } from "../errors.js";
import type { MagicCasterBlock } from "./state.js";
import {
  alwaysPreparedSets,
  canonicalSourceRank,
  fullCasterList,
  ownKnownSpells,
  spellInfo,
  type SpellInfo,
} from "./spelllist.js";

/**
 * Magic DTO projections.
 */

export type KnownSpellDto = ApiKnownSpellDto;
export type SpellcasterDto = ApiSpellcasterDto;
export type { SpellPointCostDto, SpellResourceDto };

export interface SpellBrowseEntryDto {
  id: string;
  name: string;
  source: string;
  level: number;
  school: string;
  isRitual: boolean;
  isConcentration: boolean;
  components: string;
  status: string;
  selectedNumber: number | null;
  castingTime: string;
  range: string;
  duration: string;
  description: string;
}

export interface SpellRuleSlotDto {
  number: number;
  spellId: string | null;
  spellName: string | null;
}

export interface SpellBrowseDto {
  ruleIdentifier: string;
  ruleName: string;
  spellcastingName: string | null;
  selectionCount: number;
  selectedCount: number;
  slots: SpellRuleSlotDto[];
  activeSpellLevels: number[];
  maxSpellLevel: number;
  spells: SpellBrowseEntryDto[];
}

const ABILITY_ABBR: Readonly<Record<string, string>> = {
  Strength: "str",
  Dexterity: "dex",
  Constitution: "con",
  Intelligence: "int",
  Wisdom: "wis",
  Charisma: "cha",
};

const SPELL_POINTS_OPTION = "ID_INTERNAL_OPTION_ALLOW_SPELL_POINTS";

// The public 5e per-slot-level spell point costs; slots of level 6+ can be
// converted only once each per long rest. The maximum pool is the caster's
// actual slot table weighted by these costs, so half and third casters get
// their own totals rather than the full-caster progression. Only the
// single-class projection is enabled here; multiclass pools remain uncombined
// until the repository has captured evidence for their interaction.
const SPELL_POINT_COSTS: readonly SpellPointCostDto[] = [
  { spellLevel: 1, points: 2, oncePerLongRest: false },
  { spellLevel: 2, points: 3, oncePerLongRest: false },
  { spellLevel: 3, points: 5, oncePerLongRest: false },
  { spellLevel: 4, points: 6, oncePerLongRest: false },
  { spellLevel: 5, points: 7, oncePerLongRest: false },
  { spellLevel: 6, points: 9, oncePerLongRest: true },
  { spellLevel: 7, points: 10, oncePerLongRest: true },
  { spellLevel: 8, points: 11, oncePerLongRest: true },
  { spellLevel: 9, points: 13, oncePerLongRest: true },
];

function isPactMagic(block: MagicCasterBlock): boolean {
  return block.source.toUpperCase().includes("PACT_MAGIC");
}

function spellResource(state: CharacterState, block: MagicCasterBlock, slots: readonly number[]): SpellResourceDto {
  const canUseSpellPoints = !isPactMagic(block);
  if (
    !canUseSpellPoints ||
    !state.options.has(SPELL_POINTS_OPTION) ||
    state.magic?.multiclass === true
  ) {
    return { mode: "slots", canUseSpellPoints };
  }

  const maximumPoints = SPELL_POINT_COSTS.reduce(
    (total, cost) => total + (slots[cost.spellLevel - 1] ?? 0) * cost.points,
    0,
  );
  return {
    mode: "spellPoints",
    // The engine does not track expended resources; the pool reports full.
    currentPoints: maximumPoints,
    maximumPoints,
    costs: SPELL_POINT_COSTS.map((cost) => ({ ...cost })),
    shared: false,
    canUseSpellPoints: true,
  };
}

function slotsArray(block: MagicCasterBlock): number[] {
  const slots: number[] = [];
  for (let level = 1; level <= 9; level++) {
    const value = Number.parseInt(block.slots[`s${level}`] ?? "0", 10);
    slots.push(Number.isFinite(value) ? value : 0);
  }
  return slots;
}

function maxSlotLevel(slots: number[]): number {
  for (let level = 9; level >= 1; level--) {
    if (slots[level - 1]! > 0) return level;
  }
  return 0;
}

function knownFlags(
  block: MagicCasterBlock,
  alwaysPrepared: Set<string>,
): Map<string, { prepared: boolean; always: boolean }> {
  const flags = new Map<string, { prepared: boolean; always: boolean }>();
  for (const spell of [...block.cantrips, ...block.spells]) {
    const always = alwaysPrepared.has(spell.id);
    flags.set(spell.id, { prepared: spell.prepared && !always, always });
  }
  return flags;
}

function toKnownSpellDto(info: SpellInfo, flags: { prepared: boolean; always: boolean }): KnownSpellDto {
  return {
    id: info.id,
    name: info.name,
    source: info.source,
    isPrepared: flags.prepared,
    isChosen: flags.prepared || flags.always,
    level: info.level,
    school: info.school,
    isRitual: info.isRitual,
    isConcentration: info.isConcentration,
    isAlwaysPrepared: flags.always,
    castingTime: info.castingTime,
    components: info.components,
    range: info.range,
    duration: info.duration,
    description: info.description,
  };
}

/** Whether the spellcasting feature projects the full class list (`<list known="true">`). */
function isFullListCaster(library: ElementLibrary, block: MagicCasterBlock): boolean {
  const feature = library.byId.get(block.source);
  return feature?.spellcasting?.listKnown === true;
}

/**
 * Builds the spellcasting DTO (list of casters in document order).
 * `statistics` is the computed values map; `casterIds` carries the per-caster
 * session identifiers.
 */
export function buildSpellcastingDto(
  state: CharacterState,
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
  casterIds: ReadonlyMap<string, string>,
): SpellcasterDto[] {
  const magic = state.magic;
  if (magic === null) return [];
  const always = alwaysPreparedSets(state, library);
  const proficiency = statistics["proficiency"] ?? 0;
  const abilityModifier = (ability: string): number => {
    const key = `${ability.toLowerCase()}:modifier`;
    return statistics[key] ?? 0;
  };

  const casters: SpellcasterDto[] = [];
  const seenNames = new Set<string>();
  let grantedProjected = false;
  for (const block of magic.casters) {
    // One caster per spellcasting name: a stale document may still carry a
    // duplicated block (an extension serialized as a caster), which must not
    // project twice.
    if (seenNames.has(block.name)) continue;
    seenNames.add(block.name);
    const ability = ABILITY_ABBR[block.ability] ?? block.ability.toLowerCase();
    const feature = library.byId.get(block.source);
    const requiresPreparation = feature?.spellcasting?.prepare === true;
    // The per-caster statistics carry content bonuses on top of the
    // per-ability value; fall back through the per-ability key to the
    // computed formula.
    const casterKey = block.name.toLowerCase();
    const perCasterAttack = statistics[`${casterKey}:spellcasting:attack`];
    const attackFromStats = perCasterAttack !== undefined && perCasterAttack !== 0
      ? perCasterAttack
      : statistics[`spellcasting:attack:${ability}`];
    const attackModifier = attackFromStats ?? proficiency + abilityModifier(block.ability);
    const perCasterDc = statistics[`${casterKey}:spellcasting:dc`];
    const dcFromStats = perCasterDc !== undefined && perCasterDc !== 0
      ? perCasterDc
      : statistics[`spellcasting:dc:${ability}`];
    const saveDc = dcFromStats ?? 8 + proficiency + abilityModifier(block.ability);
    const prepareKey = `${block.name.toLowerCase()}:spellcasting:prepare`;
    const prepareCount = statistics[prepareKey] ?? 0;
    const rawSlots = slotsArray(block);
    const resource = spellResource(state, block, rawSlots);
    const slots = resource.mode === "spellPoints" ? Array(9).fill(0) : rawSlots;
    const maxLevel = maxSlotLevel(rawSlots);

    const fullList = isFullListCaster(library, block);
    const alwaysSet = new Set(always.get(block.name) ?? []);
    const flags = knownFlags(block, alwaysSet);
    let spellInfos: SpellInfo[];
    if (fullList) {
      // Full-list casters: the always-prepared grants first (level, name),
      // then the character's own cantrips, then the class list (levels 1..max)
      // in plain name order (captured: Aid sorts before Bless for the paladin).
      const all = fullCasterList(library, block.name, maxLevel);
      const alwaysInfos = [...alwaysSet]
        .map((id) => spellInfo(library, id))
        .filter((info): info is SpellInfo => info !== null && info.level <= maxLevel)
        .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name) || canonicalSourceRank(left.source) - canonicalSourceRank(right.source));
      const ownCantrips = block.cantrips
        .map((entry) => spellInfo(library, entry.id))
        .filter((info): info is SpellInfo => info !== null);
      const present = new Set(alwaysInfos.map((info) => info.id));
      const rest = all.filter((info) => !present.has(info.id) && info.level >= 1);
      rest.sort((left, right) => left.name.localeCompare(right.name) || canonicalSourceRank(left.source) - canonicalSourceRank(right.source));
      spellInfos = [...alwaysInfos, ...ownCantrips, ...rest];
    } else {
      spellInfos = ownKnownSpells(library, block);
    }
    // Granted spells live in <additional> and belong to no single caster, so
    // they ride on the first caster: always ready, never counted against the
    // preparation limit, and removable through the DM-grant surface.
    if (!grantedProjected) {
      const present = new Set(spellInfos.map((info) => info.id));
      for (const extra of magic.additional) {
        if (present.has(extra.id)) continue;
        const info = spellInfo(library, extra.id);
        if (info === null) continue;
        present.add(info.id);
        spellInfos.push(info);
        alwaysSet.add(info.id);
      }
      grantedProjected = true;
    }
    const knownSpells = spellInfos.map((info) =>
      toKnownSpellDto(info, flags.get(info.id) ?? { prepared: false, always: alwaysSet.has(info.id) }),
    );

    casters.push({
      identifier: casterIds.get(block.name) ?? block.name,
      name: block.name,
      ability: block.ability,
      attackModifier,
      saveDc,
      requiresPreparation,
      allowReplace: feature?.spellcasting?.allowReplace === true,
      prepareCount,
      currentPreparedCount: knownSpells.filter((spell) => spell.isPrepared).length,
      slotsPerLevel: slots,
      knownSpells,
      maxSpellLevel: maxLevel,
      resource,
    });
  }
  return casters;
}

function spellcastingNameFor(
  state: CharacterState,
  library: ElementLibrary,
  path: number[],
): string | null {
  let nodes = state.elements;
  for (const index of path.slice(0, -1)) {
    const node = nodes[index];
    if (node === undefined) return null;
    const element = library.byId.get(node.id);
    if (element?.spellcasting !== undefined) return element.spellcasting.name;
    nodes = node.children;
  }
  return null;
}

/** The adjacent same-name/type/level rule group containing the node at path. */
function spellRuleGroup(
  state: CharacterState,
  path: number[],
): { groupPath: number[]; groupNodes: { registered: string | null }[] } {
  const parent = path.slice(0, -1);
  const index = path[path.length - 1]!;
  let nodes: { id: string; registered: string | null; requiredLevel?: number; type?: string; name?: string; children: { id: string }[] }[] = state.elements as never;
  for (const i of parent) {
    const node = nodes[i];
    if (node === undefined) break;
    nodes = node.children as never;
  }
  const node = nodes[index];
  if (node === undefined || node.requiredLevel === undefined) {
    return { groupPath: path, groupNodes: [] };
  }
  let start = index;
  while (start > 0 && sameRule(nodes[start - 1]!, node)) start--;
  let end = index + 1;
  while (end < nodes.length && sameRule(nodes[end]!, node)) end++;
  const groupPath = [...parent, start];
  return {
    groupPath,
    groupNodes: nodes.slice(start, end).map((member) => ({ registered: member.registered ?? null })),
  };
}

function sameRule(left: { requiredLevel?: number; type?: string; name?: string }, right: { requiredLevel?: number; type?: string; name?: string }): boolean {
  return left.requiredLevel === right.requiredLevel && left.type === right.type && left.name === right.name;
}

function slotProgressionSpellLevel(
  state: CharacterState,
  library: ElementLibrary,
  casterName: string,
  classLevel: number,
): number {
  const classIds = new Set(
    state.levelHistory
      .filter((entry) => !entry.isPending && library.byId.get(entry.classId)?.identity.name === casterName)
      .map((entry) => entry.classId),
  );
  const classElements = [...classIds]
    .map((id) => library.byId.get(id))
    .filter((element): element is NonNullable<typeof element> => element !== undefined);
  const featureIds = new Set<string>();
  for (const element of classElements) {
    for (const rule of element.rules) {
      if (rule.kind === "grant" && rule.type === "Class Feature" && rule.id !== undefined) featureIds.add(rule.id);
    }
  }
  const featureElements = [...featureIds]
    .map((id) => library.byId.get(id))
    .filter((element): element is NonNullable<typeof element> => element !== undefined)
    .filter((element) => element.spellcasting?.name === casterName);
  let highest = 0;
  for (const element of featureElements) {
    highest = Math.max(highest, highestSlotLevelFromRules(element.rules, casterName, classLevel));
  }
  return highest;
}

/**
 * Builds the spell-browse DTO for a Spell selection rule.
 * Errors: unknown rule and non-Spell rule are 404s.
 */
export function buildSpellBrowseDto(
  state: CharacterState,
  library: ElementLibrary,
  ruleId: string,
): SpellBrowseDto {
  const rule = selectionRuleFor(state, ruleId);
  if (rule === null) {
    throw engineError("not-found", `Selection rule '${ruleId}' does not exist on the loaded character.`);
  }
  if (rule.type !== "Spell") {
    throw engineError("not-found", `Selection rule '${ruleId}' is not a Spell rule.`);
  }
  // The browsed rule is the whole adjacent same-name group (the wizard's
  // level-1 cantrip group carries three slots, one per wrapper).
  const { groupPath, groupNodes } = spellRuleGroup(state, rule.path);
  const selectedIds = groupNodes.map((node) => {
    const registered = node.registered ?? null;
    return registered === "" ? null : registered;
  });
  // A Spell rule under a spellcasting feature browses that caster's list; a
  // rule with no such ancestor (racial traits, feats — the Astral Elf's
  // Astral Fire, the High Elf wizard cantrip) has no caster block at all and
  // browses its own supports-bounded option set instead.
  const casterName = spellcastingNameFor(state, library, groupPath);
  const caster = casterName === null ? null : (state.magic?.casters.find((block) => block.name === casterName) ?? null);
  if (casterName !== null && caster === null) {
    throw engineError("not-found", `Selection rule '${ruleId}' has no active '${casterName}' caster.`);
  }
  const slots = selectedIds.map((spellId, index) => ({
    number: index + 1,
    spellId: spellId || null,
    spellName: spellId ? (library.byId.get(spellId)?.identity.name ?? null) : null,
  }));

  const known = new Set<string>();
  for (const block of caster !== null ? [caster] : (state.magic?.casters ?? [])) {
    for (const spell of [...block.cantrips, ...block.spells]) known.add(spell.id);
  }
  for (const extra of state.magic?.additional ?? []) known.add(extra.id);

  const selectedSlots = new Map<string, number>();
  for (const [index, spellId] of selectedIds.entries()) {
    if (spellId !== null) selectedSlots.set(spellId, index + 1);
  }

  const selectionFull = selectedIds.length > 0 && selectedIds.every((id) => id !== null);
  const spells: SpellBrowseEntryDto[] = [];
  const isCantripRule = rule.name.startsWith("Cantrip");
  const eligibleIds = new Set<string>();
  for (let number = 1; number <= groupNodes.length; number++) {
    const slotRule = selectionSlotRule(state, rule, number);
    for (const option of selectionOptions(state, library, slotRule)) eligibleIds.add(option.id);
  }

  if (caster === null) {
    // Caster-less browse: the rule's eligible options are the whole universe
    // — the supports expression already encodes list and level constraints.
    for (const element of library.byType.get("Spell") ?? []) {
      const info = spellInfo(library, element.identity.id);
      if (info === null) continue;
      if (!eligibleIds.has(info.id) && !selectedSlots.has(info.id)) continue;
      if (isRestrictedForCharacter(state, library, element)) continue;
      const selectedNumber = selectedSlots.get(info.id) ?? null;
      let status: string;
      if (selectedNumber !== null) status = "selected";
      else if (known.has(info.id)) status = "known";
      else if (selectionFull) status = "limit";
      else status = "learnable";
      spells.push({
        id: info.id,
        name: info.name,
        source: info.source,
        level: info.level,
        school: info.school,
        isRitual: info.isRitual,
        isConcentration: info.isConcentration,
        components: info.components,
        status,
        selectedNumber,
        castingTime: info.castingTime,
        range: info.range,
        duration: info.duration,
        description: info.description,
      });
    }
    spells.sort((left, right) => {
      const byLevel = left.level - right.level;
      if (byLevel !== 0) return byLevel;
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return canonicalSourceRank(left.source) - canonicalSourceRank(right.source);
    });
    const ruleMaxLevel = spells.reduce((highest, spell) => Math.max(highest, spell.level), 0);
    const levels: number[] = [];
    for (let level = 1; level <= ruleMaxLevel; level++) levels.push(level);
    return {
      ruleIdentifier: rule.identifier,
      ruleName: rule.name,
      spellcastingName: null,
      selectionCount: selectedIds.length,
      selectedCount: selectedIds.length - selectedIds.filter((id) => id === null).length,
      slots,
      activeSpellLevels: levels,
      maxSpellLevel: ruleMaxLevel,
      spells,
    };
  }

  const progressionLevel = isCantripRule
    ? 0
    : slotProgressionSpellLevel(state, library, caster.name, rule.requiredLevel);
  const maxLevel = isCantripRule
    ? 0
    : progressionLevel > 0 ? progressionLevel : maxSlotLevel(slotsArray(caster));

  // The caster's browsable universe is its base list expression (the
  // spellcasting feature's <list>, defaulting to the caster name) OR-ed with
  // every registered extension expression, plus the extension spell ids
  // (subclass expanded lists, dragonmark traits). Cantrip rules browse
  // level 0; spell rules browse every levelled spell, with levels above the
  // castable maximum marked "level".
  const feature = library.byId.get(caster.source);
  const listExpressions: string[] = [feature?.spellcasting?.list ?? caster.name];
  const extensions = spellListExtensions(state, library, caster.name);
  listExpressions.push(...extensions.expressions);
  const extensionIds = new Set(extensions.spellIds);
  const onBrowseList = (element: ParsedElement): boolean => {
    if (extensionIds.has(element.identity.id)) return true;
    const have = new Set(element.supports.map((tag) => tag.trim()));
    have.add(element.identity.id);
    const level = element.setters.find((setter) => setter.name === "level")?.value;
    if (level !== undefined) have.add(level.trim());
    return listExpressions.some((expression) => evaluateSupportsExpression(expression, have));
  };

  for (const element of library.byType.get("Spell") ?? []) {
    const info = spellInfo(library, element.identity.id);
    if (info === null) continue;
    if (isCantripRule ? info.level !== 0 : info.level === 0) continue;
    if (!onBrowseList(element)) continue;
    if (isRestrictedForCharacter(state, library, element)) continue;
    const selectedNumber = selectedSlots.get(info.id) ?? null;
    let status: string;
    if (selectedNumber !== null) status = "selected";
    else if (known.has(info.id)) status = "known";
    else if (!eligibleIds.has(info.id)) status = !isCantripRule && info.level > maxLevel ? "level" : "unavailable";
    else if (selectionFull) status = "limit";
    else status = "learnable";
    spells.push({
      id: info.id,
      name: info.name,
      source: info.source,
      level: info.level,
      school: info.school,
      isRitual: info.isRitual,
      isConcentration: info.isConcentration,
      components: info.components,
      status,
      selectedNumber,
      castingTime: info.castingTime,
      range: info.range,
      duration: info.duration,
      description: info.description,
    });
  }
  // Extension spells outside the rule's level scope still browse (captured:
  // the cantrip browse lists all nine dragonmark spells) with status
  // "unavailable" at their own level.
  const present = new Set(spells.map((spell) => spell.id));
  for (const id of extensionIds) {
    if (present.has(id)) continue;
    const info = spellInfo(library, id);
    if (info === null) continue;
    const element = library.byId.get(id);
    if (element !== undefined && isRestrictedForCharacter(state, library, element)) continue;
    present.add(id);
    spells.push({
      id: info.id,
      name: info.name,
      source: info.source,
      level: info.level,
      school: info.school,
      isRitual: info.isRitual,
      isConcentration: info.isConcentration,
      components: info.components,
      status: "unavailable",
      selectedNumber: null,
      castingTime: info.castingTime,
      range: info.range,
      duration: info.duration,
      description: info.description,
    });
  }
  spells.sort((left, right) => {
    const byLevel = left.level - right.level;
    if (byLevel !== 0) return byLevel;
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return canonicalSourceRank(left.source) - canonicalSourceRank(right.source);
  });

  const selectionCount = selectedIds.length;
  const activeSpellLevels: number[] = [];
  if (!isCantripRule) {
    for (let level = 1; level <= maxLevel; level++) activeSpellLevels.push(level);
  }
  return {
    ruleIdentifier: rule.identifier,
    ruleName: rule.name,
    spellcastingName: casterName,
    selectionCount,
    selectedCount: selectionCount - selectedIds.filter((id) => id === null).length,
    slots,
    activeSpellLevels,
    maxSpellLevel: maxLevel,
    spells,
  };
}
