import { useCallback, useEffect, useRef, useState } from "react";
import { shell } from "@shell";
import { api } from "../api";
import ExportMenu from "./ExportMenu";
import PortraitControls from "./PortraitControls";
import Icon from './Icon';

export default function CharacterList({
  libraryRevision = 0,
  onDeleted,
  onOpen,
  onPreloadWorkspace,
}) {
  const [characters, setCharacters] = useState(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Filename of a character file currently importing (null when idle). Import can take a
  // few seconds — reading the file, ingesting any bundled custom content, then building
  // the character — so we surface a progress bar instead of leaving it looking hung.
  const [importing, setImporting] = useState(null);

  const refresh = useCallback(() => {
    api.characters
      .list()
      .then(setCharacters)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(refresh, [libraryRevision, refresh]);

  const create = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    void onPreloadWorkspace?.();
    try {
      const created = await api.characters.create(newName.trim());
      setNewName("");
      onOpen(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(`Delete character "${id}"?`)) return;
    try {
      await api.characters.remove(id);
      onDeleted?.(id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // File-based sharing (local engine): export a character to a file (plain .dnd5e
  // or the content-bundling .dnd5e-pkg) and import either back.
  const portable =
    typeof api.characters.export === "function" &&
    typeof api.characters.import === "function";
  const importRef = useRef(null);

  const importCharacter = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setImporting(file.name);
    void onPreloadWorkspace?.();
    try {
      const { id } = await api.characters.import(file);
      refresh();
      onOpen(id);
    } catch (e) {
      setError(e.message);
    } finally {
      // Runs even after onOpen navigates away (before unmount) — harmless there, and
      // clears the bar if the import failed and we stay on the list.
      setImporting(null);
    }
  };

  return (
    <div className="fcb-character-list">
      <div className="fcb-page-heading fcb-character-list-heading">
        <div>
          <h1>Your characters</h1>
          <p>Create, open, and export characters.</p>
        </div>
        <form onSubmit={create} className="fcb-character-create-form">
          <input
            className="fcb-input"
            placeholder="New character name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          <button
            data-testid="character-create-and-open"
            type="submit"
            disabled={busy}
            className="fcb-button fcb-button-primary"
          >
            {busy ? "Creating…" : "Create & Open"}
          </button>
          {portable && (
            <>
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                disabled={!!importing}
                className="fcb-button"
              >
                {importing ? "Importing…" : "Import"}
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".dnd5e,.dnd5e-pkg,application/xml,application/json"
                className="hidden"
                onChange={importCharacter}
              />
            </>
          )}
        </form>
      </div>

      {importing && (
        <div
          className="fcb-import-progress"
          role="status"
          aria-live="polite"
        >
          <div className="fcb-import-progress-label">
            <span className="fcb-boot-pill-spinner" aria-hidden="true" />
            Importing “{importing}”…
          </div>
          <div className="fcb-import-progress-track" />
        </div>
      )}

      {error && <p className="fcb-alert mb-4">{error}</p>}
      {!characters && !error && <p className="fcb-empty-copy">Loading…</p>}
      {characters?.length === 0 && (
        <section
          className="fcb-character-empty"
          aria-label="Empty character collection"
        >
          <span className="fcb-character-empty-mark" aria-hidden="true">
            <shell.Logo size={132} showWordmark={false} />
          </span>
          <p>No characters yet — create one above.</p>
        </section>
      )}

      <div className="fcb-character-grid">
        {characters?.map((c) => (
          <article key={c.id} className="fcb-card fcb-character-card">
            <div className="fcb-character-card-main">
              <div>
                <h3 className="fcb-card-title">{c.name || c.id}</h3>
                <p className="fcb-card-subtitle">
                  Level {c.level} {c.race} {c.class}
                </p>
                {c.background && (
                  <p className="mt-1 text-xs text-[var(--fcb-text-faint)]">
                    {c.background}
                  </p>
                )}
              </div>
              <PortraitControls
                characterId={c.id}
                characterName={c.name || c.id}
                portraitBase64={c.portraitBase64}
                onChanged={refresh}
                onError={setError}
              />
            </div>
            <div className="fcb-toolbar">
              <button
                onClick={() => onOpen(c.id)}
                onMouseEnter={() => {
                  void onPreloadWorkspace?.();
                }}
                onFocus={() => {
                  void onPreloadWorkspace?.();
                }}
                className="fcb-button fcb-button-primary"
              >
                Open
              </button>
              <ExportMenu
                id={c.id}
                includeSheet
                onError={setError}
                label="Export"
              />
              <button
                onClick={() => remove(c.id)}
                className="fcb-button fcb-button-danger ml-auto"
              >
                <Icon name="delete" />
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
