import { useEffect, useSyncExternalStore } from "react";
import {
  SHEET_ABILITY_STORAGE_KEY,
  sheetAbilitySettingStore,
} from "../sheetAbilitySetting.js";

export default function useSheetAbilitySetting() {
  const emphasizeAbilityModifiers = useSyncExternalStore(
    sheetAbilitySettingStore.subscribe,
    sheetAbilitySettingStore.getSnapshot,
    sheetAbilitySettingStore.getSnapshot,
  );
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === SHEET_ABILITY_STORAGE_KEY || event.key === null) {
        sheetAbilitySettingStore.syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return {
    emphasizeAbilityModifiers,
    setEmphasizeAbilityModifiers: sheetAbilitySettingStore.set,
  };
}
