// B5: the tags an entry answers to in pickers ("Origin", "Epic Boon" ...), or the tag leaves of
// a choice's filter. Suggestions are toggle buttons; anything else is typed once and kept as a
// chip. The engine splits tags on commas and reads a few characters as syntax, so a tag with
// those never gets in.

import { useState } from 'react';
import { RemoveButton } from './fields';

export const TAG_PATTERN = /^[^,<>&"|()!\s][^,<>&"|()!]*$/;

export default function TagPicker({ value = [], onChange, suggestions = [], label = 'Tags' }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const has = (tag) => value.some((entry) => entry.toLowerCase() === tag.toLowerCase());
  const toggle = (tag) =>
    onChange(has(tag) ? value.filter((entry) => entry.toLowerCase() !== tag.toLowerCase()) : [...value, tag]);

  const addTyped = () => {
    const tag = draft.trim();
    if (tag === '') return;
    if (!TAG_PATTERN.test(tag)) {
      setError('A tag cannot contain , < > & " | ( ) or !');
      return;
    }
    setError('');
    if (!has(tag)) onChange([...value, tag]);
    setDraft('');
  };

  return (
    <div className="fcb-custom-tags" role="group" aria-label={label}>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={has(tag)}
              className={`fcb-mode-button${has(tag) ? ' is-active' : ''}`}
              onClick={() => toggle(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {value.filter((tag) => !suggestions.includes(tag)).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value
            .filter((tag) => !suggestions.includes(tag))
            .map((tag) => (
              <li key={tag} className="fcb-custom-chip">
                <span>{tag}</span>
                <RemoveButton label={`Remove tag ${tag}`} onClick={() => toggle(tag)} />
              </li>
            ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input
          className="fcb-input"
          aria-label="Add another tag"
          placeholder="Add another tag"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTyped();
            }
          }}
        />
        <button type="button" className="fcb-button" onClick={addTyped} disabled={draft.trim() === ''}>
          Add tag
        </button>
      </div>
      {error && (
        <p role="alert" className="fcb-custom-issues">
          {error}
        </p>
      )}
    </div>
  );
}
