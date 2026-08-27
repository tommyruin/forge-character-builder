import { useState } from 'react';
import { api } from '../../../api';
import Modal from '../../Modal';
import { useWorkspace } from '../../WorkspaceContext';
import Icon from '../../Icon';

// The six PHB "Ability Score Improvement" elements (+1 each). Core content, always ingested at
// boot; a +2-to-one ASI is the same id twice. Granting these is exactly what a normal ASI does,
// so the increase shows up identically in the Ability Scores breakdown and on the sheet.
const ABILITIES = [
  { key: 'Strength', id: 'ID_PHB_FEAT_ASI_STRENGTH' },
  { key: 'Dexterity', id: 'ID_PHB_FEAT_ASI_DEXTERITY' },
  { key: 'Constitution', id: 'ID_PHB_FEAT_ASI_CONSTITUTION' },
  { key: 'Intelligence', id: 'ID_PHB_FEAT_ASI_INTELLIGENCE' },
  { key: 'Wisdom', id: 'ID_PHB_FEAT_ASI_WISDOM' },
  { key: 'Charisma', id: 'ID_PHB_FEAT_ASI_CHARISMA' },
];

const ASI_POINTS = 2; // a standard ASI: +2 to one ability, or +1 to two.

// DM/homebrew "add an ability score improvement": allocate a standard ASI (2 points, max +2 to
// one) outside the level-up ASIs. Backed by the local-engine-only api.characters.addAbilityScore.
export default function AddAsiModal({ id, open, onClose }) {
  const { run, busy } = useWorkspace();
  const [alloc, setAlloc] = useState({});
  const [error, setError] = useState(null);

  // Reset the allocation each time the dialog opens. Done at render (React's "adjust state when
  // a prop changes" pattern) rather than in an effect, since `alloc` feeds synchronous
  // derivations below and resetting it in an effect would cascade a second render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) { setAlloc({}); setError(null); }
  }

  const used = Object.values(alloc).reduce((sum, n) => sum + n, 0);
  const remaining = ASI_POINTS - used;

  const bump = (key, delta) => {
    setAlloc((current) => {
      const next = Math.max(0, Math.min(ASI_POINTS, (current[key] ?? 0) + delta));
      if (delta > 0 && remaining <= 0) return current; // no points left
      return { ...current, [key]: next };
    });
  };

  const apply = async () => {
    const ids = [];
    for (const ability of ABILITIES) {
      for (let n = 0; n < (alloc[ability.key] ?? 0); n++) ids.push(ability.id);
    }
    if (ids.length === 0) { setError('Allocate at least one point.'); return; }
    setError(null);
    try {
      await run(() => api.characters.addAbilityScore(id, ids));
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal open={open} title="Add an ability score improvement (DM / homebrew grant)" onClose={onClose}>
      <p className="fcb-muted-copy mb-3 text-xs">
        Grants an extra Ability Score Improvement outside your level-up ASIs — increase one
        ability by 2, or two abilities by 1. Applied immediately and saved with the character.
      </p>

      <div className="mb-3 text-sm">
        Points remaining: <strong data-testid="asi-remaining">{remaining}</strong>
      </div>

      <div className="space-y-1">
        {ABILITIES.map((ability) => {
          const value = alloc[ability.key] ?? 0;
          return (
            <div key={ability.key} className="flex items-center justify-between gap-3 rounded border border-[var(--fcb-border)] px-3 py-2">
              <span className="text-sm font-semibold">{ability.key}</span>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  className="fcb-icon-button"
                  aria-label={`Decrease ${ability.key}`}
                  disabled={value <= 0}
                  onClick={() => bump(ability.key, -1)}
                >
                  <Icon name="remove" />
                </button>
                <span className="w-8 text-center tabular-nums">+{value}</span>
                <button
                  type="button"
                  className="fcb-icon-button"
                  aria-label={`Increase ${ability.key}`}
                  disabled={remaining <= 0 || value >= ASI_POINTS}
                  onClick={() => bump(ability.key, 1)}
                >
                  <Icon name="add" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="fcb-alert mt-3">{error}</p>}

      <div className="fcb-toolbar mt-4 justify-end">
        <button type="button" className="fcb-button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="fcb-button fcb-status-complete"
          onClick={apply}
          disabled={busy || used === 0}
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </Modal>
  );
}
