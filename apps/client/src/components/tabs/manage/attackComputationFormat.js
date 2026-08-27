export function formatAttackContribution(contribution) {
  const value = Number(contribution?.value) || 0;
  return `${contribution?.label ?? 'Modifier'} ${
    value >= 0 ? `+${value}` : value
  }`;
}

export function attackCountLabel(attack, count) {
  const name = attack?.name ?? attack?.spellName ?? '';
  const normalized = name.toLowerCase();
  if (!count || (count <= 1 && normalized !== 'eldritch blast')) return '';
  const unit = normalized.includes('ray')
    ? 'ray'
    : normalized.includes('missile')
      ? 'missile'
      : normalized.includes('blast')
        ? 'beam'
        : 'attack';
  return `${count} ${unit}${count === 1 ? '' : 's'} · per hit`;
}
