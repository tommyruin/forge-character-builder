import { normalizeRestrictedSourceIds } from "../../../sourcePreferences.js";

const sourceDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

export function formatSourceReleaseDate(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);

  if (!raw || /^0+$/.test(raw)) return "";
  if (!match) return raw;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return raw;
  }

  return sourceDateFormatter.format(date);
}

function sourceEnabled(source, restrictedIds) {
  // Core sources are always included. Treating them as enabled here also keeps an
  // old/default list containing a now-mandatory source from making the UI look
  // unchecked when the engine cannot legally turn it off.
  return !source.canToggle || !restrictedIds.has(source.id);
}

export function getSourceGroupState(group, restrictedSourceIds) {
  const restricted = new Set(normalizeRestrictedSourceIds(restrictedSourceIds));
  const sources = group?.sources ?? [];
  const enabledCount = sources.filter((source) =>
    sourceEnabled(source, restricted),
  ).length;
  const totalCount = sources.length;
  return {
    enabledCount,
    totalCount,
    allEnabled: totalCount > 0 && enabledCount === totalCount,
    noneEnabled: totalCount > 0 && enabledCount === 0,
    mixed: enabledCount > 0 && enabledCount < totalCount,
  };
}

function sourceMatches(source, query) {
  if (!query) return true;
  return `${source.name} ${source.author} ${source.id}`
    .toLocaleLowerCase()
    .includes(query);
}

export function getVisibleSourceGroups(groups, search = "") {
  const query = search.trim().toLocaleLowerCase();
  return (groups ?? [])
    .map((group) => ({
      group,
      sources: (group.sources ?? []).filter((source) =>
        sourceMatches(source, query),
      ),
    }))
    .filter(({ sources }) => sources.length > 0);
}

export function isSourceEnabled(source, restrictedSourceIds) {
  return sourceEnabled(
    source,
    new Set(normalizeRestrictedSourceIds(restrictedSourceIds)),
  );
}

/** Every source a character may switch off, across all groups: the "Disable all" draft. */
export function getToggleableSourceIds(groups) {
  const ids = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const source of group?.sources ?? []) {
      if (source?.canToggle && source.id) ids.push(source.id);
    }
  }
  return ids;
}

/**
 * The overriding sources a draft change would newly disable. Disabling one of
 * these also hides the bundled core content its imported files replace, so the
 * panel asks for confirmation before applying the change.
 */
export function getNewlyDisabledOverrideSources(
  groups,
  currentRestrictedSourceIds,
  nextRestrictedSourceIds,
) {
  const current = new Set(
    normalizeRestrictedSourceIds(currentRestrictedSourceIds),
  );
  const next = new Set(normalizeRestrictedSourceIds(nextRestrictedSourceIds));
  const sources = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const source of group?.sources ?? []) {
      if (!source?.canToggle || !source?.overridesBundledCore) continue;
      if (!current.has(source.id) && next.has(source.id)) sources.push(source);
    }
  }
  return sources;
}

/**
 * The draft after a group header toggle: a fully or partly included group
 * switches all its switchable books off; a fully excluded one switches them
 * back on. Required books are never drafted.
 */
export function getGroupToggleSourceIds(draftSourceIds, group, state) {
  const ids = new Set(normalizeRestrictedSourceIds(draftSourceIds));
  const toggleableIds = (group?.sources ?? [])
    .filter((source) => source?.canToggle && source.id)
    .map((source) => source.id);
  if (state?.allEnabled || state?.mixed) {
    toggleableIds.forEach((id) => ids.add(id));
  } else {
    toggleableIds.forEach((id) => ids.delete(id));
  }
  return [...ids];
}

function namedSelections(value) {
  return (Array.isArray(value) ? value : []).filter(
    (entry) => typeof entry?.name === "string" && entry.name,
  );
}

/** Content types as players see them on the Build tab. */
const SELECTION_TYPE_LABELS = {
  Archetype: "Subclass",
  "Archetype Feature": "Subclass feature",
  Multiclass: "Class",
  "Sub Race": "Subrace",
  "Race Variant": "Race variant",
  "Racial Trait": "Trait",
  "Class Feature": "Class feature",
};

function selectionLabel(entry) {
  if (!entry.type) return entry.name;
  return `${entry.name} (${SELECTION_TYPE_LABELS[entry.type] ?? entry.type})`;
}

/**
 * The notice after applying sources: the choices removed from disabled books
 * and the class picks kept from them. An older engine reports spells only.
 */
export function formatSourceApplyMessage(response) {
  let removed = namedSelections(response?.removedSelections);
  if (!Array.isArray(response?.removedSelections)) {
    removed = (response?.removedSpellNames ?? []).map((name) => ({
      name,
      type: "Spell",
    }));
  }
  const kept = namedSelections(response?.keptSelections);
  const parts = [];
  if (removed.length) {
    const where = removed.some((entry) => entry.type === "Spell")
      ? "Build or Magic"
      : "Build";
    parts.push(
      `Removed from disabled books: ${removed.map(selectionLabel).join(", ")}. Choose replacements in ${where}.`,
    );
  }
  if (kept.length) {
    const books = kept.length === 1 ? "its book" : "their books";
    parts.push(
      `Kept ${kept.map(selectionLabel).join(", ")}: turn ${books} back on or change class in Build.`,
    );
  }
  return parts.length
    ? parts.join(" ")
    : "Source restrictions applied to this character.";
}
