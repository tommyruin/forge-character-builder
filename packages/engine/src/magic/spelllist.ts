import type { ElementLibrary } from "../content/library.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";
import type { MagicCasterBlock } from "./state.js";
import { grantedSpellUsage, type GrantedSpellUsage } from "./spell-usage.js";
import type { ParsedElement } from "../content/parser.js";
import { casterClassLevel, createRegistrationContext, grantEligible } from "../selection/selection.js";

/**
 * Caster spell-list derivation.
 *
 * Full-list casters (cleric/druid/paladin: the corpus spellcasting feature
 * carries `<list known="true">`) project the whole class list; other casters
 * project their own known spells. Ordering is level then name; same-name
 * ties follow the canonical source order.
 */

/** Captured same-name tie order (PHB < PHB24 < POTA < XGTE < TCOE). */
const CANONICAL_SOURCE_ORDER: readonly string[] = [
  "Player’s Handbook",
  "Player's Handbook",
  "Player’s Handbook (2024)",
  "Player's Handbook (2024)",
  "Princes of the Apocalypse",
  "Xanathar’s Guide to Everything",
  "Xanathar's Guide to Everything",
  "Tasha’s Cauldron of Everything",
  "Tasha's Cauldron of Everything",
  // Captured UA tie order (spell-browse-donyo): the Fighter, Rogue, and
  // Wizard Mind Sliver (20191125) sorts before the Sorcerer and Warlock one
  // (20190905), the reverse of corpus file order; no public index explains
  // it, so the captured relative order is pinned here.
  "Unearthed Arcana: Fighter, Rogue, and Wizard",
  "Unearthed Arcana: Sorcerer and Warlock",
];

export function canonicalSourceRank(source: string): number {
  const index = CANONICAL_SOURCE_ORDER.indexOf(source);
  return index === -1 ? CANONICAL_SOURCE_ORDER.length : index;
}

export interface SpellInfo {
  id: string;
  name: string;
  source: string;
  level: number;
  school: string;
  isRitual: boolean;
  isConcentration: boolean;
  components: string;
  castingTime: string;
  range: string;
  duration: string;
  description: string;
}

const setterValue = (element: { setters: { name: string; value: string | undefined }[] }, name: string): string | undefined =>
  element.setters.find((setter) => setter.name === name)?.value;

export function spellInfo(library: ElementLibrary, id: string): SpellInfo | null {
  const element = library.byId.get(id);
  if (element === undefined || element.identity.type !== "Spell") return null;
  const has = (name: string): boolean => setterValue(element, name) === "true";
  const material = setterValue(element, "materialComponent") ?? "";
  const parts: string[] = [];
  if (has("hasVerbalComponent")) parts.push("V");
  if (has("hasSomaticComponent")) parts.push("S");
  if (has("hasMaterialComponent")) parts.push(`M${material ? ` (${material})` : ""}`);
  return {
    id: element.identity.id,
    name: element.identity.name,
    source: element.identity.source,
    level: Number.parseInt(setterValue(element, "level") ?? "0", 10) || 0,
    school: setterValue(element, "school") ?? "",
    isRitual: has("isRitual"),
    isConcentration: has("isConcentration"),
    components: parts.join(", "),
    castingTime: setterValue(element, "time") ?? "",
    range: setterValue(element, "range") ?? "",
    duration: setterValue(element, "duration") ?? "",
    description: element.descriptionXml ?? "",
  };
}

/** Whether the spell element is on the caster's spell list. */
function onList(library: ElementLibrary, spellId: string, listTag: string): boolean {
  const element = library.byId.get(spellId);
  if (element === undefined) return false;
  return (element.supports ?? []).some((support) => support.trim() === listTag);
}

const byLevelThenNameThenSource = () => (left: SpellInfo, right: SpellInfo): number => {
  if (left.level !== right.level) return left.level - right.level;
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) return byName;
  return canonicalSourceRank(left.source) - canonicalSourceRank(right.source);
};

/** The DTO spell order: level, then name, then canonical source. */
export function compareSpellInfo(left: SpellInfo, right: SpellInfo): number {
  return byLevelThenNameThenSource()(left, right);
}

/**
 * The caster's projected known spells (prepared full-list casters): the whole
 * class list up to the caster's max slot level, in DTO order.
 */
