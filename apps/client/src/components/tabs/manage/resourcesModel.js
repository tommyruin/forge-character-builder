// The pure side of the Resources page: how a tracker from the engine becomes a card. A tracker
// with a few uses is a row of pips (filled while available, the spent ones counting from the
// right, so tapping one spends it and every pip after it); a larger one is a counter. A tracker
// the player does not track drops to the "Not tracked" group (an engine without the flag tracks
// everything).

export const MAX_PIPS = 6;

const UNIT_WORDS = { uses: '', charges: ' charges', minutes: ' min', points: ' points' };

export function trackerCardView(tracker) {
  const asPips = tracker.max <= MAX_PIPS;
  const pips = asPips
    ? Array.from({ length: tracker.max }, (_, index) => {
        const spent = index >= tracker.max - tracker.used;
        return {
          index,
          spent,
          label: `${tracker.label} use ${index + 1}, ${spent ? 'spent' : 'available'}`,
          // Tapping an available pip spends it and those after it; tapping a spent one gives it back and those before it.
          nextUsed: spent ? tracker.max - index - 1 : tracker.max - index,
        };
      })
    : [];
  const sources = tracker.sources.map((source) => source.name);
  const book = tracker.sources.every((source) => source.kind === 'book');
  const source = tracker.manual
    ? 'Added by hand'
    : book
      ? sources.join(', ')
      : tracker.pool
        ? `Shared pool · ${sources.join(', ')}`
        : sources.join(', ');
  return {
    label: tracker.label,
    asPips,
    pips,
    used: tracker.used,
    remaining: tracker.remaining,
    counterText: `${tracker.remaining} / ${tracker.max}${UNIT_WORDS[tracker.unit] ?? ''}`,
    badge: tracker.isCustom ? 'custom' : null,
    source,
    tracked: tracker.tracked !== false,
  };
}

/** The trackers the player tracks, and the ones turned off, each in the engine's order. */
export function splitTrackers(trackers) {
  const tracked = [];
  const untracked = [];
  for (const tracker of trackers) (tracker.tracked === false ? untracked : tracked).push(tracker);
  return { tracked, untracked };
}

// What the switch row says about a switch: its state, what it costs and what it applies.
export function switchNote(entry) {
  const spends = entry.spends ? `turning it on spends a use of ${entry.spends}` : null;
  const effects = entry.sources.length > 0 ? `applies the bonuses of ${entry.sources.join(', ')}` : 'applies its effects';
  return [entry.on ? 'on' : 'off', spends, effects].filter(Boolean).join(' · ');
}
