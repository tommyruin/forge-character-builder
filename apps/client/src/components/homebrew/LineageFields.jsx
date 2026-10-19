// The Basics of a species and of a subspecies: size and speeds, senses, languages, the ability
// increases, whether the species offers a subspecies, and, under Advanced, the names, height and
// weight the appearance suggestions read. A subspecies has the same fields except size and walking
// speed, which it inherits from its species (it can add to the speed).

import { CREATURE_SIZES, CUSTOM_ABILITIES, SPEED_MODES } from '@forge-cb/engine/custom';
import LibraryPicker from '../custom/LibraryPicker';
import { Field, Issues, NumberInput, RemoveButton, Segmented, SelectInput } from '../custom/fields';
import { ABILITY_LABELS, abilityOptions } from '../custom/draftModel';

const SIZE_OPTIONS = CREATURE_SIZES.map((size) => ({ id: size, label: size }));
const SPEED_MODE_OPTIONS = SPEED_MODES.map((mode) => ({ id: mode, label: mode[0].toUpperCase() + mode.slice(1) }));
const FROM_OPTIONS = [
  { id: 'standard', label: 'The common languages' },
  { id: 'any', label: 'Any language' },
];
const KIND_OPTIONS = [
  { id: 'Sub Race', label: 'Subrace (required)' },
  { id: 'Race Variant', label: 'Variant (optional)' },
];

/** A removable list of library picks (senses, languages). */
function PickList({ label, type, picks = [], onChange, lookup, noun }) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      {picks.map((pick, index) => (
        <div key={`${pick.id}-${index}`} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <LibraryPicker
              lookup={lookup}
              type={type}
              label={`Find ${noun} ${index + 1}`}
              value={pick.id}
              valueLabel={pick.label}
              onPick={(item) => onChange(picks.map((entry, at) => (at === index ? { id: item.id, label: item.name } : entry)))}
            />
          </div>
          <RemoveButton label={`Remove ${noun} ${index + 1}`} onClick={() => onChange(picks.filter((_, at) => at !== index))} />
        </div>
      ))}
      <button type="button" className="fcb-mode-button" onClick={() => onChange([...picks, { id: '' }])}>
        + {noun[0].toUpperCase() + noun.slice(1)}
      </button>
    </div>
  );
}

function Appearance({ value = {}, onChange }) {
  const names = value.names ?? {};
  const setNames = (kind, text) => {
    const next = { ...names };
    if (text.trim() === '') delete next[kind];
    else next[kind] = text;
    onChange({ ...value, names: Object.keys(next).length > 0 ? next : undefined });
  };
  const setDim = (field, patch) => {
    const next = { ...(value[field] ?? { base: '', modifier: '' }), ...patch };
    onChange({ ...value, [field]: next.base === '' && next.modifier === '' ? undefined : next });
  };
  return (
    <div className="space-y-3" data-testid="hb-appearance">
      <p className="fcb-muted-copy text-xs">These feed the name, height and weight suggestions on the Details tab. Leave them empty to use the general lists.</p>
      <div className="fcb-custom-row">
        {[
          ['male', 'Male names'],
          ['female', 'Female names'],
          ['child', 'Child names'],
          ['family', 'Family names'],
        ].map(([kind, label]) => (
          <Field key={kind} label={label}>
            <input className="fcb-input" aria-label={label} placeholder="Comma-separated" value={names[kind] ?? ''} onChange={(event) => setNames(kind, event.target.value)} />
          </Field>
        ))}
        <Field label="Name format">
          <input
            className="fcb-input"
            aria-label="Name format"
            placeholder="{{name}} {{family}}"
            value={value.namesFormat ?? ''}
            onChange={(event) => onChange({ ...value, namesFormat: event.target.value === '' ? undefined : event.target.value })}
          />
        </Field>
      </div>
      <div className="fcb-custom-row">
        <Field label="Shortest height">
          <input className="fcb-input" aria-label="Height base" placeholder={`4'6"`} value={value.height?.base ?? ''} onChange={(event) => setDim('height', { base: event.target.value })} />
        </Field>
        <Field label="Height roll">
          <input className="fcb-input" aria-label="Height roll" placeholder="2d10" value={value.height?.modifier ?? ''} onChange={(event) => setDim('height', { modifier: event.target.value })} />
        </Field>
        <Field label="Lightest weight">
          <input className="fcb-input" aria-label="Weight base" placeholder="90 lb." value={value.weight?.base ?? ''} onChange={(event) => setDim('weight', { base: event.target.value })} />
        </Field>
        <Field label="Weight roll">
          <input className="fcb-input" aria-label="Weight roll" placeholder="1d4" value={value.weight?.modifier ?? ''} onChange={(event) => setDim('weight', { modifier: event.target.value })} />
        </Field>
      </div>
    </div>
  );
}

