async function safeStatistics(characters, id) {
  try {
    return await characters.statistics(id);
  } catch {
    return null;
  }
}

export function shouldRefreshWorkspaceOnActivation(wasActive, active) {
  return active && !wasActive;
}

export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    isCurrent(request) {
      return request === latest;
    },
  };
}

export function storeResourceIfCurrent(cache, key, promise, data) {
  if (cache.get(key)?.promise !== promise) return false;
  cache.set(key, { data });
  return true;
}

// Loading must remain ordered: get() restores the character into the engine's
// single slot, so statistics cannot safely overtake it on the serialized worker.
// A detail carrying its own statistics dictionary skips the second call.
export async function loadWorkspaceData(characters, id) {
  const detail = await characters.get(id);
  const stats = detail?.statistics ? { values: detail.statistics } : await safeStatistics(characters, id);
  return { detail, stats };
}

// Resolve the post-mutation workspace snapshot with at most one statistics call. Mutations
// whose handler returns the full character detail (transport mutateDetail resolves to the
// freshly built detail when the result carries the character id) are reused directly, and a
// detail that carries its own statistics dictionary answers the statistics query for free —
// no second engine round trip at all.
export async function loadMutationWorkspaceData(
  characters,
  id,
  result,
  { refreshDetail = true } = {},
) {
  if (result?.id) {
    const stats = result.statistics
      ? { values: result.statistics }
      : await safeStatistics(characters, id);
    return { detail: result, stats };
  }
  if (refreshDetail) return loadWorkspaceData(characters, id);
  return { detail: null, stats: await safeStatistics(characters, id) };
}
