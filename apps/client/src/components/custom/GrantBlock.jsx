// B2: one grant. The author searches the library by element type and picks what is granted, or
// names it for content the library does not hold yet. A spell gets its own options: the ability
// it is cast with, and how it is cast (known, a number of times per rest with no slot, always
// prepared by a class, or at will). The block emits the draft's `GrantBlock` shape.

import { CUSTOM_GRANT_TYPES } from '@forge-cb/engine/custom';
import {
  RECHARGES,
  abilityOptions,
  compact,
  parseUsage,
  spellMode,
  typeLabel,
  usageText,
} from './draftModel';
import { Field, Issues, NumberInput, RemoveButton, Segmented, SelectInput } from './fields';
import LibraryPicker from './LibraryPicker';
import RequirementsBuilder from './RequirementsBuilder';

const TARGET_MODES = [
  { id: 'id', label: 'From the library' },
  { id: 'name', label: 'By name' },
];

const SPELL_MODES = [
  { id: 'known', label: 'Known' },
  { id: 'perRest', label: 'Uses per rest, no slot' },
  { id: 'prepared', label: 'Always prepared' },
  { id: 'atWill', label: 'At will' },
];

export const GRANT_TYPE_OPTIONS = CUSTOM_GRANT_TYPES.map((type) => ({ id: type, label: typeLabel(type) }));

// Rebuilds the spell options for a mode, keeping the cast ability the author already chose.
function spellFor(mode, previous, casters, uses) {
  const base = { castAbility: previous?.castAbility };
  switch (mode) {
    case 'perRest':
      return compact({ ...base, usage: usageText(uses.count, uses.recharge) });
    case 'atWill':
      return compact({ ...base, usage: 'At will' });
    case 'prepared':
      return compact({ ...base, prepared: true, caster: previous?.caster ?? casters[0] });
    default:
      return compact(base);
  }
}

export default function GrantBlock({
  block,
  onChange,
  onRemove,
  lookup,
  casters = [],
  issues,
  ariaLabel = 'Grant',
  typeOptions = GRANT_TYPE_OPTIONS,
  defaultCastAbility,
}) {
  const type = block.target.type;
  const isSpell = type === 'Spell';
  const spell = block.spell;
  const mode = spellMode(spell);
  const uses = parseUsage(spell?.usage) ?? { count: 1, recharge: 'Long Rest' };
  const emit = (patch) => {
    const next = compact({ ...block, ...patch });
    if (next.spell && Object.keys(next.spell).length === 0) delete next.spell;
    onChange(next);
  };
  const setSpell = (nextSpell) => emit({ spell: nextSpell && Object.keys(nextSpell).length > 0 ? nextSpell : undefined });
  const modes = SPELL_MODES.filter((option) => option.id !== 'prepared' || casters.length > 0);

  const changeType = (next) =>
    emit({
      target: { by: 'id', type: next, id: '' },
      spell: next === 'Spell' ? (spell ?? (defaultCastAbility ? { castAbility: defaultCastAbility } : undefined)) : undefined,
    });

  return (
    <div className="fcb-custom-block" role="group" aria-label={ariaLabel}>
      <div className="fcb-custom-row">
        <Field label="Kind">
          <SelectInput label="Kind of element granted" value={type} onChange={changeType} options={typeOptions} />
        </Field>
        <Segmented
          label="How to choose it"
          value={block.target.by}
          options={TARGET_MODES}
          onChange={(by) =>
            emit({ target: by === 'id' ? { by: 'id', type, id: '' } : { by: 'name', type, name: '' } })
          }
        />
        {onRemove && <RemoveButton label={`Remove ${ariaLabel.toLowerCase()}`} onClick={onRemove} />}
      </div>

      {block.target.by === 'id' ? (
        <LibraryPicker
          lookup={lookup}
          type={type}
          value={block.target.id}
          valueLabel={block.target.label}
          label={`Search ${typeLabel(type).toLowerCase()} entries`}
          onPick={(item) => emit({ target: { by: 'id', type, id: item.id, label: item.name } })}
        />
      ) : (
        <Field label="Name of the element">
          <input
            className="fcb-input"
            aria-label="Name of the element"
            value={block.target.name}
            onChange={(event) => emit({ target: { by: 'name', type, name: event.target.value } })}
          />
        </Field>
      )}

      {isSpell && (
        <div className="fcb-custom-spell">
          <Segmented
            label="How the spell is cast"
            value={mode}
            options={modes}
            onChange={(next) => setSpell(spellFor(next, spell, casters, uses))}
          />
          {mode === 'perRest' && (
            <div className="fcb-custom-row">
              <Field label="Uses">
                <NumberInput
                  label="Uses"
                  min={1}
                  max={99}
                  value={uses.count}
                  onChange={(count) => setSpell(compact({ ...spell, usage: usageText(count ?? 1, uses.recharge) }))}
                />
              </Field>
              <Field label="Recharges on">
                <SelectInput
                  label="Recharges on"
                  value={uses.recharge}
                  options={RECHARGES}
                  onChange={(recharge) => setSpell(compact({ ...spell, usage: usageText(uses.count, recharge) }))}
                />
              </Field>
            </div>
          )}
          {mode === 'prepared' && (
            <Field label="Prepared by">
              <SelectInput
                label="Prepared by"
                value={spell?.caster ?? ''}
                options={casters.map((name) => ({ id: name, label: name }))}
                onChange={(caster) => setSpell(compact({ ...spell, caster }))}
              />
            </Field>
          )}
          <Field label="Cast with">
            <SelectInput
              label="Casting ability"
              value={spell?.castAbility ?? ''}
              placeholder={spell?.castAbility ? undefined : 'Choose an ability'}
              options={abilityOptions}
              onChange={(castAbility) => castAbility !== '' && setSpell(compact({ ...spell, castAbility }))}
            />
          </Field>
        </div>
      )}

      <div className="fcb-custom-row">
        <Field label="From level">
          <NumberInput label="Grant from level" min={1} max={20} value={block.level} onChange={(level) => emit({ level })} />
        </Field>
      </div>
      <details className="fcb-custom-gates">
        <summary>Only when</summary>
        <div className="fcb-custom-gates-body">
          <RequirementsBuilder
            label="Requirements for this grant"
            lookup={lookup}
            value={block.requirements}
            onChange={(requirements) => emit({ requirements })}
          />
        </div>
      </details>
      <Issues issues={issues} />
    </div>
  );
}
