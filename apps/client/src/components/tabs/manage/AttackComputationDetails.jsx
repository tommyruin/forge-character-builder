import {
  attackCountLabel,
  formatAttackContribution,
} from './attackComputationFormat';

export default function AttackComputationDetails({
  attack,
  computation,
  compact = false,
}) {
  if (!computation) return null;
  const contributions = computation.attackBonusContributions ?? [];
  const modifiers = computation.appliedModifiers ?? [];
  const notes = computation.sourceNotes ?? [];
  const countLabel = attackCountLabel(attack, computation.attackCount);
  if (
    contributions.length === 0 &&
    modifiers.length === 0 &&
    notes.length === 0 &&
    !countLabel
  ) {
    return null;
  }

  return (
    <aside
      className={`normal-case text-[var(--fcb-text-muted)] ${
        compact
          ? 'mt-2 text-xs'
          : 'rounded-lg border border-[var(--fcb-border-soft)] bg-[var(--fcb-surface)] p-3 text-sm'
      }`}
      aria-label="Attack calculation details"
    >
      {contributions.length > 0 && (
        <p>
          <span className="font-semibold text-[var(--fcb-text)]">
            Attack:
          </span>{' '}
          {contributions.map(formatAttackContribution).join(' · ')}
        </p>
      )}
      {(countLabel || (computation.isPerHit && modifiers.length > 0)) && (
        <p className={contributions.length > 0 ? 'mt-1' : ''}>
          {countLabel || 'Damage shown per hit'}
        </p>
      )}
      {modifiers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {modifiers.map((modifier) => (
            <span
              className="fcb-stat-pill"
              key={`${modifier.id}:${modifier.field}`}
              title={modifier.effect}
            >
              {modifier.name}
            </span>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
