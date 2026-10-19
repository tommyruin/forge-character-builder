/**
 * Character packs: the custom content a character carries in its own file,
 * installed into the shared library while that character is loaded.
 *
 * A pack is a compiled content file keyed by character id. It joins the
 * library as an overlay on top of whatever is installed, so the ids its
 * entries grant, pick and gate on resolve exactly like book content, without
 * a rebuild of the library (which a snapshot-booted library cannot do: it
 * holds the finalized elements but none of the raw files they came from).
 *
 * Rules the overlay keeps:
 * - it never replaces a book element: a pack entry whose id the library
 *   already defines is skipped and reported, so a pack can not rewrite rules
 *   for characters that never opted in;
 * - it is visible only to its owners: a character that does not carry the
 *   pack's entry never sees it in a picker or a catalogue query
 *   (`isRestrictedForCharacter`), though two characters carrying the same
 *   entry (an exported and re-imported one) share a single definition;
 * - it survives a library rebuild or snapshot boot, because
 *   `reapplyCharacterPacks` runs after both;
 * - snapshots never contain it (`suspendCharacterPacks`), so the library
 *   digest a character snapshot checks describes the shared content alone.
 */

import { parseElementsFile, type ParsedElement } from "./parser.js";
import { classifyRuleset, rulesetSourcesByName, type ElementLibrary, type RulesetTag } from "./library.js";

export interface CharacterPack {
  characterId: string;
  /** The compiled `<elements>` file. */
  xml: string;
}

export interface CharacterPackReport {
  /** The ids now resolvable in the library for this pack. */
  installed: string[];
  /** Entries left out, with the reason. */
  skipped: Array<{ id: string; reason: string }>;
}

interface PackEntry extends CharacterPack {
  elements: ParsedElement[];
}

/** The overlay bookkeeping kept on the library. */
export interface CharacterPackState {
  packs: Map<string, PackEntry>;
  /** Elements currently merged into the library maps, by id. */
  merged: Map<string, ParsedElement>;
  /** Character ids carrying each merged id. */
  owners: Map<string, Set<string>>;
}

const states = new WeakMap<ElementLibrary, CharacterPackState>();

function stateOf(library: ElementLibrary): CharacterPackState {
  let state = states.get(library);
  if (state === undefined) {
    state = { packs: new Map(), merged: new Map(), owners: new Map() };
    states.set(library, state);
  }
  return state;
}

function bumpRulesetCount(library: ElementLibrary, tag: RulesetTag, delta: number): void {
  if (tag === "2014") library.rulesetCounts.rules2014Count += delta;
  else if (tag === "2024") library.rulesetCounts.rules2024Count += delta;
  else library.rulesetCounts.sharedCount += delta;
}

/** Takes every merged overlay element back out of the library maps. */
function unmerge(library: ElementLibrary, state: CharacterPackState): void {
  for (const [id, element] of state.merged) {
    // After a rebuild or a snapshot boot the maps hold none of the overlay;
    // only what is really there (by identity) is taken out and uncounted.
    if (library.byId.get(id) !== element) continue;
    library.byId.delete(id);
    const type = element.identity.type;
    const list = library.byType.get(type);
    if (list !== undefined) {
      const kept = list.filter((candidate) => candidate !== element);
      if (kept.length === 0) {
        library.byType.delete(type);
        delete library.typeCounts[type];
      } else {
        library.byType.set(type, kept);
        library.typeCounts[type] = kept.length;
      }
    }
    const tag = library.ruleset.get(id);
    library.ruleset.delete(id);
    if (tag !== undefined) bumpRulesetCount(library, tag, -1);
  }
  library.elementCount = library.byId.size;
  state.merged.clear();
  state.owners.clear();
}

