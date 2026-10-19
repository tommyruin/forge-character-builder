// The "Create spell" dialog behind Magic's Add a spell and a missing spell's fix: one form that
// makes (or edits) a spell for a character without XML. It asks for what a spell block holds (level,
// school, time, range, duration, components), what the spell rolls (a spell attack, or a saving
// throw, with its damage, healing and how it grows) and which class lists carry it. The draft that
// results is stored in the character file and compiled to an ordinary Spell element.
//
// The engine reads the roll, the save and the damage from these fields, so the numbers never depend
// on how the text is worded. The attack row is worked out by the engine on a scratch copy of the
// character, so the numbers are never a second implementation in the browser.

import { useEffect, useMemo, useState } from 'react';
import { customEntryIssues } from '@forge-cb/engine/custom';
import Modal from '../Modal';
import { Field, Issues, NumberInput, RemoveButton, Segmented, SelectInput } from './fields';
import {
  CASTING_TIME_PRESETS,
  DAMAGE_TYPE_OPTIONS,
  DURATION_PRESETS,
  RANGE_PRESETS,
  ROLL_OPTIONS,
  SPELL_LEVEL_OPTIONS,
  SPELL_SCHOOL_OPTIONS,
  abilityOptions,
  makeSpellDraft,
  summarizeSpell,
  tidySpell,
} from './draftModel';

