// Picks one element from the content library by searching it. `lookup.search({type, search,
// take})` resolves to `[{id, name, source}]`; the picker never sees how. A blank type searches
// every element type (a requirement can name any element).

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
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const [found, setFound] = useState({ key: null, items: [], error: null });
  const key = `${type}|${query.trim()}`;
  const showSearch = value === '' || changing;
  // A lookup may set its own delay (tests set none); typing otherwise waits for a pause.
  const delay = lookup.debounceMs ?? 200;

  useEffect(() => {
    if (!showSearch) return undefined;
    let alive = true;
    const handle = setTimeout(() => {
      Promise.resolve(lookup.search({ type, search: query.trim(), take: 30 }))
        .then((items) => {
          if (alive) setFound({ key, items: items ?? [], error: null });
        })
        .catch((error) => {
          if (alive) setFound({ key, items: [], error: error?.message ?? 'The search failed.' });
        });
    }, delay);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [lookup, type, query, key, showSearch, delay]);

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

  const loading = found.key !== key;
  return (
    <div className="fcb-custom-picker">
      <label className="fcb-field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="fcb-input mt-1"
        placeholder="Type to search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {found.error && (
        <p role="alert" className="fcb-custom-issues">
          {found.error}
        </p>
      )}
      <ul className="fcb-custom-results" aria-busy={loading}>
        {found.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="fcb-table-row-button"
              onClick={() => {
                onPick(item);
                setChanging(false);
                setQuery('');
              }}
            >
              <span className="font-semibold">{item.name}</span>
              {item.source && <span className="ml-2 text-xs text-[var(--fcb-text-faint)]">{item.source}</span>}
            </button>
          </li>
        ))}
        {!loading && !found.error && found.items.length === 0 && (
          <li className="text-xs text-[var(--fcb-text-faint)]">Nothing matches.</li>
        )}
      </ul>
    </div>
  );
}
