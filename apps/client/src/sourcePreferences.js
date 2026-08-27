import { localStore } from './transport/localStore.js';

export const DEFAULT_SOURCE_PREFERENCE_KEY =
  'character-default-restricted-source-ids';

export function normalizeRestrictedSourceIds(value) {
  const candidate = Array.isArray(value)
    ? value
    : value?.restrictedSourceIds;
  if (!Array.isArray(candidate)) return [];
  return [
    ...new Set(
      candidate
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export async function readDefaultRestrictedSourceIds(store = localStore) {
  if (typeof store?.getMeta !== 'function') return [];
  const value = await store.getMeta(DEFAULT_SOURCE_PREFERENCE_KEY);
  return normalizeRestrictedSourceIds(value);
}

export async function writeDefaultRestrictedSourceIds(
  restrictedSourceIds,
  store = localStore,
) {
  const normalized = normalizeRestrictedSourceIds(restrictedSourceIds);
  if (typeof store?.putMeta !== 'function') {
    throw new Error('This browser cannot save source defaults.');
  }
  await store.putMeta(DEFAULT_SOURCE_PREFERENCE_KEY, {
    version: 1,
    restrictedSourceIds: normalized,
  });
  return normalized;
}
