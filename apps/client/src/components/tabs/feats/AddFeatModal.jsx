import { useEffect, useState } from "react";
import { api } from "../../../api";
import Modal from "../../Modal";
import { useWorkspace } from "../../WorkspaceContext";

// DM/homebrew "add a feat": search the WHOLE feat library (ignoring prerequisites and the
// normal ASI/feat choice) and grant the chosen feat, mirroring AddSpellModal. Backed by the
// local-engine-only api.characters.addFeat, which registers it as a granted feat so it applies
// immediately and round-trips through .dnd5e save/load. Runs through the workspace's run() so
// the whole detail (registered feats, stats) refreshes on success.
export default function AddFeatModal({ id, open, onClose }) {
  const { run, busy, detail } = useWorkspace();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null); // feat id currently being added

  useEffect(() => {
    if (!open) return undefined;
    const q = search.trim();
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      api.content
        .elements(
          {
            type: "Feat",
            search: q,
            take: 60,
            ruleset: detail?.rulesetMode ?? "all",
          },
          { signal: controller.signal },
        )
        .then((page) => setResults(page.items ?? []))
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 250);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [detail?.rulesetMode, search, open]);

  const add = async (feat) => {
    setAdding(feat.id);
    setError(null);
    try {
      await run(() => api.characters.addFeat(id, feat.id));
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal
      open={open}
      title="Add a feat (DM / homebrew grant)"
      onClose={onClose}
    >
      <p className="fcb-muted-copy mb-3 text-xs">
        Grants any feat from your loaded content to your character, ignoring
        prerequisites and the normal Ability Score Improvement choice. It’s
        applied immediately and saved with the character.
      </p>

      <input
        className="fcb-input mb-3 w-full"
        placeholder="Search all feats…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      {error && <p className="fcb-alert mb-3">{error}</p>}
      {!results && !error && (
        <p className="fcb-empty-copy">Loading feats…</p>
      )}

      {results && (
        <div className="fcb-scroll-panel" style={{ maxHeight: "46vh" }}>
          <table className="fcb-table">
            <tbody>
              {results.map((feat) => (
                <tr key={feat.id}>
                  <td>
                    <span className="font-semibold">{feat.name}</span>
                    {feat.source && (
                      <span className="ml-2 text-xs text-[var(--fcb-text-faint)]">
                        {feat.source}
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="fcb-button"
                      disabled={busy || adding !== null}
                      onClick={() => add(feat)}
                    >
                      {adding === feat.id ? "Adding…" : "Add"}
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td className="text-[var(--fcb-text-faint)]">
                    No feats match.
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
