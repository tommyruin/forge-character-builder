// A class' Basics and Multiclass tabs: hit die, the one-line summary, the subclass pick, the levels
// that offer an ability score improvement or a feat, the first class' proficiencies and skill
// choice (B2 grants and a B3 choice at level 1), and what taking a level in this class as a second
// class asks for and gives.

import { useEffect, useState } from 'react';
import { HIT_DICE, subclassTagOf } from '@forge-cb/engine/custom';
import EffectsEditor from '../custom/EffectsEditor';
import RequirementsBuilder from '../custom/RequirementsBuilder';
import { Field, Issues, NumberInput, Segmented } from '../custom/fields';
import { SKILL_OPTIONS, makeSkillChoice, skillIdsOf, splitSkillChoice } from './buildModel';
import Disclosure from '../Disclosure';

const HIT_DIE_OPTIONS = HIT_DICE.map((die) => ({ id: String(die), label: `d${die}` }));
const PROFICIENCY_CHIPS = ['proficiency', 'language', 'choice'];

/** A comma-separated list of levels the author types; the draft takes the levels that read as numbers. */
function LevelList({ value, onChange, label }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => {
    // The draft changed from elsewhere (a different class opened): show it.
    setText((current) => (parse(current).join(',') === value.join(',') ? current : value.join(', ')));
  }, [value]);
  return (
    <input
      className="fcb-input"
      aria-label={label}
      placeholder="4, 8, 12, 16, 19"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parse(event.target.value));
      }}
    />
  );
}

const parse = (text) => [...new Set(text.split(/[,\s]+/).map((part) => Number(part)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20))].sort((a, b) => a - b);

/** "Choose N skills from these": the class' level-1 skill proficiency choice. */
export function SkillPicks({ ownerName, blocks, onChange, label = 'Skill choices' }) {
  const { skill, rest } = splitSkillChoice(blocks);
  // How many to choose is kept while no skill is ticked, since a choice needs both to exist.
  const [pending, setPending] = useState(2);
  const ids = skillIdsOf(skill);
  const count = skill?.count ?? pending;
  const emit = (nextCount, nextIds) =>
    onChange(nextCount > 0 && nextIds.length > 0 ? [...rest, makeSkillChoice(ownerName, nextCount, nextIds, skill)] : rest);
  return (
    <fieldset className="space-y-2" aria-label={label}>
      <legend className="fcb-field-label">{label}</legend>
      <div className="fcb-custom-row">
        <Field label="Choose how many">
          <NumberInput
            label="Skills to choose"
            min={0}
            max={18}
            value={count}
            onChange={(next) => {
              setPending(next ?? 0);
              if (skill) emit(next ?? 0, ids);
            }}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        {SKILL_OPTIONS.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(option.id)}
              onChange={() => emit(count, ids.includes(option.id) ? ids.filter((id) => id !== option.id) : [...ids, option.id])}
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="fcb-muted-copy text-xs">The player picks from the ticked skills only; the picks become proficiencies.</p>
    </fieldset>
  );
}

/** The first class' proficiencies: grants and picks, with the skill choice above them. */
export function StartingProficiencies({ ownerName, blocks, onChange, services, issues, attempted, path }) {
  const { skill, rest } = splitSkillChoice(blocks);
  const view = { name: ownerName, blocks: rest };
  return (
    <div className="space-y-3">
      <SkillPicks ownerName={ownerName} blocks={blocks} onChange={onChange} />
      <EffectsEditor
        draft={view}
        setDraft={(updater) => {
          const next = typeof updater === 'function' ? updater(view) : updater;
          onChange(skill ? [skill, ...next.blocks] : next.blocks);
        }}
        services={services}
        issues={issues.map((issue) => ({ ...issue, path: issue.path.replace(new RegExp(`^${path}`), 'blocks') }))}
        attempted={attempted}
        features={false}
        only={PROFICIENCY_CHIPS}
      />
    </div>
  );
}

