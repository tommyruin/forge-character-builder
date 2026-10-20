// B1: one modifier. The target comes from the engine's menu (so an author never types a
// statistic key), the mode says how it combines (Add, Set base, Best of with no stacking,
// Raise maximum), the value is a number or a reference the engine resolves, and the gates say
// when it applies: from a level, while equipped, when requirements are met, or only while a
// switch is on. The block emits the draft's `ModifierBlock` shape.

import { CUSTOM_EQUIPPED_VALUES, modifierTarget } from '@forge-cb/engine/custom';
import {
  ABILITY_LABELS,
  EQUIPPED_SLOTS,
  MODE_OPTIONS,
  abilityOptions,
  compact,
  compactGates,
  defaultBucket,
  equippedValueLabel,
  referenceFromOption,
  referenceOptionId,
  referenceOptions,
  targetGroups,
} from './draftModel';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from './fields';
import RequirementsBuilder from './RequirementsBuilder';

const VALUE_KINDS = [
  { id: 'number', label: 'A number' },
  { id: 'reference', label: 'Another value' },
  { id: 'classLevel', label: 'A class level' },
];

// A number, or a value the engine reads off the finished character (proficiency bonus,
// an ability modifier, a level ...).
export function ValueEditor({ value, onChange, label, numberOnly = false, scales = [] }) {
  const kind = value.kind;
  // A die cannot be added to a bonus: only the draft's count-valued scale values are offered.
  const counts = scales.filter((scale) => scale.kind === 'number');
  const kinds = counts.length > 0 ? [...VALUE_KINDS, { id: 'scale', label: 'A scale value' }] : VALUE_KINDS;
  const setKind = (next) => {
    if (next === 'number') onChange({ kind: 'number', value: 1 });
    else if (next === 'reference') onChange({ kind: 'reference', ref: referenceOptions[0].id });
    else if (next === 'scale') onChange({ kind: 'scale', scale: counts[0].id });
    else onChange({ kind: 'classLevel', className: '' });
  };
  return (
    <div className="fcb-custom-value" role="group" aria-label={label}>
      {!numberOnly && (
        <SelectInput label={`${label} is`} value={kind} onChange={setKind} options={kinds} />
      )}
      {kind === 'number' && (
        <NumberInput
          label={`${label} number`}
          min={-1000}
          max={1000}
          value={value.value}
          onChange={(next) => onChange({ kind: 'number', value: next ?? 0 })}
        />
      )}
      {kind === 'reference' && (
        <>
          <SelectInput
            label={`${label} value`}
            value={referenceOptionId(value)}
            onChange={(id) => onChange(referenceFromOption(id, value))}
            options={referenceOptions}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={value.negate === true}
              onChange={(event) => onChange(compact({ ...value, negate: event.target.checked ? true : undefined }))}
            />
            Subtract it
          </label>
        </>
      )}
      {kind === 'scale' && (
        <>
          <SelectInput
            label={`${label} scale value`}
            value={value.scale}
            onChange={(scale) => onChange(compact({ ...value, scale }))}
            options={counts.map((scale) => ({ id: scale.id, label: scale.name || 'Unnamed scale value' }))}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={value.negate === true}
              onChange={(event) => onChange(compact({ ...value, negate: event.target.checked ? true : undefined }))}
            />
            Subtract it
          </label>
        </>
      )}
      {kind === 'classLevel' && (
        <>
          <input
            className="fcb-input"
            aria-label={`${label} class name`}
            placeholder="Class name"
            value={value.className}
            onChange={(event) => onChange(compact({ ...value, className: event.target.value }))}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={value.negate === true}
              onChange={(event) => onChange(compact({ ...value, negate: event.target.checked ? true : undefined }))}
            />
            Subtract it
          </label>
        </>
      )}
    </div>
  );
}

// The engine names the ability limits "Strength maximum"; in the menu that reads as a second way to
// cap a score, so it says what choosing it does.
const menuLabel = (entry) => (entry.id.endsWith(':max') ? `Raise the maximum of ${entry.label.replace(/ maximum$/, '')}` : entry.label);
const menuGroupLabel = (label) => (label === 'Ability maximums' ? 'Raise an ability maximum' : label);

function EquippedGates({ gates = [], onChange }) {
  const setGate = (index, patch) => onChange(gates.map((gate, at) => (at === index ? compact({ ...gate, ...patch }) : gate)));
  return (
    <div className="space-y-2">
      {gates.map((gate, index) => {
        const values = CUSTOM_EQUIPPED_VALUES[gate.slot] ?? [];
        return (
          <div key={index} className="fcb-custom-condition" role="group" aria-label={`Equipment gate ${index + 1}`}>
            <SelectInput
              label="Only when"
              value={gate.negate ? 'not' : 'is'}
              onChange={(next) => setGate(index, { negate: next === 'not' ? true : undefined })}
              options={[
                { id: 'is', label: 'Wearing or holding' },
                { id: 'not', label: 'Not wearing or holding' },
              ]}
            />
            <SelectInput
              label="Slot"
              value={gate.slot}
              onChange={(slot) => onChange(gates.map((entry, at) => (at === index ? { slot, value: 'any' } : entry)))}
              options={EQUIPPED_SLOTS}
            />
            <SelectInput
              label="Kind"
              value={gate.value}
              onChange={(value) => setGate(index, { value })}
              options={values.map((value) => ({ id: value, label: equippedValueLabel(value) }))}
            />
            <RemoveButton label={`Remove equipment gate ${index + 1}`} onClick={() => onChange(gates.filter((_, at) => at !== index))} />
          </div>
        );
      })}
      <button type="button" className="fcb-button" onClick={() => onChange([...gates, { slot: 'armor', value: 'any' }])}>
        Add an equipment gate
      </button>
    </div>
  );
}

