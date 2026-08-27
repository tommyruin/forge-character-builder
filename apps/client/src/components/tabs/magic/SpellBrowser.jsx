import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { useWorkspace } from '../../WorkspaceContext';
import Modal from '../../Modal';
import Icon from '../../Icon';
import {
  InformationButton,
  InspectableItemButton,
} from '../../InspectableItemControls';
import { spellLevelLabel, levelPhrase } from './spellLevels';
import { castingTimeBadge } from './castingTime';

// The learn browser for ONE Spell selection rule: every spell on the rule's class
// list in spell-level tabs, with unlearnable spells greyed out and a popup that
// explains why (over the picks limit / needs higher spell slots / already known).
// Showing the unlearnable spells greyed, rather than hiding them, is what lets
// the browser explain what is legal and why.
export default function SpellBrowser({
  rule,
  onInspect,
  onSpellDetails,
  onLearned,
  status,
  action,
}) {
  const {
    id,
    busy,
    run,
    notify,
    getCachedResource,
    libraryRevision,
    active,
    createLibraryPickerRefreshController,
    ensureLibraryRevisionReady,
  } = useWorkspace();
  const [browse, setBrowse] = useState(null);
  const [error, setError] = useState(null);
  const [libraryRefreshing, setLibraryRefreshing] = useState(false);
  const [libraryRefreshError, setLibraryRefreshError] = useState(null);
  const [libraryRefreshAttempt, setLibraryRefreshAttempt] = useState(0);
  const [level, setLevel] = useState(null);
  const [filter, setFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [popup, setPopup] = useState(null); // { spell } for a blocked-learn explanation
  const [libraryRefreshController] = useState(() =>
    createLibraryPickerRefreshController(libraryRevision),
  );
  const browseRequestGeneration = useRef(0);

  const cacheKey = `spell-browse:${id}:${rule.identifier}`;

  const refresh = useCallback(
    (force = false) => {
      const generation = ++browseRequestGeneration.current;
      return getCachedResource(
        cacheKey,
        () => api.characters.spellBrowse(id, rule.identifier),
        { force },
      )
        .then((data) => {
          if (generation !== browseRequestGeneration.current) return data;
          setError(null);
          setBrowse(data);
          setLibraryRefreshing(false);
          return data;
        })
        .catch((e) => {
          if (generation === browseRequestGeneration.current) {
            setError(e.message);
            setLibraryRefreshing(false);
          }
          return null;
        });
    },
    [cacheKey, getCachedResource, id, rule.identifier],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshForLibraryRevision = useCallback(() => {
    const generation = ++browseRequestGeneration.current;
    return ensureLibraryRevisionReady(libraryRevision, active)
      .then(() =>
        getCachedResource(
          cacheKey,
          () => api.characters.spellBrowse(id, rule.identifier),
          { force: true },
        ),
      )
      .then((data) => ({ data, generation }));
  }, [
    active,
    cacheKey,
    ensureLibraryRevisionReady,
    getCachedResource,
    id,
    libraryRevision,
    rule.identifier,
  ]);

  useEffect(() => {
    if (!active || libraryRevision === 0) {
      return undefined;
    }
    const request = libraryRefreshController.request(
      libraryRevision,
      active,
      refreshForLibraryRevision,
      rule.identifier,
    );
    if (!request) return undefined;
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      setLibraryRefreshing(true);
      setLibraryRefreshError(null);
    });
    request
      .then((result) => {
        if (
          !alive ||
          result.stale ||
          result.value.generation !== browseRequestGeneration.current
        ) {
          return;
        }
        setBrowse(result.value.data);
        setError(null);
        setLibraryRefreshing(false);
      })
      .catch((caught) => {
        if (!alive) return;
        setLibraryRefreshing(false);
        setLibraryRefreshError(caught.message);
      });
    return () => {
      alive = false;
    };
  }, [
    active,
    libraryRefreshAttempt,
    libraryRevision,
    libraryRefreshController,
    refreshForLibraryRevision,
    rule.identifier,
  ]);

  const levels = useMemo(() => {
    if (!browse) return [];
    return [...new Set(browse.spells.map((s) => s.level))].sort(
      (a, b) => a - b,
    );
  }, [browse]);

  const schools = useMemo(() => {
    if (!browse) return [];
    return [...new Set(browse.spells.map((s) => s.school).filter(Boolean))].sort();
  }, [browse]);

  const sources = useMemo(() => {
    if (!browse) return [];
    return [...new Set(browse.spells.map((s) => s.source).filter(Boolean))].sort();
  }, [browse]);

  // Active tab: the user's pick when valid, else the lowest level that still has
  // something learnable, else the lowest level present (derived — no effect).
  const activeLevel = useMemo(() => {
    if (!browse || levels.length === 0) return null;
    if (level != null && levels.includes(level)) return level;
    const learnable = levels.find((l) =>
      browse.spells.some((s) => s.level === l && s.status === 'learnable'),
    );
    return learnable ?? levels[0];
  }, [browse, levels, level]);

  if (error && !browse) return <p className="fcb-alert">{error}</p>;
  if (!browse) return <p className="fcb-empty-copy">Loading spell list…</p>;

  const freeSlot = browse.slots.find((s) => !s.spellId);
  const picked = browse.slots.filter((s) => s.spellId);
  const gated = browse.activeSpellLevels.length > 0;
  // Whether the facts row has anything of its own to show. Without this the
  // row still renders for the pick count alone, which puts the count on a
  // line above the level pills rather than beside them.
  const hasSpellFacts = gated || picked.length > 0;
  const activeLevelSpells = browse.spells.filter(
    (spell) => spell.level === activeLevel,
  );
  // A level-gated rule renders every spell level, most of them locked --- nine
  // pills for one usable choice, which wraps to two rows on a phone. The phone
  // layout hides the locked pills and shows this count in their place.
  const lockedLevelCount = gated
    ? levels.filter((l) => l > browse.maxSpellLevel && l !== 0).length
    : 0;

  const learn = async (spell, number) => {
    try {
      await run(() =>
        api.characters.setSelection(id, rule.identifier, spell.id, number),
      );
      setPopup(null);
      onSpellDetails?.(spell);
      onInspect?.(spell.id);
      const [browseResult, casterResult] = await Promise.all([
        refresh(true),
        onLearned?.(),
      ]);
      if (!browseResult || (onLearned && !casterResult)) return;
      notify(
        <>
          Learned <strong>{spell.name}</strong>
        </>,
      );
    } catch {
      /* surfaced by the workspace error banner */
    }
  };

  const onSpellClick = (spell) => {
    if (spell.status === 'learnable' && freeSlot) {
      learn(spell, freeSlot.number);
      return;
    }
    // Everything not directly learnable gets an explanation popup.
    setPopup({ spell });
  };

  const visible = activeLevelSpells.filter(
    (spell) =>
      spell.name.toLowerCase().includes(filter.toLowerCase()) &&
      (schoolFilter === '' || spell.school === schoolFilter) &&
      (sourceFilter === '' || spell.source === sourceFilter),
  );

  const statusCell = (spell) => {
    switch (spell.status) {
      case 'selected':
        return (
          <span className="fcb-status-badge fcb-status-complete">
            ✓ Pick {spell.selectedNumber}
          </span>
        );
      case 'learnable':
        return (
          <button
            className="fcb-button"
            disabled={busy}
            onClick={() => onSpellClick(spell)}
            data-testid="learn-spell"
          >
            <Icon name="learn" />
            Learn
          </button>
        );
      case 'limit':
        // A 'limit' spell is swappable, not blocked — its picks are just full. Show a real
        // button (not a dead greyed label) so it's obvious you can act: swap directly when
        // there's a single pick, otherwise open the "which pick to replace" popup.
        return (
          <button
            className="fcb-button"
            disabled={busy}
            onClick={() =>
              picked.length === 1
                ? learn(spell, picked[0].number)
                : setPopup({ spell })
            }
            data-testid="swap-spell"
            title={
              picked.length === 1
                ? `Replace ${picked[0].spellName} with ${spell.name}`
                : 'Swap this in for one of your picks'
            }
          >
            <Icon name="override" />
            Swap in
          </button>
        );
      case 'level':
        return (
          <span className="fcb-status-badge fcb-status-needed">
            Level {spell.level} slots
          </span>
        );
      case 'known':
        return <span className="fcb-status-badge">Known</span>;
      default:
        return <span className="fcb-status-badge">Unavailable</span>;
    }
  };

  const popupSpell = popup?.spell;

  return (
    <div data-testid="spell-browser">
      {libraryRefreshing && (
        <p className="fcb-muted-copy mb-3" role="status" aria-live="polite">
          Refreshing spells…
        </p>
      )}
      {libraryRefreshError && (
        <p className="fcb-alert mb-3" role="alert">
          Could not refresh spells: {libraryRefreshError}{' '}
          <button
            type="button"
            className="fcb-button"
            onClick={() => setLibraryRefreshAttempt((attempt) => attempt + 1)}
          >
            <Icon name="refresh" />
            Retry
          </button>
        </p>
      )}
      {error && <p className="fcb-alert mb-3">{error}</p>}
      {hasSpellFacts && (
        <div className="fcb-toolbar mb-3 flex-wrap">
          {gated && (
            <span className="fcb-stat-pill">
              Max spell level <strong>{browse.maxSpellLevel}</strong>
            </span>
          )}
          {picked.length > 0 && (
            <span className="text-xs text-[var(--fcb-text-muted)]">
              {picked.map((s) => s.spellName).join(' · ')}
            </span>
          )}
          {/* The pick count belongs on this row, opposite the spell facts. */}
          {(status || action) && (
            <span className="fcb-spell-browser-status">
              {status}
              {action}
            </span>
          )}
        </div>
      )}

      {/* With no facts to sit opposite, the count would be alone on a row
          above the level pills. It rides the pill row instead. */}
      <div className="fcb-spell-level-row">
      <nav className="fcb-spell-level-tabs" aria-label="Spell levels">
        {levels.map((l) => {
          const anyLearnable = browse.spells.some(
            (s) => s.level === l && s.status === 'learnable',
          );
          const overCap = gated && l > browse.maxSpellLevel && l !== 0;
          return (
            <button
              key={l}
              aria-current={activeLevel === l ? 'page' : undefined}
              className={`fcb-spell-level-tab ${activeLevel === l ? 'is-active' : ''} ${!anyLearnable ? 'is-exhausted' : ''} ${overCap ? 'is-locked' : ''}`}
              title={overCap ? `Requires level ${l} spell slots` : undefined}
              onClick={() => setLevel(l)}
              data-testid={`spell-level-tab-${l}`}
            >
              {spellLevelLabel(l)}
              {overCap && <span aria-hidden="true"> 🔒</span>}
            </button>
          );
        })}
        {lockedLevelCount > 0 && (
          <span className="fcb-spell-level-locked-note">
            +{lockedLevelCount} locked
          </span>
        )}
      </nav>
        {!hasSpellFacts && (status || action) && (
          <span className="fcb-spell-browser-status">
            {status}
            {action}
          </span>
        )}
      </div>

      {(activeLevelSpells.length > 8 || schools.length > 1 || sources.length > 1) && (
        <div className="fcb-toolbar mb-3 flex-wrap">
          {activeLevelSpells.length > 8 && (
            <input
              className="fcb-input"
              placeholder="Filter spells…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {(schools.length > 1 || sources.length > 1) && (
            <div className="fcb-spell-filter-row">
              {schools.length > 1 && (
                <select
                  className="fcb-select"
                  aria-label="Filter by school"
                  value={schoolFilter}
                  onChange={(e) => setSchoolFilter(e.target.value)}
                >
                  <option value="">All schools</option>
                  {schools.map((school) => (
                    <option key={school} value={school}>
                      {school}
                    </option>
                  ))}
                </select>
              )}
              {sources.length > 1 && (
                <select
                  className="fcb-select"
                  aria-label="Filter by source"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                >
                  <option value="">All sources</option>
                  {sources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      <div className="fcb-scroll-panel fcb-mobile-list-panel">
        <table className="fcb-table fcb-mobile-list-table">
          <thead>
            <tr>
              <th>Spell</th>
              <th>School</th>
              <th>Source</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((spell) => {
              // 'limit' reads as interactive (you can swap it in), not greyed out like the
              // genuinely-blocked states (level / known / unavailable). Greying it was what
              // made the swap affordance invisible.
              const greyed = !['learnable', 'selected', 'limit'].includes(
                spell.status,
              );
              return (
                <tr
                  key={spell.id}
                  className={greyed ? 'fcb-spell-unlearnable' : ''}
                  data-testid={`spell-row-${spell.status}`}
                >
                  <td data-label="Spell">
                    <span className="inline-flex items-center gap-1">
                      <InformationButton
                        elementId={spell.id}
                        label={spell.name}
                        onInspect={(elementId, source) => {
                          onSpellDetails?.(spell);
                          onInspect?.(elementId, source);
                        }}
                      />
                      <InspectableItemButton
                        elementId={spell.id}
                        onInspect={() => {
                          onSpellDetails?.(spell);
                          onInspect?.(spell.id);
                        }}
                        onActivate={() => onSpellClick(spell)}
                        activationDisabled={busy}
                        className={`font-semibold ${greyed ? 'cursor-help' : ''}`}
                        title={greyed ? 'Why can’t I learn this?' : undefined}
                      >
                        {spell.name}
                      </InspectableItemButton>
                      {(() => {
                        const cast = castingTimeBadge(spell.castingTime);
                        return (
                          cast && (
                            <span
                              className="fcb-cast-badge"
                              data-cast={cast.kind}
                              title={`Casting time: ${cast.label}`}
                            >
                              {cast.short}
                            </span>
                          )
                        );
                      })()}
                      {spell.isRitual && (
                        <span className="fcb-spell-flag" title="Ritual">
                          R
                        </span>
                      )}
                      {spell.isConcentration && (
                        <span
                          className="fcb-spell-flag"
                          title="Concentration"
                        >
                          C
                        </span>
                      )}
                      <span className="fcb-spell-mobile-meta">
                        {spell.school} · {spell.source}
                      </span>
                    </span>
                  </td>
                  <td
                    className="text-xs text-[var(--fcb-text-muted)]"
                    data-label="School"
                  >
                    {spell.school}
                  </td>
                  <td
                    className="text-xs text-[var(--fcb-text-muted)]"
                    data-label="Source"
                  >
                    {spell.source}
                  </td>
                  <td
                    className="text-right fcb-mobile-list-actions"
                    data-label="Status"
                  >
                    {statusCell(spell)}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="text-[var(--fcb-text-faint)]">
                  No spells match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(popupSpell)}
        title={popupSpell ? `Can’t learn ${popupSpell.name}` : ''}
        onClose={() => setPopup(null)}
      >
        {popupSpell?.status === 'limit' && (
          <>
            <p data-testid="limit-popup">
              You already used all <strong>{browse.selectionCount}</strong>{' '}
              picks of <strong>{rule.name || 'this selection'}</strong> — that’s
              the maximum number of spells it can teach you at your current
              level.
            </p>
            {picked.length > 0 && (
              <>
                <p className="text-xs text-[var(--fcb-text-muted)]">
                  You can swap one of your current picks for {popupSpell.name}:
                </p>
                <div className="space-y-2">
                  {picked.map((slot) => (
                    <button
                      key={slot.number}
                      className="fcb-button w-full justify-between"
                      disabled={busy}
                      onClick={() => learn(popupSpell, slot.number)}
                    >
                      Replace {slot.spellName}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {popupSpell?.status === 'level' && (
          <p data-testid="level-popup">
            <strong>{popupSpell.name}</strong> is a{' '}
            {levelPhrase(popupSpell.level)} spell, but this selection only
            allows spells you have slots for — up to{' '}
            <strong>level {browse.maxSpellLevel}</strong>. You’ll unlock
            higher-level spells as you gain levels in this class.
          </p>
        )}
        {popupSpell?.status === 'known' && (
          <p>
            <strong>{popupSpell.name}</strong> is already on your spell list —
            you learned it through another selection or it was granted by a
            feature.
          </p>
        )}
        {popupSpell?.status === 'selected' && (
          <p>
            <strong>{popupSpell.name}</strong> is pick{' '}
            {popupSpell.selectedNumber} of {rule.name || 'this selection'}. Pick
            a different spell and choose “Replace” to swap it.
          </p>
        )}
        {popupSpell?.status === 'unavailable' && (
          <p>
            <strong>{popupSpell.name}</strong> isn’t currently available for
            this selection — it may be restricted by your sources or another
            requirement.
          </p>
        )}
        {popupSpell?.status === 'learnable' && (
          <p>
            <strong>{popupSpell.name}</strong> can be learned, but every pick of
            this selection is already used. Free a pick first.
          </p>
        )}
      </Modal>
    </div>
  );
}
