export function applyLibraryRevision({
  characterReloadRequired,
  invalidateCache,
  invalidateSheet,
  active,
  refresh,
}) {
  invalidateCache();
  if (characterReloadRequired === false) return false;
  invalidateSheet();
  if (active) refresh();
  return true;
}

export async function prepareOpenCharacterForLibraryChange(
  characters,
  openCharacterId,
  { characterReloadRequired } = {},
) {
  if (characterReloadRequired === false) return null;
  characters.invalidateLoadedCharacter?.();
  if (!openCharacterId) return null;

  try {
    await characters.get(openCharacterId);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error(String(error ?? 'Character refresh failed'));
  }
}
