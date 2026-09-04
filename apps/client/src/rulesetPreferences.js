import { localStore } from './transport/localStore.js';

export const DEFAULT_RULESET_PREFERENCE_KEY = 'character-default-ruleset-mode';

// The three modes the engine accepts; anything else is treated as "no default
// saved" so a stale or hand-edited record can never wedge character creation.
export const RULESET_MODES = ['all', '2014', '2024'];

export function normalizeRulesetMode(value) {
  const candidate = typeof value === 'string' ? value : value?.mode;
  const mode = String(candidate ?? '').trim();
  return RULESET_MODES.includes(mode) ? mode : null;
}

export async function readDefaultRulesetMode(store = localStore) {
  if (typeof store?.getMeta !== 'function') return null;
  return normalizeRulesetMode(await store.getMeta(DEFAULT_RULESET_PREFERENCE_KEY));
}

export async function writeDefaultRulesetMode(mode, store = localStore) {
  const normalized = normalizeRulesetMode(mode);
  if (!normalized) {
    throw new Error('Choose a rules version before saving it as the default.');
  }
  if (typeof store?.putMeta !== 'function') {
    throw new Error('This browser cannot save rules version defaults.');
  }
  await store.putMeta(DEFAULT_RULESET_PREFERENCE_KEY, {
    version: 1,
    mode: normalized,
  });
  return normalized;
}
