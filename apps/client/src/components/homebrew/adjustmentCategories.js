// The `category` values that put an uploaded Item or Magic Item on Manage › Additional features.
//
// The engine's list (`ADJUSTMENT_CATEGORIES` in packages/engine/src/character/options.ts) decides
// what shows there. It is mirrored here rather than imported because `@forge-cb/engine` is the
// whole rules engine, which the main bundle leaves to the worker; a test keeps the two equal.
export const ADDITIONAL_FEATURE_CATEGORIES = Object.freeze([
  'Additional Arcane Trickster Spell',
  'Additional Artificer Spell',
  'Additional Bard Spell',
  'Additional Cleric Spell',
  'Additional Druid Spell',
  'Additional Eldritch Knight Spell',
  'Additional Feature',
  'Additional Language',
  'Additional Paladin Spell',
  'Additional Proficiency',
  'Additional Ranger Spell',
  'Additional Sorcerer Spell',
  'Additional Warlock Spell',
  'Additional Wizard Spell',
  'Supernatural Gifts',
]);

// Element types whose `category` setter the list applies to.
export const ADDITIONAL_FEATURE_ITEM_TYPES = Object.freeze(['Item', 'Magic Item']);
