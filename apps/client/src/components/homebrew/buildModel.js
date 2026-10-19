// The pure side of the character-option forms (species, subspecies, class, subclass, background,
// companion): which tabs each has, how the level table's rows and cells read and change a draft,
// the skill-choice helper, and the plain-language lines the summary shows. Nothing here renders.

import {
  CUSTOM_SKILL_PROFICIENCIES,
  createProgressionFeature,
  firstCastingLevel,
  newCustomBlockId,
  subclassTagOf,
} from '@forge-cb/engine/custom';
import { describeChoice, makeChoice } from '../custom/draftModel.js';
import { makeScale } from '../custom/trackerModel.js';

export const SKILL_OPTIONS = CUSTOM_SKILL_PROFICIENCIES;

/** The tabs of a form, by the kind of option it edits. */
export const TABS = {
  species: [
    ['basics', 'Basics'],
    ['progression', 'Progression'],
    ['sheet', 'Sheet'],
  ],
  subspecies: [
    ['basics', 'Basics'],
    ['progression', 'Progression'],
    ['sheet', 'Sheet'],
  ],
  class: [
    ['basics', 'Basics'],
    ['progression', 'Progression'],
    ['spellcasting', 'Spellcasting'],
    ['multiclass', 'Multiclass'],
    ['sheet', 'Sheet'],
  ],
  subclass: [
    ['basics', 'Basics'],
    ['progression', 'Progression'],
    ['spellcasting', 'Spellcasting'],
    ['sheet', 'Sheet'],
  ],
  background: [
    ['basics', 'Basics'],
    ['feature', 'Feature'],
    ['lists', 'Personality'],
  ],
  companion: [
    ['basics', 'Basics'],
    ['entries', 'Traits and actions'],
  ],
};

/** The owner a feature inside this kind of draft belongs to. */
export const OWNER_OF = { species: 'species', subspecies: 'species', class: 'class', subclass: 'subclass', background: 'background' };

// ---- the level table -------------------------------------------------------------------

/** The value of a scale at a level: the last step at or before it, or null before the first. */
export function scaleValueAt(scale, level) {
  let value = null;
  for (const step of [...scale.steps].sort((left, right) => left.level - right.level)) {
    if (step.level <= level) value = step.value;
  }
  return value;
}

/** Levels the table has something at: features, picks, value steps and the class' own milestones. */
export function tableLevels(draft) {
  const levels = new Set();
  for (const entry of draft.features ?? []) levels.add(entry.level);
  for (const choice of draft.choices ?? []) levels.add(choice.level ?? 1);
  for (const scale of draft.scales ?? []) for (const step of scale.steps) levels.add(step.level);
  if (draft.template === 'class') {
    if (draft.subclass) levels.add(draft.subclass.level);
    for (const level of draft.asiLevels ?? []) levels.add(level);
    if (draft.spellcasting) levels.add(firstCastingLevel(draft.spellcasting));
  }
  return [...levels].sort((left, right) => left - right);
}

/** What the class itself puts at a level, as notes the table shows but does not edit there. */
export function milestonesAt(draft, level) {
  if (draft.template !== 'class') return [];
  const notes = [];
  if (draft.spellcasting && firstCastingLevel(draft.spellcasting) === level) notes.push('Spellcasting');
  if (draft.subclass && draft.subclass.level === level) notes.push(subclassTagOf(draft));
  if ((draft.asiLevels ?? []).includes(level)) notes.push('Ability Score Improvement');
  return notes;
}

export function addFeatureAt(draft, level) {
  const owner = OWNER_OF[draft.template];
  const entry = createProgressionFeature(owner, level, 'New feature');
  return { draft: { ...draft, features: [...draft.features, entry] }, id: entry.draft.id };
}

export function setFeatureDraft(draft, featureId, apply) {
  return { ...draft, features: draft.features.map((entry) => (entry.draft.id === featureId ? { ...entry, draft: apply(entry.draft) } : entry)) };
}

export function setFeatureLevel(draft, featureId, level) {
  return { ...draft, features: draft.features.map((entry) => (entry.draft.id === featureId ? { ...entry, level } : entry)) };
}

export function removeFeature(draft, featureId) {
  return { ...draft, features: draft.features.filter((entry) => entry.draft.id !== featureId) };
}

/** A new pick at a level: a choice the author fills in (the name groups the picks). */
export function addChoiceAt(draft, level) {
  const choice = makeChoice({ name: `Choice at level ${level}`, level });
  return { draft: { ...draft, choices: [...draft.choices, choice] }, id: choice.id };
}

