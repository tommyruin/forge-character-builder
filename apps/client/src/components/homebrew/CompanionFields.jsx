// A companion's tabs. Basics: the stat block (size, type, alignment, challenge, armor class, hit
// points, speeds, the six abilities and the lines under them) and the statistics that follow the
// owner. Traits and actions: the entries a stat block lists. A familiar, a beast or a sidekick is
// the same element; the tag picks which pickers offer it.

import { COMPANION_STAT_TARGETS, CREATURE_SIZES, CUSTOM_ABILITIES, newCustomBlockId } from '@forge-cb/engine/custom';
import TagPicker from '../custom/TagPicker';
import { ValueEditor } from '../custom/ModifierBlock';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from '../custom/fields';
import { ABILITY_LABELS } from '../custom/draftModel';

const SIZE_OPTIONS = CREATURE_SIZES.map((size) => ({ id: size, label: size }));
const SPEED_MODE_OPTIONS = ['fly', 'swim', 'climb', 'burrow'].map((mode) => ({ id: mode, label: mode[0].toUpperCase() + mode.slice(1) }));

const STAT_LABELS = {
  'companion:ac': 'Armor class',
  'companion:attack': 'Attack bonus',
  'companion:damage': 'Damage bonus',
  'companion:proficiency': 'Proficiency bonus',
  'companion:initiative': 'Initiative',
  'companion:hp:max': 'Hit point maximum',
};
const STAT_OPTIONS = COMPANION_STAT_TARGETS.map((id) => ({ id, label: STAT_LABELS[id] }));

const TEXT_LINES = [
  ['senses', 'Senses', 'darkvision 30 ft.'],
  ['languages', 'Languages', 'understands Common'],
  ['skills', 'Skills', 'Perception +3'],
  ['saves', 'Saving throws', 'Dex +4'],
  ['resistances', 'Damage resistances', 'fire'],
  ['immunities', 'Damage immunities', 'poison'],
  ['vulnerabilities', 'Damage vulnerabilities', 'cold'],
  ['conditionImmunities', 'Condition immunities', 'poisoned'],
];

const KINDS = [
  ['traits', 'Traits', 'trait'],
  ['actions', 'Actions', 'action'],
  ['reactions', 'Reactions', 'reaction'],
];

