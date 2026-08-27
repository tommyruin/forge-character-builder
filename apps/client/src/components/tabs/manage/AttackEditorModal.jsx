import { useMemo, useState } from 'react';
import Modal from '../../Modal';
import AttackComputationDetails from './AttackComputationDetails';
import {
  buildAttackWriteRequest,
  calculateUnarmedPreview,
  leadingDamageDie,
  calculateAttackComputation,
  calculateAttackPreview,
  calculateWeaponPreview,
  getDamageAbilityContext,
} from './attackEditorCalculations';

const ATTACK_MODES = [
  ['manual', 'Manual'],
  ['calculated', 'Calculated'],
  ['spell', 'Known spell'],
  ['unarmed', 'Unarmed strike'],
];

/** The damage dice an unarmed strike feature can grant. */
const UNARMED_DICE = ['1d4', '1d6', '1d8', '1d10', '1d12'];

const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];

const MANUAL_FIELD_EXAMPLES = {
  name: 'Fire Bolt',
  range: '120 ft',
  bonus: '+5 vs AC',
  damage: '1d10 fire',
  description:
    'Make a ranged spell attack. On a hit, the target takes 1d10 fire damage.',
};

const EMPTY = {
  mode: 'manual',
  name: '',
  range: '',
  bonus: '',
  damage: '',
  description: '',
  abilityMode: 'default',
  abilityName: 'Strength',
  calculationSource: 'ability',
  useProficiency: true,
  attackMiscBonus: '',
  damageDice: '',
  addAbilityToDamage: true,
  damageMiscBonus: '',
  damageType: '',
  casterIdentifier: '',
  spellId: '',
  unarmedDice: '',
  unarmedDiceCustom: false,
  resetFields: [],
  overrideFields: [],
};

export function attackDraft(attack, options) {
  if (!attack) return { ...EMPTY };
  const calculation = attack.calculation ?? {};
  return {
    ...EMPTY,
    mode: attack.kind,
    name: attack.name ?? '',
    range: attack.range ?? '',
    bonus: attack.bonus ?? '',
    damage: attack.damage ?? '',
    description: attack.description ?? '',
    abilityMode: attack.abilityMode ?? 'default',
    abilityName: attack.ability ?? options?.abilities?.[0]?.name ?? 'Strength',
    calculationSource: calculation.source ?? 'ability',
    useProficiency: calculation.useProficiency ?? true,
    attackMiscBonus: calculation.attackMiscBonus || '',
    damageDice: calculation.damageDice ?? '',
    addAbilityToDamage: calculation.addAbilityToDamage ?? true,
    damageMiscBonus: calculation.damageMiscBonus || '',
    damageType: calculation.damageType ?? '',
    casterIdentifier:
      calculation.casterIdentifier ?? attack.source?.casterIdentifier ?? '',
    spellId: attack.source?.spellId ?? '',
    unarmedDice: attack.unarmed?.dice ?? '',
    unarmedDiceCustom:
      Boolean(attack.unarmed?.dice) &&
      !UNARMED_DICE.includes(attack.unarmed.dice),
    resetFields: [],
    overrideFields: attack.overriddenFields ?? [],
  };
}

