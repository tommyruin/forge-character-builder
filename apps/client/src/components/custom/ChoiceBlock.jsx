// B3: a choice the player makes. The author names it, says how many to pick and of what, and
// narrows the list with a filter builder (ALL OF / ANY OF / NONE OF over tags, spell level,
// school and ids) or writes a short list of their own. The name, type, level and count are
// what the character's picks are remembered by, which is why the modal warns before they
// change. The block emits the draft's `ChoiceBlock` shape.

import {
  CUSTOM_GRANT_TYPES,
  MAX_CONDITION_DEPTH,
  WEAPON_FILTER_PRESETS,
  WEAPON_FILTER_TAGS,
  describeFilter,
  filterIssues,
  weaponFilterTag,
} from '@forge-cb/engine/custom';
import { abilityOptions, compact, typeLabel } from './draftModel';
import { Field, Issues, NumberInput, RemoveButton, SelectInput, withCurrent } from './fields';
import LibraryPicker from './LibraryPicker';
import RequirementsBuilder from './RequirementsBuilder';

const GROUP_OPS = [
  { id: 'all', label: 'All of' },
  { id: 'any', label: 'Any of' },
  { id: 'none', label: 'None of' },
];

const SCHOOLS = [
  'Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation',
].map((school) => ({ id: school, label: school }));

const SPELL_LEVELS = [{ id: '0', label: 'Cantrip' }, ...Array.from({ length: 9 }, (_, index) => ({ id: String(index + 1), label: `Level ${index + 1}` }))];

export const CHOICE_TYPE_OPTIONS = [...CUSTOM_GRANT_TYPES, 'List'].map((type) => ({ id: type, label: typeLabel(type) }));

const LEAVES = [
  { id: 'tag', label: 'Has the tag', make: () => ({ kind: 'tag', value: '' }) },
  { id: 'id', label: 'Is one of these', make: () => ({ kind: 'id', value: '' }) },
  { id: 'level', label: 'Spell level', make: () => ({ kind: 'level', value: 1 }), spellOnly: true },
  { id: 'school', label: 'School of magic', make: () => ({ kind: 'school', value: 'Evocation' }), spellOnly: true },
];

// Weapon proficiencies carry their category and properties as tags, so a choice among them can be
// narrowed in the words a weapon is described in ("melee", "one-handed", "finesse").
const WEAPON_LEAVES = [
  ...WEAPON_FILTER_PRESETS.map((preset) => ({
    id: `preset:${preset.id}`,
    label: preset.label,
    make: () => structuredClone(preset.node),
    weaponOnly: true,
  })),
  { id: 'weaponTag', label: 'Weapon category or property', make: () => ({ kind: 'tag', value: WEAPON_FILTER_TAGS[0].id }), weaponOnly: true },
];

const WEAPON_TAG_GROUPS = ['Category', 'Property'];

