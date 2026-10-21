// Pure helpers that turn homebrew-editor drafts into content XML.
//
// The draft (persisted verbatim in IndexedDB via localStore.putHomebrew) is the source of
// truth; the generated XML is re-derived on every Save & Ingest and uploaded under a stable
// path (see collectionStoragePath) so re-saving a collection overwrites it in place.
//
// Draft model:
//   {
//     id, name, slug, abbreviation, description,
//     slugTouched, abbrTouched, ingestedAt,
//     elements: [{
//       localId, type, name, description, sheetText, prerequisite,
//       requirements (advanced expression), requirementRows (simple builder; Feat only),
//       supports: [...], setters: {...}, stats: [{ name, value }], grants: [{ type, id, name }],
//       rawXml: string|null,       // advanced mode: emitted verbatim when set
//       id: string, idLocked: bool // engine element id, frozen after the first ingest
//     }]
//   }

import { compileCustomElement, customPackDraftIssues } from '@forge-cb/engine/custom';
import { requirementsSyntaxError } from '@forge-cb/engine/requirements';
import { contentStoragePath } from '../../transport/contentStorage.js';
import { plainDraftIssue } from '../custom/issueWords.js';
import { withArticle } from '../custom/draftModel.js';

export { plainDraftIssue };

// The shape version of a stored pack. A record without one is a collection from before packs
// carried an author, a release date and a playtest flag; `migratePack` reads it as version 1.
export const PACK_SCHEMA_VERSION = 2;

export const UPLOAD_CATEGORY = 'homebrew';

export const RULESET_OPTIONS = [
  ['shared', 'Both 2014 and 2024'],
  ['2014', '2014 only'],
  ['2024', '2024 only'],
];

export const ELEMENT_RULESET_OPTIONS = [
  ['inherit', 'Use pack setting'],
  ...RULESET_OPTIONS,
];

export function normalizeCollectionRuleset(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '2014' || normalized === '2024'
    ? normalized
    : 'shared';
}

export function normalizeElementRuleset(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '2014' || normalized === '2024' || normalized === 'shared'
    ? normalized
    : 'inherit';
}

export const ELEMENT_TYPES = [
  'Spell',
  'Feat',
  'Racial Trait',
  'Class Feature',
  'Archetype Feature',
  'Background Feature',
  'Language',
  'Weapon',
  'Armor',
  'Item',
  'Magic Item',
];

const SPELL_SCHOOLS = [
  'Abjuration', 'Conjuration', 'Divination', 'Enchantment',
  'Evocation', 'Illusion', 'Necromancy', 'Transmutation',
];

export const WEAPON_CATEGORIES = [
  ['ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE', 'Simple Melee'],
  ['ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED', 'Simple Ranged'],
  ['ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE', 'Martial Melee'],
  ['ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED', 'Martial Ranged'],
];

export const WEAPON_PROPERTIES = [
  ['ID_INTERNAL_WEAPON_PROPERTY_FINESSE', 'Finesse'],
  ['ID_INTERNAL_WEAPON_PROPERTY_LIGHT', 'Light'],
  ['ID_INTERNAL_WEAPON_PROPERTY_HEAVY', 'Heavy'],
  ['ID_INTERNAL_WEAPON_PROPERTY_THROWN', 'Thrown'],
  ['ID_INTERNAL_WEAPON_PROPERTY_REACH', 'Reach'],
  ['ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED', 'Two-Handed'],
  ['ID_INTERNAL_WEAPON_PROPERTY_VERSATILE', 'Versatile'],
  ['ID_INTERNAL_WEAPON_PROPERTY_LOADING', 'Loading'],
  ['ID_INTERNAL_WEAPON_PROPERTY_AMMUNITION', 'Ammunition'],
  ['ID_INTERNAL_WEAPON_PROPERTY_SPECIAL', 'Special'],
];

// The engine's armor groups (`<supports>` on armor, and the pick that decides the dexterity cap,
// the `armor` setter and the equip slot).
export const ARMOR_GROUPS = [
  ['ID_INTERNAL_ARMOR_GROUP_LIGHT', 'Light Armor'],
  ['ID_INTERNAL_ARMOR_GROUP_MEDIUM', 'Medium Armor'],
  ['ID_INTERNAL_ARMOR_GROUP_HEAVY', 'Heavy Armor'],
  ['ID_INTERNAL_ARMOR_GROUP_SHIELD', 'Shield'],
];

