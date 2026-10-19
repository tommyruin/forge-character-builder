// The pure side of the Homebrew editor's packs: how a stored record is read (old collections
// included), what kind of element each entry is, the templates the New element dialog offers, and
// the small conversions the pack health card applies. Nothing here renders.
//
// A pack is stored under the same IndexedDB name and shape as the collections that came before it.
// Reading one adds the fields packs carry (author, release, playtest, a schema version) and leaves
// every element exactly as it was, so a pack made by an earlier version opens and saves without any
// of its data changing.

import {
  CUSTOM_CATALOG_OPTIONS,
  compiledElementIds,
  createCustomAppendDraft,
  createCustomBackgroundDraft,
  createCustomCatalogDraft,
  createCustomClassDraft,
  createCustomCompanionDraft,
  createCustomDraft,
  createCustomOverrideDraft,
  createCustomSpeciesDraft,
  createCustomSpellDraft,
  createCustomSubclassDraft,
  createCustomSubspeciesDraft,
  isCustomAppendDraft,
  isCustomBuildDraft,
  isCustomCatalogDraft,
  isCustomItemDraft,
  isCustomOverrideDraft,
  isCustomSpellDraft,
  packElementFor,
} from '@forge-cb/engine/custom';
import { makeItemDraft } from '../custom/draftModel.js';
import { PACK_SCHEMA_VERSION, buildElementXml, escapeXml, resolveElementId } from './xmlBuilder.js';

export const CHARACTER_PACK_PREFIX = 'character:';

// ---- reading stored packs ------------------------------------------------------

/**
 * A stored pack in the current shape. Idempotent: a pack already at the current version comes back
 * unchanged (the same object), so reading never turns a clean record into a pending save.
 */
export function migratePack(record) {
  if (!record || (record.schemaVersion ?? 1) >= PACK_SCHEMA_VERSION) return record;
  return {
    ...record,
    schemaVersion: PACK_SCHEMA_VERSION,
    author: record.author ?? '',
    release: record.release ?? '',
    playtest: record.playtest === true,
    elements: (record.elements ?? []).map((element) =>
      element.localId ? element : { ...element, localId: crypto.randomUUID() },
    ),
  };
}

/**
 * How an element is edited: `form` (made with a form: its draft is the source of truth and its XML
 * is derived), `raw` (its XML is the source) or `legacy` (made with the earlier structured editor,
 * whose fields the forms cannot represent; it opens as its XML).
 */
export function elementKind(element) {
  if (element.customDraft != null && typeof element.customDraft === 'object') return 'form';
  if (element.rawXml != null && element.rawXml.trim() !== '') return 'raw';
  return 'legacy';
}

/** Which form a draft is edited with. */
export function draftFamily(draft) {
  if (isCustomBuildDraft(draft)) return 'build';
  if (isCustomSpellDraft(draft)) return 'spell';
  if (isCustomItemDraft(draft)) return 'item';
  if (isCustomCatalogDraft(draft)) return 'catalog';
  if (isCustomAppendDraft(draft)) return 'append';
  if (isCustomOverrideDraft(draft)) return 'override';
  return 'feature';
}

const SPELL_LEVEL_WORDS = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

const ITEM_KIND_LABELS = { weapon: 'Magic weapon', armor: 'Magic armor', worn: 'Wondrous item', gear: 'Gear' };

const FEATURE_KIND_LABELS = {
  feature: 'Feature',
  boon: 'Boon',
  curse: 'Curse',
  transformation: 'Transformation',
  feat: 'Feat',
  racialTrait: 'Racial trait',
  classFeature: 'Class feature',
};

const BUILD_KIND_LABELS = {
  species: 'Species',
  subspecies: 'Subspecies',
  class: 'Class',
  subclass: 'Subclass',
  background: 'Background',
  companion: 'Companion',
};