/** Merges every pack into the library maps; later installs win among packs. */
function merge(library: ElementLibrary, state: CharacterPackState): void {
  const sources = rulesetSourcesByName(library.sources.values());
  for (const [characterId, pack] of state.packs) {
    for (const element of pack.elements) {
      const id = element.identity.id;
      const bookDefinition = library.byId.get(id);
      if (bookDefinition !== undefined && !state.merged.has(id)) continue;
      const previous = state.merged.get(id);
      if (previous !== undefined) {
        // Another character carries the same entry: the later definition
        // stands for both.
        library.byId.delete(id);
        const list = library.byType.get(previous.identity.type);
        if (list !== undefined) library.byType.set(previous.identity.type, list.filter((candidate) => candidate !== previous));
        const oldTag = library.ruleset.get(id);
        if (oldTag !== undefined) bumpRulesetCount(library, oldTag, -1);
      }
      library.byId.set(id, element);
      const list = library.byType.get(element.identity.type) ?? [];
      list.push(element);
      library.byType.set(element.identity.type, list);
      library.typeCounts[element.identity.type] = list.length;
      const tag = classifyRuleset(element, sources);
      library.ruleset.set(id, tag);
      bumpRulesetCount(library, tag, 1);
      state.merged.set(id, element);
      const owners = state.owners.get(id) ?? new Set<string>();
      owners.add(characterId);
      state.owners.set(id, owners);
    }
  }
  library.elementCount = library.byId.size;
}

function refresh(library: ElementLibrary): void {
  const state = stateOf(library);
  unmerge(library, state);
  merge(library, state);
  library.revision = (library.revision ?? 0) + 1;
}

/**
 * Installs a character's pack, replacing the one it had. Returns what resolved
 * and what was left out; never throws for a pack the parser can read.
 */
export function installCharacterPack(library: ElementLibrary, pack: CharacterPack): CharacterPackReport {
  const state = stateOf(library);
  const elements = parseElementsFile(pack.xml, `characters/${pack.characterId}.xml`).filter(
    (element) => element.identity.id !== "",
  );
  state.packs.set(pack.characterId, { ...pack, elements });
  refresh(library);
  const skipped: CharacterPackReport["skipped"] = [];
  const installed: string[] = [];
  for (const element of elements) {
    const id = element.identity.id;
    if (state.owners.get(id)?.has(pack.characterId) === true) installed.push(id);
    else skipped.push({ id, reason: "the library already defines this id" });
  }
  return { installed, skipped };
}

/** Takes a character's pack out of the library. No-op when it has none. */
export function removeCharacterPack(library: ElementLibrary, characterId: string): void {
  const state = stateOf(library);
  if (!state.packs.delete(characterId)) return;
  refresh(library);
}

/** Puts every installed pack back after the library maps were replaced wholesale. */
export function reapplyCharacterPacks(library: ElementLibrary): void {
  const state = states.get(library);
  if (state === undefined || state.packs.size === 0) return;
  refresh(library);
}

/**
 * Takes the overlay out of the library for the duration of `run` (the content
 * graph codec serializes shared content only) and puts it back afterwards.
 */
export function withoutCharacterPacks<T>(library: ElementLibrary, run: () => T): T {
  const state = states.get(library);
  if (state === undefined || state.merged.size === 0) return run();
  unmerge(library, state);
  try {
    return run();
  } finally {
    merge(library, state);
    library.revision = (library.revision ?? 0) + 1;
  }
}

/** The character ids whose pack defines this element, or undefined for book content. */
export function characterPackOwners(library: ElementLibrary, id: string): ReadonlySet<string> | undefined {
  return states.get(library)?.owners.get(id);
}

/** True when the element comes from a character pack rather than a book. */
export function isCharacterPackElement(library: ElementLibrary, id: string): boolean {
  return states.get(library)?.owners.has(id) === true;
}

/** The ids a character's pack currently provides. */
export function characterPackIds(library: ElementLibrary, characterId: string): string[] {
  const state = states.get(library);
  if (state === undefined) return [];
  return (state.packs.get(characterId)?.elements ?? [])
    .map((element) => element.identity.id)
    .filter((id) => state.owners.get(id)?.has(characterId) === true);
}

/** The parsed entries of a character's pack (for diagnostics), in pack order. */
export function characterPackElements(library: ElementLibrary, characterId: string): ParsedElement[] {
  return [...(states.get(library)?.packs.get(characterId)?.elements ?? [])];
}
