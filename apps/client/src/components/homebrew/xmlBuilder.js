// Pure helpers that turn homebrew-editor drafts into content XML.
//
// The draft (persisted verbatim in IndexedDB via localStore.putHomebrew) is the source of
// truth; the generated XML is re-derived on every Save & Ingest and uploaded under a stable
// path (`homebrew/<slug>.xml`) so re-saving a collection overwrites it in place.
//
// Draft model:
//   {
//     id, name, slug, abbreviation, description,
//     slugTouched, abbrTouched, ingestedAt,
//     elements: [{
//       localId, type, name, description, sheetText, prerequisite,
//       supports: [...], setters: {...}, stats: [{ name, value }], grants: [{ type, id, name }],
//       rawXml: string|null,       // advanced mode: emitted verbatim when set
//       id: string, idLocked: bool // engine element id, frozen after the first ingest
//     }]
//   }

export const UPLOAD_CATEGORY = 'homebrew';

export const RULESET_OPTIONS = [
  ['shared', 'Both 2014 and 2024'],
  ['2014', '2014 only'],
  ['2024', '2024 only'],
];

export const ELEMENT_RULESET_OPTIONS = [
  ['inherit', 'Use collection setting'],
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
  ['ID_INTERNAL_WEAPON_PROPERTY_TWO_HANDED', 'Two-Handed'],
  ['ID_INTERNAL_WEAPON_PROPERTY_VERSATILE', 'Versatile'],
  ['ID_INTERNAL_WEAPON_PROPERTY_LOADING', 'Loading'],
  ['ID_INTERNAL_WEAPON_PROPERTY_AMMUNITION', 'Ammunition'],
  ['ID_INTERNAL_WEAPON_PROPERTY_SPECIAL', 'Special'],
];

