// Maps a spell's raw casting-time string (KnownSpellDto/SpellBrowseEntryDto `castingTime`,
// e.g. "1 action", "1 bonus action", "1 reaction", "1 minute", "10 minutes", "1 hour") to a
// compact table badge. The action/bonus/reaction bucketing mirrors the engine's own
// SpellElementParser normalization; longer casting times keep an abbreviated raw label.
// `short` avoids the single-letter "R" used by the Ritual flag (reaction => "RE").
export function castingTimeBadge(castingTime) {
  if (!castingTime) return null;
  const raw = String(castingTime).trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  if (t.includes('bonus action')) return { short: 'BA', kind: 'bonus', label: raw };
  if (t.includes('reaction')) return { short: 'RE', kind: 'reaction', label: raw };
  if (t.includes('action')) return { short: 'A', kind: 'action', label: raw };

  // Ritual-only / timed casts (minutes, hours, etc.): show a compact form of the raw text.
  const compact = raw
    .replace(/^1\s+/, '')
    .replace(/\bminutes?\b/i, 'min')
    .replace(/\bhours?\b/i, 'hr');
  return { short: compact, kind: 'long', label: raw };
}
