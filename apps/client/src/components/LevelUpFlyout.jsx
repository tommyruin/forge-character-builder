import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useWorkspace } from './WorkspaceContext';
import Modal from './Modal';
import {
  buildHitPointIndex,
  HitPointRoll,
  HitPointRuleBadge,
  HitPointTotals,
} from './LevelUpHitPoints';
import Icon from './Icon';
import useDismissableOverlay from '../hooks/useDismissableOverlay';

// Mirrors MAX_LEVEL in packages/engine/src/progression/leveling.ts.
export const MAX_CHARACTER_LEVEL = 20;

export function assertProgressionResponse(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(value.classes) ||
    !Array.isArray(value.levelHistory)
  ) {
    throw new Error('setHitPointRoll must return a progression payload');
  }
  return value;
}

// The "Level Up & XP" flyout: shows class progression and offers the
// three engine level-up modes - advance the main class, advance an existing
// multiclass, or start a new multiclass (which creates a Multiclass selection
// rule to resolve on the Build > Class section).
export default function LevelUpFlyout({ onClose }) {
  const { id, detail, busy, run, notify, mutationTick } = useWorkspace();
  const [progression, setProgression] = useState(null);
  const [error, setError] = useState(null);
  const [pendingDelevel, setPendingDelevel] = useState(null);
  const [targetLevel, setTargetLevel] = useState('');
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);

  useDismissableOverlay({
    panelRef,
    initialFocusRef: closeButtonRef,
    onDismiss: onClose,
    // The delevel confirmation renders outside this panel and handles its own
    // Escape, so the drawer stands down while it is open.
    suspended: Boolean(pendingDelevel),
  });

  const refresh = useCallback(() => {
    return api.characters.progression(id)
      .then((data) => {
        setError(null);
        setProgression(data);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh, mutationTick]);

  const levelUp = async (mode, classId) => {
    try {
      await run(() => api.characters.levelUpMode(id, mode, classId));
      refresh();
    } catch { /* surfaced by workspace */ }
  };

  // One engine call for the whole climb, so it is a single undo step and the
  // pending ASI/subclass/spell choices all surface together on the Build tab.
  const goToLevel = async (level) => {
    try {
      await run(() => api.characters.levelUpTo(id, level));
      setTargetLevel('');
      refresh();
      notify?.(`Levelled up to ${level}`);
    } catch { /* surfaced by workspace */ }
  };

  const delevel = async () => {
    if (!pendingDelevel) return;
    try {
      const result = await run(() =>
        api.characters.delevel(
          id,
          pendingDelevel.mode,
          pendingDelevel.classId,
        ),
      );
      setProgression(result.progression);
      setPendingDelevel(null);
      const removed = result.removedLevel;
      notify?.(
        removed?.classLevel
          ? `Removed ${removed.className} level ${removed.classLevel}`
          : 'Removed the latest level',
      );
      if (result.requiredRepicks?.length) {
        notify?.(
          `${result.requiredRepicks.length} choice${
            result.requiredRepicks.length === 1 ? '' : 's'
          } need to be made again`,
        );
      }
    } catch { /* surfaced by workspace */ }
  };

  const undoDelevel = async () => {
    try {
      const result = await run(() => api.characters.undoDelevel(id));
      setProgression(result.progression);
      notify?.('Restored the removed level');
    } catch { /* surfaced by workspace */ }
  };

  const saveHitPoint = async (classId, classLevel, value) => {
    setError(null);
    try {
      const nextProgression = await run(
        () =>
          api.characters.setHitPointRoll(
            id,
            classId,
            classLevel,
            value,
          ),
        { refreshDetail: false },
      );
      setProgression(assertProgressionResponse(nextProgression));
      return true;
    } catch (caught) {
      setError(caught.message);
      return false;
    }
  };

  const main = progression?.classes.find((c) => !c.isMulticlass);
  // Built once per render so each level row can look up its own roll instead of
  // the rolls living in a second panel that repeats the whole class list.
  const hitPoints = buildHitPointIndex(progression?.classes ?? []);
  // "Go to level N": the field starts on the next level, so an untouched field
  // never asks the engine for a level the character already has.
  const nextLevel = Number(detail?.level ?? 1) + 1;
  const targetDraft = targetLevel === '' ? String(nextLevel) : targetLevel;
  const targetValue = Number.parseInt(targetDraft, 10);
  const targetIsValid =
    Number.isInteger(targetValue) &&
    targetValue > Number(detail?.level ?? 1) &&
    targetValue <= MAX_CHARACTER_LEVEL;
  const multiclasses = progression?.classes.filter((c) => c.isMulticlass) ?? [];
  const levelHistory = progression?.levelHistory ?? [];
  const latestLevel = levelHistory.at(-1);
  const affectedLaterLevels = pendingDelevel
    ? levelHistory.filter(
        (entry) => entry.totalLevel > pendingDelevel.entry.totalLevel,
      )
    : [];

  return (
    <>
      <div
        className="fcb-scrim-overlay fcb-side-drawer-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          aria-labelledby="fcb-level-up-title"
          aria-modal="true"
          className="fcb-side-drawer"
          ref={panelRef}
          role="dialog"
        >
          <div className="fcb-side-drawer-header">
            <h3 className="fcb-panel-title" id="fcb-level-up-title">Level Up & XP</h3>
            <button onClick={onClose} className="fcb-icon-button" aria-label="Close" ref={closeButtonRef} type="button"><Icon name="close" /></button>
          </div>

          <div className="fcb-side-drawer-body">
        {error && (
          <p className="fcb-alert mb-3" role="alert">
            {error}
          </p>
        )}
        {!progression && !error && <p className="fcb-empty-copy">Loading…</p>}

        {progression && (
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="fcb-card-title text-sm">Level Up</h4>
                <span className="text-xs text-[var(--fcb-text-faint)]">
                  Level {detail.level} ·{' '}
                  {Number(detail.experience).toLocaleString()} XP
                </span>
              </div>
              {progression.classes.length === 0 && (
                <p className="fcb-empty-copy">
                  No class yet - choose one on the Build tab first.
                </p>
              )}
              {main && (
                <button
                  disabled={busy || !progression.canLevelUp}
                  onClick={() => levelUp('main')}
                  className="fcb-button fcb-button-primary block w-full text-left"
                >
                  Level up {main.className} to {main.level + 1}
                </button>
              )}
              {progression.hasMainClass && progression.canLevelUp && (
                <div className="space-y-2" data-testid="level-up-to">
                  <div className="flex items-center gap-2">
                    <label
                      className="text-xs text-[var(--fcb-text-faint)]"
                      htmlFor="fcb-level-up-target"
                    >
                      Target level
                    </label>
                    {/* .fcb-input sets width:100% outside Tailwind's layers,
                        so a width utility never bites; a fixed flex basis is
                        what actually keeps the field to two digits. */}
                    <input
                      className="fcb-input shrink-0 grow-0 basis-16"
                      disabled={busy}
                      id="fcb-level-up-target"
                      inputMode="numeric"
                      max={MAX_CHARACTER_LEVEL}
                      min={nextLevel}
                      onChange={(event) => setTargetLevel(event.target.value)}
                      step={1}
                      type="number"
                      value={targetDraft}
                    />
                  </div>
                  <button
                    className="fcb-button block w-full whitespace-nowrap text-left"
                    disabled={busy || !targetIsValid}
                    onClick={() => goToLevel(targetValue)}
                    title={`Takes ${main?.className ?? 'the main class'} up one level at a time in a single step`}
                    type="button"
                  >
                    Go to level {targetIsValid ? targetValue : detail.level}
                  </button>
                </div>
              )}
              {multiclasses.map((c) => (
                <button
                  key={c.classId}
                  disabled={busy || !progression.canLevelUp}
                  onClick={() => levelUp('multiclass', c.classId)}
                  className="fcb-button block w-full text-left"
                >
                  Level up {c.className} to {c.level + 1}
                </button>
              ))}
              {progression.hasMainClass && (
                <button
                  disabled={busy || !progression.canLevelUp || !progression.canMulticlass}
                  onClick={() => levelUp('new-multiclass')}
                  className="fcb-button block w-full border-dashed text-left"
                  title={
                    progression.canMulticlass
                      ? ''
                      : progression.multiclassRuleEnabled
                        ? 'Meet your current class ability-score prerequisite first'
                        : 'Enable Multiclassing under Manage / Optional rules'
                  }
                >
                  Start a new multiclass…
                </button>
              )}
              {progression.hasMainClass &&
              !progression.multiclassRuleEnabled ? (
                <p className="fcb-alert text-xs">
                  Enable Multiclassing under Manage / Optional rules before
                  starting another class. Existing classes can still be
                  levelled.
                </p>
              ) : progression.hasMainClass && !progression.canMulticlass ? (
                <p
                  className="fcb-alert text-xs"
                  data-testid="multiclass-prerequisite-message"
                >
                  Multiclassing is enabled. Meet your current class’s
                  ability-score prerequisite before starting another class.
                </p>
              ) : (
                <p className="text-xs text-[var(--fcb-text-faint)]">
                  Starting a new multiclass adds a level with a Multiclass
                  choice - resolve it under Build / Class.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="fcb-card-title text-sm">Level History</h4>
                <HitPointRuleBadge
                  usesAverageHitPoints={progression.usesAverageHitPoints}
                />
              </div>
              <HitPointTotals classProgressions={progression.classes} />
              <ol
                className="space-y-2"
                aria-label="Chronological class level history"
                data-testid="hit-point-history"
              >
                {levelHistory.map((entry) => (
                  <li
                    key={entry.totalLevel}
                    className="flex items-center gap-3 rounded-[var(--fcb-radius)] border border-[var(--fcb-border-soft)] bg-[var(--fcb-surface-raised)] px-3 py-2"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--fcb-border)] text-xs font-semibold">
                      {entry.totalLevel}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {entry.className}
                        </span>
                        {entry.isClassStart && (
                          <span className="fcb-badge shrink-0 text-[10px]">
                            Started
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-[var(--fcb-text-faint)]">
                        {entry.isPending
                          ? 'Class choice still unresolved'
                          : `${entry.className} level ${entry.classLevel}`}
                      </span>
                    </span>
                    <HitPointRoll
                      entry={entry}
                      hitPoints={hitPoints}
                      usesAverageHitPoints={progression.usesAverageHitPoints}
                      busy={busy}
                      onSave={saveHitPoint}
                      onValidationError={setError}
                    />
                  </li>
                ))}
              </ol>
              {levelHistory.length === 0 && (
                <p className="fcb-empty-copy">No level history yet.</p>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="fcb-card-title text-sm">Lower Level</h4>
              <button
                disabled={
                  busy ||
                  !progression.canLevelDown ||
                  !latestLevel?.canRemove
                }
                onClick={() =>
                  setPendingDelevel({
                    mode: 'last',
                    classId: null,
                    entry: latestLevel,
                  })
                }
                className="fcb-button fcb-button-danger block w-full text-left"
              >
                Undo latest level
              </button>
              {progression.classes.map((classProgression) => {
                const entry = levelHistory
                  .filter(
                    (candidate) =>
                      candidate.classId === classProgression.classId,
                  )
                  .at(-1);
                const nextClassLevel = classProgression.level - 1;
                return (
                  <button
                    key={`lower-${classProgression.classId}`}
                    disabled={busy || !classProgression.canLower}
                    title={
                      classProgression.canLower
                        ? ''
                        : entry?.totalLevel === 1
                          ? 'A character keeps its first level.'
                          : 'The levels above this one cannot be rebuilt, so this level has to stay.'
                    }
                    onClick={() =>
                      setPendingDelevel({
                        mode: 'class',
                        classId: classProgression.classId,
                        entry,
                      })
                    }
                    className="fcb-button block w-full text-left"
                  >
                    {nextClassLevel > 0
                      ? `Lower ${classProgression.className} to ${nextClassLevel}`
                      : `Remove ${classProgression.className} multiclass`}
                  </button>
                );
              })}
              {progression.canUndoDelevel && (
                <button
                  disabled={busy}
                  onClick={undoDelevel}
                  className="fcb-button fcb-button-primary block w-full text-left"
                >
                  Restore removed level
                </button>
              )}
            </section>
          </div>
        )}
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(pendingDelevel)}
        title={
          pendingDelevel
            ? `Remove ${pendingDelevel.entry.className}${
                pendingDelevel.entry.classLevel
                  ? ` ${pendingDelevel.entry.classLevel}`
                  : ''
              }?`
            : 'Remove level'
        }
        onClose={() => setPendingDelevel(null)}
      >
        {pendingDelevel && (
          <>
            <ul
              aria-label="Level removal summary"
              className="space-y-1 rounded-[var(--fcb-radius)] border border-[var(--fcb-border-soft)] bg-[var(--fcb-surface-raised)] p-3 text-xs"
            >
              <li>
                Total level {detail.level} →{' '}
                {Math.max(1, Number(detail.level) - 1)}
              </li>
              {pendingDelevel.entry.isClassStart &&
                !pendingDelevel.entry.isPending && (
                  <li>
                    Removes {pendingDelevel.entry.className} and all class
                    benefits.
                  </li>
                )}
              {affectedLaterLevels.length > 0 && (
                <li>
                  Keeps and recalculates {affectedLaterLevels.length} later level
                  {affectedLaterLevels.length === 1 ? '' : 's'}.
                </li>
              )}
              <li>XP is capped only when it is too high.</li>
              <li>Invalid choices may need re-picking.</li>
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="fcb-button"
                onClick={() => setPendingDelevel(null)}
              >
                Cancel
              </button>
              <button
                className="fcb-button fcb-button-danger"
                disabled={busy}
                onClick={delevel}
              >
                Remove level
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
