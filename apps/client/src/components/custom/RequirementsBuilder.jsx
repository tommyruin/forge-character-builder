// B4: the requirements builder. Groups of conditions joined ALL OF / ANY OF / NONE OF (AND / OR /
// NOT), nestable, with the conditions the engine can evaluate. The value is the draft's own
// `RequirementNode` tree; the engine compiles it to an expression, so nobody types one. The
// engine's own validator names what is still missing, and the plain-language reading shows
// what the tree will mean.

import {
  CUSTOM_MODIFIER_TARGETS,
  CUSTOM_VALUE_REFERENCES,
  MAX_CONDITION_DEPTH,
  describeRequirements,
  requirementIssues,
} from '@forge-cb/engine/custom';
import { abilityOptions } from './draftModel';
import { Issues, NumberInput, RemoveButton, SelectInput, withCurrent } from './fields';
import LibraryPicker from './LibraryPicker';

const GROUP_OPS = [
  { id: 'all', label: 'All of' },
  { id: 'any', label: 'Any of' },
  { id: 'none', label: 'None of' },
];

const CONDITION_KINDS = [
  { id: 'has', label: 'Has an element or rule', make: () => ({ kind: 'element', id: '' }) },
  { id: 'lacks', label: 'Lacks an element or rule', make: () => ({ kind: 'element', id: '', negate: true }) },
  { id: 'elementType', label: 'Has an element of a type', make: () => ({ kind: 'elementType', type: 'Class' }) },
  { id: 'ability', label: 'Ability score at least', make: () => ({ kind: 'ability', ability: 'strength', min: 13 }) },
  { id: 'level', label: 'Character level at least', make: () => ({ kind: 'level', min: 1 }) },
  { id: 'classLevel', label: 'Class level at least', make: () => ({ kind: 'classLevel', className: '', min: 1 }) },
  { id: 'stat', label: 'Another statistic at least', make: () => ({ kind: 'stat', key: 'proficiency', min: 1 }) },
];

// The XML element types a requirement can name; the id stays the type the content uses, the label
// is the app's word for it.
const ELEMENT_TYPE_LABELS = { Race: 'Species', 'Racial Trait': 'Species trait', Archetype: 'Subclass', 'Archetype Feature': 'Subclass feature' };
const ELEMENT_TYPES = [
  'Class', 'Race', 'Background', 'Archetype', 'Feat', 'Racial Trait', 'Class Feature', 'Archetype Feature',
  'Language', 'Proficiency',
].map((type) => ({ id: type, label: ELEMENT_TYPE_LABELS[type] ?? type }));

const STAT_OPTIONS = [
  ...CUSTOM_VALUE_REFERENCES.map((entry) => ({ id: entry.id, label: entry.label })),
  ...CUSTOM_MODIFIER_TARGETS.filter((target) => target.modes.includes('add')).map((target) => ({ id: target.id, label: target.label })),
];

function Condition({ node, onChange, lookup }) {
  switch (node.kind) {
    case 'element':
      return (
        <div className="fcb-custom-condition">
          <SelectInput
            label="Has or lacks"
            value={node.negate ? 'lacks' : 'has'}
            onChange={(next) => onChange({ ...node, negate: next === 'lacks' ? true : undefined })}
            options={[
              { id: 'has', label: 'Has' },
              { id: 'lacks', label: 'Lacks' },
            ]}
          />
          <LibraryPicker
            lookup={lookup}
            value={node.id}
            valueLabel={node.label}
            label="Find the element or rule"
            onPick={(item) => onChange({ ...node, id: item.id, label: item.name })}
          />
        </div>
      );
    case 'elementType':
      return (
        <div className="fcb-custom-condition">
          <span>Has an element of the type</span>
          <SelectInput label="Element type" value={node.type} onChange={(type) => onChange({ ...node, type })} options={withCurrent(ELEMENT_TYPES, node.type)} />
        </div>
      );
    case 'ability':
      return (
        <div className="fcb-custom-condition">
          <SelectInput label="Ability" value={node.ability} onChange={(ability) => onChange({ ...node, ability })} options={abilityOptions} />
          <span>at least</span>
          <NumberInput label="Minimum score" min={1} max={30} value={node.min} onChange={(min) => onChange({ ...node, min })} />
        </div>
      );
    case 'level':
      return (
        <div className="fcb-custom-condition">
          <span>Character level at least</span>
          <NumberInput label="Minimum level" min={1} max={20} value={node.min} onChange={(min) => onChange({ ...node, min })} />
        </div>
      );
    case 'classLevel':
      return (
        <div className="fcb-custom-condition">
          <input
            className="fcb-input"
            aria-label="Class name"
            placeholder="Class name"
            value={node.className}
            onChange={(event) => onChange({ ...node, className: event.target.value })}
          />
          <span>level at least</span>
          <NumberInput label="Minimum class level" min={1} max={20} value={node.min} onChange={(min) => onChange({ ...node, min })} />
        </div>
      );
    case 'stat': {
      const { label: _label, ...rest } = node;
      return (
        <div className="fcb-custom-condition">
          <SelectInput label="Statistic" value={node.key} onChange={(key) => onChange({ ...rest, key })} options={STAT_OPTIONS} />
          <span>at least</span>
          <NumberInput label="Minimum value" value={node.min} onChange={(min) => onChange({ ...node, min })} />
        </div>
      );
    }
    default:
      return null;
  }
}