// What each armor group writes: the `armor` setter the engine reads for the dexterity cap and
// the worn state, the equip slot, the group-wide proficiency element (class grants register it),
// and the AC line shown in the item card.
const ARMOR_GROUP_DETAILS = {
  ID_INTERNAL_ARMOR_GROUP_LIGHT: {
    armor: 'Light', slot: 'body', proficiency: 'ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR',
    display: (ac) => `${ac} + Dex modifier`,
  },
  ID_INTERNAL_ARMOR_GROUP_MEDIUM: {
    armor: 'Medium', slot: 'body', proficiency: 'ID_PROFICIENCY_ARMOR_PROFICIENCY_MEDIUM_ARMOR',
    display: (ac) => `${ac} + Dex modifier (max 2)`,
  },
  ID_INTERNAL_ARMOR_GROUP_HEAVY: {
    armor: 'Heavy', slot: 'body', proficiency: 'ID_PROFICIENCY_ARMOR_PROFICIENCY_HEAVY_ARMOR',
    display: (ac) => `${ac}`,
  },
  ID_INTERNAL_ARMOR_GROUP_SHIELD: {
    armor: 'Shield', slot: 'onehand,secondary', type: 'Shield',
    proficiency: 'ID_PROFICIENCY_ARMOR_PROFICIENCY_SHIELDS',
    display: (ac) => `+${ac}`,
  },
};

// Weapon category -> the category-wide proficiency element a character holds when a class grants
// "Simple Weapons", "Martial Weapons" and so on. Attacks add the proficiency bonus when the
// weapon's `proficiency` setter names an element the character has.
const WEAPON_CATEGORY_PROFICIENCY = {
  ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE: 'ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_MELEE_WEAPONS',
  ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED: 'ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_RANGED_WEAPONS',
  ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE: 'ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_MELEE_WEAPONS',
  ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED: 'ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_RANGED_WEAPONS',
};

const VERSATILE_PROPERTY = 'ID_INTERNAL_WEAPON_PROPERTY_VERSATILE';

// Ids written by earlier versions of the editor that no bundled content defines. Saved drafts keep
// working: the builder rewrites them to the real id when it emits XML.
const LEGACY_SUPPORT_IDS = {
  ID_INTERNAL_ARMOR_CATEGORY_LIGHT: 'ID_INTERNAL_ARMOR_GROUP_LIGHT',
  ID_INTERNAL_ARMOR_CATEGORY_MEDIUM: 'ID_INTERNAL_ARMOR_GROUP_MEDIUM',
  ID_INTERNAL_ARMOR_CATEGORY_HEAVY: 'ID_INTERNAL_ARMOR_GROUP_HEAVY',
  ID_INTERNAL_ARMOR_CATEGORY_SHIELD: 'ID_INTERNAL_ARMOR_GROUP_SHIELD',
  ID_INTERNAL_WEAPON_PROPERTY_TWO_HANDED: 'ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED',
};

export function normalizeSupportIds(list) {
  return (list ?? []).map((id) => LEGACY_SUPPORT_IDS[id] ?? id);
}

// Feat categories: the `<supports>` tags the bundled feat pickers filter on (a class's Fighting
// Style pick, a background's Origin pick, the level-19 Epic Boon pick, the ASI levels' General pick).
export const FEAT_CATEGORIES = [
  ['Origin', 'Origin'],
  ['General', 'General'],
  ['Fighting Style', 'Fighting Style'],
  ['Epic Boon', 'Epic Boon'],
];

// Magic items that sit on a base weapon or armor name what they can sit on in the `weapon` or
// `armor` setter: an expression over the base's support tags (`A||B` is "either"), or a single
// base name.
export const MAGIC_BASE_KINDS = [
  ['', 'Not based on a weapon or armor'],
  ['weapon', 'Layered on a weapon'],
  ['armor', 'Layered on armor'],
];

export const MAGIC_BASE_SCOPES = {
  weapon: [
    ['', 'Any weapon'],
    ['ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE||ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE', 'Any melee weapon'],
    ['ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED||ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED', 'Any ranged weapon'],
    ['ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE||ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED', 'Any simple weapon'],
    ['ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE||ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED', 'Any martial weapon'],
  ],
  armor: [
    ['', 'Any armor except shields'],
    ['ID_INTERNAL_ARMOR_GROUP_LIGHT', 'Light armor'],
    ['ID_INTERNAL_ARMOR_GROUP_MEDIUM', 'Medium armor'],
    ['ID_INTERNAL_ARMOR_GROUP_HEAVY', 'Heavy armor'],
    ['ID_INTERNAL_ARMOR_GROUP_SHIELD', 'Shield'],
  ],
};

const ANY_WEAPON_BASE = Object.keys(WEAPON_CATEGORY_PROFICIENCY).join('||');
const ANY_ARMOR_BASE = 'ID_INTERNAL_ARMOR_GROUP_LIGHT||ID_INTERNAL_ARMOR_GROUP_MEDIUM||ID_INTERNAL_ARMOR_GROUP_HEAVY';

export const LANGUAGE_CATEGORIES = [
  ['Standard', 'Standard'],
  ['Exotic', 'Exotic'],
  ['Monster', 'Monster'],
];

const DAMAGE_TYPE_SUPPORT_IDS = {
  slashing: 'ID_INTERNAL_DAMAGE_TYPE_SLASHING',
  piercing: 'ID_INTERNAL_DAMAGE_TYPE_PIERCING',
  bludgeoning: 'ID_INTERNAL_DAMAGE_TYPE_BLUDGEONING',
};