export function ClassBasics({ draft, setDraft, services, issues = [], attempted = false }) {
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const subclass = draft.subclass;
  const shown = attempted ? issues.filter((issue) => /^(hitDie|short|subclass|asiLevels)/.test(issue.path)) : [];
  return (
    <div className="space-y-4" data-testid="hb-class-basics">
      <Field label="One-line summary">
        <input className="fcb-input" aria-label="One-line summary" value={draft.short ?? ''} onChange={(event) => patch({ short: event.target.value === '' ? undefined : event.target.value })} />
      </Field>
      <div>
        <span className="fcb-field-label">Hit die</span>
        <Segmented label="Hit die" value={String(draft.hitDie)} options={HIT_DIE_OPTIONS} onChange={(die) => patch({ hitDie: Number(die) })} className="mt-1" />
      </div>

      <div className="space-y-2" role="group" aria-label="Subclass">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={Boolean(subclass)}
            onChange={(event) => patch({ subclass: event.target.checked ? { level: 3, label: `${draft.name.trim() || 'Class'} Subclass` } : undefined })}
          />
          Players choose a subclass
        </label>
        {subclass && (
          <div className="fcb-custom-row">
            <Field label="At class level">
              <NumberInput label="Subclass level" min={1} max={20} value={subclass.level} onChange={(level) => patch({ subclass: { ...subclass, level: level ?? 3 } })} />
            </Field>
            <Field label="Name of the pick">
              <input
                className="fcb-input"
                aria-label="Subclass pick name"
                placeholder={subclassTagOf(draft)}
                value={subclass.label ?? ''}
                onChange={(event) => patch({ subclass: { ...subclass, label: event.target.value === '' ? undefined : event.target.value } })}
              />
            </Field>
          </div>
        )}
        {subclass && <p className="fcb-muted-copy text-xs">Subclasses made for this class answer to “{subclassTagOf(draft)}”. Keep that name steady once subclasses exist.</p>}
      </div>

      <Field label="Ability score improvement at levels">
        <LevelList label="Ability score improvement levels" value={draft.asiLevels} onChange={(asiLevels) => patch({ asiLevels })} />
      </Field>

      <Disclosure open className="fcb-custom-gates" summary="Starting proficiencies (the first class only)" bare>
        <div className="fcb-custom-gates-body">
          <StartingProficiencies
            ownerName={draft.name}
            blocks={draft.starting}
            onChange={(starting) => patch({ starting })}
            services={services}
            issues={issues}
            attempted={attempted}
            path="starting"
          />
        </div>
      </Disclosure>
      <Issues issues={shown} />
    </div>
  );
}

export function MulticlassPanel({ draft, setDraft, services, issues = [], attempted = false }) {
  const multiclass = draft.multiclass;
  const shown = attempted ? issues.filter((issue) => issue.path.startsWith('multiclass')) : [];
  if (!multiclass) {
    return (
      <div className="space-y-2" data-testid="hb-multiclass">
        <p className="fcb-muted-copy text-sm">As it stands this class cannot be taken as a second class.</p>
        <button type="button" className="fcb-button" onClick={() => setDraft((current) => ({ ...current, multiclass: { blocks: [] } }))}>
          Allow multiclassing into this class
        </button>
      </div>
    );
  }
  const patch = (next) => setDraft((current) => ({ ...current, multiclass: { ...current.multiclass, ...next } }));
  const view = { name: draft.name, blocks: multiclass.blocks };
  return (
    <div className="space-y-4" data-testid="hb-multiclass">
      <div>
        <span className="fcb-field-label">To take a level in this class the character needs</span>
        <RequirementsBuilder
          label="Multiclass requirements"
          lookup={services.lookup}
          value={multiclass.requirements}
          onChange={(requirements) => patch({ requirements })}
        />
      </div>
      <Field label="Proficiencies gained, as the class page prints them">
        <input
          className="fcb-input"
          aria-label="Multiclass proficiencies text"
          placeholder="Light armor, one skill of your choice"
          value={multiclass.summary ?? ''}
          onChange={(event) => patch({ summary: event.target.value === '' ? undefined : event.target.value })}
        />
      </Field>
      <EffectsEditor
        draft={view}
        setDraft={(updater) => patch({ blocks: (typeof updater === 'function' ? updater(view) : updater).blocks })}
        services={services}
        issues={issues.map((issue) => ({ ...issue, path: issue.path.replace(/^multiclass\.blocks/, 'blocks') }))}
        attempted={attempted}
        features={false}
        only={PROFICIENCY_CHIPS}
      />
      <button type="button" className="fcb-button fcb-button-danger" onClick={() => setDraft((current) => ({ ...current, multiclass: undefined }))}>
        Do not allow multiclassing into this class
      </button>
      <Issues issues={shown} />
    </div>
  );
}