function Leaf({ node, onChange, type, lookup }) {
  switch (node.kind) {
    case 'tag':
      if (weaponFilterTag(node.value)) {
        return (
          <div className="fcb-custom-condition">
            <span>Weapon</span>
            <SelectInput label="Weapon category or property" value={node.value} onChange={(value) => onChange({ ...node, value })}>
              {WEAPON_TAG_GROUPS.map((groupName) => (
                <optgroup key={groupName} label={groupName === 'Category' ? 'Category' : 'Property'}>
                  {WEAPON_FILTER_TAGS.filter((tag) => tag.group === groupName).map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </SelectInput>
          </div>
        );
      }
      return (
        <div className="fcb-custom-condition">
          <span>Has the tag</span>
          <input
            className="fcb-input"
            aria-label="Tag"
            value={node.value}
            onChange={(event) => onChange({ ...node, value: event.target.value })}
          />
        </div>
      );
    case 'school':
      return (
        <div className="fcb-custom-condition">
          <span>School of</span>
          <SelectInput label="School of magic" value={node.value} onChange={(value) => onChange({ ...node, value })} options={SCHOOLS} />
        </div>
      );
    case 'level':
      return (
        <div className="fcb-custom-condition">
          <span>Spell level</span>
          <SelectInput
            label="Spell level"
            value={String(node.value)}
            onChange={(value) => onChange({ ...node, value: Number(value) })}
            options={SPELL_LEVELS}
          />
        </div>
      );
    case 'id':
      return (
        <div className="fcb-custom-condition">
          <LibraryPicker
            lookup={lookup}
            type={type === 'List' ? '' : type}
            value={node.value}
            valueLabel={node.label}
            label="Find the element"
            onPick={(item) => onChange({ ...node, value: item.id, label: item.name })}
          />
        </div>
      );
    default:
      return null;
  }
}

function FilterGroup({ node, onChange, onRemove, type, lookup, depth }) {
  const setItem = (index, item) => onChange({ ...node, items: node.items.map((entry, at) => (at === index ? item : entry)) });
  const removeItem = (index) => onChange({ ...node, items: node.items.filter((_, at) => at !== index) });
  const leaves = [...LEAVES, ...WEAPON_LEAVES].filter((leaf) => (!leaf.spellOnly || type === 'Spell') && (!leaf.weaponOnly || type === 'Proficiency'));
  return (
    <div className="fcb-custom-group" role="group" aria-label={`${GROUP_OPS.find((op) => op.id === node.op).label} filter group`}>
      <div className="flex items-center gap-2">
        <SelectInput label="Match" value={node.op} onChange={(op) => onChange({ ...node, op })} options={GROUP_OPS} />
        {onRemove && <RemoveButton label="Remove this filter group" onClick={onRemove} />}
      </div>
      <ul className="fcb-custom-conditions">
        {node.items.map((item, index) => (
          <li key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {item.kind === 'group' ? (
                <FilterGroup
                  node={item}
                  depth={depth + 1}
                  type={type}
                  lookup={lookup}
                  onChange={(next) => setItem(index, next)}
                  onRemove={() => removeItem(index)}
                />
              ) : (
                <Leaf node={item} type={type} lookup={lookup} onChange={(next) => setItem(index, next)} />
              )}
            </div>
            {item.kind !== 'group' && <RemoveButton label="Remove this filter" onClick={() => removeItem(index)} />}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <SelectInput
          label="Filter to add"
          value=""
          placeholder="Add a filter..."
          options={leaves}
          onChange={(id) => {
            const leaf = [...LEAVES, ...WEAPON_LEAVES].find((entry) => entry.id === id);
            if (leaf) onChange({ ...node, items: [...node.items, leaf.make()] });
          }}
        />
        {depth < MAX_CONDITION_DEPTH - 1 && (
          <button
            type="button"
            className="fcb-button"
            onClick={() => onChange({ ...node, items: [...node.items, { kind: 'group', op: 'any', items: [LEAVES[0].make()] }] })}
          >
            Add a group
          </button>
        )}
      </div>
    </div>
  );
}

// B3's filter builder on its own, for the Homebrew editor to reuse.
export function FilterBuilder({ value, onChange, type, lookup, label = 'Filter' }) {
  const issues = value ? filterIssues(value) : [];
  if (!value) {
    return (
      <div role="group" aria-label={label}>
        <p className="fcb-muted-copy text-xs">Everything of this kind is offered.</p>
        <button
          type="button"
          className="fcb-button"
          onClick={() => onChange({ kind: 'group', op: 'all', items: [LEAVES[0].make()] })}
        >
          Narrow the list
        </button>
      </div>
    );
  }
  return (
    <div role="group" aria-label={label}>
      <FilterGroup
        node={value}
        depth={0}
        type={type}
        lookup={lookup}
        onChange={(next) => onChange(next.items.length === 0 ? undefined : next)}
      />
      <Issues issues={issues} />
      {issues.length === 0 && (
        <p className="fcb-custom-readout">
          <strong>Offers things that are:</strong> {describeFilter(value)}
        </p>
      )}
    </div>
  );
}

function ItemsEditor({ items, onChange }) {
  return (
    <div className="space-y-2" role="group" aria-label="Your list">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className="fcb-input"
            aria-label={`List item ${index + 1}`}
            value={item}
            onChange={(event) => onChange(items.map((entry, at) => (at === index ? event.target.value : entry)))}
          />
          <RemoveButton
            label={`Remove list item ${index + 1}`}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <button type="button" className="fcb-button" onClick={() => onChange([...items, ''])}>
        Add an item
      </button>
    </div>
  );
}

export default function ChoiceBlock({
  block,
  onChange,
  onRemove,
  lookup,
  casters = [],
  issues,
  ariaLabel = 'Player choice',
  typeOptions = CHOICE_TYPE_OPTIONS,
  defaultCastAbility,
}) {
  const emit = (patch) => onChange(compact({ ...block, ...patch }));
  const isList = block.type === 'List';
  const isSpell = block.type === 'Spell';

  const changeType = (type) =>
    emit({
      type,
      supports: type === 'List' ? undefined : block.supports,
      items: type === 'List' ? (block.items?.length ? block.items : ['']) : undefined,
      castAbility: type === 'Spell' ? (block.castAbility ?? defaultCastAbility) : undefined,
      caster: type === 'Spell' ? block.caster : undefined,
    });

  return (
    <div className="fcb-custom-block" role="group" aria-label={ariaLabel}>
      <div className="fcb-custom-row">
        <Field label="Name of the choice">
          <input
            className="fcb-input"
            aria-label="Name of the choice"
            value={block.name}
            onChange={(event) => emit({ name: event.target.value })}
          />
        </Field>
        {onRemove && <RemoveButton label={`Remove ${ariaLabel.toLowerCase()}`} onClick={onRemove} />}
      </div>
      <div className="fcb-custom-row">
        <Field label="How many">
          <NumberInput label="How many to pick" min={1} max={20} value={block.count} onChange={(count) => emit({ count: count ?? 1 })} />
        </Field>
        <Field label="Of">
          <SelectInput label="What the player picks" value={block.type} onChange={changeType} options={withCurrent(typeOptions, block.type, typeLabel(block.type))} />
        </Field>
        <Field label="From level">
          <NumberInput label="Choice from level" min={1} max={20} value={block.level} onChange={(level) => emit({ level })} />
        </Field>
      </div>

      {isList ? (
        <ItemsEditor items={block.items ?? ['']} onChange={(items) => emit({ items })} />
      ) : (
        <FilterBuilder
          label="Which ones are offered"
          value={block.supports}
          type={block.type}
          lookup={lookup}
          onChange={(supports) => emit({ supports })}
        />
      )}

      {isSpell && (
        <div className="fcb-custom-row">
          <Field label="Cast with">
            <SelectInput
              label="Casting ability"
              value={block.castAbility ?? ''}
              placeholder={block.castAbility ? undefined : 'Choose an ability'}
              options={abilityOptions}
              onChange={(castAbility) => castAbility !== '' && emit({ castAbility })}
            />
          </Field>
          {casters.length > 0 && (
            <Field label="Joins the spell list of">
              <SelectInput
                label="Spellcasting feature"
                value={block.caster ?? ''}
                placeholder="None"
                options={casters.map((name) => ({ id: name, label: name }))}
                onChange={(caster) => emit({ caster: caster === '' ? undefined : caster })}
              />
            </Field>
          )}
        </div>
      )}

      <details className="fcb-custom-gates">
        <summary>Only when</summary>
        <div className="fcb-custom-gates-body">
          <RequirementsBuilder
            label="Requirements for this choice"
            lookup={lookup}
            value={block.requirements}
            onChange={(requirements) => emit({ requirements })}
          />
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={block.optional === true}
          onChange={(event) => emit({ optional: event.target.checked ? true : undefined })}
        />
        The player may leave it unpicked
      </label>
      <Issues issues={issues} />
    </div>
  );
}