function Group({ node, onChange, onRemove, lookup, depth }) {
  const setItem = (index, item) => onChange({ ...node, items: node.items.map((entry, at) => (at === index ? item : entry)) });
  const removeItem = (index) => onChange({ ...node, items: node.items.filter((_, at) => at !== index) });
  const add = (kind) => onChange({ ...node, items: [...node.items, kind] });
  const kindId = `add-${depth}`;

  return (
    <div className="fcb-custom-group" role="group" aria-label={`${GROUP_OPS.find((op) => op.id === node.op).label} group`}>
      <div className="flex items-center gap-2">
        <SelectInput label="Match" value={node.op} onChange={(op) => onChange({ ...node, op })} options={GROUP_OPS} />
        {onRemove && <RemoveButton label="Remove this group" onClick={onRemove} />}
      </div>
      <ul className="fcb-custom-conditions">
        {node.items.map((item, index) => (
          <li key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {item.kind === 'group' ? (
                <Group
                  node={item}
                  depth={depth + 1}
                  lookup={lookup}
                  onChange={(next) => setItem(index, next)}
                  onRemove={() => removeItem(index)}
                />
              ) : (
                <Condition node={item} lookup={lookup} onChange={(next) => setItem(index, next)} />
              )}
            </div>
            {item.kind !== 'group' && <RemoveButton label="Remove this condition" onClick={() => removeItem(index)} />}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <SelectInput
          id={kindId}
          label="Condition to add"
          value=""
          placeholder="Add a condition..."
          onChange={(id) => {
            const kind = CONDITION_KINDS.find((entry) => entry.id === id);
            if (kind) add(kind.make());
          }}
          options={CONDITION_KINDS}
        />
        {depth < MAX_CONDITION_DEPTH - 1 && (
          <button
            type="button"
            className="fcb-button"
            onClick={() => add({ kind: 'group', op: 'any', items: [CONDITION_KINDS[3].make()] })}
          >
            Add a group
          </button>
        )}
      </div>
    </div>
  );
}

export default function RequirementsBuilder({ value, onChange, lookup, label = 'Requirements' }) {
  const issues = value ? requirementIssues(value).map((issue) => ({ path: issue.path, message: issue.message })) : [];

  if (!value) {
    return (
      <div className="fcb-custom-requirements" role="group" aria-label={label}>
        <p className="fcb-muted-copy text-xs">No requirements.</p>
        <button
          type="button"
          className="fcb-button"
          onClick={() => onChange({ kind: 'group', op: 'all', items: [CONDITION_KINDS[4].make()] })}
        >
          Add requirements
        </button>
      </div>
    );
  }

  return (
    <div className="fcb-custom-requirements" role="group" aria-label={label}>
      <Group
        node={value}
        depth={0}
        lookup={lookup}
        onChange={(next) => onChange(next.items.length === 0 ? undefined : next)}
      />
      <Issues issues={issues} />
      {issues.length === 0 && (
        <p className="fcb-custom-readout">
          <strong>Reads as:</strong> {describeRequirements(value)}
        </p>
      )}
    </div>
  );
}
