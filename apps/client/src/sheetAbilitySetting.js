// Browser-wide preference shared by previews and PDF downloads.
export const SHEET_ABILITY_STORAGE_KEY = "fcb-sheet-ability-emphasis";

export function createSheetAbilitySettingStore({
  storage = globalThis.localStorage,
} = {}) {
  const read = () => {
    try {
      return (
        JSON.parse(storage?.getItem(SHEET_ABILITY_STORAGE_KEY) ?? "false") ===
        true
      );
    } catch {
      return false;
    }
  };
  let current = read();
  const listeners = new Set();
  const update = (next) => {
    if (typeof next !== "boolean" || next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    set(value) {
      if (typeof value !== "boolean") return;
      try {
        storage?.setItem(SHEET_ABILITY_STORAGE_KEY, JSON.stringify(value));
      } catch {
        // The preference still works for this session when storage is unavailable.
      }
      update(value);
    },
    syncFromStorage: () => update(read()),
  };
}

export const sheetAbilitySettingStore = createSheetAbilitySettingStore();
