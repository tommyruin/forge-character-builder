// Rename / notes for one spell on one character, book or custom. The name is this character's
// own: the spell keeps its rules and numbers, the Magic tab leads with the name and keeps the real
// one beside it, and the sheet prints it. An empty name goes back to the spell's own.

import { useState } from 'react';
import Modal from '../Modal';
import { Field } from './fields';

export const MAX_ALIAS_NAME = 80;
export const MAX_ALIAS_NOTE = 500;

// The lines the app and the sheet print for a spell with this display name: the Magic tab and the
// spell card have room for both names, the narrow spell list prints the display name alone.
export function aliasLines(realName, alias) {
  const shown = alias.trim();
  const both = shown === '' || shown === realName ? realName : `${shown} (${realName})`;
  return [`Magic tab: ${both}`, `Spell list: ${shown === '' ? realName : shown}`, `Spell card and attack row: ${both}`];
}

export default function SpellAliasModal({ spell, busy = false, onClose, onSave }) {
  const [name, setName] = useState(spell.alias?.name ?? '');
  const [note, setNote] = useState(spell.alias?.note ?? '');
  const nameTooLong = name.trim().length > MAX_ALIAS_NAME;
  const noteTooLong = note.trim().length > MAX_ALIAS_NOTE;
  const unchanged = name.trim() === (spell.alias?.name ?? '') && note.trim() === (spell.alias?.note ?? '');

  const submit = () => {
    if (nameTooLong || noteTooLong || unchanged) return;
    void onSave(spell, { name: name.trim(), note: note.trim() });
  };

  return (
    <Modal open title={`Rename or add notes to ${spell.name}`} onClose={onClose}>
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
            placeholder={spell.name}
            value={name}
            maxLength={MAX_ALIAS_NAME + 20}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="fcb-textarea"
            aria-label="Notes"
            rows={3}
            placeholder="Optional. Printed with the spell card."
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {(nameTooLong || noteTooLong) && (
          <p role="alert" className="fcb-custom-issues">
            {nameTooLong ? `The name is at most ${MAX_ALIAS_NAME} characters.` : `The notes are at most ${MAX_ALIAS_NOTE} characters.`}
          </p>
        )}
        <div className="fcb-custom-summary" data-testid="spell-alias-preview">
          <div>
            <h4 className="fcb-field-label">On the sheet</h4>
            <p className="text-sm">Original name: {spell.name}</p>
            {aliasLines(spell.name, name).map((line) => (
              <p key={line} className="text-sm">
                {line}
              </p>
            ))}
          </div>
        </div>
        <p className="fcb-muted-copy text-xs">
          Rules unchanged: it still works as {spell.name}. Only the name and notes change, on this character only.
        </p>
        <div className="fcb-toolbar fcb-dialog-footer justify-end">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={busy || unchanged || nameTooLong || noteTooLong}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