export default function ModifierBlock({
  block,
  onChange,
  onRemove,
  lookup,
  allowedGroups,
  issues,
  ariaLabel = 'Bonus to another stat',
  scales = [],
  switches = [],
}) {
  const target = modifierTarget(block.target);
  const groups = targetGroups(allowedGroups);
  const calculation = block.target === 'ac:calculation';
  const emit = (patch) => onChange(compact({ ...block, ...patch }));
  const setGates = (patch) => emit({ gates: compactGates({ ...block.gates, ...patch }) });

  const changeTarget = (id) => {
    const next = modifierTarget(id);
    const mode = next.modes.includes(block.mode) ? block.mode : next.modes[0];
    const toCalculation = id === 'ac:calculation';
    emit({
      target: id,
      mode,
      bucket: mode === 'bestOf' ? (block.mode === 'bestOf' && block.bucket ? block.bucket : defaultBucket(next)) : undefined,
      value: toCalculation && block.value.kind !== 'number' ? { kind: 'number', value: 10 } : block.value,
      cap: toCalculation ? undefined : block.cap,
      addAbilities: toCalculation ? block.addAbilities : undefined,
    });
  };

  const changeMode = (mode) =>
    emit({ mode, bucket: mode === 'bestOf' ? (block.bucket ?? defaultBucket(target)) : undefined });

  const toggleAbility = (ability) => {
    const current = block.addAbilities ?? [];
    const next = current.includes(ability) ? current.filter((entry) => entry !== ability) : [...current, ability];
    emit({ addAbilities: next.length > 0 ? next : undefined });
  };

  const modeOptions = MODE_OPTIONS.filter((option) => target?.modes.includes(option.id));

  return (
    <div className="fcb-custom-block" role="group" aria-label={ariaLabel}>
      <div className="fcb-custom-row">
        <Field label="What it changes">
          <select
            className="fcb-select"
            aria-label="What it changes"
            value={block.target}
            onChange={(event) => changeTarget(event.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={menuGroupLabel(group.label)}>
                {group.targets.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {menuLabel(entry)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="How">
          <SelectInput label="How it combines" value={block.mode} onChange={changeMode} options={modeOptions} />
        </Field>
        {onRemove && <RemoveButton label={`Remove ${ariaLabel.toLowerCase()}`} onClick={onRemove} />}
      </div>

      <div className="fcb-custom-row">
        <div>
          <span className="fcb-field-label">{block.mode === 'raiseMax' ? 'Raise by' : 'Amount'}</span>
          <ValueEditor
            label="Amount"
            numberOnly={calculation}
            scales={scales}
            value={block.value}
            onChange={(value) => emit({ value })}
          />
        </div>
        {block.mode === 'bestOf' && (
          <Field label="Group (bonuses in a group do not stack)">
            <input
              className="fcb-input"
              aria-label="Bonus group"
              value={block.bucket ?? ''}
              onChange={(event) => emit({ bucket: event.target.value })}
            />
          </Field>
        )}
      </div>

      {calculation && (
        <fieldset className="fcb-custom-abilities">
          <legend className="fcb-field-label">Also add the modifier of</legend>
          <div className="flex flex-wrap gap-3">
            {abilityOptions.map((ability) => (
              <label key={ability.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(block.addAbilities ?? []).includes(ability.id)}
                  onChange={() => toggleAbility(ability.id)}
                />
                {ABILITY_LABELS[ability.id]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!calculation && (
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.cap !== undefined}
              onChange={(event) => emit({ cap: event.target.checked ? { kind: 'number', value: 20 } : undefined })}
            />
            Stop the total going above a limit
          </label>
          {block.cap !== undefined && (
            <div className="mt-2">
              <span className="fcb-field-label">Highest total allowed</span>
              <ValueEditor label="Limit" scales={scales} value={block.cap} onChange={(cap) => emit({ cap })} />
            </div>
          )}
        </div>
      )}

      <details className="fcb-custom-gates">
        <summary>When it applies</summary>
        <div className="fcb-custom-gates-body">
          <Field label="From level">
            <NumberInput
              label="From level"
              min={1}
              max={20}
              value={block.gates?.level}
              onChange={(level) => setGates({ level })}
            />
          </Field>
          <div>
            <span className="fcb-field-label">Equipment</span>
            <EquippedGates gates={block.gates?.equipped} onChange={(equipped) => setGates({ equipped })} />
          </div>
          <div>
            <span className="fcb-field-label">Only when</span>
            <RequirementsBuilder
              label="Requirements for this bonus"
              lookup={lookup}
              value={block.gates?.requirements}
              onChange={(requirements) => setGates({ requirements })}
            />
          </div>
          <Field label="Only while this switch is on">
            <input
              className="fcb-input"
              aria-label="Switch name"
              placeholder="No switch"
              list={switches.length > 0 ? `switch-names-${block.id}` : undefined}
              value={block.gates?.switch ?? ''}
              onChange={(event) => setGates({ switch: event.target.value })}
            />
            {switches.length > 0 && (
              <datalist id={`switch-names-${block.id}`}>
                {switches.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </Field>
        </div>
      </details>

      <Field label="Shown on the sheet as">
        <input
          className="fcb-input"
          aria-label="Sheet label"
          placeholder="Leave blank for the feature's name"
          value={block.label ?? ''}
          onChange={(event) => emit({ label: event.target.value === '' ? undefined : event.target.value })}
        />
      </Field>
      <Issues issues={issues} />
    </div>
  );
}