export function fullCasterList(
  library: ElementLibrary,
  casterName: string,
  maxSpellLevel: number,
): SpellInfo[] {
  const listTag = casterName;
  const spells: SpellInfo[] = [];
  for (const element of library.byType.get("Spell") ?? []) {
    if (!onList(library, element.identity.id, listTag)) continue;
    const info = spellInfo(library, element.identity.id);
    if (info === null || info.level > maxSpellLevel) continue;
    spells.push(info);
  }
  return spells.sort(byLevelThenNameThenSource());
}

/**
 * The caster's own known spells (known/spellbook casters): the block's
 * cantrips and spells, in DTO order (level, name, source).
 */
export function ownKnownSpells(library: ElementLibrary, caster: MagicCasterBlock): SpellInfo[] {
  const entries = [...caster.cantrips, ...caster.spells];
  const spells: SpellInfo[] = [];
  for (const entry of entries) {
    const info = spellInfo(library, entry.id);
    if (info === null) continue;
    spells.push(info);
  }
  return spells.sort(byLevelThenNameThenSource());
}

/**
 * Always-prepared spells per caster, from the character's registered elements:
 *
 * - Spell grants carrying `prepared="true"` (and a spellcasting target), and
 * - bare `<grant type="Spell" spellcasting="X"/>` rules — the 2024 corpus
 *   writes its subclass lists, Divine Smite and Find Steed without the
 *   `prepared` attribute — but only when the grant actually registered as a
 *   child of the granting node. Registration is where `grantEligible()`
 *   applied the rule's `level=` and `<requirements>` gates, so reading it back
 *   honours a `level="5"` grant (the Draconic Sorcerer's Fear) for free.
 *
 * The XML `always-prepared` attribute is NOT read (captured: stale fixture
 * attributes project false when no grant backs them).
 */
export function alwaysPreparedSets(state: CharacterState, library: ElementLibrary): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  for (const { casterName, spellId } of activeClassSpellGrants(state, library)) {
    const set = sets.get(casterName) ?? new Set<string>();
    set.add(spellId);
    sets.set(casterName, set);
  }
  return sets;
}

/** Resolve both ordinary elements and selected owners, with the owner's own
 * class-level gates. Combined multiclass slots never unlock a domain table. */
function activeClassSpellGrants(state: CharacterState, library: ElementLibrary): Array<{
  element: ParsedElement; casterName: string; spellId: string;
}> {
  const grants: Array<{ element: ParsedElement; casterName: string; spellId: string }> = [];
  const context = createRegistrationContext(state, library);
  const levels = new Map<string, number>();
  const walk = (nodes: readonly RegisteredElement[]): void => {
    for (const registered of nodes) {
      const element = library.byId.get(registered.id || registered.registered || "");
      if (element !== undefined) {
        const registeredChildren = new Set(registered.children.map((child) => child.id));
        for (const rule of element.rules) {
          if (rule.kind !== "grant" || rule.type !== "Spell" || rule.id === undefined) continue;
          if (rule.prepared !== true && !registeredChildren.has(rule.id)) continue;
          const casterName = rule.spellcasting;
          if (casterName === undefined) continue;
          if (!levels.has(casterName)) levels.set(casterName, casterClassLevel(state, library, casterName) || state.level);
          if (!grantEligible(rule, state, { ...context, level: levels.get(casterName)! })) continue;
          grants.push({ element, casterName, spellId: rule.id });
        }
      }
      walk(registered.children);
    }
  };
  walk(state.elements);
  return grants;
}

/**
 * The free-cast allowance on class casters' granted spells: caster name →
 * spell id → allowance and optional conditions (including a `{{stat}}`
 * template the caller resolves). The same registered grants as
 * `alwaysPreparedSets`, so the same level and requirement gates apply.
 *
 * Normally a declared usage counts only when the element's own text promises the spell
 * is cast without a slot: Paladin's Smite ("cast it without expending a spell
 * slot, but you must finish a Long Rest") and Favored Enemy do; Beguiling
 * Magic's 1/Long Rest belongs to its rider, not to the spells it prepares.
 * spell-usage.ts handles the reviewed exceptions and shared-use conditions.
 */
export function alwaysPreparedUsages(state: CharacterState, library: ElementLibrary): Map<string, Map<string, GrantedSpellUsage>> {
  const usages = new Map<string, Map<string, GrantedSpellUsage>>();
  for (const { element, casterName, spellId } of activeClassSpellGrants(state, library)) {
    const usage = grantedSpellUsage(element, spellId, state);
    if (usage === undefined) continue;
    const spells = usages.get(casterName) ?? new Map<string, GrantedSpellUsage>();
    if (!spells.has(spellId)) spells.set(spellId, usage);
    usages.set(casterName, spells);
  }
  return usages;
}
