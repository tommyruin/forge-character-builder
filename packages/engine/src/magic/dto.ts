import type {
  KnownSpellDto as ApiKnownSpellDto,
  SpellcasterDto as ApiSpellcasterDto,
  SpellPointCostDto,
  SpellResourceDto,
} from "@forge-cb/api";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import {
  matchesSupports,
  isRestrictedForCharacter,
  selectionOptions,
  selectionRuleGroup,
  selectionRuleFor,
  spellListExtensions,
  spellSlotCeilingFor,
} from "../selection/selection.js";
import type { ParsedElement } from "../content/parser.js";
import { engineError } from "../errors.js";
import type { MagicCasterBlock } from "./state.js";
import { casterModifier } from "./caster-modifiers.js";
import {
  alwaysPreparedSets,
  alwaysPreparedUsages,
  canonicalSourceRank,
  compareSpellInfo,
  fullCasterList,
  ownKnownSpells,
  spellInfo,
  type SpellInfo,
} from "./spelllist.js";
import { featureSpellCasters, type FeatureSpellCaster } from "./feature-casters.js";
import { additionalSpellPool, isDmGrantSource, isGeneratedSpellProxyId } from "./granted-spells.js";

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

/**
 * The banner DM-granted spells project under when no class caster carries
 * them. The spell cards already file such a spell as "Additional Spell,
 * {name}" (`spellOriginLabel` prints the `<additional>` entry's own `source`),
 * so the block that gathers them is named for the same family.
 */
export const GRANTED_CASTER_NAME = "Additional Spells";

/**
 * The `magicCasterIds` key for that block. No `<magic>` caster owns it, so it
 * cannot be keyed by a caster name; the prefix keeps it clear of the feature
 * casters' `feature:<element id>` keys.
 */
export const GRANTED_CASTER_KEY = "additional:granted";

/** The abilities a spell can be cast with, in PHB order. */
const GRANTED_ABILITY_ORDER: readonly string[] = ["Intelligence", "Wisdom", "Charisma"];

/**
 * The ability a DM-granted spell is cast with. A grant carries no ability and
 * the content supports no claim about which one applies, so rather than assert
 * a rule the block reports the character's strongest casting ability (ties in
 * PHB order) — the most favourable reading, and one a DM can overrule at the
 * table.
 */
export function grantedCasterAbility(statistics: Readonly<Record<string, number>>): string {
  let best = GRANTED_ABILITY_ORDER[0]!;
  let bestModifier = Number.NEGATIVE_INFINITY;
  for (const ability of GRANTED_ABILITY_ORDER) {
    const modifier = statistics[`${ability.toLowerCase()}:modifier`] ?? 0;
    if (modifier > bestModifier) {
      bestModifier = modifier;
      best = ability;
    }
  }
  return best;
}

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

/**
 * A declared usage with its `{{stat}}` tokens filled from the statistics
 * (Favored Enemy's "{{favored enemy:usage}}/Long Rest" reads "2/Long Rest"), or
 * null when a token has no value, since a raw template means nothing on a
 * sheet. The sheet's `substitute` is not reused: sheet/model.ts imports this
 * module.
 */
