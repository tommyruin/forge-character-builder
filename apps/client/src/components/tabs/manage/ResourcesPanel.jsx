import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import { useWorkspace } from '../../WorkspaceContext';
import Icon from '../../Icon';
import Modal from '../../Modal';
import { CustomBadge } from '../../custom/CustomEntries';
import TrackerBlock from '../../custom/TrackerBlock';
import { makeTracker } from '../../custom/trackerModel';
import { trackerCardView, switchNote } from './resourcesModel';

// MANAGE / Resources: every limited use the character has (book features that state a count and
// a rest, custom features and items, and trackers kept by hand), the switches that gate custom
// bonuses, and the two rests. A tracker with a few uses is a row of pips to tap; one with many is
// a counter. The numbers come from the engine, so a maximum that follows the level or a modifier
// is always the current one.

function Pips({ view, disabled, onSet }) {
  return (
    <div className="fcb-resource-pips" role="group" aria-label={`${view.label} uses`}>
      {view.pips.map((pip) => (
        <button
          key={pip.index}
          type="button"
          className={`fcb-resource-pip${pip.spent ? ' is-spent' : ''}`}
          aria-label={pip.label}
          aria-pressed={!pip.spent}
          disabled={disabled}
          onClick={() => onSet(pip.nextUsed)}
        />
      ))}
    </div>
  );
}

function Counter({ view, disabled, onSet }) {
  return (
    <div className="fcb-resource-counter">
      <button
        type="button"
        className="fcb-icon-button"
        aria-label={`Spend one ${view.label}`}
        disabled={disabled || view.remaining <= 0}
        onClick={() => onSet(view.used + 1)}
      >
        −
      </button>
      <strong aria-live="polite" aria-label={`${view.label} remaining`}>
        {view.counterText}
      </strong>
      <button
        type="button"
        className="fcb-icon-button"
        aria-label={`Regain one ${view.label}`}
        disabled={disabled || view.used <= 0}
        onClick={() => onSet(view.used - 1)}
      >
        +
      </button>
    </div>
  );
}