export default function LineageFields({ draft, setDraft, services, issues = [], attempted = false }) {
  const isSpecies = draft.template === 'species';
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const languages = draft.languages ?? { grants: [], choices: 0 };
  const setLanguages = (next) => patch({ languages: next.grants.length === 0 && next.choices === 0 ? undefined : next });
  const bonuses = draft.abilityBonuses ?? [];
  const setBonuses = (next) => patch({ abilityBonuses: next.length > 0 ? next : undefined });
  const speeds = draft.speeds ?? [];
  const setSpeeds = (next) => patch({ speeds: next.length > 0 ? next : undefined });
  const choice = draft.abilityChoice;
  const chosen = choice?.from ?? CUSTOM_ABILITIES;
  const offer = draft.subspecies;
  const shown = attempted ? issues.filter((issue) => !/^(features|choices|scales|blocks)/.test(issue.path)) : [];
  const is2024 = draft.ruleset === '2024';

  return (
    <div className="space-y-4" data-testid="hb-lineage">
      {isSpecies ? (
        <div className="fcb-custom-row">
          <Field label="Size">
            <SelectInput label="Size" value={draft.size} options={SIZE_OPTIONS} onChange={(size) => patch({ size })} />
          </Field>
          <Field label="Walking speed (ft.)">
            <NumberInput label="Walking speed" min={0} max={300} value={draft.speed} onChange={(speed) => patch({ speed: speed ?? 0 })} />
          </Field>
        </div>
      ) : (
        <Field label="Added to the walking speed (ft.)">
          <NumberInput label="Speed bonus" min={-30} max={60} value={draft.speedBonus} onChange={(speedBonus) => patch({ speedBonus: speedBonus === 0 ? undefined : speedBonus })} />
        </Field>
      )}

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
        {speeds.length < SPEED_MODES.length && (
          <button
            type="button"
            className="fcb-mode-button"
            onClick={() => setSpeeds([...speeds, { mode: SPEED_MODES.find((mode) => !speeds.some((entry) => entry.mode === mode)), feet: 30 }])}
          >
            + Speed
          </button>
        )}
      </div>

      <div>
        <span className="fcb-field-label">Senses</span>
        <PickList label="Senses" type="Vision" noun="sense" picks={draft.vision} lookup={services.lookup} onChange={(vision) => patch({ vision: vision.length > 0 ? vision : undefined })} />
      </div>

      <div className="space-y-2" role="group" aria-label="Languages">
        <span className="fcb-field-label">Languages</span>
        <PickList
          label="Known languages"
          type="Language"
          noun="language"
          picks={languages.grants}
          lookup={services.lookup}
          onChange={(grants) => setLanguages({ ...languages, grants })}
        />
        <div className="fcb-custom-row">
          <Field label="The player also picks">
            <NumberInput label="Languages the player picks" min={0} max={10} value={languages.choices} onChange={(choices) => setLanguages({ ...languages, choices: choices ?? 0 })} />
          </Field>
          <Field label="From">
            <SelectInput label="Languages offered" value={languages.from ?? 'standard'} options={FROM_OPTIONS} onChange={(from) => setLanguages({ ...languages, from })} />
          </Field>
        </div>
      </div>

      <div className="space-y-2" role="group" aria-label="Ability scores">
        <span className="fcb-field-label">Ability scores</span>
        {is2024 ? (
          <p className="fcb-muted-copy text-xs">2024 species take no ability increase: the background supplies it. Switch the rules version to 2014 or both to set one here.</p>
        ) : (
          <>
            {bonuses.map((bonus, index) => (
              <div key={index} className="fcb-custom-row" role="group" aria-label={`Ability increase ${index + 1}`}>
                <Field label="Ability">
                  <SelectInput
                    label={`Increase ability ${index + 1}`}
                    value={bonus.ability}
                    options={abilityOptions}
                    onChange={(ability) => setBonuses(bonuses.map((entry, at) => (at === index ? { ...entry, ability } : entry)))}
                  />
                </Field>
                <Field label="Increase by">
                  <NumberInput label={`Increase amount ${index + 1}`} min={-4} max={4} value={bonus.amount} onChange={(amount) => setBonuses(bonuses.map((entry, at) => (at === index ? { ...entry, amount: amount || 1 } : entry)))} />
                </Field>
                <RemoveButton label={`Remove ability increase ${index + 1}`} onClick={() => setBonuses(bonuses.filter((_, at) => at !== index))} />
              </div>
            ))}
            <button
              type="button"
              className="fcb-mode-button"
              onClick={() => setBonuses([...bonuses, { ability: CUSTOM_ABILITIES.find((ability) => !bonuses.some((entry) => entry.ability === ability)) ?? 'strength', amount: 1 }])}
            >
              + Ability increase
            </button>
            <div className="fcb-custom-row">
              <Field label="Points the player assigns">
                <NumberInput
                  label="Points the player assigns"
                  min={0}
                  max={6}
                  value={choice?.picks ?? 0}
                  onChange={(picks) => patch({ abilityChoice: picks ? { ...(choice ?? {}), picks } : undefined })}
                />
              </Field>
            </div>
            {choice && (
              <fieldset>
                <legend className="fcb-field-label">They can assign them to</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {CUSTOM_ABILITIES.map((ability) => (
                    <label key={ability} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={chosen.includes(ability)}
                        onChange={() => {
                          const next = chosen.includes(ability) ? chosen.filter((entry) => entry !== ability) : [...chosen, ability];
                          patch({ abilityChoice: { ...choice, from: next.length === CUSTOM_ABILITIES.length || next.length === 0 ? undefined : next } });
                        }}
                      />
                      {ABILITY_LABELS[ability]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
      </div>

      {isSpecies && (
        <div className="space-y-2" role="group" aria-label="Subspecies">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={Boolean(offer)}
              onChange={(event) => patch({ subspecies: event.target.checked ? { kind: 'Sub Race' } : undefined })}
            />
            Players pick a subspecies or variant
          </label>
          {offer && (
            <>
              <Segmented label="Subspecies kind" value={offer.kind} options={KIND_OPTIONS} onChange={(kind) => patch({ subspecies: { ...offer, kind } })} />
              <div className="fcb-custom-row">
                <Field label="Subspecies answer to the tag">
                  <input
                    className="fcb-input"
                    aria-label="Subspecies tag"
                    placeholder={draft.name || 'The species name'}
                    value={offer.tag ?? ''}
                    onChange={(event) => patch({ subspecies: { ...offer, tag: event.target.value === '' ? undefined : event.target.value } })}
                  />
                </Field>
                <Field label="Name of the pick">
                  <input
                    className="fcb-input"
                    aria-label="Subspecies pick name"
                    value={offer.label ?? ''}
                    onChange={(event) => patch({ subspecies: { ...offer, label: event.target.value === '' ? undefined : event.target.value } })}
                  />
                </Field>
              </div>
              <p className="fcb-muted-copy text-xs">
                A subspecies made in this pack for this species uses the tag{' '}
                <strong>{offer.tag?.trim() || draft.name.trim() || 'above'}</strong>. Keep it steady once subspecies exist.
              </p>
            </>
          )}
        </div>
      )}

      <details className="fcb-homebrew-advanced" data-testid="hb-lineage-advanced">
        <summary>Advanced: names, height and weight</summary>
        <div className="fcb-homebrew-advanced-grid">
          <Appearance value={draft.appearance} onChange={(appearance) => patch({ appearance: appearance.names || appearance.namesFormat || appearance.height || appearance.weight ? appearance : undefined })} />
        </div>
      </details>
      <Issues issues={shown} />
    </div>
  );
}
