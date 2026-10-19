// The pure side of the custom-feature form: labels for the engine catalogue, block factories,
// the usage text a "limited uses" row writes, and the plain-language summary and sheet preview.
// Nothing here renders; the block components and the modal share it so a label or a shape is
// defined once. Authors never see a stat key or an expression, so every id that reaches the
// screen goes through a label from the engine's catalogue.

import {
  CUSTOM_ABILITIES,
  CUSTOM_MODIFIER_TARGETS,
  CUSTOM_SHOWS_UNDER,
  CUSTOM_VALUE_REFERENCES,
  SHEET_ACTION_OPTIONS,
  describeFilter,
  describeRequirements,
  modifierTarget,
  newCustomBlockId,
  valueReference,
} from '@forge-cb/engine/custom';

export const ABILITY_LABELS = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  charisma: 'Charisma',
};

export const MODE_OPTIONS = [
  { id: 'add', label: 'Add' },
  { id: 'setBase', label: 'Set base' },
  { id: 'bestOf', label: 'Best of (no stacking)' },
  { id: 'raiseMax', label: 'Raise maximum' },
];

export const modeLabel = (mode) =>
  MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;

export const RECHARGES = [
  { id: 'Short Rest', label: 'Short Rest' },
  { id: 'Long Rest', label: 'Long Rest' },
  { id: 'Dawn', label: 'Dawn' },
  { id: 'Day', label: 'Day' },
  { id: 'Never', label: 'Never' },
  { id: 'Dice roll', label: 'Dice roll' },
];

// How the equipment gates read: the engine's slot and value words in an author's language.
export const EQUIPPED_SLOTS = [
  { id: 'armor', label: 'Armor' },
  { id: 'shield', label: 'Shield' },
  { id: 'primary', label: 'Main hand' },
  { id: 'secondary', label: 'Off hand' },
];

export const EQUIPPED_VALUE_LABELS = {
  any: 'any',
  none: 'nothing',
  light: 'light',
  medium: 'medium',
  heavy: 'heavy',
  versatile: 'a versatile weapon',
};

export const equippedValueLabel = (value) =>
  EQUIPPED_VALUE_LABELS[value] ?? value;

// The element types a grant or choice may name, as the author reads them.
export const TYPE_LABELS = {
  Feat: 'Feat',
  'Feat Feature': 'Feat feature',
  'Racial Trait': 'Racial trait',
  'Class Feature': 'Class feature',
  'Archetype Feature': 'Subclass feature',
  'Custom Feature': 'Other feature',
  Language: 'Language',
  Proficiency: 'Proficiency',
  Vision: 'Sense',
  Condition: 'Condition',
  Spell: 'Spell',
  'Ability Score Improvement': 'Ability score improvement',
  Option: 'Optional rule',
  List: 'Your own list',
};

export const typeLabel = (type) => TYPE_LABELS[type] ?? type;

export const blockId = () => newCustomBlockId();

// Drops undefined and empty containers so a block that went through the form has the same
// shape as one written by hand, and a draft compares equal to what the engine stores.
export function compact(value) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

export function compactGates(gates) {
  if (!gates) return undefined;
  const next = compact({
    level: gates.level,
    equipped: gates.equipped?.length ? gates.equipped : undefined,
    requirements: gates.requirements,
    switch: gates.switch?.trim() ? gates.switch : undefined,
  });
  return Object.keys(next).length > 0 ? next : undefined;
}

export function makeModifier(overrides = {}) {
  return {
    kind: 'modifier',
    id: blockId(),
    target: 'strength',
    mode: 'add',
    value: { kind: 'number', value: 1 },
    ...overrides,
  };
}

export function makeGrant(type, overrides = {}) {
  return {
    kind: 'grant',
    id: blockId(),
    target: { by: 'id', type, id: '' },
    ...overrides,
  };
}

export function makeChoice(overrides = {}) {
  return {
    kind: 'choice',
    id: blockId(),
    type: 'Language',
    name: '',
    count: 1,
    ...overrides,
  };
}

export const usageText = (count, recharge) => {
  const n = Math.max(1, Math.trunc(Number(count)) || 1);
  if (recharge === 'Never') return `${n} (no recharge)`;
  if (recharge === 'Dice roll') return `${n} (recharges on a dice roll)`;
  return `${n}/${recharge}`;
};