// Common `<stat name="...">` targets; the stat picker also accepts free text
// (e.g. skill proficiency names) so this is guidance, not a restriction.
export const STAT_NAMES = [
  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
  'strength:max', 'dexterity:max', 'constitution:max', 'intelligence:max', 'wisdom:max', 'charisma:max',
  'hp', 'ac:misc', 'initiative:misc', 'innate speed',
];

export const GRANT_TYPES = [
  'Racial Trait', 'Class Feature', 'Archetype Feature', 'Feat', 'Feat Feature',
  'Background Feature', 'Language', 'Proficiency', 'Spell', 'Weapon', 'Armor', 'Item', 'Magic Item',
];

// Declarative per-type field spec. One table drives ElementForm's rendering AND the setter
// XML emission, so form and output can never drift.
//
// Field keys:
//   kind: 'text' | 'number' | 'select' | 'boolean'  (default 'text')
//   fixed: always-emitted constant setter (not shown as an editable field)
//   default: initial value seeded by createElement
//   required: validateDraft rejects an empty value
//   setAttrs: static attributes on the <set> (e.g. cost currency="gp")
//   attrFrom: { attrName: otherFieldKey } — pull an attribute value from another field
//   emit: 'attr' — the field only feeds another setter's attribute (no <set> of its own)
//   emit: 'derived' — the field feeds derivedParts(), which writes the setters/rules it implies
//   options may be a function of the current setters (for selects whose list depends on another field)
//   format: 'weight' — emits <set name="weight" lb="N">N lb.</set>
//   trueValue/omitFalse: boolean emitted as a word when on, omitted when off
//   showIf(setters): hide the field (and skip emission) unless the predicate passes
export const TYPE_SPECS = {
  Spell: {
    supports: {
      mode: 'text',
      label: 'Classes',
      hint: 'Comma-separated class names this spell is available to.',
      placeholder: 'Wizard, Sorcerer',
    },
    fields: [
      { key: 'level', label: 'Spell Level', kind: 'select', options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], default: '1', required: true },
      { key: 'school', label: 'School', kind: 'select', options: SPELL_SCHOOLS, default: 'Evocation', required: true },
      { key: 'time', label: 'Casting Time', default: '1 action', required: true },
      { key: 'duration', label: 'Duration', default: 'Instantaneous', required: true },
      { key: 'range', label: 'Range', default: '60 feet', required: true },
      { key: 'hasVerbalComponent', label: 'Verbal (V)', kind: 'boolean', default: 'true' },
      { key: 'hasSomaticComponent', label: 'Somatic (S)', kind: 'boolean', default: 'true' },
      { key: 'hasMaterialComponent', label: 'Material (M)', kind: 'boolean', default: 'false' },
      { key: 'materialComponent', label: 'Material Component', placeholder: 'a pinch of dust', showIf: (s) => s.hasMaterialComponent === 'true' },
      { key: 'isConcentration', label: 'Concentration', kind: 'boolean', default: 'false' },
      { key: 'isRitual', label: 'Ritual', kind: 'boolean', default: 'false' },
    ],
  },
  Feat: {
    prerequisite: true,
    requirements: true,
    supports: {
      mode: 'tags',
      label: 'Feat categories',
      hint: 'The pickers that offer this feat: a class\'s Fighting Style pick, a background\'s Origin feat, the Epic Boon pick, or the General pick at ability score increases.',
      options: FEAT_CATEGORIES,
    },
    fields: [],
  },
  'Racial Trait': { fields: [] },
  'Class Feature': { fields: [] },
  'Archetype Feature': { fields: [] },
  'Background Feature': { fields: [] },
  Language: {
    supports: {
      mode: 'select',
      label: 'Language Category',
      options: LANGUAGE_CATEGORIES,
      defaults: ['Standard'],
    },
    fields: [],
  },
  Weapon: {
    supports: { mode: 'weapon', defaults: ['ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE'] },
    fields: [
      { key: 'category', fixed: 'Weapons' },
      { key: 'cost', label: 'Cost (gp)', default: '10', setAttrs: { currency: 'gp' } },
      { key: 'weight', label: 'Weight (lb)', kind: 'number', default: '2', format: 'weight' },
      { key: 'slot', label: 'Hands', kind: 'select', options: [['onehand', 'One-handed'], ['twohand', 'Two-handed']], default: 'onehand' },
      { key: 'damage', label: 'Damage Dice', default: '1d8', required: true, attrFrom: { type: 'damageType' } },
      { key: 'damageType', label: 'Damage Type', kind: 'select', options: ['slashing', 'piercing', 'bludgeoning'], default: 'slashing', emit: 'attr' },
      { key: 'versatile', label: 'Versatile damage (two hands)', placeholder: '1d10' },
      { key: 'range', label: 'Range', placeholder: '20/60' },
    ],
  },
  Armor: {
    supports: { mode: 'select', label: 'Armor Group', options: ARMOR_GROUPS, defaults: ['ID_INTERNAL_ARMOR_GROUP_LIGHT'] },
    fields: [
      { key: 'category', fixed: 'Armor' },
      { key: 'cost', label: 'Cost (gp)', default: '10', setAttrs: { currency: 'gp' } },
      { key: 'weight', label: 'Weight (lb)', kind: 'number', default: '10', format: 'weight' },
      { key: 'armorClass', label: 'Base AC (shield: bonus)', default: '14', required: true, emit: 'derived' },
      { key: 'strength', label: 'Minimum Strength', placeholder: '13' },
      { key: 'stealth', label: 'Stealth Disadvantage', kind: 'boolean', default: 'false', trueValue: 'Disadvantage', omitFalse: true },
    ],
  },
  Item: {
    fields: [
      { key: 'category', label: 'Category', default: 'Adventuring Gear', required: true },
      { key: 'cost', label: 'Cost (gp)', default: '1', setAttrs: { currency: 'gp' } },
      { key: 'weight', label: 'Weight (lb)', kind: 'number', default: '1', format: 'weight' },
      { key: 'stackable', label: 'Stackable', kind: 'boolean', default: 'false' },
    ],
  },
  'Magic Item': {
    fields: [
      { key: 'category', label: 'Category', default: 'Wondrous Items', required: true },
      { key: 'type', label: 'Type', kind: 'select', options: ['Wondrous Item', 'Ring', 'Rod', 'Staff', 'Wand', 'Potion', 'Scroll'], default: 'Wondrous Item', required: true },
      { key: 'rarity', label: 'Rarity', kind: 'select', options: ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'], default: 'Uncommon', required: true },
      { key: 'attunement', label: 'Requires Attunement', kind: 'boolean', default: 'false' },
      { key: 'slot', label: 'Worn Slot', kind: 'select', options: [['', '(none)'], 'ring', 'neck', 'head', 'body', 'hands', 'feet', 'waist', 'wrists'] },
      { key: 'baseKind', label: 'Layered on', kind: 'select', options: MAGIC_BASE_KINDS, default: '', emit: 'derived' },
      { key: 'baseScope', label: 'Base may be', kind: 'select', options: (setters) => MAGIC_BASE_SCOPES[setters.baseKind] ?? [], emit: 'derived', showIf: (s) => Boolean(s.baseKind) },
      { key: 'baseName', label: 'Or a single named base', placeholder: 'Longsword', emit: 'derived', showIf: (s) => Boolean(s.baseKind) },
    ],
  },
};

