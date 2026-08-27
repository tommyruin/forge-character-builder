// The names the client persists under in the browser, resolved once from the
// host shell. The defaults are the builder's own; a host whose users already
// hold data under other names supplies those through `shell.storage`, so the
// same build reads what it always wrote for them.
import { shell } from '@shell';

export const DEFAULT_STORAGE_NAMES = Object.freeze({
  database: 'fcb-local',
  autosaveKey: 'fcb-autosave',
  activeCharacterKey: 'fcb-active-character',
  splitViewKey: 'fcb-split-view',
  packageToken: 'fcb-character-package',
});

/** The names a `shell.storage` block resolves to, every omission taking the default. */
export function resolveStorageNames(storage) {
  const config = typeof storage === 'object' && storage !== null ? storage : {};
  const keys = typeof config.keys === 'object' && config.keys !== null ? config.keys : {};
  const text = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);
  const packageToken = text(config.packageToken, DEFAULT_STORAGE_NAMES.packageToken);
  const legacy = Array.isArray(config.legacyPackageTokens) ? config.legacyPackageTokens.filter((token) => typeof token === 'string') : [];
  return Object.freeze({
    database: text(config.database, DEFAULT_STORAGE_NAMES.database),
    autosaveKey: text(keys.autosave, DEFAULT_STORAGE_NAMES.autosaveKey),
    activeCharacterKey: text(keys.activeCharacter, DEFAULT_STORAGE_NAMES.activeCharacterKey),
    splitViewKey: text(keys.splitView, DEFAULT_STORAGE_NAMES.splitViewKey),
    packageToken,
    /** Every package `format` token the importer accepts: the current one plus the host's legacy ones. */
    acceptedPackageTokens: Object.freeze([...new Set([packageToken, DEFAULT_STORAGE_NAMES.packageToken, ...legacy])]),
  });
}

const names = resolveStorageNames(shell.storage);

export const STORAGE_DATABASE = names.database;
export const AUTOSAVE_STORAGE_KEY = names.autosaveKey;
export const ACTIVE_CHARACTER_STORAGE_KEY = names.activeCharacterKey;
export const SPLIT_VIEW_STORAGE_KEY = names.splitViewKey;
export const CHARACTER_PACKAGE_TOKEN = names.packageToken;
export const ACCEPTED_CHARACTER_PACKAGE_TOKENS = names.acceptedPackageTokens;
