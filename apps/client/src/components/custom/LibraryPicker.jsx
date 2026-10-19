// Picks one element from the content library by searching it. `lookup.search({type, search,
// take})` resolves to `[{id, name, source}]`; the picker never sees how. A blank type searches
// every element type (a requirement can name any element).
//
// Nothing is listed until the author types: a library holds thousands of entries per type, and
// a wall of them under every grant would bury the form. The results are option rows in the same
// style as the client's other pickers, with the source in muted text, and the arrow keys and
// Enter work from the search box.

import { useEffect, useId, useState } from 'react';

export default function LibraryPicker({
  lookup,
  type = '',
  value = '',
  valueLabel = '',
  onPick,
  label = 'Search the library',
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState({ key: null, items: [], error: null });
  const text = query.trim();
  const key = `${type}|${text}`;
  const showSearch = value === '' || changing;
  // A lookup may set its own delay (tests set none); typing otherwise waits for a pause.
  const delay = lookup.debounceMs ?? 200;

  useEffect(() => {
    if (!showSearch || text === '') return undefined;
    let alive = true;
    const handle = setTimeout(() => {
      Promise.resolve(lookup.search({ type, search: text, take: 30 }))
        .then((items) => {
          if (alive) {
            setFound({ key, items: items ?? [], error: null });
            setActive(0);
          }
        })
        .catch((error) => {
          if (alive) setFound({ key, items: [], error: error?.message ?? 'The search failed.' });
        });
    }, delay);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [lookup, type, text, key, showSearch, delay]);

  if (!showSearch) {
    return (
      <div className="fcb-custom-picked">
        <span className="font-semibold">{valueLabel || value}</span>
        <button type="button" className="fcb-button px-2 py-1 text-xs" onClick={() => setChanging(true)}>
          Change
        </button>
      </div>
    );
  }

  const searching = text !== '';
  const loading = searching && found.key !== key;
  const items = searching && !loading ? found.items : [];
  const optionId = (index) => `${listId}-${index}`;

  const pick = (item) => {
    onPick(item);
    setChanging(false);
    setQuery('');
  };

  const onKeyDown = (event) => {
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      // Enter picks the highlighted row; it must not submit the dialog's form.
      event.preventDefault();
      pick(items[Math.min(active, items.length - 1)]);
    }
  };

  return (
    <div className="fcb-custom-picker">
      <label className="fcb-field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="fcb-input mt-1"
        placeholder="Type to search"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={items.length > 0 ? optionId(Math.min(active, items.length - 1)) : undefined}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {found.error && searching && (
        <p role="alert" className="fcb-custom-issues">
          {found.error}
        </p>
      )}
      <ul id={listId} role="listbox" aria-label={`${label}: results`} className="fcb-custom-results" aria-busy={loading} hidden={!searching}>
        {items.map((item, index) => (
          <li
            key={item.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === Math.min(active, items.length - 1)}
            className={`fcb-option-row fcb-custom-option${index === Math.min(active, items.length - 1) ? ' is-selected' : ''}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => pick(item)}
          >
            <span className="fcb-option-main">
              <span className="fcb-option-title">{item.name}</span>
              {item.source && <span className="fcb-option-subtitle">{item.source}</span>}
            </span>
          </li>
        ))}
        {searching && !loading && !found.error && items.length === 0 && (
          <li role="presentation" className="fcb-option-subtitle">Nothing matches.</li>
        )}
      </ul>
    </div>
  );
}
