// B10, the spellcasting tab: whether a class (or a subclass) casts, with what ability, how it learns
// and prepares spells, the slot table, the spell list, and how many cantrips and spells it knows at
// each level. A subclass can instead add to its class' spells: spells always prepared from a class
// level, and spells added to the class list. The draft this edits is the engine's
// `CustomSpellcasting` / `SubclassSpells`.

import { CASTING_STYLES, SLOT_PROGRESSIONS, slotTotals } from '@forge-cb/engine/custom';
import LibraryPicker from '../custom/LibraryPicker';
import { Field, Issues, NumberInput, RemoveButton, Segmented, SelectInput } from '../custom/fields';
import { abilityOptions } from '../custom/draftModel';

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];

const PROGRESSION_LABELS = { full: 'Full', half: 'Half', third: 'Third', pact: 'Pact', custom: 'Custom table' };
const PROGRESSION_OPTIONS = SLOT_PROGRESSIONS.map((id) => ({ id, label: PROGRESSION_LABELS[id] }));

const STYLE_LABELS = { prepared: 'Prepares from the list', known: 'Knows a set', spellbook: 'Spellbook' };
const STYLE_OPTIONS = CASTING_STYLES.map((id) => ({ id, label: STYLE_LABELS[id] }));

const SHARE_OPTIONS = [
  { id: '', label: 'Follows its slots' },
  { id: 'full', label: 'Counts as a full caster' },
  { id: 'half', label: 'Counts as a half caster' },
  { id: 'third', label: 'Counts as a third caster' },
  { id: 'solo', label: 'Keeps its own slots (pact)' },
  { id: 'none', label: 'Adds nothing to shared slots' },
];

const PREPARE_LEVEL_OPTIONS = [
  { id: '', label: 'No class level' },
  { id: 'full', label: 'Class level' },
  { id: 'half', label: 'Half class level (down)' },
  { id: 'halfUp', label: 'Half class level (up)' },
];

export function defaultSpellcasting() {
  return {
    ability: 'intelligence',
    style: 'prepared',
    slots: { progression: 'full' },
    prepare: { ability: true, level: 'full' },
    cantrips: [{ level: 1, known: 2 }],
  };
}

const emptyTable = () => Array.from({ length: 20 }, () => Array.from({ length: 9 }, () => 0));

/** One list of "from this level the total is N" steps. */
function Steps({ steps = [], onChange, label, noun }) {
  const set = (index, patch) => onChange(steps.map((step, at) => (at === index ? { ...step, ...patch } : step)));
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      {steps.map((step, index) => (
        <div key={index} className="fcb-custom-row" role="group" aria-label={`${label} step ${index + 1}`}>
          <Field label="From level">
            <NumberInput label={`${label} level ${index + 1}`} min={1} max={20} value={step.level} onChange={(level) => set(index, { level: level ?? 1 })} />
          </Field>
          <Field label={`${noun} known`}>
            <NumberInput label={`${label} known ${index + 1}`} min={0} max={99} value={step.known} onChange={(known) => set(index, { known: known ?? 0 })} />
          </Field>
          <RemoveButton label={`Remove ${label.toLowerCase()} step ${index + 1}`} onClick={() => onChange(steps.filter((_, at) => at !== index))} />
        </div>
      ))}
      <button
        type="button"
        className="fcb-mode-button"
        onClick={() => {
          const last = steps[steps.length - 1];
          onChange([...steps, { level: Math.min(20, (last?.level ?? 0) + 1), known: last?.known ?? 1 }]);
        }}
      >
        + Step
      </button>
    </div>
  );
}