/** The grey line under an element's name in the list ("Spell · 1st", "Magic weapon · Longsword"). */
export function elementMeta(element) {
  const draft = element.customDraft;
  if (draft == null) return element.type;
  if (isCustomBuildDraft(draft)) {
    const kind = draft.template === 'subspecies' && draft.kind === 'Race Variant' ? 'Variant' : BUILD_KIND_LABELS[draft.template];
    return draft.parent?.name ? `${kind} · ${draft.parent.name}` : kind;
  }
  if (isCustomSpellDraft(draft)) return `Spell · ${SPELL_LEVEL_WORDS[draft.level] ?? draft.level}`;
  if (isCustomItemDraft(draft)) {
    const kind = ITEM_KIND_LABELS[draft.template] ?? 'Item';
    return draft.base?.name ? `${kind} · ${draft.base.name}` : kind;
  }
  if (isCustomCatalogDraft(draft)) {
    return CUSTOM_CATALOG_OPTIONS.find((option) => option.id === draft.template)?.label ?? element.type;
  }
  if (isCustomAppendDraft(draft)) return `Addition · ${draft.targetName || draft.targetId}`;
  if (isCustomOverrideDraft(draft)) return `${draft.reflavour ? 'Reflavour' : 'Changed'} · ${draft.targetType}`;
  return FEATURE_KIND_LABELS[draft.template] ?? element.type;
}

/** The id an element has in the pack's file: the XML's own when it is the source, else the stored one. */
export function elementIdOf(element, pack) {
  if (element.customDraft == null && element.rawXml?.trim()) {
    const match = /^\s*<element\b[^>]*?\bid="([^"]+)"/.exec(element.rawXml);
    if (match) return match[1];
  }
  return resolveElementId(element, pack);
}

/**
 * Every id an element defines in its pack's file. A class or a species writes its features, and a
 * background its feature, as elements of their own, so a finding about one of them belongs to the
 * element that wrote it.
 */
export function elementIdsOf(element, pack) {
  const own = elementIdOf(element, pack);
  if (element.customDraft != null && isCustomBuildDraft(element.customDraft) && element.rawXml) {
    return [own, ...compiledElementIds(element.rawXml).filter((id) => id !== own)];
  }
  return [own];
}

/** The XML the editor shows for an element that was made with the earlier structured editor. */
export function legacyXml(element, pack) {
  return buildElementXml(element, pack);
}

// ---- templates ------------------------------------------------------------------

/**
 * What the New element dialog offers, in its five groups. `route` says what Create does:
 * `feature`, `catalog`, `build`, `spell` and `item` start a form of that kind; `parent` starts a
 * form after asking which class or species it belongs to; `append`, `override` and `reflavour`
 * first ask which book element; `raw` starts the XML of an element type.
 */
