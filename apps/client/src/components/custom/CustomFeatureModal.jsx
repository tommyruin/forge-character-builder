// The "Custom feature" dialog behind Build's [+] Custom: one form that makes (or edits) a
// rule for a character without XML. The author names it, says where it shows, writes its text
// and adds effects from chips; every effect is one of the shared blocks, and the draft that
// results is what the engine stores in the character file and compiles to an ordinary element.
//
// Saving an edit first asks the engine whether any choice would lose the picks already made
// under it (a choice is remembered by its name, type, level and count) and says so before it
// writes anything.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createCustomDraft, customDraftIssues } from '@forge-cb/engine/custom';
import Modal, { DialogFooter } from '../Modal';
import FeatureFields from './FeatureFields';
import { PROMOTE_LABEL, castAbilityIssues, parseUsage } from './draftModel';
import { trackerFromUsage } from './trackerModel';

// An entry made before limited uses were tracked holds them as a sheet usage line ("2/Short Rest").
// Opening it moves that line into a tracker, which writes the same line back when it is saved.
function withTrackedUsage(draft) {
  const parsed = parseUsage(draft.sheet?.usage);
  if (!parsed || (draft.trackers ?? []).length > 0) return draft;
  const { usage: _usage, ...sheet } = draft.sheet;
  return {
    ...draft,
    trackers: [trackerFromUsage(parsed, draft.name)],
    ...(Object.keys(sheet).length > 0 ? { sheet } : { sheet: undefined }),
  };
}

function identityMessage(change) {
  const what = change.change === 'removed' ? 'is being removed' : `changes its ${change.fields.join(', ')}`;
  const picks = change.picks.map((pick) => pick.elementName).join(', ');
  return `"${change.name}" ${what}. These picks would be cleared: ${picks}.`;
}

export default function CustomFeatureModal({
  services,
  characterName,
  entry = null,
  initialShowsUnder = 'feats',
  onClose,
  onSaved,
}) {
  const editing = entry !== null;
  const [draft, setDraft] = useState(() => {
    if (entry) return withTrackedUsage(structuredClone(entry.draft));
    const fresh = createCustomDraft('feature', '');
    return { ...fresh, showsUnder: initialShowsUnder };
  });
  const [promote, setPromote] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [partial, setPartial] = useState(null);
  const warningRef = useRef(null);

  // The warning sits at the bottom of a long form: bring it into view and put the keyboard on it.
  useEffect(() => {
    if (warning === null) return;
    warningRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    warningRef.current?.focus({ preventScroll: true });
  }, [warning]);

  const issues = useMemo(() => [...customDraftIssues(draft), ...castAbilityIssues(draft)], [draft]);

  const finish = async (saved) => {
    onSaved?.(saved);
    onClose();
  };

  const write = async () => {
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await services.save(draft);
    } catch (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    if (promote) {
      try {
        await services.promote(draft);
      } catch (e) {
        setPartial({ entry: result?.entry ?? null, message: `Added to ${characterName}, but could not copy it to a homebrew pack: ${e.message}` });
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    await finish(result?.entry ?? null);
  };

  const submit = async () => {
    setAttempted(true);
    setWarning(null);
    if (issues.length > 0) return;
    if (editing) {
      setSaving(true);
      try {
        const report = await services.impact(draft);
        if (report?.hasPicks) {
          setWarning(report.changes.filter((change) => change.picks.length > 0));
          setSaving(false);
          return;
        }
      } catch (e) {
        setError(e.message);
        setSaving(false);
        return;
      }
    }
    await write();
  };

  const title = editing ? 'Edit custom feature' : 'Custom feature';

  if (partial) {
    return (
      <Modal open title={title} onClose={() => finish(partial.entry)} size="wide">
        <p role="alert" className="fcb-alert">{partial.message}</p>
        <div className="fcb-toolbar mt-4 justify-end">
          <button type="button" className="fcb-button" onClick={() => finish(partial.entry)}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={title} onClose={onClose} size="wide">
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FeatureFields draft={draft} setDraft={setDraft} services={services} issues={issues} attempted={attempted} autoFocus />

        {!editing && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={promote} onChange={(event) => setPromote(event.target.checked)} />
            <span>{PROMOTE_LABEL}</span>
          </label>
        )}

        {error && <p role="alert" className="fcb-alert">{error}</p>}

        {warning && (
          <div ref={warningRef} tabIndex={-1} role="alert" className="fcb-alert space-y-2" data-testid="identity-warning">
            <p className="font-semibold">Saving this would clear picks the character already made.</p>
            <ul className="list-disc pl-5">
              {warning.map((change) => (
                <li key={change.blockId}>{identityMessage(change)}</li>
              ))}
            </ul>
            <div className="fcb-toolbar">
              <button type="button" className="fcb-button" onClick={() => setWarning(null)}>
                Keep editing
              </button>
              <button type="button" className="fcb-button fcb-button-danger" disabled={saving} onClick={() => { setWarning(null); void write(); }}>
                Save and clear those picks
              </button>
            </div>
          </div>
        )}

        {/* While the warning is up, its two buttons are the only way forward. */}
        {warning === null && (
          <DialogFooter>
            {/* The button waits until the form is complete; this says what it is waiting for. */}
            {issues.length > 0 && (
              <p id="feature-add-needs" className="fcb-custom-needs mr-auto" data-testid="add-needs">
                To add it: {issues[0].message.charAt(0).toLowerCase() + issues[0].message.slice(1)}
                {issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}
              </p>
            )}
            <button type="button" className="fcb-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="fcb-button fcb-status-complete" disabled={saving || issues.length > 0} aria-describedby={issues.length > 0 ? 'feature-add-needs' : undefined}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add feature'}
            </button>
          </DialogFooter>
        )}
      </form>
    </Modal>
  );
}
