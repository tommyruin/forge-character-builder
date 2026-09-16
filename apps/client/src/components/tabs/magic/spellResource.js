import { spellLevelLabel } from './spellLevels';

/** "1/Long Rest" → "1/LR", the short form the printed spell page uses. */
function compactUsage(usage) {
  return usage.replace(/\s*Long Rest/gi, 'LR').replace(/\s*Short Rest/gi, 'SR');
}

function featureCastsDisplay(caster) {
  const free = (caster.knownSpells ?? []).filter((spell) => spell.usage);
  if (free.length === 0) {
    return {
      label: 'NO SLOTS',
      compactLabel: 'NO SL',
      value: '',
      title: 'This feature provides no spell slots; follow each spell’s casting rules',
    };
  }
  return {
    label: 'FREE CASTS',
    compactLabel: 'FREE',
    value: [...new Set(free.map((spell) => compactUsage(spell.usage)))].join(' · '),
    title: `Cast without a spell slot — ${free
      .map((spell) => `${spell.name} ${spell.usage}`)
      .join(', ')}`,
  };
}

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
    // These features provide no slots of their own. Summarize their free casts;
    // casting with slots supplied by a class follows the feature's own rules.
    if (caster.kind === 'feature') return featureCastsDisplay(caster);
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