function SlotTable({ value, onChange }) {
  const totals = slotTotals({ slots: value });
  return (
    <div className="fcb-progression-scroll">
      <table className="fcb-progression-table" aria-label="Spell slots by level">
        <thead>
          <tr>
            <th scope="col">Class level</th>
            {Array.from({ length: 9 }, (_, slot) => (
              <th key={slot} scope="col">{slot + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {totals.map((row, level) => (
            <tr key={level}>
              <th scope="row">{level + 1}</th>
              {row.map((count, slot) => (
                <td key={slot}>
                  <input
                    className="fcb-input fcb-progression-value"
                    type="number"
                    min="0"
                    max="9"
                    aria-label={`Slots of level ${slot + 1} at class level ${level + 1}`}
                    value={count}
                    onChange={(event) => {
                      const table = totals.map((entry) => [...entry]);
                      table[level][slot] = Math.max(0, Math.min(9, Math.trunc(Number(event.target.value)) || 0));
                      onChange({ ...value, table });
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The slots of a standard progression, read-only, so the author sees what Full or Third gives. */
function SlotPreview({ progression }) {
  const totals = slotTotals({ slots: { progression } });
  if (totals === null) {
    return <p className="fcb-muted-copy text-xs">Pact magic: one to four slots, all of the highest level, back after a short rest.</p>;
  }
  const first = totals.findIndex((row) => row.some((count) => count > 0)) + 1;
  const row = totals[19].map((count, slot) => (count > 0 ? `${count} of level ${slot + 1}` : null)).filter(Boolean);
  return (
    <p className="fcb-muted-copy text-xs" data-testid="hb-slot-preview">
      Slots start at class level {first}; at level 20 that is {row.join(', ')}.
    </p>
  );
}

/** A class' (or a subclass' own) caster. `value` is undefined when it does not cast. */
export default function SpellcastingPanel({ value, onChange, ownerName, subject = 'class', issues = [], attempted = false }) {
  if (!value) {
    return (
      <div className="space-y-2" data-testid="hb-spellcasting">
        <p className="fcb-muted-copy text-sm">This {subject} does not cast spells.</p>
        <button type="button" className="fcb-button" onClick={() => onChange(defaultSpellcasting())}>
          Give it spellcasting
        </button>
      </div>
    );
  }
  const patch = (next) => onChange({ ...value, ...next });
  const setStyle = (style) => {
    const next = { ...value, style };
    if (style === 'known') delete next.prepare;
    else if (!next.prepare) next.prepare = { ability: true, level: 'full' };
    if (style === 'prepared') delete next.spells;
    onChange(next);
  };
  const setProgression = (progression) => {
    const slots = { progression };
    if (progression === 'custom') slots.table = value.slots.table ?? emptyTable();
    patch({ slots, multiclassSlots: undefined });
  };
  const schoolFilter = value.listFilter?.kind === 'group' && value.listFilter.op === 'any' ? value.listFilter.items.map((item) => item.value) : [];
  const setSchools = (schools) =>
    patch({ listFilter: schools.length === 0 ? undefined : { kind: 'group', op: 'any', items: schools.map((school) => ({ kind: 'school', value: school })) } });
  const prepares = value.style !== 'known';
  const shown = attempted ? issues : [];

  return (
    <div className="space-y-4" data-testid="hb-spellcasting">
      <div className="fcb-custom-row">
        <Field label="Spellcasting ability">
          <SelectInput label="Spellcasting ability" value={value.ability} options={abilityOptions} onChange={(ability) => patch({ ability })} />
        </Field>
        <Field label="Caster name">
          <input
            className="fcb-input"
            aria-label="Caster name"
            placeholder={ownerName || 'The name of the class'}
            value={value.casterName ?? ''}
            onChange={(event) => patch({ casterName: event.target.value === '' ? undefined : event.target.value })}
          />
        </Field>
        <Field label="Spell list">
          <input
            className="fcb-input"
            aria-label="Spell list tag"
            placeholder={ownerName || 'The class list'}
            value={value.listTag ?? ''}
            onChange={(event) => patch({ listTag: event.target.value === '' ? undefined : event.target.value })}
          />
        </Field>
      </div>

      <div>
        <span className="fcb-field-label">Slots</span>
        <Segmented label="Slot progression" value={value.slots.progression} options={PROGRESSION_OPTIONS} onChange={setProgression} className="mt-1" />
        {value.slots.progression === 'custom' ? <SlotTable value={value.slots} onChange={(slots) => patch({ slots })} /> : <SlotPreview progression={value.slots.progression} />}
      </div>

      <div>
        <span className="fcb-field-label">Spells</span>
        <Segmented label="How spells are learned" value={value.style} options={STYLE_OPTIONS} onChange={setStyle} className="mt-1" />
        <div className="mt-2 flex flex-wrap gap-4">
          {value.style === 'known' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value.allowReplace === true} onChange={(event) => patch({ allowReplace: event.target.checked ? true : undefined })} />
              May swap one spell when gaining a level
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.ritual === true} onChange={(event) => patch({ ritual: event.target.checked ? true : undefined })} />
            Can cast rituals
          </label>
        </div>
      </div>

      <fieldset>
        <legend className="fcb-field-label">Only spells of these schools</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {SCHOOLS.map((school) => (
            <label key={school} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={schoolFilter.includes(school)}
                onChange={() => setSchools(schoolFilter.includes(school) ? schoolFilter.filter((entry) => entry !== school) : [...schoolFilter, school])}
              />
              {school}
            </label>
          ))}
        </div>
        <p className="fcb-muted-copy text-xs">Leave all unticked for the whole list.</p>
      </fieldset>

      {prepares && (
        <div className="fcb-custom-row" role="group" aria-label="Spells prepared">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.prepare?.ability !== false}
              onChange={(event) => patch({ prepare: { ...(value.prepare ?? {}), ability: event.target.checked } })}
            />
            Prepared: ability modifier
          </label>
          <Field label="plus">
            <SelectInput
              label="Prepared count from class level"
              value={value.prepare?.level ?? ''}
              options={PREPARE_LEVEL_OPTIONS}
              onChange={(level) => patch({ prepare: { ...(value.prepare ?? {}), level: level === '' ? undefined : level } })}
            />
          </Field>
        </div>
      )}

      <div>
        <span className="fcb-field-label">Cantrips known</span>
        <Steps steps={value.cantrips ?? []} onChange={(cantrips) => patch({ cantrips: cantrips.length > 0 ? cantrips : undefined })} label="Cantrips" noun="Cantrips" />
      </div>
      {value.style !== 'prepared' && (
        <div>
          <span className="fcb-field-label">{value.style === 'spellbook' ? 'Spells in the spellbook' : 'Spells known'}</span>
          <Steps steps={value.spells ?? []} onChange={(spells) => patch({ spells: spells.length > 0 ? spells : undefined })} label="Spells" noun="Spells" />
        </div>
      )}

      <Field label="Multiclassing">
        <SelectInput
          label="Counts toward shared slots"
          value={value.multiclassSlots ?? ''}
          options={SHARE_OPTIONS}
          onChange={(share) => patch({ multiclassSlots: share === '' ? undefined : share })}
        />
      </Field>

      <button type="button" className="fcb-button fcb-button-danger" onClick={() => onChange(undefined)}>
        Remove spellcasting
      </button>
      <Issues issues={shown} />
    </div>
  );
}

const SPELL_MODES = [
  { id: 'none', label: 'None' },
  { id: 'adds', label: 'Adds to the class' },
  { id: 'own', label: 'Casts on its own' },
];

/** A subclass' spells: none, an addition to its class' list, or a caster of its own. */
export function SubclassSpellsPanel({ draft, setDraft, lookup, issues = [], attempted = false }) {
  const mode = draft.spellcasting ? 'own' : draft.spells ? 'adds' : 'none';
  const parent = draft.parent?.name ?? '';
  const spells = draft.spells;
  const setSpells = (next) => setDraft((current) => ({ ...current, spells: next }));
  const setMode = (next) =>
    setDraft((current) => {
      const { spells: _spells, spellcasting: _spellcasting, ...rest } = current;
      if (next === 'adds') return { ...rest, spells: { caster: parent, alwaysPrepared: [], addToList: [] } };
      if (next === 'own') return { ...rest, spellcasting: { ...defaultSpellcasting(), style: 'known', prepare: undefined, slots: { progression: 'third' }, cantrips: [], listTag: parent } };
      return rest;
    });
  const shown = attempted ? issues.filter((issue) => issue.path.startsWith('spell')) : [];

  return (
    <div className="space-y-4" data-testid="hb-subclass-spells">
      <div>
        <span className="fcb-field-label">This subclass</span>
        <Segmented label="Subclass spells" value={mode} options={SPELL_MODES} onChange={setMode} className="mt-1" />
      </div>

      {mode === 'adds' && spells && (
        <div className="space-y-4">
          <div className="fcb-custom-row">
            <Field label="Class spellcasting">
              <input
                className="fcb-input"
                aria-label="Class spellcasting feature"
                placeholder="Wizard"
                value={spells.caster}
                onChange={(event) => setSpells({ ...spells, caster: event.target.value })}
              />
            </Field>
            <Field label="Class spell list">
              <input
                className="fcb-input"
                aria-label="Class spell list tag"
                placeholder={parent}
                value={spells.listTag ?? ''}
                onChange={(event) => setSpells({ ...spells, listTag: event.target.value === '' ? undefined : event.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-2" role="group" aria-label="Always prepared spells">
            <span className="fcb-field-label">Always prepared</span>
            {spells.alwaysPrepared.map((entry, index) => (
              <div key={index} className="fcb-custom-row" role="group" aria-label={`Always prepared spell ${index + 1}`}>
                <Field label="At class level">
                  <NumberInput
                    label={`Always prepared level ${index + 1}`}
                    min={1}
                    max={20}
                    value={entry.level}
                    onChange={(level) => setSpells({ ...spells, alwaysPrepared: spells.alwaysPrepared.map((item, at) => (at === index ? { ...item, level: level ?? 1 } : item)) })}
                  />
                </Field>
                <div>
                  <span className="fcb-field-label">Spell</span>
                  <LibraryPicker
                    lookup={lookup}
                    type="Spell"
                    label={`Find always prepared spell ${index + 1}`}
                    value={entry.spell.id}
                    valueLabel={entry.spell.label}
                    onPick={(item) =>
                      setSpells({ ...spells, alwaysPrepared: spells.alwaysPrepared.map((other, at) => (at === index ? { ...other, spell: { id: item.id, label: item.name } } : other)) })
                    }
                  />
                </div>
                <RemoveButton
                  label={`Remove always prepared spell ${index + 1}`}
                  onClick={() => setSpells({ ...spells, alwaysPrepared: spells.alwaysPrepared.filter((_, at) => at !== index) })}
                />
              </div>
            ))}
            <button
              type="button"
              className="fcb-mode-button"
              onClick={() => setSpells({ ...spells, alwaysPrepared: [...spells.alwaysPrepared, { level: 3, spell: { id: '' } }] })}
            >
              + Spell
            </button>
          </div>

          <div className="space-y-2" role="group" aria-label="Spells added to the class list">
            <span className="fcb-field-label">Add to the {parent || 'class'} list</span>
            {spells.addToList.map((entry, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <LibraryPicker
                    lookup={lookup}
                    type="Spell"
                    label={`Find spell ${index + 1} to add to the list`}
                    value={entry.id}
                    valueLabel={entry.label}
                    onPick={(item) => setSpells({ ...spells, addToList: spells.addToList.map((other, at) => (at === index ? { id: item.id, label: item.name } : other)) })}
                  />
                </div>
                <RemoveButton label={`Remove list spell ${index + 1}`} onClick={() => setSpells({ ...spells, addToList: spells.addToList.filter((_, at) => at !== index) })} />
              </div>
            ))}
            <button type="button" className="fcb-mode-button" onClick={() => setSpells({ ...spells, addToList: [...spells.addToList, { id: '' }] })}>
              + Spell for the list
            </button>
            <p className="fcb-muted-copy text-xs">Any {parent || 'class'} can learn a spell added here, not only this subclass.</p>
          </div>
        </div>
      )}

      {mode === 'own' && (
        <SpellcastingPanel
          value={draft.spellcasting}
          ownerName={draft.name}
          subject="subclass"
          issues={issues}
          attempted={attempted}
          onChange={(next) => setDraft((current) => ({ ...current, spellcasting: next }))}
        />
      )}
      <Issues issues={shown} />
    </div>
  );
}
