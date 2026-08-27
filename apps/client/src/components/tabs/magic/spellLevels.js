export function spellLevelLabel(level) {
  if (level === 0) return 'Cantrips';
  if (level === 1) return '1st';
  if (level === 2) return '2nd';
  if (level === 3) return '3rd';
  return `${level}th`;
}

export function levelPhrase(level) {
  return level === 0 ? 'cantrip' : `${spellLevelLabel(level).toLowerCase()}-level`;
}
