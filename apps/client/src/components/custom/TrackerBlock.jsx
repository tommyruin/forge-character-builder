// B7: one limited use. A feature's uses, an item's charges or a pool of points: what it is
// called, how many it holds (a number, or a value that follows the character), the unit, when it
// refills, and optionally a pool shared with other features and a switch that spends a use when
// it is turned on. The block emits the draft's `TrackerDef` shape.

import { MAX_KINDS, RECHARGE_OPTIONS, UNIT_OPTIONS, describeMax, referenceMenu } from './trackerModel';
import { compact } from './draftModel';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from './fields';

function MaxEditor({ max, onChange, scales, literalOnly, label }) {
  const counts = scales.filter((scale) => scale.kind === 'number');
  const kinds = literalOnly
    ? MAX_KINDS.filter((kind) => kind.id === 'number')
    : MAX_KINDS.filter((kind) => kind.id !== 'scale' || counts.length > 0);
  const setKind = (kind) => {
    if (kind === 'number') onChange({ kind: 'number', value: 1 });
    else if (kind === 'reference') onChange({ kind: 'reference', ref: referenceMenu[0].id });
    else if (kind === 'classLevel') onChange({ kind: 'classLevel', className: '' });
    else onChange({ kind: 'scale', scale: counts[0].id });
  };
  return (
    <div className="fcb-custom-value" role="group" aria-label={`${label} holds`}>
      {kinds.length > 1 && <SelectInput label={`${label} follows`} value={max.kind} onChange={setKind} options={kinds} />}
      {max.kind === 'number' && (
        <NumberInput label="Uses" min={1} max={999} value={max.value} onChange={(value) => onChange({ kind: 'number', value: value ?? 1 })} />
      )}
      {max.kind === 'reference' && (
        <>
          <SelectInput
            label={`${label} value`}
            value={max.ref}
            onChange={(ref) => onChange(compact({ ...max, ref }))}
            options={referenceMenu}
          />
          <Field label="At least">
            <NumberInput
              label={`${label} minimum`}
              min={0}
              max={99}
              value={max.min}
              onChange={(min) => onChange(compact({ ...max, min }))}
            />
          </Field>
        </>
      )}
      {max.kind === 'classLevel' && (
        <input
          className="fcb-input"
          aria-label={`${label} class name`}
          placeholder="Class name"
          value={max.className}
          onChange={(event) => onChange({ kind: 'classLevel', className: event.target.value })}
        />
      )}
      {max.kind === 'scale' && (
        <SelectInput
          label={`${label} scale value`}
          value={max.scale}
          onChange={(scale) => onChange({ kind: 'scale', scale })}
          options={counts.map((scale) => ({ id: scale.id, label: scale.name || 'Unnamed scale value' }))}
        />
      )}
    </div>
  );
}

export default function TrackerBlock({
  tracker,
  onChange,
  onRemove,
  scales = [],
  switches = [],
  literalOnly = false,
  issues,
  ariaLabel = 'Uses per rest',
}) {
  const emit = (patch) => onChange(compact({ ...tracker, ...patch }));
  const label = tracker.label.trim() || 'Uses per rest';
  const rolls = tracker.recharge === 'diceRoll';
  return (
    <div className="fcb-custom-block" role="group" aria-label={ariaLabel}>
      <div className="fcb-custom-row">
        <Field label="Name">
          <input
            className="fcb-input"
            aria-label="Limited use name"
            placeholder={literalOnly ? 'Charges' : 'What it is called'}
            value={tracker.label}
            onChange={(event) => emit({ label: event.target.value })}
          />
        </Field>
        <div>
          <span className="fcb-field-label">How many</span>
          <MaxEditor max={tracker.max} onChange={(max) => emit({ max })} scales={scales} literalOnly={literalOnly} label={label} />
        </div>
        <Field label="Counted in">
          <SelectInput label="Unit" value={tracker.unit} onChange={(unit) => emit({ unit })} options={UNIT_OPTIONS} />
        </Field>
        <Field label="Recharges on">
          <SelectInput
            label="Recharges on"
            value={tracker.recharge}
            onChange={(recharge) => emit({ recharge, regain: recharge === 'diceRoll' ? tracker.regain : undefined })}
            options={RECHARGE_OPTIONS}
          />
        </Field>
        {onRemove && <RemoveButton label={`Remove ${label.toLowerCase()}`} onClick={onRemove} />}
      </div>

      {rolls && (
        <Field label="What the roll regains">
          <input
            className="fcb-input"
            aria-label="Regains"
            placeholder="1d6+1 at dawn"
            value={tracker.regain ?? ''}
            onChange={(event) => emit({ regain: event.target.value === '' ? undefined : event.target.value })}
          />
        </Field>
      )}

      {!literalOnly && (
        <div className="fcb-custom-row">
          <Field label="Shared pool (features with the same pool spend one count)">
            <input
              className="fcb-input"
              aria-label="Shared pool"
              placeholder="Not shared"
              value={tracker.pool ?? ''}
              onChange={(event) => emit({ pool: event.target.value === '' ? undefined : event.target.value })}
            />
          </Field>
          {switches.length > 0 && (
            <Field label="Spent when a switch is turned on">
              <SelectInput
                label="Spent by switch"
                value={tracker.spendOnSwitch ?? ''}
                placeholder="Not spent by a switch"
                onChange={(spendOnSwitch) => emit({ spendOnSwitch: spendOnSwitch === '' ? undefined : spendOnSwitch })}
                options={switches.map((name) => ({ id: name, label: name }))}
              />
            </Field>
          )}
        </div>
      )}
      <p className="fcb-muted-copy text-xs">
        {literalOnly
          ? 'Counted on the Resources page: tap a pip or counter to spend a use, and the rest you choose refills it.'
          : `Counted on the Resources page, and printed on the sheet as ${tracker.max.kind === 'number' ? 'the usage line' : `the usage line (${describeMax(tracker.max, scales)})`}.`}
      </p>
      <Issues issues={issues} />
    </div>
  );
}
