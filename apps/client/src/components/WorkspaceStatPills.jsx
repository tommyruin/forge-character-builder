/**
 * The live stat pills on the workspace subbar. Initiative carries a small
 * ADV marker while a feature or item gives advantage on initiative rolls; its
 * tooltip and screen-reader text name the sources.
 */
export default function WorkspaceStatPills({ detail, hp }) {
  const sources = detail.initiativeAdvantageSources ?? [];
  const advantage =
    detail.initiativeAdvantage === true
      ? `Advantage on Initiative${sources.length > 0 ? `: ${sources.join(', ')}` : ''}`
      : null;
  const pills = [
    ['HP', 'Hit Points', hp],
    ['AC', 'Armor Class', detail.armorClass],
    ['INIT', 'Initiative', detail.initiative, advantage],
    ['PROF', 'Proficiency', detail.proficiency],
    ['SPEED', 'Speed', detail.speed],
  ];
  return (
    <div className="fcb-subbar-stats">
      {pills.map(([label, full, value, marker]) => (
        <span key={label} className="fcb-stat-pill" title={full}>
          <strong>{value ?? '—'}</strong> {label}
          {marker && (
            <span className="fcb-stat-pill-adv" title={marker}>
              <span aria-hidden="true">ADV</span>
              <span className="dmf-sr-only">{marker}</span>
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
