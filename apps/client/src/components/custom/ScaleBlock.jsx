// B9: a scale value, a named per-level table: 1d6 at level 1 and 2d6 at level 5, or 2 uses at
// level 1 and 3 at level 6. Bonuses and limited uses in the same entry can follow a count, and
// the sheet text reads either one through the token shown below the table.

import { compact } from './draftModel';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from './fields';
import { scaleToken } from './trackerModel';

const KIND_OPTIONS = [
  { id: 'dice', label: 'A die' },
  { id: 'number', label: 'A count' },
];

export default function ScaleBlock({ scale, onChange, onRemove, issues }) {
  const emit = (patch) => onChange(compact({ ...scale, ...patch }));
  const setStep = (index, patch) => emit({ steps: scale.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)) });
  const changeKind = (kind) =>
    emit({ kind, steps: scale.steps.map((step) => ({ level: step.level, value: kind === 'number' ? 1 : '1d6' })) });
  const last = scale.steps[scale.steps.length - 1];
  const named = scale.name.trim() !== '';
  return (
    <div className="fcb-custom-block" role="group" aria-label="Scale value">
      <div className="fcb-custom-row">
        <Field label="Name">
          <input
            className="fcb-input"
            aria-label="Scale name"
            placeholder="Moonlight die"
            value={scale.name}
            onChange={(event) => emit({ name: event.target.value })}
          />
        </Field>
        <Field label="Grows as">
          <SelectInput label="Scale kind" value={scale.kind} onChange={changeKind} options={KIND_OPTIONS} />
        </Field>
        {onRemove && <RemoveButton label={`Remove ${scale.name.trim() || 'scale value'}`} onClick={onRemove} />}
      </div>
      <div className="space-y-2">
        {scale.steps.map((step, index) => (
          <div key={index} className="fcb-custom-row" role="group" aria-label={`Level ${index + 1} of the scale`}>
            <Field label="From level">
              <NumberInput label={`Scale level ${index + 1}`} min={1} max={20} value={step.level} onChange={(level) => setStep(index, { level: level ?? 1 })} />
            </Field>
            <Field label={scale.kind === 'dice' ? 'Die' : 'Count'}>
              {scale.kind === 'dice' ? (
                <input
                  className="fcb-input"
                  aria-label={`Scale value ${index + 1}`}
                  placeholder="1d6"
                  value={step.value}
                  onChange={(event) => setStep(index, { value: event.target.value.trim() })}
                />
              ) : (
                <NumberInput label={`Scale value ${index + 1}`} min={0} max={999} value={step.value} onChange={(value) => setStep(index, { value: value ?? 0 })} />
              )}
            </Field>
            {scale.steps.length > 1 && (
              <RemoveButton label={`Remove scale level ${index + 1}`} onClick={() => emit({ steps: scale.steps.filter((_, at) => at !== index) })} />
            )}
          </div>
        ))}
        {scale.steps.length < 20 && (
          <button
            type="button"
            className="fcb-mode-button"
            onClick={() => emit({ steps: [...scale.steps, { level: Math.min(20, (last?.level ?? 0) + 1), value: last?.value ?? (scale.kind === 'dice' ? '1d6' : 1) }] })}
          >
            + Level
          </button>
        )}
      </div>
      <p className="fcb-muted-copy text-xs">
        {named
          ? `Write ${scaleToken(scale)} in the sheet text to print it. Bonuses and limited uses can follow a count.`
          : 'Name it, then write its token in the sheet text to print it.'}
      </p>
      <Issues issues={issues} />
    </div>
  );
}
