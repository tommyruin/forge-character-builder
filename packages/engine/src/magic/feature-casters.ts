import type { ElementLibrary } from "../content/library.js";
import type { ParsedElement } from "../content/parser.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";

/**
 * Feature spell casters: the spells a feat or trait gives outside any
 * spellcasting feature.
 *
 * Magic Initiate, Fey-Touched, Ritual Caster, the High Elf cantrip, the
 * Tiefling's Infernal Legacy and the spell-granting eldritch invocations all
 * hang their spell rules off an ordinary feature element with no
 * `<spellcasting>` block anywhere above them, so they never reach a caster
 * block and never reached the spell pages. Both shapes count:
 *
 * - `<select type="Spell">` wrappers the player resolved, and
 * - `<grant type="Spell">` targets with **no** `spellcasting` attribute —
 *   Fey-Touched's Misty Step, Armor of Shadows' Mage Armor, the Tiefling's
 *   Thaumaturgy. A grant that names a spellcasting target belongs to that
 *   caster instead (`alwaysPreparedSets` in spelllist.ts owns those).
 *
 * Everything under one feature shares a banner, so a feat's chosen and granted
 * spells project as a single caster.
 */

/** The abilities a feat sub-feature can nominate for its spells. */
const SPELLCASTING_ABILITIES: readonly string[] = ["Intelligence", "Wisdom", "Charisma"];

/** The allowance derived from prose, when the corpus declares none. */
const DERIVED_USAGE = "1/Long Rest";

export interface FeatureSpellCaster {
  /** Stable per-character key (`feature:<element id>`). */
  key: string;
  /** The granting element's id. */
  elementId: string;
  /** Display name: the ability sub-feature's sheet `alt`, else the element name. */
  name: string;
  /** Full ability name ("Wisdom"). */
  ability: string;
  /**
   * The free-cast allowance the feature attaches to its levelled spells
   * ("1/Long Rest"), or null when the feature grants no slotless casting.
   */
  usage: string | null;
  /** Cantrip ids, in registration order. */
  cantripIds: string[];
  /** Levelled spell ids, in registration order. */
  spellIds: string[];
}

/** The element a node stands for: its own id, or the id a wrapper registered. */
function nodeElementId(node: RegisteredElement): string {
  if (node.id !== undefined && node.id !== "") return node.id;
  return node.registered ?? "";
}

/** The spell element's level, from its `level` setter. */
function spellLevel(spell: ParsedElement): number {
  return Number.parseInt(spell.setters.find((setter) => setter.name === "level")?.value ?? "0", 10) || 0;
}

/** The first `usage` any of the element's `<sheet>` entries declares. */
export function declaredUsage(element: ParsedElement | undefined): string | null {
  const usage = element?.sheets.find((sheet) => sheet.usage !== undefined && sheet.usage !== "")?.usage;
  return usage === undefined || usage === "" ? null : usage;
}

/**
 * Whether the feature's own text promises a free cast that recharges on a long
 * rest. Magic Initiate ("cast it once without a spell slot ... when you finish
 * a Long Rest") and Fey-Touched ("without expending a spell slot ... until you
 * finish a Long Rest") both say so; Armor of Shadows casts Mage Armor without a
 * slot but never mentions a rest, so it stays at-will and unmarked.
 */
export function promisesFreeCastPerLongRest(element: ParsedElement | undefined): boolean {
  const text = (element?.descriptionXml ?? "").replace(/<[^>]*>/g, " ").toLowerCase();
  if (!/without (expending )?a spell slot/.test(text)) return false;
  return text.includes("long rest");
}

/**
 * The free-cast allowance for a feature's levelled spells. The corpus's own
 * `<sheet usage="...">` wins wherever it declares one (Ritual Caster's ability
 * sub-features carry `usage="1/Long Rest"`); otherwise the feature's prose is
 * read for the same promise, since most feat chains state it only in text.
 */
function featureUsage(
  ancestor: ParsedElement,
  abilityElement: ParsedElement | undefined,
): string | null {
  const declared = declaredUsage(abilityElement) ?? declaredUsage(ancestor);
  if (declared !== null) return declared;
  return promisesFreeCastPerLongRest(ancestor) ? DERIVED_USAGE : null;
}

