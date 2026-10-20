import { useEffect, useMemo, useState } from "react";
import { api } from "../../../api";
import Modal from "../../Modal";
import { useWorkspace } from "../../WorkspaceContext";

// DM/homebrew "add a spell" surface: search the WHOLE spell library (ignoring the class
// list and the known/prepared caps) and grant the chosen spell to a caster. Backed by the
// local-engine-only api.characters.addSpell, which registers it as a granted spell so it shows up
// under the caster (always-prepared) and round-trips through .dnd5e save/load.
//
// A spell the library lacks can be made here: the dialog offers "Create it?" and hands the name
// and the chosen caster to the spell form (`onCreate`), which stores the spell in the character.
export default function AddSpellModal({
  id,
  casters,
  defaultCaster,
  open,
  onClose,
  onAdded,
  onCreate,
}) {
  const { detail } = useWorkspace();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState(null);
  // The query `results` answers; the "Create it?" prompt waits for it, so text typed since the
  // last search never reads as a search that found nothing.
  const [answered, setAnswered] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // spell id currently being added
  // Only a class's spellcasting can cast a granted spell; a feat's or a trait's spells are not
  // a caster the engine can add to.
  const classCasters = useMemo(
    () => (casters ?? []).filter((c) => c.kind === 'class').map((c) => ({ value: c.name, label: c.name })),
    [casters],
  );
  // The parent mounts a fresh modal for each open, so transient state resets without an
  // effect-driven render cascade and the launcher's active caster is selected immediately.
  const [caster, setCaster] = useState(() =>
    classCasters.some((o) => o.value === defaultCaster) ? defaultCaster : (classCasters[0]?.value ?? ''),
  );

  // Spells a caster already lists, so the same spell is not granted twice without the player knowing.
  const alreadyHas = useMemo(() => {
    const found = new Map();
    for (const c of casters ?? []) {
      for (const spell of c.knownSpells ?? []) {
        if (!found.has(spell.id)) found.set(spell.id, { caster: c.name, alwaysPrepared: spell.isAlwaysPrepared === true });
      }
    }
    return found;
  }, [casters]);

  useEffect(() => {
    if (!open) return undefined;
    const q = search.trim();
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      api.content
        .elements(
          {
            type: "Spell",
            search: q,
            take: 60,
            ruleset: detail?.rulesetMode ?? "all",
            characterId: id,
          },
          { signal: controller.signal },
        )
        .then((page) => {
          setResults(page.items ?? []);
          setAnswered(q);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 250);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [detail?.rulesetMode, id, search, open]);

  const add = async (spell) => {
    setBusy(spell.id);
    setError(null);
    try {
      await api.characters.addSpell(id, spell.id, caster || null);
      onAdded?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      title="Add a spell (DM / homebrew grant)"
      onClose={onClose}
    >
      <p className="fcb-muted-copy mb-3 text-xs">
        Grants any spell to your character, ignoring the class list and
        known/prepared limits — for spells a DM handed you or homebrew content.
        It’s marked always-prepared under the chosen caster and saved with the
        character.
      </p>

      <div className="fcb-toolbar mb-3 flex-wrap">
        {classCasters.length > 0 ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="fcb-muted-copy">Add to</span>
            <select
              className="fcb-input"
              aria-label="Add to"
              value={caster}
              onChange={(e) => setCaster(e.target.value)}
            >
              {classCasters.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="">Additional Spells (no class caster)</option>
            </select>
          </label>
        ) : (
          <span className="fcb-muted-copy text-xs">
            No spellcasting on this character — the spell will be added as an
            innate/known spell.
          </span>
        )}
      </div>

      <input
        className="fcb-input mb-3 w-full"
        placeholder="Search all spells…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      {error && <p className="fcb-alert mb-3">{error}</p>}
      {!results && !error && (
        <p className="fcb-empty-copy">Loading spells…</p>
      )}

      {results && (
        <div className="fcb-scroll-panel" style={{ maxHeight: "46vh" }}>
          <table className="fcb-table">
            <tbody>
              {results.map((spell) => (
                <tr key={spell.id}>
                  <td>
                    <span className="font-semibold">{spell.name}</span>
                    {spell.detail && (
                      <span className="ml-2 text-xs text-[var(--fcb-text-muted)]">
                        {spell.detail}
                      </span>
                    )}
                    {spell.source && (
                      <span className="ml-2 text-xs text-[var(--fcb-text-faint)]">
                        {spell.source}
                      </span>
                    )}
                    {alreadyHas.has(spell.id) && (
                      <p className="fcb-warning-note text-xs" data-testid="already-granted">
                        Already on this character under {alreadyHas.get(spell.id).caster}
                        {alreadyHas.get(spell.id).alwaysPrepared ? ', always prepared' : ''}. Adding it again grants
                        it a second time.
                      </p>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="fcb-button"
                      disabled={busy !== null}
                      onClick={() => add(spell)}
                    >
                      {busy === spell.id ? "Adding…" : alreadyHas.has(spell.id) ? "Add anyway" : "Add"}
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td className="text-[var(--fcb-text-faint)]">
                    {onCreate && search.trim() !== '' && answered === search.trim() ? (
                      <span className="flex flex-wrap items-center gap-3">
                        <span data-testid="create-spell-prompt">
                          {search.trim()} isn't in your library. Create it?
                        </span>
                        <button
                          type="button"
                          className="fcb-button fcb-status-complete"
                          onClick={() => {
                            onCreate({ name: search.trim(), caster });
                            onClose();
                          }}
                        >
                          Create spell
                        </button>
                      </span>
                    ) : (
                      'No spells match.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
