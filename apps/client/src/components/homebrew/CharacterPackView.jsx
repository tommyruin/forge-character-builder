// The open character's own pack, listed beside the homebrew packs. Its entries live in the
// character's file and are edited from the tab they belong to (Build, Equipment or Magic); here
// each can be copied to My homebrew, which keeps its id so the character keeps resolving it.

import { typeLabel } from '../custom/draftModel';

export const CHARACTER_PACK_KIND_LABEL = { feature: 'Feature', item: 'Item', spell: 'Spell' };

export function characterEntryMeta(entry) {
  const kind = CHARACTER_PACK_KIND_LABEL[entry.kind ?? 'feature'] ?? 'Feature';
  return entry.kind === 'feature' || entry.kind === undefined ? `${kind} · ${typeLabel(entry.type)}` : kind;
}

export default function CharacterPackView({ characterName, content, busy, notice, onCopy, onEdit, onPromote }) {
  const entries = content?.entries ?? [];
  const problems = content?.problems ?? [];
  return (
    <section className="fcb-panel" data-testid="hb-character-pack">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">{characterName}&apos;s pack</h2>
          <p className="fcb-panel-subtitle">
            Made on this character and saved in its file. Edit an entry here or from Build, Equipment or Magic; add it to a pack to share it
            with other characters.
          </p>
        </div>
      </header>
      <div className="fcb-panel-body space-y-3">
        {notice && (
          <p role="status" className="fcb-status-badge fcb-status-complete">
            {notice}
          </p>
        )}
        {problems.length > 0 && (
          <div role="alert" className="fcb-alert">
            <p className="font-semibold">Some entries in the file cannot be read and are kept untouched:</p>
            <ul className="list-disc pl-5 text-sm">
              {problems.map((problem, index) => (
                <li key={index}>{problem.message}</li>
              ))}
            </ul>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="fcb-empty-copy">Nothing made on this character yet. Use + Custom on Build, Custom item on Equipment or Create spell on Magic.</p>
        ) : (
          <ul className="space-y-1" data-testid="hb-character-entries">
            {entries.map((entry) => (
              <li key={entry.elementId} className="fcb-custom-entry flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{entry.draft.name}</span>
                  <span className="fcb-custom-entry-meta">{characterEntryMeta(entry)}</span>
                </span>
                {onEdit && (
                  <button type="button" className="fcb-button px-2 py-1 text-xs" disabled={busy} aria-label={`Edit ${entry.draft.name}`} onClick={() => onEdit(entry)}>
                    Edit
                  </button>
                )}
                {onPromote && (
                  <button
                    type="button"
                    className="fcb-button px-2 py-1 text-xs"
                    disabled={busy}
                    aria-label={`Copy ${entry.draft.name} to a pack`}
                    onClick={() => onPromote(entry)}
                  >
                    Copy to a pack…
                  </button>
                )}
                <button
                  type="button"
                  className="fcb-button px-2 py-1 text-xs"
                  disabled={busy}
                  aria-label={`Copy ${entry.draft.name} to My homebrew`}
                  onClick={() => onCopy(entry)}
                >
                  Copy to My homebrew
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