export function setChoice(draft, choiceId, next) {
  return { ...draft, choices: draft.choices.map((choice) => (choice.id === choiceId ? next : choice)) };
}

export function removeChoice(draft, choiceId) {
  return { ...draft, choices: draft.choices.filter((choice) => choice.id !== choiceId) };
}

/**
 * Sets a column's value at one level. A step is written only where the value changes, so typing the
 * value a level already has removes that step; the first step is the base and always stays.
 */
export function setScaleAt(scale, level, text) {
  const raw = String(text).trim();
  const kind = scale.kind;
  const steps = [...scale.steps].sort((left, right) => left.level - right.level);
  const without = steps.filter((step) => step.level !== level);
  if (raw === '') return { ...scale, steps: without.length > 0 ? without : steps };
  const value = kind === 'number' ? Number(raw) : raw;
  if (kind === 'number' && !Number.isFinite(value)) return scale;
  const before = scaleValueAt({ steps: without }, level - 1);
  const next = before === value && without.length > 0 ? without : [...without, { level, value }];
  return { ...scale, steps: next.sort((left, right) => left.level - right.level) };
}

export function addScaleColumn(draft) {
  const used = new Set((draft.scales ?? []).map((scale) => scale.name.toLowerCase()));
  let n = 1;
  while (used.has(`value ${n}`)) n += 1;
  return { ...draft, scales: [...(draft.scales ?? []), makeScale({ name: `Value ${n}` })] };
}

// ---- skill choices ---------------------------------------------------------------------------

export const isSkillChoice = (block) => block.kind === 'choice' && block.type === 'Proficiency' && /^Skill Proficiency/.test(block.name);

/** The ids a skill choice offers. */
export const skillIdsOf = (block) =>
  block?.supports?.kind === 'group' ? block.supports.items.filter((item) => item.kind === 'id').map((item) => item.value) : [];

/** A "choose N skills from these" block: the level-1 proficiency choice of a class or background. */
export function makeSkillChoice(ownerName, count, ids, previous) {
  return {
    ...(previous ?? { kind: 'choice', id: newCustomBlockId() }),
    type: 'Proficiency',
    // The name is part of the choice's identity, so a pick made under it keeps its name through edits.
    name: previous?.name ?? `Skill Proficiency (${ownerName.trim() || 'New'})`,
    count,
    supports: { kind: 'group', op: 'any', items: ids.map((value) => ({ kind: 'id', value })) },
  };
}

/** Splits a list of starting blocks into its skill choice (if any) and the rest. */
export function splitSkillChoice(blocks) {
  const skill = blocks.find(isSkillChoice);
  return { skill, rest: blocks.filter((block) => block !== skill) };
}

// ---- summaries ----------------------------------------------------------------------------------

const countWord = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A pick as the table shows it in its cell. */
export const describePick = (choice) => describeChoice(choice).replace(/^Player picks /, '');

/** Plain lines about a class, for the summary under its form. */
export function summarizeBuild(draft) {
  const lines = [];
  switch (draft.template) {
    case 'class': {
      lines.push(`Hit die d${draft.hitDie}`);
      if (draft.subclass) lines.push(`${subclassTagOf(draft)} at level ${draft.subclass.level}`);
      if ((draft.asiLevels ?? []).length > 0) lines.push(`Ability score improvement at ${draft.asiLevels.join(', ')}`);
      if (draft.spellcasting) lines.push(`Casts with ${draft.spellcasting.ability}, ${draft.spellcasting.slots.progression} slots`);
      lines.push(`${countWord(draft.features.length, 'feature')} in the level table`);
      break;
    }
    case 'subclass':
      lines.push(`Answers to ${draft.parent?.tag || 'a class'}`, `${countWord(draft.features.length, 'feature')} in the level table`);
      break;
    case 'species':
      lines.push(`${draft.size}, speed ${draft.speed} ft.`, `${countWord(draft.features.length, 'trait')}`);
      break;
    case 'subspecies':
      lines.push(`Answers to ${draft.parent?.tag || 'a species'}`, `${countWord(draft.features.length, 'trait')}`);
      break;
    case 'background':
      lines.push(`${countWord(draft.starting.length, 'proficiency or pick')}`, `${countWord(draft.lists.length, 'personality list')}`);
      break;
    case 'companion':
      lines.push(`${draft.size} ${draft.creatureType.toLowerCase()}, AC ${draft.armorClass}, ${draft.hitPoints} hit points`);
      break;
    default:
      break;
  }
  return lines;
}