function TrackerCard({ tracker, disabled, onSet, onEdit, onRemove }) {
  const view = trackerCardView(tracker);
  return (
    <li className="fcb-resource-card" data-testid="resource-card" aria-label={view.label}>
      <div className="min-w-0 flex-1">
        <strong>{view.label}</strong>
        <div className="fcb-resource-meta">
          {view.badge === 'custom' ? <CustomBadge /> : null}
          <span className="fcb-resource-source">{view.source}</span>
          <span className="fcb-muted-copy text-xs">{tracker.rechargeLabel}</span>
        </div>
      </div>
      {view.asPips ? (
        <Pips view={view} disabled={disabled} onSet={(used) => onSet(tracker, used)} />
      ) : (
        <Counter view={view} disabled={disabled} onSet={(used) => onSet(tracker, used)} />
      )}
      {tracker.manual && (
        <div className="fcb-resource-actions">
          <button type="button" className="fcb-button px-2 py-1 text-xs" disabled={disabled} aria-label={`Edit ${view.label}`} onClick={() => onEdit(tracker)}>
            <Icon name="edit" />
            Edit
          </button>
          <button
            type="button"
            className="fcb-button fcb-button-danger px-2 py-1 text-xs"
            disabled={disabled}
            aria-label={`Remove ${view.label}`}
            onClick={() => onRemove(tracker)}
          >
            <Icon name="delete" />
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function SwitchRow({ entry, disabled, onToggle }) {
  return (
    <li className="fcb-resource-switch">
      <button
        type="button"
        role="switch"
        aria-checked={entry.on}
        aria-label={entry.name}
        className={`fcb-switch${entry.on ? ' is-on' : ''}`}
        disabled={disabled}
        onClick={() => onToggle(entry)}
      >
        <span className="fcb-switch-knob" />
      </button>
      <span>
        <strong>{entry.name}</strong> <span className="fcb-muted-copy text-xs">{switchNote(entry)}</span>
      </span>
    </li>
  );
}

function ManualTrackerModal({ draft, onChange, onSave, onClose, saving, error }) {
  const problems = !draft.tracker.label.trim() ? ['Give it a name.'] : [];
  return (
    <Modal open title={draft.isNew ? 'Add a tracker' : 'Edit tracker'} onClose={onClose} size="wide">
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (problems.length === 0) onSave();
        }}
      >
        <TrackerBlock
          tracker={draft.tracker}
          literalOnly
          ariaLabel="Tracker"
          onChange={(tracker) => onChange({ ...draft, tracker })}
        />
        {error && <p role="alert" className="fcb-alert">{error}</p>}
        <div className="fcb-toolbar justify-end">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={saving || problems.length > 0}>
            {saving ? 'Saving…' : draft.isNew ? 'Add tracker' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ResourcesPanel() {
  const { id, busy, run, mutationTick } = useWorkspace();
  const [resources, setResources] = useState(null);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState(null);
  const [saving, setSaving] = useState(false);
  const [manualError, setManualError] = useState(null);

  const refresh = useCallback(
    () =>
      api.characters
        .resources(id)
        .then((result) => {
          setResources(result);
          setError(null);
        })
        .catch((caught) => setError(caught.message)),
    [id],
  );

  useEffect(() => {
    void refresh();
  }, [refresh, mutationTick]);

  // Every action is an edit the shared Undo button takes back; the workspace banner owns an
  // engine refusal (a switch with no use left to spend), so the page only stays truthful.
  const act = useCallback(
    async (operation) => {
      try {
        await run(operation);
      } catch {
        // Reported by the workspace.
      }
      await refresh();
    },
    [refresh, run],
  );

  const trackers = useMemo(() => resources?.trackers ?? [], [resources]);
  const switches = resources?.switches ?? [];

  const openAdd = () => {
    setManualError(null);
    setManual({ isNew: true, tracker: makeTracker({ label: '' }) });
  };
  const openEdit = (tracker) => {
    setManualError(null);
    setManual({ isNew: false, tracker: structuredClone(tracker.def) });
  };
  const saveManual = async () => {
    setSaving(true);
    setManualError(null);
    try {
      await run(() => api.characters.saveManualTracker(id, manual.tracker));
      setManual(null);
      await refresh();
    } catch (caught) {
      setManualError(caught.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="fcb-panel" data-testid="resources-panel">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">Resources</h2>
          <p className="fcb-panel-subtitle">
            Every limited use, from class rules, items and custom entries. Tap a pip to spend it.
          </p>
        </div>
        <div className="fcb-toolbar">
          <button type="button" className="fcb-button" disabled={busy} onClick={openAdd}>
            <Icon name="add" />
            Add tracker
          </button>
          <button type="button" className="fcb-button" disabled={busy} onClick={() => void act(() => api.characters.rest(id, 'short'))}>
            Short rest
          </button>
          <button type="button" className="fcb-button fcb-button-primary" disabled={busy} onClick={() => void act(() => api.characters.rest(id, 'long'))}>
            Long rest
          </button>
        </div>
      </header>
      <div className="fcb-panel-body space-y-4">
        {error && <p role="alert" className="fcb-alert">{error}</p>}
        {resources !== null && trackers.length === 0 && (
          <p className="fcb-empty-copy">
            No limited uses yet. Features that state a count and a rest appear here by themselves; custom features and
            items can carry their own, and Add tracker keeps one by hand.
          </p>
        )}
        {trackers.length > 0 && (
          <ul className="fcb-resource-grid">
            {trackers.map((tracker) => (
              <TrackerCard
                key={tracker.id}
                tracker={tracker}
                disabled={busy}
                onSet={(entry, used) => void act(() => api.characters.setTrackerUsed(id, entry.id, used))}
                onEdit={openEdit}
                onRemove={(entry) => void act(() => api.characters.deleteManualTracker(id, entry.id))}
              />
            ))}
          </ul>
        )}

        <div className="fcb-resource-switches" aria-label="Switches">
          <h3 className="fcb-field-label">Switches</h3>
          {switches.length === 0 ? (
            <p className="fcb-muted-copy text-xs">
              A custom feature whose bonuses apply only while it is active adds a switch here.
            </p>
          ) : (
            <ul className="space-y-2">
              {switches.map((entry) => (
                <SwitchRow
                  key={entry.name}
                  entry={entry}
                  disabled={busy}
                  onToggle={(target) => void act(() => api.characters.setResourceSwitch(id, target.name, !target.on))}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {manual && (
        <ManualTrackerModal
          draft={manual}
          onChange={setManual}
          onSave={() => void saveManual()}
          onClose={() => setManual(null)}
          saving={saving}
          error={manualError}
        />
      )}
    </section>
  );
}
