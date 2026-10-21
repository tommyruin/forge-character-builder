// The base weapon or armor a custom item is built on: a searchable list grouped by the book (and
// so the edition) each entry comes from, so two editions of one name sit under their own headings
// instead of repeating in one long menu. While the library list is still loading it says so.
//
// It is a combobox: the list opens when the field is focused or typed in, the arrow keys (and Home
// and End) move through every entry, Enter picks the highlighted one and Escape closes the list. The
// list grows inside the dialog's own scroll area rather than scrolling on its own.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { sourceLabel } from '../sourceLabel';

export default function BasePicker({ kind, bases, loading, value, disabled, onPick }) {
  const noun = kind === 'weapon' ? 'weapon' : 'armor';
  const label = kind === 'weapon' ? 'Base weapon' : 'Base armor';
  const inputId = useId();
  const listId = `${inputId}-list`;
  const optionId = (index) => `${inputId}-option-${index}`;
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const [open, setOpen] = useState(false);
  // The highlighted entry; -1 until the arrow keys or the pointer pick one (Enter then takes the first match).
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const text = query.trim().toLowerCase();

  const { groups, flat } = useMemo(() => {
    const matching = bases.filter((option) => text === '' || `${option.name} ${option.equipmentKind ?? ''} ${option.source ?? ''}`.toLowerCase().includes(text));
    const bySource = new Map();
    for (const option of matching) {
      const source = sourceLabel(option.source, 'Built in') || 'Other';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(option);
    }
    const grouped = [...bySource.entries()].map(([source, entries]) => ({ source, entries }));
    return { groups: grouped, flat: grouped.flatMap((group) => group.entries) };
  }, [bases, text]);

  // A new search starts over.
  useEffect(() => setActive(-1), [text]);

  // The highlighted entry stays in view as the arrow keys move through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (option) => {
    onPick(option.id);
    setChanging(false);
    setOpen(false);
    setQuery('');
  };

  if (value && !changing) {
    const option = bases.find((candidate) => candidate.id === value.id);
    return (
      <div className="fcb-custom-picked" data-testid="base-picked">
        <span className="font-semibold">{value.name}</span>
        {option && (
          <span className="fcb-muted-copy text-xs">
            {[option.equipmentKind, sourceLabel(option.source)].filter(Boolean).join(' · ')}
          </span>
        )}
        {!disabled && (
          <button
            type="button"
            className="fcb-button px-2 py-1 text-xs"
            aria-label={`Change ${label.toLowerCase()}`}
            onClick={() => {
              setChanging(true);
              setOpen(true);
            }}
          >
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

  const shown = open && flat.length > 0;
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (flat.length === 0) return;
      const down = event.key === 'ArrowDown';
      setActive((current) => {
        if (current < 0) return down ? 0 : flat.length - 1;
        return (current + (down ? 1 : -1) + flat.length) % flat.length;
      });
    } else if ((event.key === 'Home' || event.key === 'End') && open && flat.length > 0) {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : flat.length - 1);
    } else if (event.key === 'Enter') {
      // Enter picks the highlighted match; it must not submit the dialog's form.
      event.preventDefault();
      const option = flat[active] ?? flat[0];
      if (option) pick(option);
    } else if (event.key === 'Escape' && (open || changing)) {
      // Closing the list is all Escape does here; the dialog stays open.
      event.stopPropagation();
      setOpen(false);
      if (changing && value) setChanging(false);
    }
  };

  return (
    <div className="fcb-custom-picker">
      <div className="fcb-base-search">
        <input
          ref={inputRef}
          id={inputId}
          className="fcb-input"
          role="combobox"
          aria-label={label}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && flat[active] ? optionId(active) : undefined}
          placeholder={`Search ${noun}s by name or kind`}
          autoComplete="off"
          autoFocus={changing}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {changing && value && (
          <button type="button" className="fcb-button" onClick={() => setChanging(false)}>
            Keep {value.name}
          </button>
        )}
      </div>
      <div id={listId} role="listbox" aria-label={`${label} results`} className="fcb-base-results" hidden={!open}>
        {groups.map((group) => (
          <div key={group.source} role="group" aria-label={group.source} className="fcb-base-group">
            <div className="fcb-base-group-heading" aria-hidden="true">
              {group.source}
            </div>
            {group.entries.map((option) => {
              const index = flat.indexOf(option);
              return (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className="fcb-option-row fcb-custom-option"
                  // Picking with the mouse must not blur the field first, or the list would close under the pointer.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(option)}
                >
                  <span className="fcb-option-main">
                    <span className="fcb-option-title">{option.name}</span>
                    <span className="fcb-option-subtitle">
                      {[option.equipmentKind, option.displayPrice].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && (
          <p role="presentation" className="fcb-option-subtitle">
            Nothing matches.
          </p>
        )}
      </div>
    </div>
  );
}
