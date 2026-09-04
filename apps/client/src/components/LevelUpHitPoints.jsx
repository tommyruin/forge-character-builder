import { useEffect, useRef, useState } from 'react';
import { commitHitPointDraft } from './hitPointDraft';

export const hitDieMaximum = (hitDie) => {
  const match = /^d(\d+)$/i.exec(String(hitDie ?? '').trim());
  return match ? Number(match[1]) : 0;
};

// Half the die rounded up - the same number the Average Hit Points optional
// rule fixes a level at.
const averageForMaximum = (maximum) => Math.floor(maximum / 2) + 1;

// The average result for a class's hit die, so a player who prefers averages
// can take one without turning the rule on for the whole character.
export const averageHitPoints = (hitDie) => {
  const maximum = hitDieMaximum(hitDie);
  return maximum ? averageForMaximum(maximum) : 0;
};

// Level History rows are chronological, but rolls are stored per class, so the
// row needs to look its value up by the pair that identifies it.
const rollKey = (classId, classLevel) => `${classId}:${classLevel}`;

// Indexes every editable roll so a level row can find its own without walking
// the class list again for each of the twenty rows.
export function buildHitPointIndex(classProgressions = []) {
  const index = new Map();
  for (const classProgression of classProgressions) {
    const maximum = hitDieMaximum(classProgression.hitDie);
    const values = classProgression.hitPointValues ?? [];
    if (!maximum || values.length === 0) continue;
    values.forEach((value, position) => {
      const classLevel = position + 1;
      index.set(rollKey(classProgression.classId, classLevel), {
        classProgression,
        classLevel,
        maximum,
        value,
        // A main class starts at its hit die maximum; a multiclass rolls for
        // its first level like any other.
        fixedFirstLevel: !classProgression.isMulticlass && classLevel === 1,
      });
    });
  }
  return index;
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-2.5 w-2.5"
      viewBox="0 0 12 12"
      fill="none"
    >
      <rect
        x="2.25"
        y="5.25"
        width="7.5"
        height="5.5"
        rx="1.25"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M4 5.25V3.75a2 2 0 0 1 4 0v1.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HitPointInput({
  classProgression,
  classLevel,
  value,
  maximum,
  disabled,
  fixedFirstLevel,
  busy,
  onSave,
  onValidationError,
}) {
  const [draft, setDraft] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  const previousSavedValue = useRef(value);

  useEffect(() => {
    if (previousSavedValue.current === value) return;
    previousSavedValue.current = value;
    if (!focused) setDraft(String(value));
  }, [focused, value]);

  const commit = (next = draft) =>
    commitHitPointDraft({
      draft: next,
      maximum,
      savedValue: value,
      classId: classProgression.classId,
      classLevel,
      setDraft,
      onSave,
      onValidationError,
    });

  // Nudging saves straight away: a stepper has no natural "done" moment the way
  // typing and tabbing away does. Clamped to the die so it can never post a
  // result the engine would reject.
  const nudge = (delta) => {
    const typed = Number.parseInt(draft, 10);
    const from = Number.isInteger(typed) ? typed : value;
    const next = Math.min(maximum, Math.max(1, from + delta));
    setDraft(String(next));
    void commit(String(next));
  };

  // Taking the average is a save, not a draft: like the nudges it has a
  // definite "done" moment, so it posts straight away.
  const average = averageForMaximum(maximum);
  const takeAverage = () => {
    setDraft(String(average));
    void commit(String(average));
  };

  const locked = disabled || busy;
  const label = `${classProgression.className} level ${classLevel} hit points`;

  return (
    <div className="fcb-level-hp">
      <span className="fcb-level-hp__tag" aria-hidden="true">
        HP
        {fixedFirstLevel && <LockIcon />}
      </span>
      {!disabled && (
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          className="fcb-level-hp__nudge"
          disabled={locked || value <= 1}
          onClick={() => nudge(-1)}
          tabIndex={-1}
        >
          <svg aria-hidden="true" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6h7"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      <input
        aria-label={label}
        data-fixed={fixedFirstLevel ? 'true' : undefined}
        disabled={locked}
        min={1}
        max={maximum}
        step={1}
        type="number"
        inputMode="numeric"
        value={draft}
        title={
          disabled
            ? classProgression.isMulticlass || classLevel > 1
              ? 'Fixed by the Average Hit Points optional rule'
              : 'A main class starts with the hit die maximum'
            : `Enter the d${maximum} result for this class level`
        }
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
        className="fcb-input fcb-hp-roll-input"
      />
      {!disabled && (
        <button
          type="button"
          aria-label={`Increase ${label}`}
          className="fcb-level-hp__nudge"
          disabled={locked || value >= maximum}
          onClick={() => nudge(1)}
          tabIndex={-1}
        >
          <svg aria-hidden="true" viewBox="0 0 12 12" fill="none">
            <path
              d="M6 2.5v7M2.5 6h7"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      {!disabled && value !== average && (
        <button
          type="button"
          aria-label={`Use average ${average} for ${label}`}
          title={`Use the average d${maximum} result (${average})`}
          className="fcb-level-hp__average min-h-[2.25rem] shrink-0 rounded-[var(--fcb-radius)] border border-[var(--fcb-control-border)] bg-[var(--fcb-control)] px-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--fcb-text-muted)] disabled:opacity-40"
          disabled={locked}
          onClick={takeAverage}
        >
          Avg
        </button>
      )}
    </div>
  );
}

// One level row's roll. Renders nothing for a level the engine has no roll for
// (an unresolved class choice, or a class with no hit die).
export function HitPointRoll({
  entry,
  hitPoints,
  usesAverageHitPoints,
  busy,
  onSave,
  onValidationError = () => {},
}) {
  const roll = hitPoints?.get(rollKey(entry.classId, entry.classLevel));
  if (!roll) return null;
  return (
    <HitPointInput
      classProgression={roll.classProgression}
      classLevel={roll.classLevel}
      value={roll.value}
      maximum={roll.maximum}
      disabled={usesAverageHitPoints || roll.fixedFirstLevel}
      fixedFirstLevel={roll.fixedFirstLevel}
      busy={busy}
      onSave={onSave}
      onValidationError={onValidationError}
    />
  );
}

// Which rule produced the numbers in the column. Rolled and average values look
// identical in the rows, so the distinction has to be stated once up top.
export function HitPointRuleBadge({ usesAverageHitPoints }) {
  return (
    <span
      className="shrink-0 rounded-full border border-[var(--fcb-border)] fcb-inset-panel px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--fcb-text-muted)]"
      title={
        usesAverageHitPoints
          ? 'Values shown before the Constitution modifier. Change this rule in Manage / Optional rules.'
          : 'Values shown before the Constitution modifier'
      }
    >
      {usesAverageHitPoints ? 'Average rule' : 'Rolled'}
    </span>
  );
}

// The per-class die and running total the old standalone panel carried in its
// class headers. The rows show the parts; this keeps the sums a glance away.
export function HitPointTotals({ classProgressions = [] }) {
  const totals = classProgressions
    .map((classProgression) => ({
      classProgression,
      maximum: hitDieMaximum(classProgression.hitDie),
      values: classProgression.hitPointValues ?? [],
    }))
    .filter(({ maximum, values }) => maximum && values.length > 0);

  if (totals.length === 0) return null;

  return (
    <p
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--fcb-text-faint)]"
      data-testid="hit-point-totals"
    >
      {totals.map(({ classProgression, values }) => (
        <span key={classProgression.classId}>
          <span className="fcb-strong-text font-semibold">
            {classProgression.className}
          </span>{' '}
          {classProgression.hitDie}{' '}
          <span className="font-semibold text-[var(--fcb-text-muted)]">
            Total {values.reduce((total, value) => total + value, 0)}
          </span>
        </span>
      ))}
    </p>
  );
}
