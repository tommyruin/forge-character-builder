import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import Modal from '../../Modal';
import Icon from '../../Icon';

export default function CharacterAdjustments({ id, busy, run }) {
  const [adjustments, setAdjustments] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);

  const refresh = useCallback(() => {
    return api.characters
      .adjustments(id)
      .then((result) => {
        setAdjustments(result);
        setError(null);
      })
      .catch((caught) => setError(caught.message));
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = async (adjustment, enabled) => {
    setPendingKey(adjustment.key);
    try {
      await run(() =>
        api.characters.setCharacterControl(id, adjustment.key, enabled),
      );
      await refresh();
    } catch {
      // The workspace banner owns mutation errors.
    } finally {
      setPendingKey(null);
    }
  };

  const active = adjustments.filter((adjustment) => adjustment.enabled);
  const available = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return adjustments.filter(
      (adjustment) =>
        !adjustment.enabled &&
        (!query ||
          `${adjustment.name} ${adjustment.category} ${adjustment.source}`
            .toLocaleLowerCase()
            .includes(query)),
    );
  }, [adjustments, search]);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="fcb-muted-copy text-xs">
          {active.length} active feature or adjustment
          {active.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="fcb-button"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          <Icon name="add" />
          Feature
        </button>
      </div>
      {error && <p className="fcb-alert mt-3">{error}</p>}
      {active.length > 0 && (
        <ul className="mt-3 space-y-1">
          {active.map((adjustment) => (
            <li
              key={adjustment.key}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {adjustment.name}
                <small className="fcb-muted-copy ml-2">
                  {adjustment.category}
                </small>
              </span>
              <button
                type="button"
                className="fcb-button fcb-button-danger"
                disabled={busy || pendingKey === adjustment.key}
                onClick={() => setEnabled(adjustment, false)}
              >
                <Icon name="delete" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        title="Add feature or adjustment"
        onClose={() => setOpen(false)}
      >
        <label className="fcb-field-label">
          Search features and adjustments
          <input
            type="search"
            className="fcb-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <ul className="mt-3 space-y-2">
          {available.map((adjustment) => (
            <li
              key={adjustment.key}
              className="fcb-card flex items-center gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{adjustment.name}</div>
                <div className="fcb-muted-copy text-xs">
                  {adjustment.category} · {adjustment.source}
                </div>
              </div>
              <button
                type="button"
                className="fcb-button fcb-button-primary"
                disabled={busy || pendingKey === adjustment.key}
                onClick={() => setEnabled(adjustment, true)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
        {available.length === 0 && (
          <p className="fcb-empty-copy mt-3">
            No available adjustments match this search.
          </p>
        )}
      </Modal>
    </>
  );
}