export default function AttackEditorModal({
  open,
  attack,
  options,
  detail,
  busy,
  onClose,
  onSave,
}) {
  const [draft, setDraft] = useState(() => attackDraft(attack, options));
  const [error, setError] = useState('');

  const selectedSpell = useMemo(
    () =>
      options?.spells?.find(
        (spell) =>
          spell.spellId === draft.spellId &&
          spell.casterIdentifier === draft.casterIdentifier,
      ),
    [draft.casterIdentifier, draft.spellId, options],
  );
  const calculatedPreview = useMemo(
    () => calculateAttackPreview(draft, options, detail),
    [detail, draft, options],
  );
  const calculatedComputation = useMemo(
    () => calculateAttackComputation(draft, options, detail),
    [detail, draft, options],
  );
  const damageAbility = useMemo(
    () => getDamageAbilityContext(draft, options, detail),
    [detail, draft, options],
  );
  const weaponPreview = useMemo(
    () => calculateWeaponPreview(attack, draft, detail),
    [attack, detail, draft],
  );
  const unarmedPreview = useMemo(
    () => calculateUnarmedPreview(attack, draft, detail, options),
    [attack, detail, draft, options],
  );
  const computation =
    selectedSpell?.computation ??
    (draft.mode === 'calculated'
      ? calculatedComputation
      : attack?.computation);

  const set = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const chooseMode = (mode) => {
    const caster = options?.casters?.[0];
    const unarmed = mode === 'unarmed' ? options?.unarmed : null;
    setDraft({
      ...EMPTY,
      mode,
      abilityName: options?.abilities?.[0]?.name ?? 'Strength',
      casterIdentifier: mode === 'calculated' ? (caster?.identifier ?? '') : '',
      calculationSource: 'ability',
      addAbilityToDamage: mode !== 'spell',
      // Show what the row will be before it exists, so Add is not a blind
      // action. Only an edited name/range/description becomes an override.
      name: unarmed?.name ?? '',
      range: unarmed?.range ?? '',
      bonus: unarmed?.bonus ?? '',
      damage: unarmed?.damage ?? '',
    });
  };

  const chooseSpell = (value) => {
    const spell = options.spells.find(
      (candidate) =>
        `${candidate.casterIdentifier}::${candidate.spellId}` === value,
    );
    if (!spell) return;
    setDraft((current) => ({
      ...current,
      casterIdentifier: spell.casterIdentifier,
      spellId: spell.spellId,
      name: spell.spellName,
      range: spell.range,
      bonus: spell.bonus,
      damage: spell.damage,
      description: spell.description,
      resetFields: [],
      overrideFields: [],
    }));
  };

  const setFieldOverride = (field, enabled, generatedValue) => {
    setDraft((current) => ({
      ...current,
      [field]: enabled
        ? (generatedValue ?? current[field])
        : (generatedValue ?? ''),
      resetFields: enabled
        ? current.resetFields.filter((candidate) => candidate !== field)
        : [...new Set([...current.resetFields, field])],
      overrideFields: enabled
        ? [...new Set([...current.overrideFields, field])]
        : current.overrideFields.filter((candidate) => candidate !== field),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (draft.mode !== 'spell' && draft.mode !== 'unarmed' && !draft.name.trim()) {
      setError('Attack name is required.');
      return;
    }
    if (draft.mode === 'spell' && (!draft.spellId || !draft.casterIdentifier)) {
      setError('Choose a known spell.');
      return;
    }
    setError('');
    await onSave(buildAttackWriteRequest(draft));
  };

  const overrideSwitch = (field, label, overridden, generatedValue) => (
    <button
      type="button"
      role="switch"
      aria-checked={overridden}
      aria-label={`Use custom ${label.toLowerCase()}`}
      className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-1 py-1 text-xs normal-case text-[var(--fcb-text-muted)] transition hover:text-[var(--fcb-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fcb-primary)]"
      onClick={() =>
        setFieldOverride(field, !overridden, generatedValue)
      }
      disabled={busy}
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition ${
          overridden
            ? 'border-[var(--fcb-primary)] bg-[var(--fcb-primary)]'
            : 'border-[var(--fcb-border)] bg-[var(--fcb-surface)]'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            overridden ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
      <span>Custom</span>
    </button>
  );

  const generatedField = (
    key,
    label,
    multiline = false,
    placeholder = undefined,
  ) => {
    const overridden = draft.overrideFields.includes(key);
    const canOverrideGenerated =
      Boolean(attack?.generated) &&
      (attack.kind === 'weapon' ||
        attack.kind === 'spell' ||
        attack.kind === 'unarmed');
    const inputId = `attack-${key}`;
    const generatedValue =
      (attack?.kind === 'weapon' || attack?.kind === 'unarmed') &&
      (key === 'bonus' || key === 'damage')
        ? weaponPreview[key]
        : (attack?.generated?.[key] ?? draft[key]);
    const updateField = (event) => {
      const value = event.target.value;
      if ((draft.mode === 'spell' || draft.mode === 'unarmed') && !attack) {
        setDraft((current) => ({
          ...current,
          [key]: value,
          overrideFields: [...new Set([...current.overrideFields, key])],
        }));
      } else {
        set(key, value);
      }
    };
    const common = {
      id: inputId,
      className: multiline
        ? 'fcb-textarea normal-case'
        : 'fcb-input normal-case',
      placeholder,
      value: canOverrideGenerated && !overridden ? generatedValue : draft[key],
      onChange: updateField,
      disabled: busy || (canOverrideGenerated && !overridden),
    };
    if (canOverrideGenerated) {
      return (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <label className="fcb-field-label" htmlFor={inputId}>
              {label}
            </label>
            {overrideSwitch(key, label, overridden, generatedValue)}
          </div>
          {multiline ? (
            <textarea rows={5} {...common} />
          ) : (
            <input {...common} />
          )}
        </div>
      );
    }
    return (
      <label className="fcb-field-label" htmlFor={inputId}>
        {label}
        {multiline ? <textarea rows={5} {...common} /> : <input {...common} />}
      </label>
    );
  };

  // An unarmed strike's bonus and damage are always derived, so they are shown
  // rather than offered for editing.
  const derivedField = (key, label) => (
    <div className="min-w-0 rounded-lg border border-[var(--fcb-border)] bg-[var(--fcb-surface)] p-3">
      <p className="fcb-field-label">{label}</p>
      <output className="mt-2 block text-lg font-semibold normal-case text-[var(--fcb-text)]">
        {unarmedPreview[key] || '—'}
      </output>
    </div>
  );

  const fieldPlaceholder = (key) =>
    draft.mode === 'manual' ? MANUAL_FIELD_EXAMPLES[key] : undefined;

  // The generated damage always leads with its dice, so the current die can be
  // shown as the placeholder of an empty override box.
  const derivedUnarmedDie = leadingDamageDie(options?.unarmed?.damage);

  const isWeapon = attack?.kind === 'weapon';
  const isUnarmed = attack?.kind === 'unarmed' || draft.mode === 'unarmed';
  // An unarmed strike picks its ability the same way a finesse weapon does, so
  // it reuses the weapon ability selector.
  const showsAbilityChoice = isWeapon || (isUnarmed && Boolean(attack));
  const canChooseMode = !attack;
  const calculatedResult = (field, label) => {
    const overridden = draft.overrideFields.includes(field);
    return (
      <div className="min-w-0 rounded-lg border border-[var(--fcb-border)] bg-[var(--fcb-surface)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="fcb-field-label">{label}</p>
          {overrideSwitch(
            field,
            label,
            overridden,
            calculatedPreview[field],
          )}
        </div>
        {!overridden && (
          <output className="mt-2 block text-lg font-semibold normal-case text-[var(--fcb-text)]">
            {calculatedPreview[field] || '—'}
          </output>
        )}
        {overridden && (
          <label className="fcb-field-label mt-3">
            Custom value
            <input
              className="fcb-input normal-case"
              value={draft[field]}
              onChange={(event) => set(field, event.target.value)}
              disabled={busy}
            />
          </label>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title={attack ? `Edit ${attack.name}` : 'Add Attack'}
      onClose={onClose}
      size="wide"
    >
      <form className="space-y-4" onSubmit={submit}>
        {canChooseMode && (
          <div
            className="fcb-secondary-tabs"
            role="tablist"
            aria-label="Attack type"
          >
            {ATTACK_MODES.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={draft.mode === mode}
                className={`fcb-tab ${draft.mode === mode ? 'is-active' : ''}`}
                onClick={() => chooseMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {isUnarmed && (
          <label className="fcb-field-label" htmlFor="attack-unarmed-dice">
            Damage die
            <select
              id="attack-unarmed-dice"
              className="fcb-input normal-case"
              value={draft.unarmedDiceCustom ? 'custom' : draft.unarmedDice}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  unarmedDiceCustom: value === 'custom',
                  unarmedDice: value === 'custom' ? current.unarmedDice : value,
                }));
              }}
              disabled={busy}
            >
              <option value="">
                {`Automatic (${derivedUnarmedDie || '1'})`}
              </option>
              {UNARMED_DICE.map((die) => (
                <option key={die} value={die}>
                  {die}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {draft.unarmedDiceCustom && (
              <input
                aria-label="Custom damage die"
                className="fcb-input normal-case mt-2"
                value={draft.unarmedDice}
                placeholder="2d6"
                onChange={(event) => set('unarmedDice', event.target.value)}
                disabled={busy}
              />
            )}
            <span className="mt-1 block text-xs normal-case text-[var(--fcb-text-muted)]">
              Automatic follows the character, including a monk&rsquo;s Martial
              Arts die. Choose a die for a feat that only names one in its
              text, such as Tavern Brawler.
            </span>
          </label>
        )}

        {draft.mode === 'spell' && !attack && (
          <label className="fcb-field-label">
            Known attack spell
            <select
              className="fcb-input normal-case"
              value={
                draft.spellId
                  ? `${draft.casterIdentifier}::${draft.spellId}`
                  : ''
              }
              onChange={(event) => chooseSpell(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose a spell…</option>
              {options?.spells?.map((spell) => (
                <option
                  key={`${spell.casterIdentifier}:${spell.spellId}`}
                  value={`${spell.casterIdentifier}::${spell.spellId}`}
                >
                  {spell.spellName} · {spell.casterName}
                </option>
              ))}
            </select>
          </label>
        )}

        {showsAbilityChoice && (
          <label className="fcb-field-label">
            Attack and damage ability
            <select
              className="fcb-input normal-case"
              value={
                draft.abilityMode === 'default' ? 'default' : draft.abilityName
              }
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  abilityMode: value === 'default' ? 'default' : 'explicit',
                  abilityName:
                    value === 'default' ? current.abilityName : value,
                }));
              }}
              disabled={busy}
            >
              <option value="default">
                {isUnarmed ? 'Automatic' : 'Weapon default'}
              </option>
              {options?.abilities?.map((ability) => (
                <option key={ability.name} value={ability.name}>
                  {ability.abbreviation}
                </option>
              ))}
            </select>
          </label>
        )}

        {draft.mode === 'calculated' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {generatedField('name', 'Name')}
              {generatedField('range', 'Range')}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="fcb-field-label">
                Source
                <select
                  className="fcb-input normal-case"
                  value={draft.calculationSource}
                  onChange={(event) => {
                    const source = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      calculationSource: source,
                      addAbilityToDamage:
                        source === 'ability'
                          ? current.addAbilityToDamage
                          : false,
                    }));
                  }}
                >
                  <option value="ability">Ability</option>
                  <option value="caster">Spellcasting</option>
                </select>
              </label>
              {draft.calculationSource === 'ability' ? (
                <label className="fcb-field-label">
                  Ability
                  <select
                    aria-label="Ability"
                    className="fcb-input normal-case"
                    value={draft.abilityName}
                    onChange={(event) => set('abilityName', event.target.value)}
                  >
                    {options?.abilities?.map((ability) => (
                      <option key={ability.name} value={ability.name}>
                        {ability.abbreviation}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="fcb-field-label">
                  Spellcasting profile
                  <select
                    className="fcb-input normal-case"
                    value={draft.casterIdentifier}
                    onChange={(event) =>
                      set('casterIdentifier', event.target.value)
                    }
                  >
                    <option value="">Choose a caster…</option>
                    {options?.casters?.map((caster) => (
                      <option key={caster.identifier} value={caster.identifier}>
                        {caster.name} ({caster.ability},{' '}
                        {caster.attackModifier >= 0 ? '+' : ''}
                        {caster.attackModifier})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.calculationSource === 'ability' && (
                <label className="flex items-center gap-2 text-sm normal-case">
                  <input
                    type="checkbox"
                    checked={draft.useProficiency}
                    onChange={(event) =>
                      set('useProficiency', event.target.checked)
                    }
                  />
                  Proficient
                </label>
              )}
              <label className="fcb-field-label">
                Attack modifier
                <input
                  type="number"
                  className="fcb-input"
                  value={draft.attackMiscBonus}
                  onChange={(event) =>
                    set('attackMiscBonus', event.target.value)
                  }
                />
              </label>
              <label className="fcb-field-label">
                Damage dice
                <input
                  className="fcb-input normal-case"
                  placeholder="1d10"
                  value={draft.damageDice}
                  onChange={(event) => set('damageDice', event.target.value)}
                />
              </label>
              <label className="fcb-field-label">
                Damage type
                <select
                  className="fcb-input normal-case"
                  value={draft.damageType}
                  onChange={(event) => set('damageType', event.target.value)}
                >
                  <option value="">Choose type…</option>
                  {draft.damageType &&
                    !DAMAGE_TYPES.includes(draft.damageType) && (
                      <option value={draft.damageType}>
                        {draft.damageType}
                      </option>
                    )}
                  {DAMAGE_TYPES.map((damageType) => (
                    <option key={damageType} value={damageType}>
                      {damageType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm normal-case">
                <input
                  type="checkbox"
                  checked={draft.addAbilityToDamage}
                  onChange={(event) =>
                    set('addAbilityToDamage', event.target.checked)
                  }
                  />
                Add {damageAbility.abbreviation} to damage
              </label>
              <label className="fcb-field-label">
                Damage modifier
                <input
                  type="number"
                  className="fcb-input"
                  value={draft.damageMiscBonus}
                  onChange={(event) =>
                    set('damageMiscBonus', event.target.value)
                  }
                />
              </label>
            </div>
          </>
        )}

        {selectedSpell?.warning && (
          <p className="fcb-alert">{selectedSpell.warning}</p>
        )}
        <AttackComputationDetails
          attack={selectedSpell ?? attack}
          computation={computation}
        />

        {draft.mode === 'calculated' ? (
          <section
            className="rounded-xl border border-[var(--fcb-border)] bg-[var(--fcb-surface-2)] p-4"
            aria-label="Calculated attack values"
          >
            <div className="grid gap-3 md:grid-cols-2">
              {calculatedResult('bonus', 'Attack bonus')}
              {calculatedResult('damage', 'Damage')}
            </div>
          </section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {generatedField(
              'name',
              'Name',
              false,
              fieldPlaceholder('name'),
            )}
            {generatedField(
              'range',
              'Range',
              false,
              fieldPlaceholder('range'),
            )}
            {isUnarmed ? (
              <>
                {derivedField('bonus', 'Attack bonus')}
                {derivedField('damage', 'Damage')}
              </>
            ) : (
              <>
                {generatedField(
                  'bonus',
                  'Attack bonus',
                  false,
                  fieldPlaceholder('bonus'),
                )}
                {generatedField(
                  'damage',
                  'Damage',
                  false,
                  fieldPlaceholder('damage'),
                )}
              </>
            )}
          </div>
        )}
        {generatedField(
          'description',
          'Description',
          true,
          fieldPlaceholder('description'),
        )}

        {error && <p className="fcb-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="fcb-button fcb-button-primary"
            disabled={busy}
          >
            {attack ? 'Save Attack' : 'Add Attack'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export { ATTACK_MODES };
