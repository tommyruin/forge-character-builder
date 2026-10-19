// Picks the class a subclass belongs to, or the species a subspecies belongs to: one of this pack's
// own, or one the library holds. What matters is the tag the parent's pick answers to, so a
// book class is looked up for it and an author can state one by hand when the lookup finds none.

import { useState } from 'react';
import LibraryPicker from '../custom/LibraryPicker';
import { Field } from '../custom/fields';
import { PARENT_KINDS, findPickTag, packParents } from './parentLookup';

export default function ParentPicker({ kind, pack, api, lookup, value, onPick }) {
  const spec = PARENT_KINDS[kind];
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(null);
  const [manualTag, setManualTag] = useState('');
  const own = packParents(pack, kind);

  const pickBook = async (item) => {
    setBusy(true);
    setMissing(null);
    try {
      const found = await findPickTag(api, item.id, kind);
      if (found) onPick({ id: item.id, name: item.name, tag: found.tag, kind: found.kind });
      else setMissing({ id: item.id, name: item.name });
    } catch {
      setMissing({ id: item.id, name: item.name });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" role="group" aria-label={`Which ${spec.noun}`} data-testid="hb-parent-picker">
      {value?.id ? (
        <p className="text-sm">
          For <strong>{value.name || value.id}</strong>
          {value.tag ? <span className="fcb-muted-copy"> · pick list “{value.tag.split('||').join('” or “')}”</span> : null}
        </p>
      ) : (
        <p className="text-sm">Which {spec.noun} is this for?</p>
      )}

      {own.length > 0 && (
        <div className="space-y-1">
          <span className="fcb-field-label">In this pack</span>
          <ul className="fcb-custom-chips">
            {own.map((parent) => (
              <li key={parent.id}>
                <button
                  type="button"
                  className="fcb-mode-button"
                  disabled={parent.tag === null}
                  title={parent.tag === null ? `This ${spec.noun} offers no ${kind === 'subclass' ? 'subclass' : 'subspecies'} pick yet; turn one on in its Basics.` : undefined}
                  onClick={() => onPick(parent)}
                >
                  {parent.name || 'Unnamed'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <span className="fcb-field-label">From the library</span>
        <LibraryPicker lookup={lookup} type={spec.parentType} label={`Find a ${spec.noun}`} onPick={pickBook} />
        {busy && <p className="fcb-muted-copy text-xs">Looking up its pick list…</p>}
      </div>

      {missing && (
        <div role="alert" className="fcb-alert space-y-2" data-testid="hb-parent-missing">
          <p>
            {missing.name} offers no {kind === 'subclass' ? 'subclass' : 'subspecies'} pick the builder can read. If you know the tag its pick answers to, enter it.
          </p>
          <Field label="Tag the pick answers to">
            <input className="fcb-input" aria-label="Pick list tag" value={manualTag} onChange={(event) => setManualTag(event.target.value)} />
          </Field>
          <button
            type="button"
            className="fcb-button"
            disabled={manualTag.trim() === ''}
            onClick={() => {
              onPick({ id: missing.id, name: missing.name, tag: manualTag.trim(), kind: null });
              setMissing(null);
            }}
          >
            Use this tag
          </button>
        </div>
      )}
    </div>
  );
}