function resolvedUsage(usage: string, statistics: Readonly<Record<string, number>>): string | null {
  let unresolved = false;
  const text = usage.replace(/\{\{([^}]+)\}\}/g, (match, rawKey: string) => {
    const value = statistics[rawKey.trim()];
    if (typeof value === "number" && Number.isFinite(value)) return `${value}`;
    unresolved = true;
    return match;
  });
  return unresolved ? null : text;
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
  // A character can have feature spells with no `<magic>` region at all (a
  // Fighter whose background granted Magic Initiate), so the feature casters
  // are built before the early return.
  const featureCasters = featureSpellCasters(state, library);
  if (magic === null && featureCasters.length === 0) return [];
  const always = alwaysPreparedSets(state, library);
  const usages = alwaysPreparedUsages(state, library);
  const proficiency = statistics["proficiency"] ?? 0;
  const abilityModifier = (ability: string): number => {
    const key = `${ability.toLowerCase()}:modifier`;
    return statistics[key] ?? 0;
  };

  const casters: SpellcasterDto[] = [];
  const seenNames = new Set<string>();
  let legacyProjected = false;
  for (const block of magic?.casters ?? []) {
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
    const base = proficiency + abilityModifier(block.ability);
    const attackModifier = casterModifier(statistics, block.name, ability, "attack", base);
    const saveDc = casterModifier(statistics, block.name, ability, "dc", 8 + base);
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
      // Feature grants (2024 subclass expanded lists, Divine Smite, Find
      // Steed) never enter `<spells>`, so the known-caster projection unions
      // them in and re-sorts with the DTO comparator.
      const known = new Set(spellInfos.map((info) => info.id));
      const granted: SpellInfo[] = [];
      for (const id of alwaysSet) {
        if (known.has(id)) continue;
        const info = spellInfo(library, id);
        if (info === null) continue;
        known.add(id);
        granted.push(info);
      }
      if (granted.length > 0) spellInfos = [...spellInfos, ...granted].sort(compareSpellInfo);
    }
    // Non-DM <additional> entries (feature grants serialized by an importer)
    // still ride on the first caster: always ready, never counted against the
    // preparation limit. DM grants are partitioned after the class casters: a
    // class list that already carries one keeps it, the rest gather in the
    // "Additional Spells" block.
    if (!legacyProjected) {
      const present = new Set(spellInfos.map((info) => info.id));
      for (const extra of magic?.additional ?? []) {
        if (isDmGrantSource(extra.source)) continue;
        if (present.has(extra.id)) continue;
        const info = spellInfo(library, extra.id);
        if (info === null) continue;
        present.add(info.id);
        spellInfos.push(info);
        alwaysSet.add(info.id);
      }
      legacyProjected = true;
    }
    // A granted spell the feature also lets the caster cast without a slot
    // (Divine Smite, Hunter's Mark) carries that allowance, as a feature
    // caster's spells do.
    const casterUsages = usages.get(block.name);
    const knownSpells = spellInfos.map((info) => {
      const spell = toKnownSpellDto(info, flags.get(info.id) ?? { prepared: false, always: alwaysSet.has(info.id) });
      const declared = casterUsages?.get(info.id);
      const usage = declared === undefined ? null : resolvedUsage(declared.usage, statistics);
      return usage === null ? spell : { ...spell, usage, ...(declared?.note === undefined ? {} : { usageNote: declared.note }) };
    });

    casters.push({
      identifier: casterIds.get(block.name) ?? block.name,
      name: block.name,
      kind: "class",
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
  // The class lists decide where additional spells live, so the set is taken
  // before the feature casters join (a feat's pick is not a class list).
  const classListIds = new Set(casters.flatMap((caster) => caster.knownSpells.map((spell) => spell.id)));
  for (const feature of featureCasters) {
    // Generated "Additional ... Spell" item proxies are DM grants; they are
    // partitioned with the rest instead of earning a banner of their own.
    if (isGeneratedSpellProxyId(feature.elementId)) continue;
    casters.push(featureCasterDto(library, statistics, casterIds, feature, proficiency, abilityModifier));
  }
  const partition = partitionAdditionalGrants(additionalSpellPool(state, library), classListIds, statistics);
  for (const group of partition.groups) {
    const identifier = grantedCasterIdentifier(partition.groups.length, group.profile);
    casters.push(grantedCasterDto(casterIds, group.spells, group.profile, identifier));
  }
  return casters;
}

/**
 * The spell ids every class caster's projected list carries. A caller that
 * has to mirror the additional-spell partition (the attack-option sources)
 * reads them here rather than rebuilding the full-list projection.
 */
export function classCasterSpellIds(
  state: CharacterState,
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
): Set<string> {
  const ids = new Set<string>();
  for (const caster of buildSpellcastingDto(state, library, statistics, new Map())) {
    if (caster.kind !== "class") continue;
    for (const spell of caster.knownSpells) ids.add(spell.id);
  }
  return ids;
}

/** The header values an additional-spell block prints. */
export interface AdditionalGrantProfile {
  ability: string;
  attackModifier: number;
  saveDc: number;
}

export interface AdditionalGrantGroup {
  profile: AdditionalGrantProfile;
  spells: SpellInfo[];
}

export interface AdditionalGrantPartition {
  /** The spells a class caster's projected list already carries. */
  onList: SpellInfo[];
  /** The rest, grouped by the header profile they share. */
  groups: AdditionalGrantGroup[];
}

/**
 * The profile every additional spell prints under today: the character's best
 * casting ability, that ability's modifier plus proficiency for the attack
 * bonus, and the same base for the save DC.
 */
export function grantedProfile(statistics: Readonly<Record<string, number>>): AdditionalGrantProfile {
  const ability = grantedCasterAbility(statistics);
  const proficiency = statistics["proficiency"] ?? 0;
  const modifier = statistics[`${ability.toLowerCase()}:modifier`] ?? 0;
  return { ability, attackModifier: proficiency + modifier, saveDc: 8 + proficiency + modifier };
}

/**
 * Splits the additional spells by whether a class caster's list already
 * carries them, then groups the remainder so identical header profiles share
 * one block. Spell order within a group follows the pool.
 */
export function partitionAdditionalGrants(
  spells: readonly SpellInfo[],
  classListIds: ReadonlySet<string>,
  statistics: Readonly<Record<string, number>>,
): AdditionalGrantPartition {
  const onList: SpellInfo[] = [];
  const offList: SpellInfo[] = [];
  for (const spell of spells) (classListIds.has(spell.id) ? onList : offList).push(spell);
  const profile = grantedProfile(statistics);
  return { onList, groups: groupGrantedSpells(offList, () => profile) };
}

/**
 * Groups spells by the profile `profileFor` resolves. Exported separately so
 * the identical-profile rule is testable without a character whose grants
 * carry different casting values.
 */
export function groupGrantedSpells(
  spells: readonly SpellInfo[],
  profileFor: (spell: SpellInfo) => AdditionalGrantProfile,
): AdditionalGrantGroup[] {
  const groups: AdditionalGrantGroup[] = [];
  const byKey = new Map<string, AdditionalGrantGroup>();
  for (const spell of spells) {
    const profile = profileFor(spell);
    const key = `${profile.ability}:${profile.attackModifier}:${profile.saveDc}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { profile, spells: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.spells.push(spell);
  }
  return groups;
}

/** The block's session key; a lone group keeps the stable granted-caster key. */
export function grantedCasterIdentifier(groupCount: number, profile: AdditionalGrantProfile): string {
  return groupCount === 1
    ? GRANTED_CASTER_KEY
    : `${GRANTED_CASTER_KEY}:${profile.ability}:${profile.attackModifier}:${profile.saveDc}`;
}

/**
 * Projects one feature caster: no slots, nothing to prepare, and an
 * attack/DC from proficiency plus the nominated ability modifier. Its levelled
 * spells are always prepared and carry the feature's free-cast allowance, when
 * it grants one; cantrips are at-will and carry none.
 */
function featureCasterDto(
  library: ElementLibrary,
  statistics: Readonly<Record<string, number>>,
  casterIds: ReadonlyMap<string, string>,
  feature: FeatureSpellCaster,
  proficiency: number,
  abilityModifier: (ability: string) => number,
): SpellcasterDto {
  const modifier = abilityModifier(feature.ability);
  const toDto = (id: string, usage: string | null): KnownSpellDto | null => {
    const info = spellInfo(library, id);
    if (info === null) return null;
    return {
      ...toKnownSpellDto(info, { prepared: false, always: true }),
      ...(usage === null ? {} : { usage }),
    };
  };
  const knownSpells = [
    ...feature.cantripIds.map((id) => toDto(id, null)),
    ...feature.spellIds.map((id) => toDto(id, feature.usage)),
  ]
    .filter((spell): spell is KnownSpellDto => spell !== null)
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
  return {
    identifier: casterIds.get(feature.key) ?? feature.key,
    name: feature.name,
    kind: "feature",
    ability: feature.ability,
    attackModifier: proficiency + modifier,
    saveDc: 8 + proficiency + modifier,
    requiresPreparation: false,
    allowReplace: false,
    prepareCount: 0,
    currentPreparedCount: 0,
    slotsPerLevel: Array<number>(9).fill(0),
    knownSpells,
    maxSpellLevel: knownSpells.reduce((highest, spell) => Math.max(highest, spell.level), 0),
    resource: { mode: "slots", canUseSpellPoints: false },
  };
}

/**
 * Projects one "Additional Spells" block: the additional spells no class list
 * carries. Shaped like a feature caster — no slots, nothing to prepare, an
 * attack/DC from proficiency plus the resolved ability — because that is what
 * an additional spell is: always available, and never counted against a
 * preparation limit.
 */
function grantedCasterDto(
  casterIds: ReadonlyMap<string, string>,
  spells: readonly SpellInfo[],
  profile: AdditionalGrantProfile,
  identifier: string,
): SpellcasterDto {
  const knownSpells = spells
    .map((info) => toKnownSpellDto(info, { prepared: false, always: true }))
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
  return {
    identifier: casterIds.get(identifier) ?? identifier,
    name: GRANTED_CASTER_NAME,
    kind: "feature",
    ability: profile.ability,
    attackModifier: profile.attackModifier,
    saveDc: profile.saveDc,
    requiresPreparation: false,
    allowReplace: false,
    prepareCount: 0,
    currentPreparedCount: 0,
    slotsPerLevel: Array<number>(9).fill(0),
    knownSpells,
    maxSpellLevel: knownSpells.reduce((highest, spell) => Math.max(highest, spell.level), 0),
    resource: { mode: "slots", canUseSpellPoints: false },
  };
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
  // The browsed rule is the whole adjacent group spawned by one authored
  // select (the wizard's level-1 cantrip group carries three slots, one per
  // wrapper); a same-name group from a different select browses separately.
  const groupRules = selectionRuleGroup(state, library, rule);
  const groupPath = groupRules[0]?.path ?? rule.path;
  const selectedIds = groupRules.map((slot) => slot.selectedElementIds[0] ?? null);
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
  for (const slotRule of groupRules) {
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

  // The same ceiling the select's supports expand to, so the panel offers and
  // labels exactly the levels the select accepts.
  const progressionLevel = isCantripRule
    ? 0
    : spellSlotCeilingFor(state, library, rule, caster.name);
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
    return listExpressions.some((expression) => matchesSupports(expression, element));
  };

  for (const element of library.byType.get("Spell") ?? []) {
    const info = spellInfo(library, element.identity.id);
    if (info === null) continue;
    if (isCantripRule ? info.level !== 0 : info.level === 0) continue;
    if (!onBrowseList(element) && !eligibleIds.has(info.id) && !selectedSlots.has(info.id)) continue;
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
