import { spellLevelLabel } from './spellLevels';

export function spellResourceDisplay(caster) {
  if (caster.resource?.mode === 'spellPoints') {
    const shared = Boolean(caster.resource.shared);
    return {
      label: 'SPELL POINTS',
      // `compactLabel` is the phone-width form, for the narrowest screens where
      // the summary row cannot hold five chips with the words spelled out. The
      // title carries the full meaning either way.
      compactLabel: 'SP',
      value: `${caster.resource.maximumPoints ?? '—'}${
        shared ? ' · shared' : ''
      }`,
      title: shared ? 'Shared spell point pool' : 'Maximum spell points',
    };
  }

  // Positional display: position = spell level, trailing empty levels trimmed.
  // Levels below the highest with no slots keep a "–" placeholder so position
  // stays meaningful (a warlock's lone 5th-level pact slots read "–·–·–·–·2").
  // The tooltip spells the mapping out.
  const counts = caster.slotsPerLevel ?? [];
  let highest = 0;
  counts.forEach((count, index) => {
    if (count > 0) highest = index + 1;
  });
  if (highest === 0) {
    return { label: 'SLOTS', compactLabel: 'SL', value: '—', title: 'Spell slots' };
  }
  const value = counts
    .slice(0, highest)
    .map((count) => (count > 0 ? String(count) : '–'))
    .join('·');
  const breakdown = counts
    .map((count, index) => ({ level: index + 1, count }))
    .filter((slot) => slot.count > 0)
    .map((slot) => `${spellLevelLabel(slot.level)} ×${slot.count}`)
    .join(', ');
  return {
    label: 'SLOTS',
    compactLabel: 'SL',
    value,
    title: `Spell slots — ${breakdown}`,
  };
}