// The inverse of usageText, for reopening an entry; null when the text is the author's own.
export function parseUsage(text) {
  const value = String(text ?? '').trim();
  const rest = value.match(/^(\d+)\/(Short Rest|Long Rest|Dawn|Day)$/);
  if (rest) return { count: Number(rest[1]), recharge: rest[2] };
  const never = value.match(/^(\d+) \(no recharge\)$/);
  if (never) return { count: Number(never[1]), recharge: 'Never' };
  const dice = value.match(/^(\d+) \(recharges on a dice roll\)$/);
  if (dice) return { count: Number(dice[1]), recharge: 'Dice roll' };
  return null;
}

const signed = (value) => (value < 0 ? `-${Math.abs(value)}` : `+${value}`);

export function describeValue(value) {
  if (!value) return '';
  if (value.kind === 'number') return String(value.value);
  const sign = value.negate ? '-' : '';
  if (value.kind === 'classLevel') return `${sign}${value.className} level`;
  return `${sign}${valueReference(value.ref)?.label ?? value.ref}`;
}

const signedValue = (value) => {
  if (value.kind === 'number') return signed(value.value);
  return value.negate ? `- ${describeValue({ ...value, negate: false })}` : `+ ${describeValue(value)}`;
};

function describeGates(gates) {
  if (!gates) return '';
  const parts = [];
  if (gates.level) parts.push(`from level ${gates.level}`);
  for (const gate of gates.equipped ?? []) {
    const slot = EQUIPPED_SLOTS.find((entry) => entry.id === gate.slot)?.label.toLowerCase() ?? gate.slot;
    const value = equippedValueLabel(gate.value);
    parts.push(`${gate.negate ? 'not ' : ''}with ${slot}: ${value}`);
  }
  if (gates.requirements) parts.push(`when ${describeRequirements(gates.requirements).toLowerCase()}`);
  if (gates.switch) parts.push(`only while ${gates.switch} is on`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function describeModifier(block) {
  const target = modifierTarget(block.target);
  const label = target?.label ?? block.target;
  const cap = block.cap ? `, at most ${describeValue(block.cap)}` : '';
  let line;
  switch (block.mode) {
    case 'setBase':
      line = `${label}: base becomes ${describeValue(block.value)}`;
      break;
    case 'bestOf':
      line = `${label} ${signedValue(block.value)}${cap} (does not stack with other bonuses in its group)`;
      break;
    case 'raiseMax':
      line = `${label} raised by ${describeValue(block.value)}`;
      break;
    default:
      line = `${label} ${signedValue(block.value)}${cap}`;
  }
  if (block.addAbilities?.length) {
    line += ` plus ${block.addAbilities.map((ability) => ABILITY_LABELS[ability]).join(' and ')} modifier`;
  }
  return `${line}${describeGates(block.gates)}`;
}

export function spellMode(spell) {
  if (spell?.prepared) return 'prepared';
  if (spell?.usage === 'At will') return 'atWill';
  if (spell?.usage) return 'perRest';
  return 'known';
}

function describeSpell(block) {
  const name = block.target.label || block.target.id || 'a spell';
  const spell = block.spell ?? {};
  const bits = [];
  const mode = spellMode(spell);
  if (mode === 'prepared') bits.push(`always prepared${spell.caster ? ` (${spell.caster})` : ''}`);
  else if (mode === 'atWill') bits.push('at will');
  else if (mode === 'perRest') bits.push(`${spell.usage}, without a spell slot`);
  if (spell.castAbility) bits.push(`cast with ${ABILITY_LABELS[spell.castAbility]}`);
  return `Spell: ${name}${bits.length ? ` (${bits.join('; ')})` : ''}`;
}

export function describeGrant(block) {
  if (block.target.type === 'Spell') return `${describeSpell(block)}${describeGates({ level: block.level, requirements: block.requirements })}`;
  const name = block.target.by === 'name' ? block.target.name : block.target.label || block.target.id;
  const label = typeLabel(block.target.type);
  return `${label}: ${name || 'not picked yet'}${describeGates({ level: block.level, requirements: block.requirements })}`;
}

export function describeChoice(block) {
  const what = block.type === 'List' ? 'from your list' : `${typeLabel(block.type).toLowerCase()}${block.count > 1 ? 's' : ''}`;
  const filter = block.supports ? ` matching ${describeFilter(block.supports)}` : '';
  const options = block.type === 'List' && block.items?.length ? `: ${block.items.join(', ')}` : '';
  const optional = block.optional ? ' (optional)' : '';
  return `Player picks ${block.count} ${what}${filter}${options}${block.name ? ` for "${block.name}"` : ''}${optional}${describeGates({ level: block.level, requirements: block.requirements })}`;
}

export function describeBlock(block) {
  if (block.kind === 'modifier') return describeModifier(block);
  if (block.kind === 'grant') return describeGrant(block);
  return describeChoice(block);
}

// The lines of the "in plain words" panel: every block, then the sheet-only extras.
export function summarizeDraft(draft) {
  const lines = draft.blocks.map(describeBlock);
  if (draft.sheet?.usage) lines.push(`Limited uses: ${draft.sheet.usage}`);
  if (draft.requirements) lines.push(`Needs: ${describeRequirements(draft.requirements)}`);
  return lines;
}

export const showsUnderLabel = (showsUnder) =>
  CUSTOM_SHOWS_UNDER.find((option) => option.id === showsUnder)?.label ?? showsUnder;

// What the character sheet prints for the entry: its title, the action and usage beside it, and
// its text. This mirrors the compiler's rule (sheet text, else the description), so the preview
// never promises a line the sheet would not carry.
export function sheetPreview(draft) {
  const sheet = draft.sheet ?? {};
  const action = SHEET_ACTION_OPTIONS.find((option) => option.id === (sheet.action ?? 'none'))?.text ?? '';
  const spellUsage = draft.blocks.find((block) => block.kind === 'grant' && block.spell?.usage)?.spell.usage;
  const usage = sheet.usage?.trim() || spellUsage || '';
  const text = (sheet.text?.trim() ? sheet.text : draft.description).trim().replace(/\s*\n+\s*/g, ' ');
  return {
    hidden: sheet.show === false,
    title: sheet.title?.trim() || draft.name.trim() || 'Untitled',
    meta: [action, usage].filter((part) => part !== ''),
    text,
  };
}

// Groups the engine's target menu for a <select>, in the engine's order, optionally narrowed to
// some groups (the "Ability score" effect only offers ability scores and maximums).
export function targetGroups(allowedGroups) {
  const groups = [];
  for (const target of CUSTOM_MODIFIER_TARGETS) {
    if (allowedGroups && !allowedGroups.includes(target.group)) continue;
    let group = groups.find((entry) => entry.label === target.group);
    if (!group) {
      group = { label: target.group, targets: [] };
      groups.push(group);
    }
    group.targets.push(target);
  }
  return groups;
}

export const ABILITY_TARGET_GROUPS = ['Ability scores', 'Ability maximums'];

export const abilityOptions = CUSTOM_ABILITIES.map((ability) => ({
  id: ability,
  label: ABILITY_LABELS[ability],
}));

export const referenceOptions = CUSTOM_VALUE_REFERENCES;

// A bonus group name for "best of" when the target names none, in the words the engine accepts
// (lowercase letters, digits, spaces; never "base").
export function defaultBucket(target) {
  if (target?.defaultBucket) return target.defaultBucket;
  const words = (target?.label ?? 'bonus')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return words === 'base' || words === '' ? 'custom bonus' : words.slice(0, 40);
}

// The ability a new spell effect is cast with. A feature casts every spell it grants with one
// ability, so a draft that already names one keeps it; otherwise the character's own spellcasting
// ability is offered, and a character who has none is asked (undefined here).
export function defaultCastAbility(draft, characterAbility) {
  for (const block of draft.blocks) {
    const ability = block.kind === 'grant' ? block.spell?.castAbility : block.kind === 'choice' ? block.castAbility : undefined;
    if (ability) return ability;
  }
  return characterAbility ?? undefined;
}

// Spell effects that still lack the ability they are cast with. The engine would quietly fall
// back to Intelligence; the form asks instead, since a wrong guess changes every spell attack.
export function castAbilityIssues(draft) {
  const issues = [];
  draft.blocks.forEach((block, index) => {
    if (block.kind === 'grant' && block.target.type === 'Spell' && !block.spell?.castAbility) {
      issues.push({ path: `blocks[${index}].spell.castAbility`, message: 'Pick the ability this spell is cast with.' });
    }
    if (block.kind === 'choice' && block.type === 'Spell' && !block.castAbility) {
      issues.push({ path: `blocks[${index}].castAbility`, message: 'Pick the ability these spells are cast with.' });
    }
  });
  return issues;
}
