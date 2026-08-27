import { useCallback, useSyncExternalStore } from 'react';
import { api } from '../api';

// True while `id` has an edit that Undo can step back from.
export default function useUndoAvailable(id, characters = api.characters) {
  const subscribe = useCallback(
    (listener) =>
      characters.onUnsavedChange?.(() => listener()) ?? (() => undefined),
    [characters],
  );
  const getSnapshot = useCallback(
    () => Boolean(characters.canUndo?.(id)),
    [characters, id],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