// The class lists a spell can join, in book order; a draft that names another keeps it.
const CLASS_LISTS = ['Artificer', 'Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];
const NO_GRANT = '__list';
const SCALING_NONE = [{ id: 'none', label: 'None' }];

function DamageRows({ terms, onChange }) {
  const set = (index, patch) => onChange(terms.map((term, at) => (at === index ? { ...term, ...patch } : term)));
  return (
    <div className="space-y-2" role="group" aria-label="Damage">
      {terms.map((term, index) => (
        <div key={index} className="fcb-custom-row">
          <Field label="Damage">
            <input
              className="fcb-input"
              aria-label={`Damage dice ${index + 1}`}
              placeholder="2d8"
              value={term.dice}
              onChange={(event) => set(index, { dice: event.target.value.trim() })}
            />
          </Field>
          <Field label="Damage type">
            <SelectInput
              label={`Damage type ${index + 1}`}
              value={term.type}
              options={DAMAGE_TYPE_OPTIONS}
              onChange={(type) => set(index, { type })}
            />
          </Field>
          <RemoveButton label={`Remove damage ${index + 1}`} onClick={() => onChange(terms.filter((_, at) => at !== index))} />
        </div>
      ))}
      {terms.length < 4 && (
        <button type="button" className="fcb-mode-button" onClick={() => onChange([...terms, { dice: '', type: 'fire' }])}>
          + Damage
        </button>
      )}
    </div>
  );
}

function CantripTiers({ tiers, onChange }) {
  const set = (index, patch) => onChange(tiers.map((tier, at) => (at === index ? { ...tier, ...patch } : tier)));
  return (
    <div className="space-y-2" role="group" aria-label="Level tiers">
      <p className="fcb-muted-copy text-xs">
        From each character level, the first damage die becomes the one given here (a cantrip usually grows at levels 5, 11 and 17).
      </p>
      {tiers.map((tier, index) => (
        <div key={index} className="fcb-custom-row">
          <Field label="At character level">
            <NumberInput label={`Tier level ${index + 1}`} min={2} max={20} value={tier.level} onChange={(level) => set(index, { level: level ?? 5 })} />
          </Field>
          <Field label="Damage becomes">
            <input
              className="fcb-input"
              aria-label={`Tier dice ${index + 1}`}
              placeholder="2d10"
              value={tier.dice}
              onChange={(event) => set(index, { dice: event.target.value.trim() })}
            />
          </Field>
          <RemoveButton label={`Remove tier ${index + 1}`} onClick={() => onChange(tiers.filter((_, at) => at !== index))} />
        </div>
      ))}
      {tiers.length < 6 && (
        <button
          type="button"
          className="fcb-mode-button"
          onClick={() => onChange([...tiers, { level: tiers.length === 0 ? 5 : Math.min(20, (tiers[tiers.length - 1].level ?? 5) + 6), dice: '' }])}
        >
          + Tier
        </button>
      )}
    </div>
  );
}

export default function CustomSpellModal({
  services,
  characterName,
  entry = null,
  initialDraft = null,
  defaultCaster = null,
  pack = null,
  onClose,
  onSaved,
}) {
  const editing = entry !== null;
  const [draft, setDraft] = useState(() =>
    entry ? structuredClone(entry.draft) : { ...makeSpellDraft(initialDraft?.name ?? ''), ...(initialDraft?.id ? { id: initialDraft.id } : {}) },
  );
  const [casters, setCasters] = useState(null);
  const [castWith, setCastWith] = useState(null);
  const [promote, setPromote] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [preview, setPreview] = useState({ key: null, attack: null, error: null });

  useEffect(() => {
    let alive = true;
    services
      .casters()
      .then((names) => {
        if (alive) setCasters(names ?? []);
      })
      .catch(() => {
        if (alive) setCasters([]);
      });
    return () => {
      alive = false;
    };
  }, [services]);

  // Who casts it: the caster the dialog was opened from when the character has it, else the first
  // class caster, else no class caster (the spell then gathers under Additional Spells).
  const known = casters ?? [];
  const defaultCastWith = defaultCaster && known.includes(defaultCaster) ? defaultCaster : (known[0] ?? '');
  const chosenCaster = castWith ?? defaultCastWith;
  const grants = chosenCaster !== NO_GRANT;
  const previewCaster = grants && chosenCaster !== '' ? chosenCaster : undefined;

  const tidied = useMemo(() => tidySpell(draft), [draft]);
  const issues = useMemo(() => customEntryIssues(tidied), [tidied]);
  const topIssues = attempted ? issues : [];
  const summary = summarizeSpell(tidied);
  const mechanics = draft.mechanics ?? { roll: 'none' };
  const roll = mechanics.roll;
  const isCantrip = draft.level === 0;

  // The attack row waits for the author to pause, and only runs for a draft the engine accepts.
  const previewKey =
    roll !== 'none' && pack === null && issues.length === 0 && casters !== null ? `${previewCaster ?? ''}:${JSON.stringify(tidied)}` : null;
  useEffect(() => {
    if (previewKey === null) return undefined;
    let alive = true;
    const handle = setTimeout(() => {
      Promise.resolve(services.previewSpell?.(tidied, previewCaster))
        .then((result) => {
          if (alive) setPreview({ key: previewKey, attack: result?.attack ?? null, error: null });
        })
        .catch((e) => {
          if (alive) setPreview({ key: previewKey, attack: null, error: e?.message ?? 'The preview failed.' });
        });
    }, services.previewDelayMs ?? 400);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
    // `tidied` is the parsed form of `previewKey`; the key alone says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, services]);

  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const patchMechanics = (next) => setDraft((current) => ({ ...current, mechanics: { ...(current.mechanics ?? { roll: 'none' }), ...next } }));
  const patchComponents = (next) => setDraft((current) => ({ ...current, components: { ...current.components, ...next } }));
  const damage = mechanics.damage ?? [];
  const scaling = mechanics.scaling;

  const setLevel = (value) => {
    const level = Number(value);
    // A cantrip grows with the caster's level and a spell with its slot; the other kind no longer applies.
    const kind = scaling?.kind;
    const stale = (level === 0 && kind === 'slot') || (level > 0 && kind === 'cantrip');
    setDraft((current) => ({
      ...current,
      level,
      mechanics: { ...(current.mechanics ?? { roll: 'none' }), ...(stale ? { scaling: undefined } : {}) },
    }));
  };

  const setScalingKind = (kind) => {
    if (kind === 'none') patchMechanics({ scaling: undefined });
    else if (kind === 'cantrip') patchMechanics({ scaling: { kind: 'cantrip', tiers: scaling?.kind === 'cantrip' ? scaling.tiers : [] } });
    else patchMechanics({ scaling: { kind: 'slot', dice: scaling?.kind === 'slot' ? scaling.dice : '' } });
  };

  const toggleClass = (name) => {
    const current = draft.classes ?? [];
    patch({ classes: current.includes(name) ? current.filter((entryName) => entryName !== name) : [...current, name] });
  };

  const write = async () => {
    setSaving(true);
    setError(null);
    let result;
    try {
      const options = {};
      if (!editing && pack === null) {
        if (!grants) options.grant = false;
        else if (chosenCaster !== '') options.caster = chosenCaster;
      }
      result = await services.save(tidied, options);
    } catch (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    if (promote && pack === null) {
      try {
        await services.promote(tidied);
      } catch (e) {
        setError(`Saved to ${characterName}, but could not copy it to a homebrew pack: ${e.message}`);
        setSaving(false);
        onSaved?.(result?.entry ?? null);
        return;
      }
    }
    setSaving(false);
    onSaved?.(result?.entry ?? null);
    onClose();
  };

  const submit = async () => {
    setAttempted(true);
    if (issues.length > 0) return;
    await write();
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await services.remove(draft.id);
    } catch (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved?.(null);
    onClose();
  };

  const attack = preview.key === previewKey ? preview.attack : null;
  const previewPending = previewKey !== null && preview.key !== previewKey;
  const scalingOptions = [
    ...SCALING_NONE,
    ...(isCantrip ? [{ id: 'cantrip', label: 'By character level' }] : [{ id: 'slot', label: 'Per slot level' }]),
  ];
  const classLists = [...CLASS_LISTS, ...(draft.classes ?? []).filter((name) => !CLASS_LISTS.includes(name))];
  const material = draft.components?.material === true;
  const dealsDamageOrHeals = damage.length > 0 || Boolean(mechanics.healing?.trim());

  return (
    <Modal open title={editing ? 'Edit custom spell' : 'Create spell'} onClose={onClose} size="wide">
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="fcb-custom-row">
          <Field label="Name">
            <input
              className="fcb-input"
              aria-label="Name"
              autoFocus
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field label="Level">
            <SelectInput label="Level" value={String(draft.level)} options={SPELL_LEVEL_OPTIONS} onChange={setLevel} />
          </Field>
          <Field label="School">
            <SelectInput label="School" value={draft.school} options={SPELL_SCHOOL_OPTIONS} onChange={(school) => patch({ school })} />
          </Field>
        </div>

        <datalist id="fcb-spell-casting-times">
          {CASTING_TIME_PRESETS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="fcb-spell-ranges">
          {RANGE_PRESETS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="fcb-spell-durations">
          {DURATION_PRESETS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className="fcb-custom-row">
          <Field label="Casting time">
            <input
              className="fcb-input"
              aria-label="Casting time"
              list="fcb-spell-casting-times"
              value={draft.castingTime}
              onChange={(event) => patch({ castingTime: event.target.value })}
            />
          </Field>
          <Field label="Range">
            <input className="fcb-input" aria-label="Range" list="fcb-spell-ranges" value={draft.range} onChange={(event) => patch({ range: event.target.value })} />
          </Field>
          <Field label="Duration">
            <input
              className="fcb-input"
              aria-label="Duration"
              list="fcb-spell-durations"
              value={draft.duration}
              onChange={(event) => patch({ duration: event.target.value })}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="fcb-field-label">Components and flags</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.components?.verbal === true} onChange={(event) => patchComponents({ verbal: event.target.checked })} />
              Verbal
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.components?.somatic === true} onChange={(event) => patchComponents({ somatic: event.target.checked })} />
              Somatic
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={material} onChange={(event) => patchComponents({ material: event.target.checked })} />
              Material
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.concentration === true} onChange={(event) => patch({ concentration: event.target.checked })} />
              Concentration
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.ritual === true} onChange={(event) => patch({ ritual: event.target.checked })} />
              Ritual
            </label>
          </div>
          {material && (
            <Field label="Material" className="mt-2">
              <input
                className="fcb-input"
                aria-label="Material"
                placeholder="a sliver of ice"
                value={draft.components?.materialText ?? ''}
                onChange={(event) => patchComponents({ materialText: event.target.value })}
              />
            </Field>
          )}
        </fieldset>

        <Field label="Text">
          <textarea
            className="fcb-textarea"
            aria-label="Text"
            rows={3}
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>
        <Field label="At higher levels">
          <textarea
            className="fcb-textarea"
            aria-label="At higher levels"
            rows={2}
            placeholder="Optional"
            value={draft.higherLevels ?? ''}
            onChange={(event) => patch({ higherLevels: event.target.value })}
          />
        </Field>

        <div>
          <h4 className="fcb-field-label mb-2">What it rolls</h4>
          <Segmented label="Roll" value={roll} options={ROLL_OPTIONS} onChange={(next) => patchMechanics({ roll: next })} />
          {roll === 'save' && (
            <div className="fcb-custom-row mt-3">
              <Field label="The target saves with">
                <SelectInput
                  label="Saving throw ability"
                  value={mechanics.saveAbility ?? ''}
                  placeholder="Pick an ability"
                  options={abilityOptions}
                  onChange={(saveAbility) => patchMechanics({ saveAbility: saveAbility === '' ? undefined : saveAbility })}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mechanics.halfOnSave === true} onChange={(event) => patchMechanics({ halfOnSave: event.target.checked })} />
                Half damage on a successful save
              </label>
            </div>
          )}
          <div className="mt-3 space-y-3">
            <DamageRows terms={damage} onChange={(next) => patchMechanics({ damage: next })} />
            <div className="fcb-custom-row">
              <Field label="Healing">
                <input
                  className="fcb-input"
                  aria-label="Healing dice"
                  placeholder="2d8"
                  value={mechanics.healing ?? ''}
                  onChange={(event) => patchMechanics({ healing: event.target.value.trim() })}
                />
              </Field>
              {dealsDamageOrHeals && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={mechanics.addsModifier === true} onChange={(event) => patchMechanics({ addsModifier: event.target.checked })} />
                  Adds the spellcasting modifier
                </label>
              )}
            </div>
            {(damage.length > 0 || mechanics.healing?.trim()) && (
              <div>
                <span className="fcb-field-label">Grows</span>
                <Segmented
                  label="Scaling"
                  value={scaling?.kind ?? 'none'}
                  options={scalingOptions}
                  onChange={setScalingKind}
                  className="mt-1"
                />
                {scaling?.kind === 'cantrip' && (
                  <div className="mt-2">
                    <CantripTiers tiers={scaling.tiers} onChange={(tiers) => patchMechanics({ scaling: { kind: 'cantrip', tiers } })} />
                  </div>
                )}
                {scaling?.kind === 'slot' && (
                  <Field label="Added for each slot level above the spell's own" className="mt-2">
                    <input
                      className="fcb-input"
                      aria-label="Dice per slot level"
                      placeholder="1d6"
                      value={scaling.dice}
                      onChange={(event) => patchMechanics({ scaling: { kind: 'slot', dice: event.target.value.trim() } })}
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        </div>

        <fieldset>
          <legend className="fcb-field-label">Spell lists</legend>
          <p className="fcb-muted-copy text-xs">
            A class's list offers the spell to that class's pickers. Leave them all off for a spell only this character has.
          </p>
          <div className="mt-1 flex flex-wrap gap-4">
            {classLists.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={(draft.classes ?? []).includes(name)} onChange={() => toggleClass(name)} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>

        {pack !== null && (
          <p className="fcb-muted-copy text-xs">
            This spell is saved to the {pack.name} pack, so every character that uses the pack can have it.
          </p>
        )}

        {!editing && pack === null && (
          <Field label="Cast with">
            <SelectInput label="Cast with" value={chosenCaster} onChange={setCastWith}>
              {known.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="">Additional Spells (no class caster)</option>
              <option value={NO_GRANT}>Only put it on the spell lists</option>
            </SelectInput>
          </Field>
        )}

        <div className="fcb-custom-summary" aria-live="polite">
          <div>
            <h4 className="fcb-field-label">In plain words</h4>
            <ul className="fcb-custom-summary-list" data-testid="spell-summary">
              {summary.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
          {roll !== 'none' && pack === null && (
            <div data-testid="spell-attack-preview">
              <h4 className="fcb-field-label">Attack row{previewCaster ? ` (${previewCaster})` : ''}</h4>
              {attack ? (
                <>
                  <p className="text-sm">
                    <strong>{draft.name.trim() || 'Untitled'}</strong> {attack.bonus}
                    {attack.damage ? ` · ${attack.damage}` : ''}
                    {attack.range ? ` · ${attack.range}` : ''}
                  </p>
                  {attack.warning && <p className="fcb-muted-copy text-xs">{attack.warning}</p>}
                </>
              ) : preview.key === previewKey && preview.error ? (
                <p className="fcb-muted-copy text-xs">{preview.error}</p>
              ) : (
                <p className="fcb-muted-copy text-xs">
                  {previewPending ? 'Working it out…' : 'Name the spell, pick a caster and its roll to see the row.'}
                </p>
              )}
            </div>
          )}
        </div>

        {!editing && pack === null && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={promote} onChange={(event) => setPromote(event.target.checked)} />
            <span>Also save to a homebrew pack, so it can be used by other characters</span>
          </label>
        )}

        <Issues issues={topIssues} />
        {error && <p role="alert" className="fcb-alert">{error}</p>}

        {confirmRemove && (
          <div role="alert" className="fcb-alert space-y-2" data-testid="remove-confirm">
            <p className="font-semibold">Delete {draft.name || 'this spell'} from {characterName}? It leaves every spell list it is on.</p>
            <div className="fcb-toolbar">
              <button type="button" className="fcb-button" onClick={() => setConfirmRemove(false)}>
                Keep it
              </button>
              <button type="button" className="fcb-button fcb-button-danger" disabled={saving} onClick={() => void remove()}>
                Delete custom spell
              </button>
            </div>
          </div>
        )}

        <div className="fcb-toolbar justify-end">
          {editing && pack === null && (
            <button type="button" className="fcb-button fcb-button-danger mr-auto" disabled={saving} onClick={() => setConfirmRemove(true)}>
              Delete spell
            </button>
          )}
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : pack ? `Add to ${pack.name}` : 'Add spell'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
