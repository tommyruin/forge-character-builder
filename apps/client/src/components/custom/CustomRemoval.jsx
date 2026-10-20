// Removing a custom entry from one of the Build tab's lists. Remove deletes the entry's draft, and
// with it the picks the character made under its choices, so it asks first when there are any
// (naming them), and says what it did either way. The shared Undo button brings it back.

import { useCallback, useState } from 'react';
import Modal from '../Modal';

export function useCustomRemoval({ services, notify }) {
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const removeNow = useCallback(
    async (entry) => {
      await services.remove(entry.elementId);
      notify?.(`Removed ${entry.draft.name}. Undo brings it back.`);
    },
    [services, notify],
  );

  const request = useCallback(
    async (entry) => {
      let changes = [];
      try {
        // Removing the entry removes every choice it holds, so ask about the draft without them.
        const without = { ...entry.draft, blocks: (entry.draft.blocks ?? []).filter((block) => block.kind !== 'choice') };
        const report = await services.impact(without);
        changes = (report?.changes ?? []).filter((change) => change.picks.length > 0);
      } catch {
        // The impact check is a courtesy; Undo still covers a remove it could not check.
      }
      if (changes.length > 0) {
        setError(null);
        setPending({ entry, changes });
        return;
      }
      await removeNow(entry);
    },
    [services, removeNow],
  );

  const confirm = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await removeNow(pending.entry);
      setPending(null);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }, [pending, removeNow]);

  return { request, pending, saving, error, confirm, cancel: () => setPending(null) };
}

export function CustomRemovalDialog({ removal }) {
  const { pending } = removal;
  if (!pending) return null;
  return (
    <Modal open title={`Remove ${pending.entry.draft.name}`} onClose={removal.cancel}>
      <div className="fcb-custom-form" data-testid="remove-picks-warning">
        <p className="font-semibold">Removing this would clear picks the character already made.</p>
        <ul className="list-disc pl-5">
          {pending.changes.map((change) => (
            <li key={change.blockId}>
              {change.name}: {change.picks.map((pick) => pick.elementName).join(', ')}
            </li>
          ))}
        </ul>
        {removal.error && <p role="alert" className="fcb-alert">{removal.error}</p>}
        <div className="fcb-toolbar justify-end">
          <button type="button" className="fcb-button" onClick={removal.cancel}>
            Keep it
          </button>
          <button type="button" className="fcb-button fcb-button-danger" disabled={removal.saving} onClick={() => void removal.confirm()}>
            Remove and clear those picks
          </button>
        </div>
      </div>
    </Modal>
  );
}