// ---------------------------------------------------------------------------
// Ids, slugs, names
// ---------------------------------------------------------------------------

// Engine element-id segment: the validator requires /^ID_[A-Z0-9_]+$/.
export function sanitizeSlug(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// File-name slug for `homebrew/<slug>.xml` (lowercase, hyphenated).
export function fileSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// "My Cool Stuff" -> "MCS"; single word -> its first three letters.
export function deriveAbbreviation(name) {
  const words = String(name ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return 'HB';
  const abbr = words.length === 1
    ? words[0].slice(0, 3).toUpperCase()
    : words.map((w) => w[0].toUpperCase()).join('').slice(0, 6);
  return abbr || 'HB';
}

export function makeElementId(collectionSlug, type, name) {
  return `ID_HB_${sanitizeSlug(collectionSlug) || 'HOMEBREW'}_${sanitizeSlug(type)}_${sanitizeSlug(name) || 'UNNAMED'}`;
}

export function makeSourceId(draft) {
  return `ID_HB_${sanitizeSlug(draft.abbreviation) || 'HB'}_SOURCE_${sanitizeSlug(draft.slug || draft.name) || 'HOMEBREW'}`;
}

// The engine id an element will be ingested under. Frozen after the first successful
// ingest (re-uploads overwrite by id; changing an id would orphan characters using it).
export function resolveElementId(element, collection) {
  if (element.idLocked && element.id) return element.id;
  return makeElementId(collection.slug || collection.name, element.type, element.name);
}

export function collectionFileName(draft) {
  return `${fileSlug(draft.slug || draft.name) || 'homebrew-collection'}.xml`;
}

// Where a collection lives in the content store. The source id comes from the draft's own id and
// the file name is fixed, so saving, the warnings filter and delete name one path no matter how
// often the collection is saved or renamed.
export const COLLECTION_STORED_FILE = 'collection.xml';

export function collectionContentSourceId(draft) {
  return `homebrew-${draft.id}`;
}

export function collectionStoragePath(draft) {
  return contentStoragePath(collectionContentSourceId(draft), COLLECTION_STORED_FILE);
}

// ---------------------------------------------------------------------------
// Draft factories
// ---------------------------------------------------------------------------

export function createCollection(name) {
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    slug: fileSlug(name),
    abbreviation: deriveAbbreviation(name),
    description: '',
    author: '',
    release: '',
    playtest: false,
    ruleset: 'shared',
    slugTouched: false,
    abbrTouched: false,
    ingestedAt: null,
    elements: [],
  };
}

export function createElement(type) {
  const spec = TYPE_SPECS[type] ?? {};
  const setters = {};
  for (const field of spec.fields ?? []) {
    if (field.default != null && field.fixed == null) setters[field.key] = field.default;
  }
  return {
    localId: crypto.randomUUID(),
    type,
    name: `New ${type}`,
    description: '',
    sheetText: '',
    prerequisite: '',
    requirements: '',
    requirementRows: [],
    supports: spec.supports?.defaults ? [...spec.supports.defaults] : [],
    ruleset: 'inherit',
    setters,
    stats: [],
    grants: [],
    rawXml: null,
    id: '',
    idLocked: false,
  };
}

// ---------------------------------------------------------------------------
// XML generation
// ---------------------------------------------------------------------------

export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function indent(text, pad) {
  return String(text)
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n');
}

// Description bodies are HTML fragments. Plain text (no tags) is escaped and wrapped in
// <p> paragraphs; anything containing markup is emitted as-is (validated separately).
export function descriptionToXml(text) {
  const value = String(text ?? '').trim();
  if (!value) return '<p></p>';
  if (value.includes('<')) return value;
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeXml(paragraph.replace(/\s*\n\s*/g, ' ').trim())}</p>`)
    .join('\n');
}

// Well-formedness check for authored HTML fragments (the engine parses content as XML, so
// unclosed tags or raw ampersands would poison the whole file). Returns an error string or null.
export function validateHtmlFragment(html) {
  const value = String(html ?? '').trim();
  if (!value || !value.includes('<')) return null; // plain text is escaped at build time
  const doc = new DOMParser().parseFromString(`<root>${value}</root>`, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (!parseError) return null;
  const firstLine = (parseError.textContent ?? '').split('\n').find((l) => l.trim()) ?? 'parse error';
  return `Description markup is not well-formed XML (${firstLine.trim()}). Close every tag and escape bare & as &amp;.`;
}

// What the type derives from the draft beyond its plain fields: setters whose value depends on
// other fields (the armor group decides the `armor` setter and the equip slot), the rules those
// setters stand for, supports the engine needs, and plain fields to write differently.
function derivedParts(element) {
  const setters = element.setters ?? {};
  const supports = normalizeSupportIds(element.supports).filter(Boolean);
  const parts = { overrides: {}, sets: [], rules: [], supports: [] };

  if (element.type === 'Armor') {
    const group = supports.find((id) => ARMOR_GROUP_DETAILS[id]) ?? 'ID_INTERNAL_ARMOR_GROUP_LIGHT';
    const details = ARMOR_GROUP_DETAILS[group];
    const ac = armorBaseValue(setters.armorClass);
    parts.sets.push({ name: 'slot', value: details.slot });
    if (details.type) parts.sets.push({ name: 'type', value: details.type });
    parts.sets.push({ name: 'armor', value: details.armor });
    parts.sets.push({ name: 'armorClass', value: details.display(ac) });
    parts.sets.push({ name: 'proficiency', value: details.proficiency });
    if (!supports.includes(group)) parts.supports.push(group);
    if (setters.stealth === 'true') {
      parts.rules.push('<grant type="Grants" id="ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE" />');
    }
    parts.rules.push(group === 'ID_INTERNAL_ARMOR_GROUP_SHIELD'
      ? `<stat name="ac:shield" value="${ac}" bonus="shield" />`
      : `<stat name="ac:armored:armor" value="${ac}" />`);
    const strength = Number.parseInt(String(setters.strength ?? ''), 10);
    if (Number.isFinite(strength) && strength > 0 && group !== 'ID_INTERNAL_ARMOR_GROUP_SHIELD') {
      parts.rules.push(`<stat name="speed" value="-10" bonus="armor" requirements="!([str:${strength}]||ID_INTERNAL_GRANT_ARMOR_IGNORE_STRENGTH_REQUIREMENT)" />`);
    }
  }

  if (element.type === 'Weapon') {
    const category = supports.find((id) => WEAPON_CATEGORY_PROFICIENCY[id]);
    if (category) parts.sets.push({ name: 'proficiency', value: WEAPON_CATEGORY_PROFICIENCY[category] });
    const versatile = String(setters.versatile ?? '').trim();
    if (versatile && !supports.includes(VERSATILE_PROPERTY)) parts.supports.push(VERSATILE_PROPERTY);
    const damageType = String(setters.damageType ?? '').trim().toLowerCase();
    const damageSupport = DAMAGE_TYPE_SUPPORT_IDS[damageType];
    if (damageSupport && !supports.includes(damageSupport)) parts.supports.push(damageSupport);
  }

  if (element.type === 'Magic Item') {
    const base = magicItemBase(element);
    if (base) {
      parts.overrides.category = base.kind === 'weapon' ? 'Magic Weapons' : 'Magic Armor';
      parts.overrides.type = base.kind === 'weapon' ? 'Weapon' : 'Armor';
      parts.sets.push({ name: base.kind, value: base.expression });
    }
  }
  return parts;
}

// The leading whole number of an armor's AC text ("14", or a legacy "14 + Dex modifier").
function armorBaseValue(text) {
  const parsed = Number.parseInt(String(text ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// The base a Magic Item layers on, or null. A draft saved before the form had a base picker with
// type Weapon or Armor is read as "any weapon" / "any armor": that type without a base setter
// could never be equipped to a hand or the body.
export function magicItemBase(element) {
  const setters = element.setters ?? {};
  const legacyKind = setters.type === 'Weapon' ? 'weapon' : setters.type === 'Armor' ? 'armor' : '';
  const kind = String(setters.baseKind ?? '').trim() || legacyKind;
  if (kind !== 'weapon' && kind !== 'armor') return null;
  const name = String(setters.baseName ?? '').trim();
  const scope = String(setters.baseScope ?? '').trim();
  const expression = name || scope || (kind === 'weapon' ? ANY_WEAPON_BASE : ANY_ARMOR_BASE);
  return { kind, expression };
}

// Full supports list. Legacy Language drafts predate the category field, so treat a blank
// category as Standard; otherwise those elements cannot appear in ordinary language pickers.
// Weapons also derive their internal damage-type id so the picker and damage setter agree.
function supportsList(element) {
  const list = normalizeSupportIds(element.supports).filter(Boolean);
  if (element.type === 'Language' && list.length === 0) return ['Standard'];
  if (element.type === 'Armor' || element.type === 'Weapon') {
    const extra = derivedParts(element).supports;
    return [...list, ...extra.filter((id) => !list.includes(id))];
  }
  return list;
}

function setterLines(element, spec) {
  const setters = element.setters ?? {};
  const derived = derivedParts(element);
  const lines = [];
  for (const field of spec.fields ?? []) {
    if (field.emit) continue;
    if (field.showIf && !field.showIf(setters)) continue;
    let value = field.fixed ?? derived.overrides[field.key] ?? String(setters[field.key] ?? field.default ?? '').trim();

    if (field.kind === 'boolean') {
      const on = value === 'true';
      if (field.trueValue) {
        if (!on) continue;
        value = field.trueValue;
      } else {
        value = on ? 'true' : 'false';
      }
    } else if (!value) {
      continue; // optional field left blank
    }

    if (field.format === 'weight') {
      const pounds = value.replace(/[^\d.]/g, '') || '0';
      lines.push(`<set name="weight" lb="${pounds}">${pounds} lb.</set>`);
      continue;
    }

    let attrs = '';
    if (field.setAttrs) {
      for (const [attr, attrValue] of Object.entries(field.setAttrs)) attrs += ` ${attr}="${escapeXml(attrValue)}"`;
    }
    if (field.attrFrom) {
      for (const [attr, sourceKey] of Object.entries(field.attrFrom)) {
        const sourceValue = String(setters[sourceKey] ?? '').trim();
        if (sourceValue) attrs += ` ${attr}="${escapeXml(sourceValue)}"`;
      }
    }
    lines.push(`<set name="${field.key}"${attrs}>${escapeXml(value)}</set>`);
  }
  for (const set of derived.sets) lines.push(`<set name="${set.name}">${escapeXml(set.value)}</set>`);
  return lines;
}

function elementRulesetLines(element) {
  const ruleset = normalizeElementRuleset(element.ruleset);
  return ruleset === 'inherit'
    ? []
    : [`<set name="ruleset">${escapeXml(ruleset)}</set>`];
}

function ruleLines(element) {
  const lines = [...derivedParts(element).rules];
  for (const stat of element.stats ?? []) {
    const name = String(stat.name ?? '').trim();
    const value = String(stat.value ?? '').trim();
    if (!name || !value) continue;
    lines.push(`<stat name="${escapeXml(name)}" value="${escapeXml(value)}" />`);
  }
  for (const grant of element.grants ?? []) {
    const type = String(grant.type ?? '').trim();
    const id = String(grant.id ?? '').trim();
    if (!type || !id) continue;
    lines.push(`<grant type="${escapeXml(type)}" id="${escapeXml(id)}" />`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Feat requirements
// ---------------------------------------------------------------------------

export const REQUIREMENT_ABILITIES = [
  ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'],
];

// One simple-builder row as an engine requirement atom, or '' while it is incomplete.
function requirementAtom(row) {
  const min = Number.parseInt(String(row.min ?? ''), 10);
  if (row.kind === 'ability') {
    return REQUIREMENT_ABILITIES.some(([abbr]) => abbr === row.ability) && min > 0 ? `[${row.ability}:${min}]` : '';
  }
  if (row.kind === 'level') return min > 0 ? `[level:${min}]` : '';
  if (row.kind === 'classLevel') {
    const cls = String(row.className ?? '').trim().toLowerCase();
    return cls && min > 0 ? `[level:${cls}:${min}]` : '';
  }
  if (row.kind === 'element') {
    const id = String(row.id ?? '').trim();
    return id ? `${row.negate ? '!' : ''}${id}` : '';
  }
  return '';
}

function requirementPhrase(row) {
  const min = Number.parseInt(String(row.min ?? ''), 10);
  if (row.kind === 'ability') {
    const name = REQUIREMENT_ABILITIES.find(([abbr]) => abbr === row.ability)?.[1];
    return name && min > 0 ? `${name} ${min} or higher` : '';
  }
  if (row.kind === 'level') return min > 0 ? `Character level ${min} or higher` : '';
  if (row.kind === 'classLevel') {
    const cls = String(row.className ?? '').trim();
    return cls && min > 0 ? `${cls} level ${min} or higher` : '';
  }
  if (row.kind === 'element') {
    const label = String(row.name ?? row.id ?? '').trim();
    return label ? `${row.negate ? 'Without' : 'Has'} ${label}` : '';
  }
  return '';
}

// The engine requirements expression for a feat: the advanced text when set, otherwise the
// builder rows joined with "and".
export function buildRequirementsExpression(element) {
  const text = String(element.requirements ?? '').trim();
  if (text) return text;
  return (element.requirementRows ?? []).map(requirementAtom).filter(Boolean).join(',');
}

// The line the picker shows next to the feat. Authors can write their own; a blank one is
// filled from the builder rows so the gating the engine enforces is also visible.
export function requirementsDisplayText(element) {
  const own = String(element.prerequisite ?? '').trim();
  if (own) return own;
  return (element.requirementRows ?? []).map(requirementPhrase).filter(Boolean).join('; ');
}

// The XML an element written with a form is compiled to, under the pack's current name. The pack
// name is the element's source, so renaming a pack reaches every element on the next save. A draft
// the compiler refuses falls back to the XML it last compiled to: validation reports the draft, and
// saving never loses what was stored.
function compiledDraftXml(element, collection) {
  try {
    return compileCustomElement(element.customDraft, { source: collection.name });
  } catch {
    return element.rawXml?.trim() ?? '';
  }
}

export function buildElementXml(element, collection) {
  if (element.customDraft != null && typeof element.customDraft === 'object') {
    // A draft that does not compile and never has contributes nothing to the file; validation
    // names it, and the file is not loaded while it is invalid.
    return compiledDraftXml(element, collection);
  }
  if (element.rawXml != null && element.rawXml.trim()) return element.rawXml.trim();

  const spec = TYPE_SPECS[element.type] ?? {};
  const children = [];

  const supports = supportsList(element);
  if (supports.length) children.push(`<supports>${escapeXml(supports.join(', '))}</supports>`);

  if (spec.prerequisite) {
    const display = requirementsDisplayText(element);
    if (display) children.push(`<prerequisite>${escapeXml(display)}</prerequisite>`);
  }
  if (spec.requirements) {
    const expression = buildRequirementsExpression(element);
    if (expression) children.push(`<requirements>${escapeXml(expression)}</requirements>`);
  }

  children.push('<description>');
  children.push(indent(descriptionToXml(element.description), '  '));
  children.push('</description>');

  if (element.sheetText?.trim()) {
    children.push('<sheet>');
    children.push(`  <description>${escapeXml(element.sheetText.trim())}</description>`);
    children.push('</sheet>');
  }

  const sets = [
    ...elementRulesetLines(element),
    ...setterLines(element, spec),
  ];
  if (sets.length) {
    children.push('<setters>');
    children.push(...sets.map((line) => `  ${line}`));
    children.push('</setters>');
  }

  const rules = ruleLines(element);
  if (rules.length) {
    children.push('<rules>');
    children.push(...rules.map((line) => `  ${line}`));
    children.push('</rules>');
  }

  const attrs = [
    `name="${escapeXml(element.name)}"`,
    `type="${escapeXml(element.type)}"`,
    `source="${escapeXml(collection.name)}"`,
    `id="${resolveElementId(element, collection)}"`,
  ].join(' ');

  return [`<element ${attrs}>`, ...children.map((line) => indent(line, '  ')), '</element>'].join('\n');
}

// A pack's release date as the Source element reads it (YYYYMMDD), from the date the form stores
// (YYYY-MM-DD). Anything else is left out rather than written as a date the library cannot sort.
export function releaseStamp(release) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(release ?? '').trim());
  return match ? `${match[1]}${match[2]}${match[3]}` : '';
}

function buildSourceElementXml(draft) {
  const description = draft.description?.trim()
    ? descriptionToXml(draft.description)
    : `<p>${escapeXml(`${draft.name} — homebrew content created with DM Forge Character Builder.`)}</p>`;
  return [
    `<element name="${escapeXml(draft.name)}" type="Source" source="${escapeXml(draft.name)}" id="${makeSourceId(draft)}">`,
    '  <description>',
    indent(description, '    '),
    '  </description>',
    '  <setters>',
    `    <set name="abbreviation">${escapeXml(draft.abbreviation || 'HB')}</set>`,
    '    <set name="url">https://local.homebrew</set>',
    '    <set name="homebrew">true</set>',
    ...(draft.author?.trim() ? [`    <set name="author">${escapeXml(draft.author.trim())}</set>`] : []),
    ...(releaseStamp(draft.release) ? [`    <set name="release">${releaseStamp(draft.release)}</set>`] : []),
    ...(draft.playtest === true ? ['    <set name="playtest">true</set>'] : []),
    `    <set name="ruleset">${normalizeCollectionRuleset(draft.ruleset)}</set>`,
    '  </setters>',
    '</element>',
  ].join('\n');
}

// The complete collection file. No <info> block on purpose: when present the engine requires
// an <update version><file/> payload and rejects the file otherwise; omitting it is safe.
export function buildCollectionXml(draft) {
  const parts = [buildSourceElementXml(draft), ...(draft.elements ?? []).map((el) => buildElementXml(el, draft))].filter(
    (part) => part !== '',
  );
  return [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<elements>',
    parts.map((part) => indent(part, '  ')).join('\n'),
    '</elements>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validation (blocking issues surfaced before Save & Ingest)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^ID_[A-Z0-9_]+$/;

/** Every issue that keeps a pack's form-made elements from loading, one entry per issue. */
export function draftIssuesOf(pack) {
  const found = [];
  for (const element of pack.elements ?? []) {
    if (element.customDraft == null || typeof element.customDraft !== 'object') continue;
    for (const issue of customPackDraftIssues(element.customDraft)) {
      found.push({ element, message: plainDraftIssue(element.customDraft, issue) });
    }
  }
  return found;
}

export function validateDraft(draft) {
  const errors = [];
  if (!draft.name?.trim()) errors.push({ where: 'Pack', message: 'Pack name is required.' });
  if (!fileSlug(draft.slug || draft.name)) errors.push({ where: 'Pack', message: 'Pack slug is required (letters/numbers).' });

  const seenIds = new Set();
  for (const element of draft.elements ?? []) {
    const label = element.name?.trim() || `(unnamed ${element.type})`;

    if (element.customDraft != null && typeof element.customDraft === 'object') {
      for (const issue of customPackDraftIssues(element.customDraft)) {
        errors.push({ where: label, message: plainDraftIssue(element.customDraft, issue) });
      }
      continue;
    }

    if (element.rawXml != null && element.rawXml.trim()) {
      const doc = new DOMParser().parseFromString(element.rawXml, 'application/xml');
      if (doc.querySelector('parsererror')) {
        errors.push({ where: label, message: 'Raw XML is not well-formed.' });
      } else if (doc.documentElement.tagName !== 'element') {
        errors.push({ where: label, message: 'Raw XML must be a single <element> node.' });
      }
      continue;
    }

    if (!element.name?.trim()) errors.push({ where: label, message: 'Element name is required.' });

    const id = resolveElementId(element, draft);
    if (!ID_PATTERN.test(id)) errors.push({ where: label, message: `Generated id "${id}" is invalid — the name needs at least one letter or number.` });
    if (seenIds.has(id)) errors.push({ where: label, message: `Duplicate element id "${id}" — rename one of the elements sharing this type and name.` });
    seenIds.add(id);

    const spec = TYPE_SPECS[element.type] ?? {};
    for (const field of spec.fields ?? []) {
      if (!field.required || field.fixed != null) continue;
      if (field.showIf && !field.showIf(element.setters ?? {})) continue;
      const value = String(element.setters?.[field.key] ?? '').trim();
      if (!value) errors.push({ where: label, message: `${field.label ?? field.key} is required for ${withArticle(element.type)}.` });
    }

    if (spec.requirements) {
      const syntax = requirementsSyntaxError(buildRequirementsExpression(element));
      if (syntax) errors.push({ where: label, message: `Requirements are not a valid expression (${syntax}).` });
    }

    if (element.type === 'Armor' && !/^\d+/.test(String(element.setters?.armorClass ?? '').trim())) {
      errors.push({ where: label, message: 'Armor needs a whole-number base AC.' });
    }
    if (element.type === 'Weapon') {
      const supports = normalizeSupportIds(element.supports);
      if (supports.includes(VERSATILE_PROPERTY) && !String(element.setters?.versatile ?? '').trim()) {
        errors.push({ where: label, message: 'A versatile weapon needs its two-handed damage dice.' });
      }
    }

    const htmlError = validateHtmlFragment(element.description);
    if (htmlError) errors.push({ where: label, message: htmlError });

    for (const stat of element.stats ?? []) {
      const name = String(stat.name ?? '').trim();
      const value = String(stat.value ?? '').trim();
      if (!name && !value) continue; // fully empty row is skipped at build time
      if (!name) errors.push({ where: label, message: 'A stat bonus row is missing its stat name.' });
      // A leading + is how bonuses are written ("+2"); the engine reads it as the number.
      if (!/^[+-]?\d+$/.test(value)) errors.push({ where: label, message: `Stat bonus "${name || '?'}" needs a whole-number value.` });
    }

    for (const grant of element.grants ?? []) {
      const id2 = String(grant.id ?? '').trim();
      if (!id2) errors.push({ where: label, message: 'A grant row has no element selected — pick an element or remove the row.' });
    }
  }
  return errors;
}
