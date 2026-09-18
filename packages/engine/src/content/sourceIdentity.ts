/**
 * Source identity. Uploaded and bundled content attributes drift from the
 * Source element's display name in practice — straight vs typographic
 * apostrophes, word case, repeated spaces — so every source lookup matches on
 * a normalized form instead of exact string equality.
 */

import type { ElementLibrary } from "./library.js";

/** Case- and punctuation-insensitive form of a source display name. */
export function normalizeSourceName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

const sourceIdsByNameCache = new WeakMap<
  ElementLibrary,
  { revision: number; byName: Map<string, Set<string>> }
>();

/** Normalized source display name -> the source element ids carrying that name. */
export function sourceIdsByName(library: ElementLibrary): Map<string, Set<string>> {
  const revision = library.revision ?? 0;
  let cached = sourceIdsByNameCache.get(library);
  if (cached === undefined || cached.revision !== revision) {
    const byName = new Map<string, Set<string>>();
    for (const source of library.sources.values()) {
      const key = normalizeSourceName(source.identity.name);
      const ids = byName.get(key) ?? new Set<string>();
      ids.add(source.identity.id);
      byName.set(key, ids);
    }
    cached = { revision, byName };
    sourceIdsByNameCache.set(library, cached);
  }
  return cached.byName;
}

/** True when the source display name resolves to a restricted source id. */
export function isSourceNameRestricted(
  restricted: ReadonlySet<string>,
  library: ElementLibrary,
  sourceName: string,
): boolean {
  if (restricted.size === 0) return false;
  const ids = sourceIdsByName(library).get(normalizeSourceName(sourceName));
  if (ids === undefined) return false;
  for (const id of ids) {
    if (restricted.has(id)) return true;
  }
  return false;
}
