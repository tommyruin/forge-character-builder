/**
 * Where an element lands in the Build tab and where it came from.
 *
 * The section table mirrors the client's Build sections; a type outside it
 * lands in Other, so a custom feature is never hidden. Origin is what the
 * Build tab badges: book content has none, a character's own entry reads
 * "character", and an entry that was promoted into a homebrew collection (or
 * any element of a source marked `homebrew`) reads "homebrew".
 */

import type { BuildSectionKey, ContentOrigin } from "@forge-cb/api";
import { isCharacterPackElement } from "../content/character-packs.js";
import type { ElementLibrary } from "../content/library.js";
import { normalizeSourceName } from "../content/sourceIdentity.js";
import { isCustomElementId } from "./schema.js";

const SECTION_TYPES: ReadonlyArray<readonly [BuildSectionKey, readonly string[]]> = [
  ["race", ["Race", "Race Variant", "Sub Race", "Racial Trait", "Dragonmark", "Dragonmark Feature"]],
  ["class", ["Class", "Class Feature", "Archetype", "Archetype Feature", "Multiclass"]],
  ["background", ["Background", "Background Variant", "Background Feature", "List"]],
  ["abilities", ["Ability Score Improvement"]],
  ["languages", ["Language", "Language Feature"]],
  ["proficiencies", ["Proficiency"]],
  ["feats", ["Feat", "Feat Feature"]],
];

/** The Build section an element of this type belongs in. */
export function buildSectionOfType(type: string): BuildSectionKey {
  for (const [section, types] of SECTION_TYPES) {
    if (types.includes(type)) return section;
  }
  return "other";
}

const homebrewSourceCache = new WeakMap<ElementLibrary, { revision: number; names: Set<string> }>();

/** Normalized names of the sources the builder (or an author) marked `homebrew`, per library revision. */
function homebrewSourceNames(library: ElementLibrary): ReadonlySet<string> {
  const revision = library.revision ?? 0;
  let cached = homebrewSourceCache.get(library);
  if (cached === undefined || cached.revision !== revision) {
    const names = new Set<string>();
    for (const source of library.sources.values()) {
      if (source.setters.some((setter) => setter.name === "homebrew" && setter.value.trim().toLowerCase() === "true")) {
        names.add(normalizeSourceName(source.identity.name));
      }
    }
    cached = { revision, names };
    homebrewSourceCache.set(library, cached);
  }
  return cached.names;
}

/** Where an element came from; unknown ids read as book content. */
export function contentOrigin(library: ElementLibrary | undefined, id: string): ContentOrigin {
  if (library === undefined) return "book";
  if (isCharacterPackElement(library, id)) return "character";
  const element = library.byId.get(id);
  if (element === undefined) return "book";
  return isCustomElementId(id) || homebrewSourceNames(library).has(normalizeSourceName(element.identity.source)) ? "homebrew" : "book";
}
