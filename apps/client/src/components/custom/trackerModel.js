// The pure side of limited uses and scale values in the custom forms: the menus, block factories,
// and the plain-language lines the summary and the sheet preview show. Nothing here renders. The
// statistic keys the engine uses (`uses:<id>`, `scale:<name>`) never reach the screen: a maximum
// that follows the character is described in words, and the sheet text token a scale value is
// used with is shown only as the one thing an author copies.

import {
  CUSTOM_VALUE_REFERENCES,
  TRACKER_RECHARGE_OPTIONS,
  TRACKER_UNIT_OPTIONS,
  newCustomBlockId,
  scaleSlug,
  trackerStatKey,
  trackerUsageText,
  valueReference,
} from '@forge-cb/engine/custom';

export const RECHARGE_OPTIONS = TRACKER_RECHARGE_OPTIONS.map((option) => ({ id: option.id, label: option.label }));
export const UNIT_OPTIONS = TRACKER_UNIT_OPTIONS.map((option) => ({ id: option.id, label: option.label }));

// What a tracker's maximum can follow. `stat` is in the engine but not offered: its keys are the
// engine's own, and the menu below already covers the values an author means.
export const MAX_KINDS = [
  { id: 'number', label: 'A number' },
  { id: 'reference', label: 'Another value' },
  { id: 'classLevel', label: 'A class level' },
  { id: 'scale', label: 'A scale value' },
];

export const rechargeLabel = (id) => RECHARGE_OPTIONS.find((option) => option.id === id)?.label ?? id;

export function makeTracker(overrides = {}) {
  return {
    id: newCustomBlockId(),
    label: '',
    max: { kind: 'number', value: 1 },
    unit: 'uses',
    recharge: 'longRest',
    ...overrides,
  };
}

export function makeScale(overrides = {}) {
  return {
    id: newCustomBlockId(),
    name: '',
    kind: 'dice',
    steps: [{ level: 1, value: '1d6' }],
    ...overrides,
  };
}

// The text a sheet line carries to read a scale value: `{{scale:moonlight die}}`.
export const scaleToken = (scale) => `{{scale:${scaleSlug(scale.name)}}}`;

export function describeMax(max, scales = []) {
  switch (max.kind) {
    case 'number':
      return String(max.value);
    case 'reference': {
      const label = (valueReference(max.ref)?.label ?? max.ref).toLowerCase();
      return max.min === undefined ? `your ${label}` : `your ${label} (at least ${max.min})`;
    }
    case 'classLevel':
      return `your ${max.className || 'class'} level`;
    case 'scale':
      return scales.find((scale) => scale.id === max.scale)?.name || 'a scale value';
    default:
      return 'a value';
  }
}

// The usage line as the author reads it: the engine's own wording with the token it fills in later
// swapped for what it follows ("your proficiency bonus/Long Rest").
export function trackerPreviewText(tracker, scales = []) {
  const text = trackerUsageText(tracker);
  return text.replace(`{{${trackerStatKey(tracker)}}}`, describeMax(tracker.max, scales));
}

export function describeTracker(tracker, scales = []) {
  const name = tracker.label.trim() || 'Limited uses';
  const pool = tracker.pool?.trim() ? `, shared pool "${tracker.pool.trim()}"` : '';
  const spend = tracker.spendOnSwitch?.trim() ? `; turning on ${tracker.spendOnSwitch.trim()} spends one` : '';
  return `${name}: ${trackerPreviewText(tracker, scales)}${pool}${spend}`;
}

export function describeScale(scale) {
  const steps = [...scale.steps].sort((left, right) => left.level - right.level);
  return `${scale.name.trim() || 'Scale value'}: ${steps.map((step) => `${step.value} from level ${step.level}`).join(', ')}`;
}

// The usage text the form used to write ("2/Short Rest") as a tracker, so an entry made before
// trackers existed opens with its limited uses in the new block. Null when the text is the author's own.
const LEGACY_RECHARGE = {
  'Short Rest': 'shortRest',
  'Long Rest': 'longRest',
  Dawn: 'dawn',
  Day: 'day',
  Never: 'never',
  'Dice roll': 'diceRoll',
};

export function trackerFromUsage(parsed, label) {
  if (!parsed) return null;
  return makeTracker({
    label,
    max: { kind: 'number', value: parsed.count },
    recharge: LEGACY_RECHARGE[parsed.recharge] ?? 'longRest',
  });
}

// Every switch name the character's custom entries use, for the picker (each once, as first written).
export function switchNamesIn(entries) {
  const seen = new Map();
  for (const entry of entries ?? []) {
    for (const block of entry.draft?.blocks ?? []) {
      const name = block.kind === 'modifier' ? block.gates?.switch?.trim() : undefined;
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

export const referenceMenu = CUSTOM_VALUE_REFERENCES;
