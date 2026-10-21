// The pure side of the custom-feature form: labels for the engine catalogue, block factories,
// the usage text a "limited uses" row writes, and the plain-language summary and sheet preview.
// Nothing here renders; the block components and the modal share it so a label or a shape is
// defined once. Authors never see a stat key or an expression, so every id that reaches the
// screen goes through a label from the engine's catalogue.

import { describeScale, describeTracker, trackerPreviewText } from './trackerModel.js';
import {
  CUSTOM_ABILITIES,
  CUSTOM_MODIFIER_TARGETS,
  DAMAGE_TYPES,
  ITEM_RARITIES,
  WEAPON_PROPERTY_IDS,
  WORN_SLOTS,
  createCustomItemDraft,
  createCustomSpellDraft,
  SPELL_SCHOOLS,
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
  { id: 'Short Rest', label: 'Short rest' },
  { id: 'Long Rest', label: 'Long rest' },
  { id: 'Dawn', label: 'Dawn' },
  { id: 'Day', label: 'Day' },
  { id: 'Never', label: 'Never' },
  { id: 'Dice roll', label: 'Dice roll (regains 1d6+1 at dawn)' },
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

// "a spell", "an item", "another feature": the article a label needs, so a generated sentence never
// reads "a other feature". Words that start with a vowel letter but a consonant sound (unicorn, use,
// one) take "a"; a silent h (hour, honest, heir) takes "an".
export function withArticle(noun) {
  const text = String(noun ?? '').trim();
  if (/^other\b/i.test(text)) return `an${text}`;
  if (/^(uni|use|usu|eu|one\b|once)/i.test(text)) return `a ${text}`;
  if (/^(hour|honest|honou?r|heir)/i.test(text) || /^[aeiou]/i.test(text)) return `an ${text}`;
  return `a ${text}`;
}

// The element types a grant or choice may name, as the author reads them.
export const TYPE_LABELS = {
  Feat: 'Feat',
  'Feat Feature': 'Feat feature',
  'Racial Trait': 'Species trait',
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

// One wording for the "also keep it in a pack" tick, wherever a custom dialog offers it.
export const PROMOTE_LABEL = 'Also save to a homebrew pack, so other characters can use it';

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

export function describeValue(value, scales = []) {
  if (!value) return '';
  if (value.kind === 'number') return String(value.value);
  const sign = value.negate ? '-' : '';
  if (value.kind === 'classLevel') return `${sign}${value.className} level`;
  if (value.kind === 'scale') return `${sign}${scales.find((scale) => scale.id === value.scale)?.name || 'a scale value'}`;
  const floor = value.min === undefined ? '' : ` (minimum ${value.min})`;
  return `${sign}${valueReference(value.ref)?.label ?? value.ref}${floor}`;
}

const signedValue = (value, scales) => {
  if (value.kind === 'number') return signed(value.value);
  return value.negate ? `- ${describeValue({ ...value, negate: false }, scales)}` : `+ ${describeValue(value, scales)}`;
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

export function describeModifier(block, scales = []) {
  const target = modifierTarget(block.target);
  const label = target?.label ?? block.target;
  const cap = block.cap ? `, at most ${describeValue(block.cap, scales)}` : '';
  let line;
  switch (block.mode) {
    case 'setBase':
      line = `${label}: base becomes ${describeValue(block.value, scales)}`;
      break;
    case 'bestOf':
      line = `${label} ${signedValue(block.value, scales)}${cap} (does not stack with other bonuses in its group)`;
      break;
    case 'raiseMax':
      line = `${label} raised by ${describeValue(block.value, scales)}`;
      break;
    default:
      line = `${label} ${signedValue(block.value, scales)}${cap}`;
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

// Resistance, immunity and vulnerability are library conditions named for a damage type. The menu
// picks the kind and the type; the stored grant is the same condition element it always was.
export const DAMAGE_RESPONSES = [
  { id: 'resistance', label: 'Resistance', plain: 'Resistance to' },
  { id: 'immunity', label: 'Immunity', plain: 'Immunity to' },
  { id: 'vulnerability', label: 'Vulnerability', plain: 'Vulnerability to' },
];

export const damageResponseId = (response, type) => `ID_INTERNAL_CONDITION_DAMAGE_${response.toUpperCase()}_${type.toUpperCase()}`;

export function damageResponseGrant(response, type, previous = {}) {
  return {
    ...previous,
    kind: 'grant',
    target: {
      by: 'id',
      type: 'Condition',
      id: damageResponseId(response, type),
      label: `${DAMAGE_RESPONSES.find((entry) => entry.id === response).label} (${titleCase(type)})`,
    },
  };
}

// The kind and the damage type of a grant that is one of those conditions, else null (an older
// draft may name some other condition, which keeps the generic grant editor).
export function damageResponseOf(block) {
  if (block.kind !== 'grant' || block.target.by !== 'id' || block.target.type !== 'Condition') return null;
  const found = /^ID_INTERNAL_CONDITION_DAMAGE_(RESISTANCE|IMMUNITY|VULNERABILITY)_([A-Z]+)$/.exec(block.target.id);
  if (!found) return null;
  const type = found[2].toLowerCase();
  return DAMAGE_TYPES.includes(type) ? { response: found[1].toLowerCase(), type } : null;
}

export function describeGrant(block) {
  const damage = damageResponseOf(block);
  if (damage) {
    const plain = DAMAGE_RESPONSES.find((entry) => entry.id === damage.response).plain;
    return `${plain} ${damage.type} damage${describeGates({ level: block.level, requirements: block.requirements, switch: block.switch })}`;
  }
  const gates = describeGates({ level: block.level, requirements: block.requirements, switch: block.switch });
  if (block.target.type === 'Spell') return `${describeSpell(block)}${gates}`;
  const name = block.target.by === 'name' ? block.target.name : block.target.label || block.target.id;
  const label = typeLabel(block.target.type);
  return `${label}: ${name || 'not picked yet'}${gates}`;
}

export function describeChoice(block) {
  const what = block.type === 'List' ? 'from your list' : `${typeLabel(block.type).toLowerCase()}${block.count > 1 ? 's' : ''}`;
  const filter = block.supports ? ` matching ${describeFilter(block.supports)}` : '';
  const options = block.type === 'List' && block.items?.length ? `: ${block.items.join(', ')}` : '';
  const optional = block.optional ? ' (optional)' : '';
  return `Player picks ${block.count} ${what}${filter}${options}${block.name ? ` for "${block.name}"` : ''}${optional}${describeGates({ level: block.level, requirements: block.requirements })}`;
}

export function describeBlock(block, scales = []) {
  if (block.kind === 'modifier') return describeModifier(block, scales);
  if (block.kind === 'grant') return describeGrant(block);
  return describeChoice(block);
}

// The lines of the "in plain words" panel: every block, then the sheet-only extras.
export function summarizeDraft(draft) {
  const scales = draft.scales ?? [];
  const lines = draft.blocks.map((block) => describeBlock(block, scales));
  for (const scale of scales) lines.push(describeScale(scale));
  for (const tracker of draft.trackers ?? []) lines.push(`Uses per rest — ${describeTracker(tracker, scales)}`);
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
  const scales = draft.scales ?? [];
  const trackerUsage = (draft.trackers ?? []).map((tracker) => trackerPreviewText(tracker, scales)).join('; ');
  const usage = sheet.usage?.trim() || trackerUsage || spellUsage || '';
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

// The value menu: the engine's references, and each ability modifier again with a floor of 1, the
// way features word it ("your Intelligence modifier, minimum 1"). A floored entry's id carries the
// floor after a `#`, which `referenceFromOption` takes apart again.
const FLOORED = 1;
export const referenceOptions = CUSTOM_VALUE_REFERENCES.flatMap((reference) =>
  reference.id.endsWith(':modifier')
    ? [reference, { id: `${reference.id}#min:${FLOORED}`, label: `${reference.label} (minimum ${FLOORED})` }]
    : [reference],
);

export const referenceOptionId = (value) => (value.min === undefined ? value.ref : `${value.ref}#min:${value.min}`);

// The reference value a menu entry stands for, keeping the "subtract it" choice already made.
export function referenceFromOption(id, previous = {}) {
  const [ref, floor] = id.split('#min:');
  const next = { kind: 'reference', ref };
  if (floor !== undefined) next.min = Number(floor);
  if (previous.negate === true) next.negate = true;
  return next;
}

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

// ---- items -------------------------------------------------------------------

export const ITEM_TEMPLATE_OPTIONS = [
  { id: 'weapon', label: 'Weapon' },
  { id: 'armor', label: 'Armor or shield' },
  { id: 'worn', label: 'Worn item' },
  { id: 'gear', label: 'Plain gear' },
];

const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export const RARITY_OPTIONS = ITEM_RARITIES.map((rarity) => ({ id: rarity, label: rarity }));
export const DAMAGE_TYPE_OPTIONS = DAMAGE_TYPES.map((type) => ({ id: type, label: titleCase(type) }));
export const WORN_SLOT_OPTIONS = WORN_SLOTS.map((slot) => ({
  id: slot,
  label: slot === 'misc' ? 'Anywhere else' : titleCase(slot),
}));

const PROPERTY_LABELS = {
  ID_INTERNAL_WEAPON_PROPERTY_AMMUNITION: 'Ammunition',
  ID_INTERNAL_WEAPON_PROPERTY_FINESSE: 'Finesse',
  ID_INTERNAL_WEAPON_PROPERTY_HEAVY: 'Heavy',
  ID_INTERNAL_WEAPON_PROPERTY_LIGHT: 'Light',
  ID_INTERNAL_WEAPON_PROPERTY_LOADING: 'Loading',
  ID_INTERNAL_WEAPON_PROPERTY_REACH: 'Reach',
  ID_INTERNAL_WEAPON_PROPERTY_THROWN: 'Thrown',
  ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED: 'Two-handed',
  ID_INTERNAL_WEAPON_PROPERTY_VERSATILE: 'Versatile',
};

export const WEAPON_PROPERTY_OPTIONS = WEAPON_PROPERTY_IDS.map((id) => ({ id, label: PROPERTY_LABELS[id] }));

// A blank item draft for a template. A worn item starts at the neck so the slot is never empty;
// everything else the author adds.
export function makeItemDraft(template) {
  const draft = createCustomItemDraft(template, '');
  return template === 'worn' ? { ...draft, slot: 'neck' } : draft;
}

export const itemTemplateLabel = (template) =>
  ITEM_TEMPLATE_OPTIONS.find((option) => option.id === template)?.label ?? template;

const damageText = (term) => `${term.dice} ${term.type}`;

// The lines of an item's "in plain words" panel: what it is, what it changes, then its effects.
export function summarizeItem(draft) {
  const lines = [];
  if (draft.base) {
    const bonus = draft.bonus ? ` +${draft.bonus}` : '';
    lines.push(`${draft.name.trim() || 'Untitled'} is ${withArticle(draft.base.name)}${bonus}`);
  } else if (draft.template === 'worn') {
    const slot = WORN_SLOT_OPTIONS.find((option) => option.id === draft.slot)?.label.toLowerCase();
    lines.push(`Worn item${slot ? ` (${slot})` : ''}`);
  }
  const weapon = draft.weapon ?? {};
  for (const term of weapon.extraDamage ?? []) lines.push(`Extra damage: ${damageText(term)}`);
  if (weapon.attackAbility) lines.push(`Attacks and damage use ${ABILITY_LABELS[weapon.attackAbility]}`);
  if (weapon.damage) lines.push(`Damage becomes ${damageText(weapon.damage)}`);
  if (weapon.versatile) lines.push(`Two-handed damage ${weapon.versatile}`);
  if (weapon.range) lines.push(`Range ${weapon.range}`);
  if (weapon.properties) {
    lines.push(`Properties: ${weapon.properties.map((id) => PROPERTY_LABELS[id] ?? id).join(', ') || 'none'}`);
  }
  if (draft.template === 'armor' && draft.bonus) lines.push(`Armor class +${draft.bonus}`);
  if (draft.attunement) lines.push('Requires attunement');
  for (const tracker of draft.trackers ?? []) lines.push(`Charges — ${describeTracker(tracker)}`);
  if (draft.uses?.trim() && !(draft.trackers ?? []).length) lines.push(`Limited uses: ${draft.uses.trim()}`);
  const when = draft.attunement ? 'while attuned' : draft.template === 'worn' ? 'while worn' : 'while wielded';
  for (const block of draft.blocks) lines.push(`${describeBlock(block)} (${when})`);
  return lines;
}

// Whether a base option from the library is a shield (a shield sits in the off hand and adds to
// the shield bonus), by the label the catalog already gives it.
export const isShieldOption = (option) => /^shield$/i.test(option?.equipmentKind ?? '');

// "Longsword" alone, or "Longsword (Player's Handbook)" when two editions share the name.
export function baseLabel(option, options) {
  const shared = options.filter((other) => other.name === option.name).length > 1;
  return shared && option.source ? `${option.name} (${option.source})` : option.name;
}

// ---- spells ------------------------------------------------------------------

export const ROLL_OPTIONS = [
  { id: 'none', label: 'No attack or save' },
  { id: 'attackRanged', label: 'Ranged spell attack' },
  { id: 'attackMelee', label: 'Melee spell attack' },
  { id: 'save', label: 'Saving throw' },
];

export const SPELL_SCHOOL_OPTIONS = SPELL_SCHOOLS.map((school) => ({ id: school, label: school }));
export const SPELL_LEVEL_OPTIONS = Array.from({ length: 10 }, (_, level) => ({
  id: String(level),
  label: level === 0 ? 'Cantrip' : `Level ${level}`,
}));

// The words a casting time, range and duration usually take; the fields stay free text, since
// "1 reaction, which you take when ..." and "Up to 10 minutes" are as real as these.
export const CASTING_TIME_PRESETS = ['1 action', '1 bonus action', '1 reaction', '1 minute', '10 minutes', '1 hour'];
export const RANGE_PRESETS = ['Self', 'Touch', '30 feet', '60 feet', '120 feet', '150 feet', '300 feet', 'Sight'];
export const DURATION_PRESETS = [
  'Instantaneous',
  '1 round',
  '1 minute',
  '10 minutes',
  '1 hour',
  '8 hours',
  '24 hours',
  'Until dispelled',
];

export const ordinal = (value) => {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
};

// A blank spell draft. It states "no attack or save" outright: a draft that says nothing is read
// from its text like a book spell, and a form should never leave that to chance.
export function makeSpellDraft(name = '') {
  return createCustomSpellDraft(name);
}

// "Frost Lance" from `ID_HB_MC_SPELL_FROST_LANCE`: the words after the type word, capitalised.
export function spellNameFromId(id) {
  const after = id.includes('_SPELL_') ? id.slice(id.indexOf('_SPELL_') + '_SPELL_'.length) : id.replace(/^ID_/, '');
  return after
    .toLowerCase()
    .split('_')
    .filter((word) => word !== '')
    .map(titleCase)
    .join(' ');
}

// A draft for a spell a pack grants that nothing defines. A grant by id keeps that id, so the
// spell made here is the one the grant was waiting for; a grant by name only supplies the name.
export function spellDraftFromMissing(missing) {
  const named = /^Spell "(.+)"$/.exec(missing?.missingId ?? '');
  if (named) return makeSpellDraft(named[1]);
  const id = missing?.missingId ?? '';
  if (/^ID_[A-Z0-9_]+$/.test(id)) return { ...makeSpellDraft(spellNameFromId(id)), id };
  return makeSpellDraft('');
}

const COMPONENT_LETTERS = [
  ['verbal', 'V'],
  ['somatic', 'S'],
  ['material', 'M'],
];

// Drops what a form leaves empty or what the chosen roll does not use, so a draft that was only
// opened compares equal to what the engine stores and switching the roll never leaves stale data.
export function tidySpell(draft) {
  const next = JSON.parse(JSON.stringify(draft));
  for (const key of ['higherLevels', 'cameFrom']) {
    if (typeof next[key] === 'string' && next[key].trim() === '') delete next[key];
  }
  if (!next.concentration) delete next.concentration;
  if (!next.ritual) delete next.ritual;
  if (!next.classes?.length) delete next.classes;
  const components = {};
  for (const [key] of COMPONENT_LETTERS) if (next.components?.[key]) components[key] = true;
  const material = next.components?.materialText?.trim();
  if (components.material && material) components.materialText = material;
  next.components = components;
  const mechanics = next.mechanics;
  if (mechanics) {
    const kept = { roll: mechanics.roll };
    if (mechanics.roll === 'save') {
      if (mechanics.saveAbility) kept.saveAbility = mechanics.saveAbility;
      if (mechanics.halfOnSave) kept.halfOnSave = true;
    }
    const damage = (mechanics.damage ?? []).filter((term) => term.dice !== '' || term.type !== '');
    if (damage.length > 0) kept.damage = damage;
    if (mechanics.healing?.trim()) kept.healing = mechanics.healing.trim();
    if (mechanics.addsModifier) kept.addsModifier = true;
    const scaling = mechanics.scaling;
    if (scaling?.kind === 'cantrip' && scaling.tiers?.length > 0) kept.scaling = scaling;
    else if (scaling?.kind === 'slot' && scaling.dice?.trim()) kept.scaling = { kind: 'slot', dice: scaling.dice.trim() };
    next.mechanics = kept;
  }
  return next;
}

const joinNames = (names) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const termsText = (terms) => terms.map((term) => `${term.dice} ${term.type}`.trim()).join(' + ');

// The lines of a spell's "in plain words" panel: the spell block's own line, its components, what
// it rolls, how it grows and which class lists carry it.
export function summarizeSpell(draft) {
  const lines = [];
  const school = draft.school ?? 'Evocation';
  const kind = draft.level === 0 ? `${school} cantrip` : `${ordinal(draft.level)}-level ${school.toLowerCase()}`;
  const header = [kind, draft.castingTime, draft.range];
  if (draft.concentration) header.push('concentration');
  if (draft.ritual) header.push('ritual');
  lines.push(header.filter(Boolean).join(', '));

  const components = draft.components ?? {};
  const letters = COMPONENT_LETTERS.filter(([key]) => components[key]).map(([, letter]) => letter);
  if (letters.length > 0) {
    const material = components.material && components.materialText?.trim() ? ` (${components.materialText.trim()})` : '';
    lines.push(`Components: ${letters.join(', ')}${material}`);
  }

  const mechanics = draft.mechanics;
  if (mechanics) {
    const damage = (mechanics.damage ?? []).filter((term) => term.dice !== '');
    const dealt = damage.length > 0 ? `${termsText(damage)}${mechanics.addsModifier ? ' plus the spellcasting modifier' : ''}` : '';
    if (mechanics.roll === 'attackRanged' || mechanics.roll === 'attackMelee') {
      const word = mechanics.roll === 'attackRanged' ? 'Ranged' : 'Melee';
      lines.push(`${word} spell attack${dealt ? `: ${dealt}` : ''}`);
    } else if (mechanics.roll === 'save') {
      const ability = mechanics.saveAbility ? ABILITY_LABELS[mechanics.saveAbility] : 'A';
      const half = dealt && mechanics.halfOnSave ? ', half on a success' : '';
      lines.push(`${ability} saving throw${dealt ? `: ${dealt}` : ''}${half}`);
    } else if (dealt) {
      lines.push(`Damage: ${dealt}`);
    }
    if (mechanics.healing?.trim()) {
      lines.push(`Heals ${mechanics.healing.trim()}${mechanics.addsModifier ? ' plus the spellcasting modifier' : ''}`);
    }
    const scaling = mechanics.scaling;
    if (scaling?.kind === 'slot' && scaling.dice?.trim()) {
      lines.push(`+${scaling.dice.trim()} for each slot level above ${ordinal(draft.level)}`);
    } else if (scaling?.kind === 'cantrip' && scaling.tiers?.length > 0) {
      lines.push([...scaling.tiers].sort((a, b) => a.level - b.level).map((tier) => `${tier.dice} at level ${tier.level}`).join(', '));
    }
  }
  if (draft.classes?.length > 0) {
    lines.push(`On the ${joinNames(draft.classes)} spell ${draft.classes.length === 1 ? 'list' : 'lists'}`);
  }
  return lines;
}
