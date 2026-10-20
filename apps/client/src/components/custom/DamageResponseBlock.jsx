// One resistance, immunity or vulnerability an item grants. The author picks which and the damage
// type; the block stores the library condition of that name, so nothing about the saved shape
// changes and the words "Condition" and "Internal" never show.

import { DAMAGE_RESPONSES, DAMAGE_TYPE_OPTIONS, damageResponseGrant, damageResponseOf } from './draftModel';
import { Field, Issues, RemoveButton, Segmented, SelectInput } from './fields';

export default function DamageResponseBlock({ block, onChange, onRemove, issues, ariaLabel = 'Damage resistance' }) {
  const current = damageResponseOf(block);
  return (
    <div className="fcb-custom-block" role="group" aria-label={ariaLabel}>
      <div className="fcb-custom-row">
        <div>
          <span className="fcb-field-label">Effect</span>
          <Segmented
            label="Damage effect"
            value={current.response}
            options={DAMAGE_RESPONSES}
            onChange={(response) => onChange(damageResponseGrant(response, current.type, block))}
            className="mt-1"
          />
        </div>
        <Field label="Damage type">
          <SelectInput
            label="Damage type"
            value={current.type}
            options={DAMAGE_TYPE_OPTIONS}
            onChange={(type) => onChange(damageResponseGrant(current.response, type, block))}
          />
        </Field>
        {onRemove && <RemoveButton label={`Remove ${ariaLabel.toLowerCase()}`} onClick={onRemove} />}
      </div>
      <Issues issues={issues} />
    </div>
  );
}