export const NEW_ELEMENT_GROUPS = [
  {
    label: 'Gifts and afflictions',
    items: [
      { id: 'boon', label: 'Boon or blessing', summary: 'DM gift, supernatural gift, epic boon, piety reward', route: { kind: 'feature', template: 'boon', showsUnder: 'other' } },
      { id: 'curse', label: 'Curse or injury', summary: 'Penalties, lingering injury, madness, item curse', route: { kind: 'feature', template: 'curse', showsUnder: 'other' } },
      { id: 'transformation', label: 'Transformation', summary: 'A form you switch into: lycanthropy, wild form, avatar', route: { kind: 'feature', template: 'transformation', showsUnder: 'other' } },
      { id: 'feature', label: 'Feature', summary: 'Any other trait or ability, shown where you choose', route: { kind: 'feature', template: 'feature', showsUnder: 'other' } },
    ],
  },
  {
    label: 'Character options',
    items: [
      { id: 'species', label: 'Species', summary: 'Size, speeds, senses, languages, traits, ability choices', route: { kind: 'build', template: 'species' } },
      { id: 'subspecies', label: 'Subspecies or variant', summary: 'Adds to a species; lineage or subrace', route: { kind: 'parent', template: 'subspecies' } },
      { id: 'class', label: 'Class', summary: 'Hit die, level table, spellcasting, multiclass rules', route: { kind: 'build', template: 'class' } },
      { id: 'subclass', label: 'Subclass', summary: 'Joins a class at its subclass level', route: { kind: 'parent', template: 'subclass' } },
      { id: 'background', label: 'Background', summary: 'Its feature, proficiencies, gear, trait, ideal, bond and flaw lists', route: { kind: 'build', template: 'background' } },
      { id: 'feat', label: 'Feat', summary: 'Origin, General, Fighting Style or Epic Boon; real prerequisites', route: { kind: 'feature', template: 'feat', showsUnder: 'feats' } },
    ],
  },
  {
    label: 'Magic and equipment',
    items: [
      { id: 'spell', label: 'Spell', summary: 'Class lists, components, attack or save, damage and scaling', route: { kind: 'spell' } },
      { id: 'weapon', label: 'Weapon', summary: 'Category, properties, damage, mastery', route: { kind: 'catalog', template: 'baseWeapon' } },
      { id: 'armor', label: 'Armor or shield', summary: 'Group, AC, stealth, strength', route: { kind: 'catalog', template: 'baseArmor' } },
      { id: 'magicBase', label: 'Magic weapon or armor', summary: 'Built on a base item; bonus, riders, charges', route: { kind: 'item', template: 'weapon' } },
      { id: 'wondrous', label: 'Wondrous or worn item', summary: 'Rarity, attunement, effects while worn, charges', route: { kind: 'item', template: 'worn' } },
      { id: 'gear', label: 'Gear or consumable', summary: 'Cost, weight, stacks, pack contents', route: { kind: 'item', template: 'gear' } },
    ],
  },
  {
    label: 'Companions and world',
    items: [
      { id: 'companion', label: 'Companion', summary: 'Familiar, beast, sidekick; stat block, traits, actions', route: { kind: 'build', template: 'companion' } },
      { id: 'language', label: 'Language', summary: 'Standard, exotic or secret; script', route: { kind: 'catalog', template: 'language' } },
      { id: 'proficiency', label: 'Proficiency', summary: 'New skill, tool, vehicle or weapon group', route: { kind: 'catalog', template: 'proficiency' } },
      { id: 'vision', label: 'Sense or damage type', summary: 'Vision types, resistances to new damage types', route: { kind: 'catalog', template: 'vision' } },
      { id: 'deity', label: 'Deity', summary: 'Domains and symbol for the deity picker', route: { kind: 'catalog', template: 'deity' } },
      { id: 'option', label: 'Optional rule', summary: 'A switch on Manage › Optional rules that other content can check', route: { kind: 'catalog', template: 'option' } },
      { id: 'alignment', label: 'Alignment', summary: 'Extra alignments for the alignment picker', route: { kind: 'catalog', template: 'alignment' } },
      { id: 'weaponProperty', label: 'Weapon property', summary: 'New properties, such as firearms reload or misfire', route: { kind: 'catalog', template: 'weaponProperty' } },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { id: 'override', label: 'Change a book element', summary: 'Replace it in this pack, such as a house-ruled spell', route: { kind: 'override' } },
      { id: 'append', label: 'Add to a book element', summary: 'Extra rules or tags, such as putting a spell on the Druid list', route: { kind: 'append' } },
      { id: 'reflavour', label: 'Reflavour', summary: 'New name and text, same rules', route: { kind: 'reflavour' } },
      { id: 'raw', label: 'Custom type or raw XML', summary: 'Anything the forms cannot express yet', route: { kind: 'raw', type: '' } },
    ],
  },
];

export const NEW_ELEMENT_TEMPLATES = NEW_ELEMENT_GROUPS.flatMap((group) => group.items);

export const templateById = (id) => NEW_ELEMENT_TEMPLATES.find((template) => template.id === id);

// Sets the rules version an element asks for when the dialog picked one; "inherit" leaves it unset.
function withRuleset(draft, ruleset) {
  return ruleset && ruleset !== 'inherit' ? { ...draft, ruleset } : draft;
}

/**
 * The blank draft a form-backed template starts from, or null for a template that needs more
 * input first (a book element to change) or that starts as XML.
 */
export function createTemplateDraft(templateId, { ruleset = 'inherit' } = {}) {
  const template = templateById(templateId);
  const route = template?.route;
  if (!route) return null;
  if (route.kind === 'feature') {
    const draft = createCustomDraft(route.template, '');
    return withRuleset({ ...draft, showsUnder: route.showsUnder }, ruleset);
  }
  if (route.kind === 'catalog') return withRuleset(createCustomCatalogDraft(route.template, ''), ruleset);
  if (route.kind === 'spell') return withRuleset(createCustomSpellDraft(''), ruleset);
  if (route.kind === 'item') return withRuleset(makeItemDraft(route.template), ruleset);
  if (route.kind === 'build') return withRuleset(createBuildDraft(route.template, null), ruleset);
  return null;
}

/**
 * A blank character-option draft. A subclass or subspecies is made for a parent
 * (`{ id, name, tag }`, and `kind` for the subspecies' pick); the others take none.
 */
