import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import type { MagicCasterBlock } from "./state.js";

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
  const walk = (nodes: { id: string; children: { id: string }[] }[]): void => {
    for (const registered of nodes) {
      const element = library.byId.get(registered.id);
      if (element !== undefined) {
        const registeredChildren = new Set(registered.children.map((child) => child.id));
        for (const rule of element.rules) {
          if (rule.kind !== "grant" || rule.type !== "Spell" || rule.id === undefined) continue;
          if (rule.prepared !== true && !registeredChildren.has(rule.id)) continue;
          const casterName = rule.spellcasting;
          if (casterName === undefined) continue;
          const set = sets.get(casterName) ?? new Set<string>();
          set.add(rule.id);
          sets.set(casterName, set);
        }
      }
      walk(registered.children as unknown as { id: string; children: { id: string }[] }[]);
    }
  };
  walk(state.elements as unknown as { id: string; children: { id: string }[] }[]);
  return sets;
}


