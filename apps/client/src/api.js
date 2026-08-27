import { createEngineApi } from './transport/engineTransport.ts';

// The UI keeps the long-standing nested surface. Only this module knows that the
// implementation is a typed FCB worker.
export const api = createEngineApi();
export const ENGINE_TRANSPORT = 'worker';

export const BUILD_SECTIONS = [
  {
    key: 'race',
    label: 'Race',
    types: ['Race', 'Race Variant', 'Sub Race', 'Racial Trait', 'Dragonmark', 'Dragonmark Feature'],
  },
  {
    key: 'class',
    label: 'Class',
    types: ['Class', 'Class Feature', 'Archetype', 'Archetype Feature', 'Multiclass'],
  },
  {
    key: 'background',
    label: 'Background',
    types: ['Background', 'Background Variant', 'Background Feature'],
  },
  { key: 'abilities', label: 'Ability Scores', types: ['Ability Score Improvement'] },
  { key: 'languages', label: 'Languages', types: ['Language', 'Language Feature'] },
  { key: 'proficiencies', label: 'Proficiencies', types: ['Proficiency'] },
  { key: 'feats', label: 'Feats', types: ['Feat', 'Feat Feature'] },
];

export const FEATS_OPTION_ID = 'ID_INTERNAL_OPTION_ALLOW_FEATS';
export const SPELL_POINTS_OPTION_ID = 'ID_INTERNAL_OPTION_ALLOW_SPELL_POINTS';

export function isImprovementOptionRule(rule) {
  return rule?.type === 'Class Feature' && /^Improvement Option\b/.test(rule?.name ?? '');
}

export const MANAGE_RULE_TYPES = ['Alignment', 'Deity'];
export const MAGIC_RULE_TYPES = ['Spell'];
export const COMPANION_RULE_TYPES = ['Companion', 'Companion Feature'];
