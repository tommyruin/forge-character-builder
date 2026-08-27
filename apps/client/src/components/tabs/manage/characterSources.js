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
