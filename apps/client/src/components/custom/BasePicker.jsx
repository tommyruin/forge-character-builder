// The base weapon or armor a custom item is built on: a searchable list grouped by the book (and
// so the edition) each entry comes from, so two editions of one name sit under their own headings
// instead of repeating in one long menu. While the library list is still loading it says so.

import { useId, useMemo, useState } from 'react';

export default function BasePicker({ kind, bases, loading, value, disabled, onPick }) {
  const noun = kind === 'weapon' ? 'weapon' : 'armor';
  const label = kind === 'weapon' ? 'Base weapon' : 'Base armor';
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const text = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const matching = bases.filter((option) => text === '' || `${option.name} ${option.equipmentKind ?? ''} ${option.source ?? ''}`.toLowerCase().includes(text));
    const bySource = new Map();
    for (const option of matching) {
      const source = option.source || 'Other';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(option);
    }
    return [...bySource.entries()].map(([source, entries]) => ({ source, entries }));
  }, [bases, text]);

  const pick = (option) => {
    onPick(option.id);
    setChanging(false);
    setQuery('');
  };

  if (value && !changing) {
    const option = bases.find((candidate) => candidate.id === value.id);
    return (
      <div className="fcb-custom-picked" data-testid="base-picked">
        <span className="font-semibold">{value.name}</span>
        {option && (
          <span className="fcb-muted-copy text-xs">
            {[option.equipmentKind, option.source].filter(Boolean).join(' · ')}
          </span>
        )}
        {!disabled && (
          <button type="button" className="fcb-button px-2 py-1 text-xs" aria-label={`Change ${label.toLowerCase()}`} onClick={() => setChanging(true)}>
            Change
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <p className="fcb-muted-copy text-sm" role="status" data-testid="base-loading">
        Loading {noun}s…
      </p>
    );
  }

  const first = groups[0]?.entries[0];
  return (
    <div className="fcb-custom-picker">
      <input
        id={inputId}
        className="fcb-input"
        role="combobox"
        aria-label={label}
        aria-expanded
        aria-controls={`${inputId}-list`}
        aria-autocomplete="list"
        placeholder={`Search ${noun}s by name or kind`}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter picks the first match; it must not submit the dialog's form.
          if (event.key === 'Enter') {
            event.preventDefault();
            if (first) pick(first);
          }
        }}
      />
      <div id={`${inputId}-list`} role="listbox" aria-label={`${label} results`} className="fcb-custom-results fcb-base-results">
        {groups.map((group) => (
          <div key={group.source} role="group" aria-label={group.source} className="fcb-base-group">
            <div className="fcb-base-group-heading">{group.source}</div>
            {group.entries.map((option) => (
              <div key={option.id} role="option" aria-selected={false} className="fcb-option-row fcb-custom-option" onClick={() => pick(option)}>
                <span className="fcb-option-main">
                  <span className="fcb-option-title">{option.name}</span>
                  <span className="fcb-option-subtitle">
                    {[option.equipmentKind, option.displayPrice].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p role="presentation" className="fcb-option-subtitle">Nothing matches.</p>}
      </div>
    </div>
  );
}
