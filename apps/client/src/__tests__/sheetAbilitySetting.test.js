import { describe, expect, it } from "vitest";
import {
  createSheetAbilitySettingStore,
  SHEET_ABILITY_STORAGE_KEY,
} from "../sheetAbilitySetting.js";
import { sheetCacheKey } from "../components/sheetCache.js";

describe("ability emphasis preference", () => {
  it("defaults off, persists and restores only booleans", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
    const store = createSheetAbilitySettingStore({ storage });
    expect(store.getSnapshot()).toBe(false);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set(true);
    store.set(true);
    expect(calls).toBe(1);
    expect(createSheetAbilitySettingStore({ storage }).getSnapshot()).toBe(
      true,
    );
    values.set(SHEET_ABILITY_STORAGE_KEY, '"true"');
    store.syncFromStorage();
    expect(store.getSnapshot()).toBe(false);
  });
  it("separates cached PDFs by emphasis", () => {
    const args = ["hero", 1, false, 0, "2024", "colours", "fonts", "pages"];
    expect(sheetCacheKey(...args, true)).not.toBe(
      sheetCacheKey(...args, false),
    );
  });
});
