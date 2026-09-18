/**
 * Character content access. The single predicate deciding whether an element
 * may be offered to, browsed by, or granted to a character: it belongs to the
 * character's ruleset and comes from a source the character has not disabled.
 *
 * Selection pickers, spell browse and every catalogue query share it so they
 * cannot drift apart.
 */

import { rulesetOf, type ElementLibrary } from "./library.js";
import { isSourceNameRestricted } from "./sourceIdentity.js";
import type { CharacterState } from "../character/state.js";
import type { ParsedElement } from "./parser.js";

const restrictedSourceIdCache = new WeakMap<
  CharacterState,
  { key: string; ids: ReadonlySet<string> }
>();

/** The restricted source ids as a set, cached per state and list content. */
function restrictedSourceIds(state: CharacterState): ReadonlySet<string> {
  const key = state.restrictedSources.join("\u0000");
  let cached = restrictedSourceIdCache.get(state);
  if (cached === undefined || cached.key !== key) {
    cached = { key, ids: new Set(state.restrictedSources) };
    restrictedSourceIdCache.set(state, cached);
  }
  return cached.ids;
}

/** True when the source display name resolves to a restricted source id. */
export function isSourceRestricted(state: CharacterState, library: ElementLibrary, source: string): boolean {
  return isSourceNameRestricted(restrictedSourceIds(state), library, source);
}

/**
 * True when the element can never be offered to this character: it belongs
 * to the other ruleset (2014 vs 2024 mode) or comes from a restricted
 * source. Such elements are pruned from offering and browse lists entirely
 * rather than shown as unavailable.
 */
export function isRestrictedForCharacter(
  state: CharacterState,
  library: ElementLibrary,
  element: ParsedElement,
): boolean {
  if (state.rulesetMode === "2014" && rulesetOf(library, element.identity.id) === "2024") return true;
  if (state.rulesetMode === "2024" && rulesetOf(library, element.identity.id) === "2014") return true;
  return isSourceRestricted(state, library, element.identity.source);
}

/** The complement of isRestrictedForCharacter, for catalogue filters. */
export function isContentAllowedForCharacter(
  state: CharacterState,
  library: ElementLibrary,
  element: ParsedElement,
): boolean {
  return !isRestrictedForCharacter(state, library, element);
}
