// The state behind adding a pack file: read it, apply it at once when it is a pack this device
// does not have, and hold it for a confirm when it would replace one that is. Shared by the
// Homebrew page and Content › Manage files, so a pack file behaves the same from either.

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPackImport, planPackImport } from './packTransfer.js';

export default function usePackImport({ api, store, beforeLibraryMutation, onLibraryChanged, onLibraryMutationFinished, onImported }) {
  const [plan, setPlan] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);
  const hooks = useRef({ api, store });
  // The latest handlers, read when an import runs, so a long import is not tied to stale ones.
  useEffect(() => {
    hooks.current = { api, store, beforeLibraryMutation, onLibraryChanged, onLibraryMutationFinished, onImported };
  });

  const run = useCallback(async (toApply) => {
    setBusy(true);
    setPlan(null);
    try {
      const result = await applyPackImport(toApply, hooks.current);
      setOutcome({ ...result, name: toApply.manifest.name, kind: toApply.kind });
      if (result.stored) hooks.current.onImported?.(result.pack);
    } catch (error) {
      setOutcome({ ok: false, stored: false, name: toApply.manifest.name, errors: [{ where: 'Import', message: error.message }] });
    } finally {
      setBusy(false);
    }
  }, []);

  /** Reads a file. Returns `'not-pack'` for a file that is not a pack file, so the caller can handle it as content. */
  const start = useCallback(
    async (file) => {
      setOutcome(null);
      const text = await file.text();
      const next = planPackImport(text, await hooks.current.store.listHomebrew());
      if (next.kind === 'not-pack') return 'not-pack';
      if (next.kind === 'invalid') {
        setOutcome({ ok: false, stored: false, name: file.name, errors: [{ where: file.name, message: next.error }] });
        return 'invalid';
      }
      if (next.kind === 'new') {
        await run(next);
        return 'imported';
      }
      setPlan(next);
      return 'confirm';
    },
    [run],
  );

  const apply = useCallback(() => (plan ? run(plan) : Promise.resolve()), [plan, run]);
  const cancel = useCallback(() => setPlan(null), []);
  const dismiss = useCallback(() => setOutcome(null), []);

  return { plan, outcome, busy, start, apply, cancel, dismiss };
}