export function CompanionBasics({ draft, setDraft, issues = [], attempted = false }) {
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const speeds = draft.speeds ?? [];
  const setSpeeds = (next) => patch({ speeds: next.length > 0 ? next : undefined });
  const text = (key, value) => patch({ [key]: value === '' ? undefined : value });
  const stats = draft.stats;
  const setStat = (id, next) => patch({ stats: stats.map((stat) => (stat.id === id ? next : stat)) });
  const shown = attempted ? issues.filter((issue) => !/^(traits|actions|reactions)/.test(issue.path)) : [];

  return (
    <div className="space-y-4" data-testid="hb-companion-basics">
      <div>
        <span className="fcb-field-label">Offered by pickers tagged</span>
        <TagPicker label="Companion tags" value={draft.tags ?? []} suggestions={['Familiar']} onChange={(tags) => patch({ tags: tags.length > 0 ? tags : undefined })} />
      </div>
      <div className="fcb-custom-row">
        <Field label="Size">
          <SelectInput label="Size" value={draft.size} options={SIZE_OPTIONS} onChange={(size) => patch({ size })} />
        </Field>
        <Field label="Creature type">
          <input className="fcb-input" aria-label="Creature type" value={draft.creatureType} onChange={(event) => patch({ creatureType: event.target.value })} />
        </Field>
        <Field label="Alignment">
          <input className="fcb-input" aria-label="Alignment" value={draft.alignment} onChange={(event) => patch({ alignment: event.target.value })} />
        </Field>
        <Field label="Challenge">
          <input className="fcb-input" aria-label="Challenge" placeholder="1/2" value={draft.challenge} onChange={(event) => patch({ challenge: event.target.value })} />
        </Field>
      </div>
      <div className="fcb-custom-row">
        <Field label="Armor class">
          <NumberInput label="Armor class" min={0} max={40} value={draft.armorClass} onChange={(armorClass) => patch({ armorClass: armorClass ?? 0 })} />
        </Field>
        <Field label="Hit points">
          <NumberInput label="Hit points" min={0} max={9999} value={draft.hitPoints} onChange={(hitPoints) => patch({ hitPoints: hitPoints ?? 0 })} />
        </Field>
        <Field label="Printed hit points">
          <input className="fcb-input" aria-label="Printed hit points" placeholder="19 (3d8+6)" value={draft.hitPointsText ?? ''} onChange={(event) => text('hitPointsText', event.target.value)} />
        </Field>
        <Field label="Walking speed (ft.)">
          <NumberInput label="Walking speed" min={0} max={300} value={draft.speed} onChange={(speed) => patch({ speed: speed ?? 0 })} />
        </Field>
      </div>

      <div className="space-y-2" role="group" aria-label="Other speeds">
        <span className="fcb-field-label">Other speeds</span>
        {speeds.map((speed, index) => (
          <div key={index} className="fcb-custom-row" role="group" aria-label={`Speed ${index + 1}`}>
            <Field label="Kind">
              <SelectInput label={`Speed kind ${index + 1}`} value={speed.mode} options={SPEED_MODE_OPTIONS} onChange={(mode) => setSpeeds(speeds.map((entry, at) => (at === index ? { ...entry, mode } : entry)))} />
            </Field>
            <Field label="Feet">
              <NumberInput label={`Speed feet ${index + 1}`} min={5} max={300} value={speed.feet} onChange={(feet) => setSpeeds(speeds.map((entry, at) => (at === index ? { ...entry, feet: feet ?? 30 } : entry)))} />
            </Field>
            <RemoveButton label={`Remove speed ${index + 1}`} onClick={() => setSpeeds(speeds.filter((_, at) => at !== index))} />
          </div>
        ))}
        {speeds.length < SPEED_MODE_OPTIONS.length && (
          <button type="button" className="fcb-mode-button" onClick={() => setSpeeds([...speeds, { mode: SPEED_MODE_OPTIONS.find((o) => !speeds.some((s) => s.mode === o.id)).id, feet: 30 }])}>
            + Speed
          </button>
        )}
      </div>

      <div className="fcb-custom-row" role="group" aria-label="Ability scores">
        {CUSTOM_ABILITIES.map((ability) => (
          <Field key={ability} label={ABILITY_LABELS[ability]}>
            <NumberInput label={`${ABILITY_LABELS[ability]} score`} min={1} max={30} value={draft.abilities[ability]} onChange={(score) => patch({ abilities: { ...draft.abilities, [ability]: score ?? 10 } })} />
          </Field>
        ))}
      </div>

      <div className="fcb-custom-row">
        {TEXT_LINES.map(([key, label, placeholder]) => (
          <Field key={key} label={label}>
            <input className="fcb-input" aria-label={label} placeholder={placeholder} value={draft[key] ?? ''} onChange={(event) => text(key, event.target.value)} />
          </Field>
        ))}
      </div>

      <div className="space-y-2" role="group" aria-label="Statistics that follow the owner">
        <span className="fcb-field-label">Statistics that follow its owner</span>
        {stats.map((stat, index) => (
          <div key={stat.id} className="fcb-custom-block" role="group" aria-label={`Companion statistic ${index + 1}`}>
            <div className="fcb-custom-row">
              <Field label="Statistic">
                <SelectInput
                  label={`Companion statistic ${index + 1} is`}
                  value={stat.target}
                  options={STAT_OPTIONS}
                  onChange={(target) => setStat(stat.id, { ...stat, target, mode: target === 'companion:hp:max' ? stat.mode : 'add' })}
                />
              </Field>
              {stat.target === 'companion:hp:max' && (
                <Field label="How">
                  <SelectInput
                    label={`Companion statistic ${index + 1} mode`}
                    value={stat.mode}
                    options={[
                      { id: 'add', label: 'Add' },
                      { id: 'set', label: 'Set at least' },
                    ]}
                    onChange={(mode) => setStat(stat.id, { ...stat, mode })}
                  />
                </Field>
              )}
              <RemoveButton label={`Remove companion statistic ${index + 1}`} onClick={() => patch({ stats: stats.filter((entry) => entry.id !== stat.id) })} />
            </div>
            <ValueEditor label={`Companion statistic ${index + 1} value`} value={stat.value} onChange={(value) => setStat(stat.id, { ...stat, value })} />
          </div>
        ))}
        <button
          type="button"
          className="fcb-mode-button"
          onClick={() => patch({ stats: [...stats, { id: newCustomBlockId(), target: 'companion:attack', mode: 'add', value: { kind: 'reference', ref: 'proficiency' } }] })}
        >
          + Statistic
        </button>
      </div>
      <Issues issues={shown} />
    </div>
  );
}

export function CompanionEntries({ draft, setDraft, issues = [], attempted = false }) {
  const setList = (key, next) => setDraft((current) => ({ ...current, [key]: next }));
  const shown = attempted ? issues.filter((issue) => /^(traits|actions|reactions)/.test(issue.path)) : [];
  return (
    <div className="space-y-4" data-testid="hb-companion-entries">
      {KINDS.map(([key, heading, noun]) => (
        <section key={key} className="space-y-2" role="group" aria-label={heading}>
          <h4 className="fcb-field-label">{heading}</h4>
          {draft[key].map((entry, index) => (
            <div key={entry.id} className="fcb-custom-block" role="group" aria-label={`${noun[0].toUpperCase() + noun.slice(1)} ${index + 1}`}>
              <div className="fcb-custom-row">
                <Field label="Name">
                  <input
                    className="fcb-input"
                    aria-label={`${noun[0].toUpperCase() + noun.slice(1)} ${index + 1} name`}
                    value={entry.name}
                    onChange={(event) => setList(key, draft[key].map((other) => (other.id === entry.id ? { ...other, name: event.target.value } : other)))}
                  />
                </Field>
                <RemoveButton label={`Remove ${noun} ${index + 1}`} onClick={() => setList(key, draft[key].filter((other) => other.id !== entry.id))} />
              </div>
              <Field label="Text">
                <textarea
                  className="fcb-textarea"
                  aria-label={`${noun[0].toUpperCase() + noun.slice(1)} ${index + 1} text`}
                  rows={3}
                  value={entry.text}
                  onChange={(event) => setList(key, draft[key].map((other) => (other.id === entry.id ? { ...other, text: event.target.value } : other)))}
                />
              </Field>
            </div>
          ))}
          <button type="button" className="fcb-mode-button" onClick={() => setList(key, [...draft[key], { id: newCustomBlockId(), name: '', text: '' }])}>
            + {noun[0].toUpperCase() + noun.slice(1)}
          </button>
        </section>
      ))}
      <Issues issues={shown} />
    </div>
  );
}
