// Rename and note for one spell on one character, book or custom. The name is this character's
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
    <Modal open title={`Rename ${spell.name}`} onClose={onClose}>
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Display name">
          <input
            className="fcb-input"
            aria-label="Display name"
            autoFocus
            placeholder={spell.name}
            value={name}
            maxLength={MAX_ALIAS_NAME + 20}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Note">
          <textarea
            className="fcb-textarea"
            aria-label="Note"
            rows={3}
            placeholder="Optional. Printed with the spell's card."
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {(nameTooLong || noteTooLong) && (
          <p role="alert" className="fcb-custom-issues">
            {nameTooLong ? `The name is at most ${MAX_ALIAS_NAME} characters.` : `The note is at most ${MAX_ALIAS_NOTE} characters.`}
          </p>
        )}
        <div className="fcb-custom-summary" data-testid="spell-alias-preview">
          <div>
            <h4 className="fcb-field-label">Where it shows</h4>
            {aliasLines(spell.name, name).map((line) => (
              <p key={line} className="text-sm">
                {line}
              </p>
            ))}
          </div>
        </div>
        <p className="fcb-muted-copy text-xs">
          The rules stay {spell.name}'s. Only the name and note change, on this character only.
        </p>
        <div className="fcb-toolbar justify-end">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={busy || unchanged || nameTooLong || noteTooLong}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