export function createBuildDraft(template, parent) {
  switch (template) {
    case 'species':
      return createCustomSpeciesDraft('');
    case 'class':
      return createCustomClassDraft('');
    case 'background':
      return createCustomBackgroundDraft('');
    case 'companion':
      return createCustomCompanionDraft('');
    case 'subclass':
      return createCustomSubclassDraft({ id: parent.id, name: parent.name, tag: parent.tag }, '');
    case 'subspecies':
      return createCustomSubspeciesDraft({ id: parent.id, name: parent.name, tag: parent.tag }, '', parent.kind ?? 'Sub Race');
    default:
      return null;
  }
}

/**
 * A pack element for a draft, compiled under the pack's name. A draft that does not compile yet
 * still makes an element (with no XML); the form reports what is missing.
 */
export function elementForDraft(draft, pack) {
  return packElementFor(draft, pack.name, { tolerant: true });
}

/**
 * The element after its draft changed: name, text and XML follow the draft, and everything else
 * about the element (its place in the list, its last-loaded version) stays. When the draft does
 * not compile yet the element keeps the XML it last compiled to.
 */
export function updateElementDraft(element, draft, pack) {
  const next = packElementFor(draft, pack.name, { tolerant: true });
  return { ...element, ...next, localId: element.localId, rawXml: next.rawXml === '' ? element.rawXml : next.rawXml };
}

/** A pack element that edits a copy of a book element (a house rule, or a reflavour). */
export function overrideElement(source, pack, { reflavour = false, ruleset = 'inherit' } = {}) {
  const draft = withRuleset(
    createCustomOverrideDraft({ targetId: source.id, targetType: source.type, baseXml: source.xml, name: source.name, reflavour }),
    ruleset,
  );
  return elementForDraft(draft, pack);
}

/** A pack element that adds rules or tags to a book element. */
export function appendElement(target, pack) {
  return elementForDraft(createCustomAppendDraft(target.id, target.name, `${target.name} (addition)`), pack);
}

const PLACEHOLDER_ID_TYPES = { 'Sub Race': 'SUBRACE', Archetype: 'SUBCLASS', Race: 'SPECIES' };

/**
 * A raw element: a starting XML skeleton for an element type the forms do not cover, with a
 * stable id generated now (so characters that use it keep resolving it) and the pack's source name.
 */
export function rawElement({ type, name, pack, ruleset = 'inherit' }) {
  const slug = (PLACEHOLDER_ID_TYPES[type] ?? type).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'ELEMENT';
  const id = `ID_CUSTOM_${slug}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const setters = ruleset && ruleset !== 'inherit' ? ['  <setters>', `    <set name="ruleset">${ruleset}</set>`, '  </setters>'] : [];
  const rawXml = [
    `<element name="${escapeXml(name)}" type="${escapeXml(type)}" source="${escapeXml(pack.name)}" id="${id}">`,
    '  <description>',
    '    <p></p>',
    '  </description>',
    ...setters,
    '</element>',
  ].join('\n');
  return {
    localId: crypto.randomUUID(),
    type,
    name,
    description: '',
    sheetText: '',
    prerequisite: '',
    requirements: '',
    requirementRows: [],
    supports: [],
    ruleset: 'inherit',
    setters: {},
    stats: [],
    grants: [],
    rawXml,
    id,
    idLocked: true,
  };
}

// ---- conversions the health card applies ------------------------------------------

const TYPE_ATTRIBUTE = /(<element\b[^>]*?\btype=")([^"]*)(")/;

/**
 * A Background Feature cannot be granted on its own (only a Background attaches it), so it is
 * converted to a feature that can: the same rules and text, a type the DM-grant path accepts. It
 * becomes an element whose XML is its source, so nothing it held is lost.
 */
export function convertToFeature(element, pack, toType = 'Custom Feature') {
  const xml = buildElementXml(element, pack);
  const rawXml = xml.replace(TYPE_ATTRIBUTE, `$1${toType}$3`);
  const { customDraft: _draft, loadedDraft: _loaded, ...rest } = element;
  return { ...rest, type: toType, rawXml, id: elementIdOf({ ...rest, rawXml }, pack), idLocked: true };
}

/** The pack element a finding names, if the pack holds it. */
export function elementForFinding(finding, pack) {
  if (!finding.elementId) return null;
  return (pack.elements ?? []).find((element) => elementIdsOf(element, pack).includes(finding.elementId)) ?? null;
}
