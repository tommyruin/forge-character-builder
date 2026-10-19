// The character's custom entries in the Build tab: a hook that reads the character's own pack,
// and the rows that list an entry with its Custom badge and Edit / Remove actions. Remove
// deletes the draft (and with it the grant); the shared Undo button brings it back.

import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { InformationButton, InspectableItemButton } from '../InspectableItemControls';
import { showsUnderLabel, typeLabel } from './draftModel';

// The entries refetch whenever the character detail changes, the same moment the DM-grant list
// does, so an add, edit, remove or undo is reflected without a manual refresh.
export function useCustomContent(services, detail) {
  const [content, setContent] = useState({ entries: [], problems: [] });
  useEffect(() => {
    if (!services) return undefined;
    let alive = true;
    services
      .list()
      .then((next) => {
        if (alive) setContent({ entries: next?.entries ?? [], problems: next?.problems ?? [] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [services, detail]);
  return content;
}

export function CustomBadge() {
  return <span className="fcb-custom-badge">Custom</span>;
}

function metaLine(entry) {
  const { draft } = entry;
  const kind = draft.showsUnder === 'other' ? 'Feature' : typeLabel(entry.type);
  return [kind, 'Custom', draft.cameFrom?.trim() || showsUnderLabel(draft.showsUnder)].join(' · ');
}

export function CustomEntryRows({ entries, onInspect, onEdit, onRemove, disabled }) {
  return entries.map((entry) => (
    <li key={entry.elementId} className="fcb-custom-entry flex flex-wrap items-center gap-2 text-sm">
      <InformationButton elementId={entry.elementId} label={entry.draft.name} onInspect={onInspect} />
      <InspectableItemButton
        elementId={entry.elementId}
        onInspect={onInspect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="font-semibold">{entry.draft.name}</span>
        <span className="fcb-custom-entry-meta">{metaLine(entry)}</span>
      </InspectableItemButton>
      <CustomBadge />
      {entry.installed === false && (
        <span className="fcb-custom-note" title="Its id matches book content, so the book version is used.">
          Not installed
        </span>
      )}
      <button
        type="button"
        className="fcb-button px-2 py-1 text-xs"
        disabled={disabled}
        aria-label={`Edit ${entry.draft.name}`}
        onClick={() => onEdit(entry)}
      >
        <Icon name="edit" />
        Edit
      </button>
      <button
        type="button"
        className="fcb-button fcb-button-danger px-2 py-1 text-xs"
        disabled={disabled}
        aria-label={`Remove ${entry.draft.name}`}
        title="Remove this custom entry from the character"
        onClick={() => onRemove(entry)}
      >
        <Icon name="delete" />
        Remove
      </button>
    </li>
  ));
}

export function CustomEntryList({ title = 'Custom', ...rows }) {
  if (rows.entries.length === 0) return null;
  return (
    <div className="fcb-card p-3" data-testid="custom-entries">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <ul className="space-y-1">
        <CustomEntryRows {...rows} />
      </ul>
    </div>
  );
}
