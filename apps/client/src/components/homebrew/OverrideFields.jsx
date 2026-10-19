// The form for a replacement of a book element. A reflavour takes a new name and text and keeps the
// original's rules; a house rule starts from a copy of the original's XML, which the author changes.
// Either way the element keeps the book's id, so characters that have it keep it.

import { Field, Issues } from '../custom/fields';

export default function OverrideFields({ draft, setDraft, issues = [], attempted = false }) {
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  return (
    <>
      <p className="fcb-muted-copy text-xs">
        {draft.reflavour
          ? 'Same rules, new name and text. Characters that have the original see this version.'
          : 'This pack replaces the book element with the version below. Characters that have it see this version.'}{' '}
        It keeps the id <code>{draft.id}</code>.
      </p>
      <div className="fcb-custom-row">
        <Field label="Name">
          <input className="fcb-input" aria-label="Name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="Type">
          <input className="fcb-input" aria-label="Type" value={draft.targetType} readOnly />
        </Field>
      </div>
      <Field label="Text (leave empty to keep the original's)">
        <textarea
          className="fcb-textarea"
          aria-label="Text"
          rows={4}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>
      {!draft.reflavour && (
        <Field label="The element's XML">
          <textarea
            className="fcb-textarea font-mono text-xs"
            aria-label="Element XML"
            rows={14}
            spellCheck={false}
            value={draft.baseXml}
            onChange={(event) => patch({ baseXml: event.target.value })}
          />
        </Field>
      )}
      <Issues issues={attempted ? issues : []} />
    </>
  );
}
