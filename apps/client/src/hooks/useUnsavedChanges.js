import { useCallback, useSyncExternalStore } from 'react';
import { api } from '../api';

// True while `id` has edits the transport has not written to storage.
export default function useUnsavedChanges(id, characters = api.characters) {
  const subscribe = useCallback(
    (listener) =>
      characters.onUnsavedChange?.(() => listener()) ?? (() => undefined),
    [characters],
  );
  const getSnapshot = useCallback(
    () => Boolean(characters.hasUnsavedChanges?.(id)),
    [characters, id],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