export const ARMOR_CATEGORIES = [
  ['ID_INTERNAL_ARMOR_CATEGORY_LIGHT', 'Light Armor'],
  ['ID_INTERNAL_ARMOR_CATEGORY_MEDIUM', 'Medium Armor'],
  ['ID_INTERNAL_ARMOR_CATEGORY_HEAVY', 'Heavy Armor'],
  ['ID_INTERNAL_ARMOR_CATEGORY_SHIELD', 'Shield'],
];

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
  Feat: { prerequisite: true, fields: [] },
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
      { key: 'range', label: 'Range', placeholder: '20/60' },
    ],
  },
  Armor: {
    supports: { mode: 'select', label: 'Armor Category', options: ARMOR_CATEGORIES, defaults: ['ID_INTERNAL_ARMOR_CATEGORY_LIGHT'] },
    fields: [
      { key: 'category', fixed: 'Armor' },
      { key: 'cost', label: 'Cost (gp)', default: '10', setAttrs: { currency: 'gp' } },
      { key: 'weight', label: 'Weight (lb)', kind: 'number', default: '10', format: 'weight' },
      { key: 'armorClass', label: 'Armor Class', default: '14', required: true },
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
      { key: 'type', label: 'Type', kind: 'select', options: ['Wondrous Item', 'Ring', 'Rod', 'Staff', 'Wand', 'Potion', 'Scroll', 'Armor', 'Weapon'], default: 'Wondrous Item', required: true },
      { key: 'rarity', label: 'Rarity', kind: 'select', options: ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'], default: 'Uncommon', required: true },
      { key: 'attunement', label: 'Requires Attunement', kind: 'boolean', default: 'false' },
      { key: 'slot', label: 'Worn Slot', kind: 'select', options: [['', '(none)'], 'ring', 'neck', 'head', 'body', 'hands', 'feet', 'waist', 'wrists'] },
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

export function collectionFilePath(draft) {
  return `${UPLOAD_CATEGORY}/${collectionFileName(draft)}`;
}

// ---------------------------------------------------------------------------
// Draft factories
// ---------------------------------------------------------------------------

export function createCollection(name) {
  return {
    id: crypto.randomUUID(),
    name,
    slug: fileSlug(name),
    abbreviation: deriveAbbreviation(name),
    description: '',
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

// Full supports list. Legacy Language drafts predate the category field, so treat a blank
// category as Standard; otherwise those elements cannot appear in ordinary language pickers.
// Weapons also derive their internal damage-type id so the picker and damage setter agree.
function supportsList(element) {
  const list = (element.supports ?? []).filter(Boolean);
  if (element.type === 'Language' && list.length === 0) return ['Standard'];
  if (element.type === 'Weapon') {
    const damageType = String(element.setters?.damageType ?? '').trim().toLowerCase();
    const supportId = DAMAGE_TYPE_SUPPORT_IDS[damageType];
    if (supportId && !list.includes(supportId)) return [...list, supportId];
  }
  return list;
}

function setterLines(element, spec) {
  const setters = element.setters ?? {};
  const lines = [];
  for (const field of spec.fields ?? []) {
    if (field.emit === 'attr') continue;
    if (field.showIf && !field.showIf(setters)) continue;
    let value = field.fixed ?? String(setters[field.key] ?? field.default ?? '').trim();

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
  return lines;
}

function elementRulesetLines(element) {
  const ruleset = normalizeElementRuleset(element.ruleset);
  return ruleset === 'inherit'
    ? []
    : [`<set name="ruleset">${escapeXml(ruleset)}</set>`];
}

function ruleLines(element) {
  const lines = [];
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

export function buildElementXml(element, collection) {
  if (element.rawXml != null && element.rawXml.trim()) return element.rawXml.trim();

  const spec = TYPE_SPECS[element.type] ?? {};
  const children = [];

  const supports = supportsList(element);
  if (supports.length) children.push(`<supports>${escapeXml(supports.join(', '))}</supports>`);

  if (spec.prerequisite && element.prerequisite?.trim()) {
    children.push(`<prerequisite>${escapeXml(element.prerequisite.trim())}</prerequisite>`);
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
    `    <set name="ruleset">${normalizeCollectionRuleset(draft.ruleset)}</set>`,
    '  </setters>',
    '</element>',
  ].join('\n');
}

// The complete collection file. No <info> block on purpose: when present the engine requires
// an <update version><file/> payload and rejects the file otherwise; omitting it is safe.
export function buildCollectionXml(draft) {
  const parts = [buildSourceElementXml(draft), ...(draft.elements ?? []).map((el) => buildElementXml(el, draft))];
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

export function validateDraft(draft) {
  const errors = [];
  if (!draft.name?.trim()) errors.push({ where: 'Collection', message: 'Collection name is required.' });
  if (!fileSlug(draft.slug || draft.name)) errors.push({ where: 'Collection', message: 'Collection slug is required (letters/numbers).' });

  const seenIds = new Set();
  for (const element of draft.elements ?? []) {
    const label = element.name?.trim() || `(unnamed ${element.type})`;

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
      if (!value) errors.push({ where: label, message: `${field.label ?? field.key} is required for a ${element.type}.` });
    }

    const htmlError = validateHtmlFragment(element.description);
    if (htmlError) errors.push({ where: label, message: htmlError });

    for (const stat of element.stats ?? []) {
      const name = String(stat.name ?? '').trim();
      const value = String(stat.value ?? '').trim();
      if (!name && !value) continue; // fully empty row is skipped at build time
      if (!name) errors.push({ where: label, message: 'A stat bonus row is missing its stat name.' });
      if (!/^-?\d+$/.test(value)) errors.push({ where: label, message: `Stat bonus "${name || '?'}" needs a whole-number value.` });
    }

    for (const grant of element.grants ?? []) {
      const id2 = String(grant.id ?? '').trim();
      if (!id2) errors.push({ where: label, message: 'A grant row has no element selected — pick an element or remove the row.' });
    }
  }
  return errors;
}
