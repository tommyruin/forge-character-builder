// The character sheet template set: which rules edition's layout the PDF
// renders against. Persisted per browser; renaming the key silently resets the
// preference for everyone who set it.
export const SHEET_TEMPLATE_STORAGE_KEY = 'fcb-sheet-template';
export const SHEET_TEMPLATE_SETS = ['2014', '2024'];
export const DEFAULT_SHEET_TEMPLATE_SET = '2014';

export function readStoredSheetTemplateSet(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(SHEET_TEMPLATE_STORAGE_KEY);
    return SHEET_TEMPLATE_SETS.includes(value) ? value : DEFAULT_SHEET_TEMPLATE_SET;
  } catch {
    return DEFAULT_SHEET_TEMPLATE_SET;
  }
}

// Whether the reader has ever chosen a set. Without a choice the workspace
// follows the character's ruleset (see hooks/useFollowRulesetTemplate.js), so
// "no choice" must stay distinguishable from "chose the default".
export function hasStoredSheetTemplateSet(storage = globalThis.localStorage) {
  try {
    return SHEET_TEMPLATE_SETS.includes(storage?.getItem(SHEET_TEMPLATE_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function storeSheetTemplateSet(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SHEET_TEMPLATE_STORAGE_KEY, value);
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

// One store shared by the sheet tab, the split-view preview and the export
// menu, so every render agrees on the set.
export function createSheetTemplateSettingStore({ storage = globalThis.localStorage } = {}) {
  let current = readStoredSheetTemplateSet(storage);
  let explicit = hasStoredSheetTemplateSet(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // A reader's own choice: persisted, and it stops the set following the
  // character's ruleset from here on — even when it names the current set.
  const set = (next) => {
    if (!SHEET_TEMPLATE_SETS.includes(next)) return;
    const changed = next !== current || !explicit;
    current = next;
    explicit = true;
    storeSheetTemplateSet(current, storage);
    if (changed) notify();
  };
  // Following a character's ruleset. It moves the session's set without
  // persisting, so opening a 2014 character next still follows that one.
  const follow = (next) => {
    if (explicit || !SHEET_TEMPLATE_SETS.includes(next) || next === current) return;
    current = next;
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    getExplicitSnapshot: () => explicit,
    set,
    follow,
    syncFromStorage() {
      const value = readStoredSheetTemplateSet(storage);
      const stored = hasStoredSheetTemplateSet(storage);
      if (value === current && stored === explicit) return;
      current = value;
      explicit = stored;
      notify();
    },
  };
}

export const sheetTemplateSettingStore = createSheetTemplateSettingStore();
