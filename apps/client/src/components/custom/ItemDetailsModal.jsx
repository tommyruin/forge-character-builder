// Rename / notes for one inventory record, book or custom. The name is this character's own for
// this record: the item keeps its rules, and the preview shows the lines the sheet will print. An
// empty name goes back to the item's own.

import { useState } from 'react';
import Modal from '../Modal';
import { Field } from './fields';

export const MAX_ITEM_NAME = 120;
export const MAX_ITEM_NOTES = 2000;

// The lines the sheet prints for a record with this name: the attack row (weapons) and the
// equipment line, which keeps the item's own name beside a custom one.
export function sheetLines(item, name) {
  const shown = name.trim() || item.defaultName;
  const lines = [];
  if (item.type === 'Weapon') lines.push(`Attacks: ${shown}`);
  const renamed = name.trim() !== '';
  lines.push(`Equipment: ${renamed ? `${shown} (${item.defaultName})` : shown}${item.amount > 1 ? ` x${item.amount}` : ''}`);
  return lines;
}

export default function ItemDetailsModal({ item, busy = false, onClose, onSave }) {
  const [name, setName] = useState(item.customName ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const nameTooLong = name.trim().length > MAX_ITEM_NAME;
  const notesTooLong = notes.trim().length > MAX_ITEM_NOTES;
  const unchanged = name.trim() === (item.customName ?? '') && notes.trim() === (item.notes ?? '');

  const submit = () => {
    if (nameTooLong || notesTooLong || unchanged) return;
    void onSave(item, { name: name.trim(), notes: notes.trim() });
  };

  return (
    <Modal open title={`Rename or add notes to ${item.defaultName}`} onClose={onClose}>
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Name">
          <input
            className="fcb-input"
            aria-label="Name"
            autoFocus
            placeholder={item.defaultName}
            value={name}
            maxLength={MAX_ITEM_NAME + 20}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="fcb-textarea"
            aria-label="Notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        {(nameTooLong || notesTooLong) && (
          <p role="alert" className="fcb-custom-issues">
            {nameTooLong ? `The name is at most ${MAX_ITEM_NAME} characters.` : `The notes are at most ${MAX_ITEM_NOTES} characters.`}
          </p>
        )}
        <div className="fcb-custom-summary" data-testid="item-sheet-preview">
          <div>
            <h4 className="fcb-field-label">On the sheet</h4>
            {sheetLines(item, name).map((line) => (
              <p key={line} className="text-sm">
                {line}
              </p>
            ))}
          </div>
        </div>
        <p className="fcb-muted-copy text-xs">
          Rules unchanged: it still works as {item.defaultName}. Only the name and notes change, on this character only.
        </p>
        <div className="fcb-toolbar fcb-dialog-footer justify-end">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={busy || unchanged || nameTooLong || notesTooLong}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
