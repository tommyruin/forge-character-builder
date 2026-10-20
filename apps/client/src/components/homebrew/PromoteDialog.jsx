// "Copy to a pack": where a finished entry goes, and what comes with it. The destination is a pack
// already on the device or a new pack (to share with a table). The entry is
// always copied; what it refers to (an item's granted feature, a subclass's class) is listed so the
// author sees the pack will hold everything the entry needs, and can leave a piece out knowingly.

import { useState } from 'react';
import Modal from '../Modal';
import { Field, SelectInput } from '../custom/fields';

const NEW_PACK = '__new__';

export default function PromoteDialog({ subject, plan, packs, defaultPackId = '', busy = false, error = null, onConfirm, onClose }) {
  const [destination, setDestination] = useState(defaultPackId && packs.some((pack) => pack.id === defaultPackId) ? defaultPackId : NEW_PACK);
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [skipped, setSkipped] = useState(() => new Set());
  const creating = destination === NEW_PACK;
  const target = creating ? null : packs.find((pack) => pack.id === destination);
  const held = new Set((target?.elements ?? []).map((element) => element.id));
  const chosen = plan.items.filter((item) => !item.linked || !skipped.has(item.id));
  const ready = !busy && chosen.length > 0 && (!creating || name.trim() !== '');

  const toggle = (id) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal open title={`Copy ${subject} to a pack`} onClose={onClose} size="wide">
      <form
        className="space-y-4"
        data-testid="hb-promote"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onConfirm({ target: creating ? { create: { name, author } } : { packId: destination }, items: chosen });
        }}
      >
        <Field label="Pack">
          <SelectInput
            label="Destination pack"
            data-testid="hb-promote-pack"
            value={destination}
            onChange={setDestination}
            options={[
              ...packs.map((pack) => ({ id: pack.id, label: `${pack.name} (${pack.elements?.length ?? 0})${pack.world ? ' · shared pack' : ''}` })),
              { id: NEW_PACK, label: 'A new pack…' },
            ]}
          />
        </Field>
        {creating && (
          <div className="fcb-custom-row" data-testid="hb-promote-new">
            <Field label="Pack name">
              <input className="fcb-input normal-case" aria-label="Pack name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Moonwell Campaign" />
            </Field>
            <Field label="Author">
              <input className="fcb-input normal-case" aria-label="Author" value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Who is sharing it" />
            </Field>
          </div>
        )}
        <div>
          <p className="fcb-field-label mb-1">Copied into the pack as they are</p>
          <ul className="space-y-1" data-testid="hb-promote-items">
            {plan.items.map((item) => (
              <li key={item.id} className="fcb-custom-entry flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Copy ${item.name}`}
                  checked={!item.linked || !skipped.has(item.id)}
                  disabled={!item.linked}
                  onChange={() => toggle(item.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{item.name}</span>
                  {item.meta && <span className="fcb-custom-entry-meta">{item.meta}</span>}
                </span>
                {item.linked && <span className="fcb-custom-note">Used by {subject}</span>}
                {held.has(item.id) && <span className="fcb-custom-note">Replaces the copy in this pack</span>}
              </li>
            ))}
          </ul>
        </div>
        {plan.notFound.length > 0 && (
          <p className="fcb-warning-note text-sm" data-testid="hb-promote-missing">
            {subject} also refers to {plan.notFound.join(', ')}, which is not in this {plan.sourceNoun ?? 'list'}. If it is in your library from
            another source, the pack still works there; otherwise import it too.
          </p>
        )}
        {error && (
          <p role="alert" className="fcb-alert">
            {error}
          </p>
        )}
        <div className="fcb-toolbar justify-end">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" data-testid="hb-promote-confirm" disabled={!ready}>
            {creating ? 'Create pack and copy' : `Copy to ${target?.name ?? 'pack'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