/**
 * The ability nominated by a sibling of the spell rules: Magic Initiate's 27
 * PHB24 sub-features carry no setters at all, and are told apart only by their
 * identity name ("Intelligence" / "Wisdom" / "Charisma").
 */
function abilitySibling(
  library: ElementLibrary,
  siblings: readonly RegisteredElement[],
): ParsedElement | null {
  for (const sibling of siblings) {
    const element = library.byId.get(nodeElementId(sibling));
    if (element === undefined) continue;
    if (SPELLCASTING_ABILITIES.includes(element.identity.name)) return element;
  }
  return null;
}

/** The first class caster's ability, used when the feature nominates none. */
function fallbackAbility(state: CharacterState): string {
  const ability = state.magic?.casters[0]?.ability ?? "";
  return SPELLCASTING_ABILITIES.includes(ability) ? ability : "Intelligence";
}

/**
 * Whether the granting element hands this spell out with no caster attached.
 * A grant naming a `spellcasting` target is that caster's always-prepared
 * spell, not a feature caster's.
 */
function isCasterLessGrant(owner: ParsedElement, spellId: string): boolean {
  let found = false;
  for (const rule of owner.rules) {
    if (rule.kind !== "grant" || rule.type !== "Spell" || rule.id !== spellId) continue;
    if (rule.spellcasting !== undefined) return false;
    found = true;
  }
  return found;
}

/**
 * The character's feature spell casters, in registration order.
 *
 * A spell counts when it has no spellcasting feature anywhere above it and
 * sits under a feature element that resolves in the library; spells are
 * grouped by that nearest ancestor element.
 */
export function featureSpellCasters(
  state: CharacterState,
  library: ElementLibrary,
): FeatureSpellCaster[] {
  const byElement = new Map<string, FeatureSpellCaster>();
  const order: string[] = [];

  const casterFor = (owner: RegisteredElement, ownerElement: ParsedElement): FeatureSpellCaster => {
    const ownerId = ownerElement.identity.id;
    let caster = byElement.get(ownerId);
    if (caster === undefined) {
      const nominated = abilitySibling(library, owner.children);
      caster = {
        key: `feature:${ownerId}`,
        elementId: ownerId,
        name: nominated?.sheets.find((sheet) => sheet.alt !== undefined)?.alt ?? ownerElement.identity.name,
        ability: nominated?.identity.name ?? fallbackAbility(state),
        usage: featureUsage(ownerElement, nominated ?? undefined),
        cantripIds: [],
        spellIds: [],
      };
      byElement.set(ownerId, caster);
      order.push(ownerId);
    }
    return caster;
  };

  const collect = (caster: FeatureSpellCaster, spell: ParsedElement): void => {
    const bucket = spellLevel(spell) === 0 ? caster.cantripIds : caster.spellIds;
    if (!bucket.includes(spell.identity.id)) bucket.push(spell.identity.id);
  };

  const walk = (
    nodes: readonly RegisteredElement[],
    underSpellcasting: boolean,
    owner: RegisteredElement | null,
  ): void => {
    for (const node of nodes) {
      const elementId = nodeElementId(node);
      const element = elementId === "" ? undefined : library.byId.get(elementId);
      const nextUnderSpellcasting = underSpellcasting || element?.spellcasting !== undefined;
      const ownerElement = owner === null ? undefined : library.byId.get(nodeElementId(owner));
      if (!nextUnderSpellcasting && node.type === "Spell" && owner !== null && ownerElement !== undefined) {
        // A wrapper carries its selection in `registered` and has an empty id;
        // a granted spell is an element node with the spell's own id.
        const isWrapper = node.requiredLevel !== undefined && (node.id === undefined || node.id === "");
        const selected = node.registered ?? "";
        if (isWrapper && selected !== "") {
          const spell = library.byId.get(selected);
          if (spell !== undefined) collect(casterFor(owner, ownerElement), spell);
        } else if (!isWrapper && element !== undefined && isCasterLessGrant(ownerElement, elementId)) {
          collect(casterFor(owner, ownerElement), element);
        }
      }
      // Spell nodes never own a group, so the nearest feature above a spell is
      // the one that granted it.
      const nextOwner = element !== undefined && node.type !== "Spell" ? node : owner;
      walk(node.children, nextUnderSpellcasting, nextOwner);
    }
  };
  walk(state.elements, false, null);

  return order.map((id) => byElement.get(id)!);
}
